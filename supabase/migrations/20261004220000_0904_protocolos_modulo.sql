-- 0904 — Protocolos: módulo opcional (spec 22, docs/specs/22-spec-modulo-protocolos.md).
--
-- A demanda operacional de um cliente atual ("preciso da guia", "vou admitir alguém amanhã",
-- "chegou uma intimação") com categoria, competência, prioridade P1–P4, área, responsável, ciclo
-- de vida e SLA. "Protocolo" e não "chamado" porque o produto já chama `agent_cases` de "chamado
-- humano" na tela (spec 22, nota de nome).
--
-- ── Por que MÓDULO (ADR-0002) ─────────────────────────────────────────────────
-- Quem vende para pessoa física e atende pela inbox não tem fila de demandas com SLA. Se nenhuma
-- instalação ligar isto, a operação comum continua inteira. As tabelas nascem por
-- `fn_protocolos_provisionar()` quando o administrador instala o módulo em /admin/modulos.
--
-- ── As tabelas ───────────────────────────────────────────────────────────────
-- protocolo_categorias     — categoria e subcategoria (um nível), com área, prioridade padrão,
--                            se exige competência e se exige passagem para humano.
-- protocolo_politicas_sla  — prazos de primeira resposta e de resolução por prioridade (e,
--                            opcionalmente, por categoria), em minutos úteis ou corridos.
-- protocolo_area_membros   — quem trabalha a fila de cada área, e o líder. Em TABELA e não no
--                            jsonb de settings: id de usuário em jsonb é chave estrangeira que o
--                            banco não confere (anti-patterns 1 e 4 — decisão do dono, Q8).
-- protocolo_feriados       — dias sem expediente, para o relógio do SLA.
-- protocolo_contadores     — numeração anual por organização (molde de crm_proposal_counters).
-- protocolos               — a demanda.
-- protocolo_eventos        — a linha do tempo (append-only para os três papéis).
-- protocolo_marcos_sla     — idempotência do escalonamento 80/100/120% (a PK é a trava).
--
-- ── Quem escreve o quê ────────────────────────────────────────────────────────
-- * `protocolos` só é escrito pelo SERVIÇO (`lib/protocolos/`), com o service role, depois do
--   `requireRole` da rota: o SLA é calculado em TypeScript (expediente, feriados, pausas —
--   `lib/protocolos/sla.ts`), e uma escrita direta pelo PostgREST mudaria o estado sem recalcular
--   os prazos. Por isso `authenticated` não tem INSERT/UPDATE/DELETE nela; a sessão só LÊ.
-- * O que não depende de calendário mora em GATILHO e vale para qualquer escritor: número e ano,
--   campos imutáveis, a máquina de estados (transição fora da tabela é recusada), os carimbos
--   (resolvido_em, fechado_em, primeira resposta, reaberturas), a coerência entre organizações e
--   a linha do tempo.
-- * Nota e complemento do cliente entram na linha do tempo por `fn_protocolo_registrar_evento`.
-- * A configuração (categorias, políticas, membros, feriados) é escrita pela sessão do `admin`,
--   pela RLS por operação.
--
-- ── LGPD (D8, migration 0485) ─────────────────────────────────────────────────
-- Diferente da carteira, aqui HÁ texto livre sobre a pessoa: título, descrição, resumo, urgência
-- declarada, e o texto/anterior/novo dos eventos. As seções vão para `modulo_secoes_lgpd` (fim
-- deste arquivo), e a anonimização do contato as alcança pelo gatilho genérico, que pula sem erro
-- onde o módulo não está instalado. Número, datas, categoria, prioridade e relógios sobrevivem:
-- são operação.
--
-- ── Sem event_log nesta migration ─────────────────────────────────────────────
-- Os eventos `protocolo.*` entram com o primeiro consumidor (o watcher de SLA e a Central,
-- PR-C2/D) — evento sem handler fica `pending` para sempre (anti-pattern nº 3).

create or replace function public.fn_protocolos_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── protocolo_categorias ───────────────────────────────────────────────────
  create table if not exists public.protocolo_categorias (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    parent_id uuid,
    nome text not null check (char_length(btrim(nome)) between 1 and 80),
    slug text not null check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
    -- Slug de `organizations.settings.atendimento.areas` (lib/atendimento/areas.ts).
    area text not null check (area ~ '^[a-z][a-z0-9_]{1,40}$'),
    prioridade_padrao text not null default 'P3' check (prioridade_padrao in ('P1', 'P2', 'P3', 'P4')),
    exige_competencia boolean not null default false,
    exige_handoff boolean not null default false,
    -- Quando usar esta categoria — vai para a descrição da ferramenta do assistente, nunca ao cliente.
    descricao_para_ia text check (descricao_para_ia is null or char_length(descricao_para_ia) <= 500),
    ativa boolean not null default true,
    posicao integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint protocolo_categorias_org_id_unico unique (organization_id, id),
    constraint protocolo_categorias_pai_da_org
      foreign key (organization_id, parent_id)
      references public.protocolo_categorias (organization_id, id) on delete cascade,
    constraint protocolo_categorias_nao_e_pai_dela
      check (parent_id is null or parent_id <> id)
  );
  -- `nulls not distinct` não existe no piso (pg15 tem, mas o índice parcial é mais legível):
  -- um slug por organização entre as categorias, e um por categoria entre as subcategorias.
  create unique index if not exists protocolo_categorias_slug_raiz_idx
    on public.protocolo_categorias (organization_id, slug) where parent_id is null;
  create unique index if not exists protocolo_categorias_slug_sub_idx
    on public.protocolo_categorias (organization_id, parent_id, slug) where parent_id is not null;

  -- ── protocolo_politicas_sla ────────────────────────────────────────────────
  create table if not exists public.protocolo_politicas_sla (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    prioridade text not null check (prioridade in ('P1', 'P2', 'P3', 'P4')),
    categoria_id uuid,
    primeira_resposta_min integer not null check (primeira_resposta_min > 0),
    resolucao_min integer not null check (resolucao_min > 0),
    em_horario_util boolean not null default true,
    pausa_aguardando_cliente boolean not null default true,
    pausa_aguardando_terceiro boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint protocolo_politicas_sla_categoria_da_org
      foreign key (organization_id, categoria_id)
      references public.protocolo_categorias (organization_id, id) on delete cascade
  );
  create unique index if not exists protocolo_politicas_sla_geral_idx
    on public.protocolo_politicas_sla (organization_id, prioridade) where categoria_id is null;
  create unique index if not exists protocolo_politicas_sla_categoria_idx
    on public.protocolo_politicas_sla (organization_id, prioridade, categoria_id) where categoria_id is not null;

  -- ── protocolo_area_membros ─────────────────────────────────────────────────
  create table if not exists public.protocolo_area_membros (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    area text not null check (area ~ '^[a-z][a-z0-9_]{1,40}$'),
    user_id uuid not null,
    papel text not null default 'membro' check (papel in ('membro', 'lider')),
    created_at timestamptz not null default now(),
    -- Membro desta organização; sair dela tira a pessoa da fila sozinho.
    constraint protocolo_area_membros_membro_da_org
      foreign key (organization_id, user_id)
      references public.user_organizations (organization_id, user_id) on delete cascade,
    constraint protocolo_area_membros_unico unique (organization_id, area, user_id)
  );
  create unique index if not exists protocolo_area_membros_um_lider_idx
    on public.protocolo_area_membros (organization_id, area) where papel = 'lider';

  -- ── protocolo_feriados ─────────────────────────────────────────────────────
  create table if not exists public.protocolo_feriados (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    data date not null,
    descricao text not null check (char_length(btrim(descricao)) between 1 and 120),
    created_at timestamptz not null default now(),
    constraint protocolo_feriados_um_por_dia unique (organization_id, data)
  );

  -- ── protocolo_contadores ───────────────────────────────────────────────────
  create table if not exists public.protocolo_contadores (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    ano integer not null check (ano between 2000 and 2999),
    ultimo_numero integer not null default 0 check (ultimo_numero >= 0),
    primary key (organization_id, ano)
  );

  -- ── protocolos ─────────────────────────────────────────────────────────────
  create table if not exists public.protocolos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- Atribuídos pelo gatilho de numeração; qualquer valor enviado é ignorado.
    ano integer not null default 0,
    numero integer not null default 0,
    -- Gravado NA ABERTURA: trocar o contexto da conversa depois não move o protocolo de empresa.
    company_id uuid references public.companies(id) on delete set null,
    contact_id uuid references public.contacts(id) on delete set null,
    conversation_id uuid references public.conversations(id) on delete set null,
    agent_case_id uuid references public.agent_cases(id) on delete set null,
    demanda_id uuid references public.demandas(id) on delete set null,
    lead_id uuid references public.crm_leads(id) on delete set null,
    categoria_id uuid not null,
    subcategoria_id uuid,
    competencia text check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    titulo text not null check (char_length(btrim(titulo)) between 1 and 200),
    descricao text not null check (char_length(descricao) between 1 and 5000),
    -- Resumo estruturado (spec 22 §5), validado pelo Zod central. Nulo = anonimizado.
    resumo jsonb check (resumo is null or jsonb_typeof(resumo) = 'object'),
    prioridade text not null check (prioridade in ('P1', 'P2', 'P3', 'P4')),
    prioridade_origem text not null default 'regra' check (prioridade_origem in ('regra', 'ia', 'humano')),
    prioridade_motivo text check (prioridade_motivo is null or char_length(prioridade_motivo) <= 300),
    -- O que o CLIENTE disse sobre urgência — separado da prioridade operacional (modelo §27).
    urgencia_declarada text check (urgencia_declarada is null or char_length(urgencia_declarada) <= 300),
    prazo_cliente date,
    area text not null check (area ~ '^[a-z][a-z0-9_]{1,40}$'),
    responsavel_user_id uuid,
    distribuido_por text check (distribuido_por in ('carteira', 'fila', 'fallback', 'humano')),
    estado text not null default 'novo'
      check (estado in ('novo', 'triagem', 'atribuido', 'em_atendimento', 'aguardando_cliente',
                        'aguardando_terceiro', 'aguardando_interno', 'resolvido', 'fechado',
                        'cancelado', 'reaberto')),
    origem text not null check (origem in ('agente', 'humano', 'api', 'automacao')),
    politica_sla_id uuid references public.protocolo_politicas_sla(id) on delete set null,
    aberto_em timestamptz not null default now(),
    primeira_resposta_vence_em timestamptz,
    primeira_resposta_em timestamptz,
    resolucao_vence_em timestamptz,
    resolvido_em timestamptz,
    pausado_desde timestamptz,
    pausa_acumulada interval not null default interval '0',
    fechado_em timestamptz,
    motivo_encerramento text check (motivo_encerramento is null or char_length(motivo_encerramento) <= 300),
    reaberturas integer not null default 0 check (reaberturas >= 0),
    revision bigint not null default 1,
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint protocolos_categoria_da_org
      foreign key (organization_id, categoria_id)
      references public.protocolo_categorias (organization_id, id) on delete restrict,
    constraint protocolos_subcategoria_da_org
      foreign key (organization_id, subcategoria_id)
      references public.protocolo_categorias (organization_id, id) on delete restrict,
    constraint protocolos_responsavel_membro_da_org
      foreign key (organization_id, responsavel_user_id)
      references public.user_organizations (organization_id, user_id) on delete set null (responsavel_user_id),
    constraint protocolos_sub_nao_e_a_categoria
      check (subcategoria_id is null or subcategoria_id <> categoria_id),
    constraint protocolos_fechado_coerente
      check ((fechado_em is null) = (estado not in ('fechado', 'cancelado'))),
    constraint protocolos_numero_unico unique (organization_id, ano, numero)
  );

  create index if not exists protocolos_watcher_idx
    on public.protocolos (organization_id, estado, resolucao_vence_em);
  create index if not exists protocolos_empresa_idx
    on public.protocolos (organization_id, company_id, aberto_em desc);
  create index if not exists protocolos_responsavel_idx
    on public.protocolos (organization_id, responsavel_user_id, estado);
  create index if not exists protocolos_fila_idx
    on public.protocolos (organization_id, area, estado) where responsavel_user_id is null;
  create index if not exists protocolos_contato_idx
    on public.protocolos (organization_id, contact_id) where contact_id is not null;

  -- ── protocolo_eventos ──────────────────────────────────────────────────────
  create table if not exists public.protocolo_eventos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    protocolo_id uuid not null references public.protocolos(id) on delete cascade,
    tipo text not null
      check (tipo in ('aberto', 'classificacao_corrigida', 'prioridade_alterada', 'atribuido',
                      'transferido', 'estado_alterado', 'nota', 'complemento_do_cliente',
                      'sla_alerta', 'sla_estourado', 'reaberto', 'resolvido', 'fechado', 'cancelado')),
    anterior jsonb,
    novo jsonb,
    texto text check (texto is null or char_length(texto) <= 5000),
    ator_kind text not null check (ator_kind in ('humano', 'ia', 'sistema')),
    ator_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
  );
  create index if not exists protocolo_eventos_protocolo_idx
    on public.protocolo_eventos (protocolo_id, created_at);

  -- ── protocolo_marcos_sla ───────────────────────────────────────────────────
  create table if not exists public.protocolo_marcos_sla (
    protocolo_id uuid not null references public.protocolos(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    relogio text not null check (relogio in ('primeira_resposta', 'resolucao')),
    marco smallint not null check (marco in (80, 100, 120)),
    disparado_em timestamptz not null default now(),
    primary key (protocolo_id, relogio, marco)
  );

  -- ── Gatilhos (as funções vêm da migration — D7; aqui só se prendem) ─────────
  drop trigger if exists protocolo_categorias_coerencia on public.protocolo_categorias;
  create trigger protocolo_categorias_coerencia
    before insert or update on public.protocolo_categorias
    for each row execute function public.fn_protocolo_categoria_coerente();

  drop trigger if exists protocolos_antes on public.protocolos;
  create trigger protocolos_antes
    before insert or update on public.protocolos
    for each row execute function public.fn_protocolo_antes_de_gravar();
  drop trigger if exists protocolos_linha_do_tempo on public.protocolos;
  create trigger protocolos_linha_do_tempo
    after insert or update on public.protocolos
    for each row execute function public.fn_protocolo_evento();

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui) ─────────────────────────────────────
  -- Configuração: leitura da organização, escrita do `admin` (spec 22 §12). Cada `create policy`
  -- em DUAS linhas (nome / tabela) de propósito (#1906).
  alter table public.protocolo_categorias enable row level security;
  drop policy if exists protocolo_categorias_select on public.protocolo_categorias;
  create policy protocolo_categorias_select
    on public.protocolo_categorias
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists protocolo_categorias_escrita on public.protocolo_categorias;
  create policy protocolo_categorias_escrita
    on public.protocolo_categorias
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.protocolo_categorias from anon;

  alter table public.protocolo_politicas_sla enable row level security;
  drop policy if exists protocolo_politicas_sla_select on public.protocolo_politicas_sla;
  create policy protocolo_politicas_sla_select
    on public.protocolo_politicas_sla
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists protocolo_politicas_sla_escrita on public.protocolo_politicas_sla;
  create policy protocolo_politicas_sla_escrita
    on public.protocolo_politicas_sla
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.protocolo_politicas_sla from anon;

  alter table public.protocolo_area_membros enable row level security;
  drop policy if exists protocolo_area_membros_select on public.protocolo_area_membros;
  create policy protocolo_area_membros_select
    on public.protocolo_area_membros
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists protocolo_area_membros_escrita on public.protocolo_area_membros;
  create policy protocolo_area_membros_escrita
    on public.protocolo_area_membros
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.protocolo_area_membros from anon;

  alter table public.protocolo_feriados enable row level security;
  drop policy if exists protocolo_feriados_select on public.protocolo_feriados;
  create policy protocolo_feriados_select
    on public.protocolo_feriados
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists protocolo_feriados_escrita on public.protocolo_feriados;
  create policy protocolo_feriados_escrita
    on public.protocolo_feriados
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.protocolo_feriados from anon;

  -- O contador é da numeração (gatilho); ninguém da sessão lê nem escreve.
  alter table public.protocolo_contadores enable row level security;
  revoke all on public.protocolo_contadores from anon, authenticated;

  -- Protocolos: a sessão só LÊ (o serviço escreve, ver o cabeçalho).
  alter table public.protocolos enable row level security;
  drop policy if exists protocolos_select on public.protocolos;
  create policy protocolos_select
    on public.protocolos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.protocolos from anon;
  revoke insert, update, delete, truncate on public.protocolos from authenticated;

  alter table public.protocolo_eventos enable row level security;
  drop policy if exists protocolo_eventos_select on public.protocolo_eventos;
  create policy protocolo_eventos_select
    on public.protocolo_eventos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.protocolo_eventos from anon;
  -- Append-only para os três papéis do PostgREST (lição da 0258): só os gatilhos e
  -- fn_protocolo_registrar_evento (definer, dona da tabela) escrevem aqui.
  revoke insert, update, delete, truncate on public.protocolo_eventos from authenticated, service_role;

  alter table public.protocolo_marcos_sla enable row level security;
  drop policy if exists protocolo_marcos_sla_select on public.protocolo_marcos_sla;
  create policy protocolo_marcos_sla_select
    on public.protocolo_marcos_sla
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.protocolo_marcos_sla from anon;
  revoke insert, update, delete, truncate on public.protocolo_marcos_sla from authenticated;
  -- O watcher (service role) só ACRESCENTA marcos: um marco disparado não se desfaz.
  revoke update, delete, truncate on public.protocolo_marcos_sla from service_role;

  comment on table public.protocolo_categorias is
    'Categorias e subcategorias (um nível) de protocolo (módulo protocolos, migration 0904), com área, prioridade padrão e se exigem competência ou passagem para humano.';
  comment on table public.protocolo_politicas_sla is
    'Prazos de primeira resposta e de resolução por prioridade (e opcionalmente por categoria). Sem política = protocolo sem SLA.';
  comment on table public.protocolo_area_membros is
    'Quem trabalha a fila de cada área e o líder (um por área). Em tabela, com FK, e não em settings.';
  comment on table public.protocolo_feriados is
    'Dias sem expediente para o relógio do SLA.';
  comment on table public.protocolo_contadores is
    'Numeração anual dos protocolos por organização. Escrita só pelo gatilho de numeração.';
  comment on table public.protocolos is
    'Demanda operacional de cliente. Escrita só pelo serviço (service role); a sessão lê. Número, estado e carimbos são do gatilho; SLA do serviço.';
  comment on table public.protocolo_eventos is
    'Linha do tempo do protocolo, append-only. Escrita pelos gatilhos e por fn_protocolo_registrar_evento.';
  comment on table public.protocolo_marcos_sla is
    'Marcos de SLA já disparados (80/100/120% por relógio). A PK impede disparar duas vezes.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9).
revoke execute on function public.fn_protocolos_provisionar() from public, anon, authenticated;
grant execute on function public.fn_protocolos_provisionar() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Funções do módulo. Existem mesmo sem as tabelas (D7): `record`, nunca `%rowtype`.
-- Quem fez: `auth.uid()` quando é a sessão; com o service role, a coluna `alterado_por`.
-- ════════════════════════════════════════════════════════════════════════════

-- ---- categoria: subcategoria pendura numa CATEGORIA (um nível só) ----
create or replace function public.fn_protocolo_categoria_coerente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'protocolo_organizacao_imutavel' using errcode = '23514';
  end if;
  if new.parent_id is not null and exists (
       select 1 from public.protocolo_categorias
        where id = new.parent_id and parent_id is not null) then
    raise exception 'protocolo_subcategoria_de_subcategoria' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- protocolo, ANTES de gravar: número, imutáveis, coerência, máquina de estados ----
--
-- A tabela de transições (spec 22 §4.2/§10) mora aqui e vale para todo escritor. Carimbos que
-- não dependem de calendário também: o SLA (prazos, pausa) é do serviço.
create or replace function public.fn_protocolo_antes_de_gravar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_permitidas text[];
  v_pai uuid;
begin
  if tg_op = 'INSERT' then
    new.ano := extract(year from coalesce(new.aberto_em, now()))::integer;
    insert into public.protocolo_contadores as c (organization_id, ano, ultimo_numero)
    values (new.organization_id, new.ano, 1)
    on conflict (organization_id, ano)
      do update set ultimo_numero = c.ultimo_numero + 1
    returning ultimo_numero into new.numero;
    new.estado := coalesce(new.estado, 'novo');
    new.revision := 1;
    new.reaberturas := 0;
  else
    -- O que nasce com o protocolo não muda.
    if new.organization_id is distinct from old.organization_id
       or new.ano is distinct from old.ano
       or new.numero is distinct from old.numero
       or new.aberto_em is distinct from old.aberto_em
       or new.origem is distinct from old.origem
       or new.company_id is distinct from old.company_id
       or new.contact_id is distinct from old.contact_id
       or new.conversation_id is distinct from old.conversation_id then
      raise exception 'protocolo_campo_imutavel' using errcode = '23514';
    end if;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;

  -- Coerência entre organizações (o service role passa por cima de RLS, não de gatilho).
  if new.company_id is not null and (tg_op = 'INSERT') and not exists (
       select 1 from public.companies where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'protocolo_empresa_de_outra_organizacao' using errcode = '23514';
  end if;
  if new.contact_id is not null and (tg_op = 'INSERT') and not exists (
       select 1 from public.contacts where id = new.contact_id and organization_id = new.organization_id) then
    raise exception 'protocolo_contato_de_outra_organizacao' using errcode = '23514';
  end if;
  if new.conversation_id is not null and (tg_op = 'INSERT') and not exists (
       select 1 from public.conversations where id = new.conversation_id and organization_id = new.organization_id) then
    raise exception 'protocolo_conversa_de_outra_organizacao' using errcode = '23514';
  end if;
  if new.agent_case_id is not null
     and (tg_op = 'INSERT' or new.agent_case_id is distinct from old.agent_case_id)
     and not exists (
       select 1 from public.agent_cases where id = new.agent_case_id and organization_id = new.organization_id) then
    raise exception 'protocolo_caso_de_outra_organizacao' using errcode = '23514';
  end if;

  -- A categoria é RAIZ, e a subcategoria é filha DELA.
  select parent_id into v_pai from public.protocolo_categorias where id = new.categoria_id;
  if v_pai is not null then
    raise exception 'protocolo_categoria_nao_e_raiz' using errcode = '23514';
  end if;
  if new.subcategoria_id is not null and not exists (
       select 1 from public.protocolo_categorias
        where id = new.subcategoria_id and parent_id = new.categoria_id) then
    raise exception 'protocolo_subcategoria_de_outra_categoria' using errcode = '23514';
  end if;

  -- Máquina de estados.
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    v_permitidas := case old.estado
      when 'novo'                then array['triagem', 'atribuido', 'em_atendimento', 'cancelado']
      when 'triagem'             then array['atribuido', 'em_atendimento', 'cancelado']
      when 'atribuido'           then array['triagem', 'em_atendimento', 'aguardando_cliente',
                                            'aguardando_terceiro', 'aguardando_interno', 'resolvido', 'cancelado']
      when 'em_atendimento'      then array['atribuido', 'aguardando_cliente', 'aguardando_terceiro',
                                            'aguardando_interno', 'resolvido', 'cancelado']
      when 'aguardando_cliente'  then array['em_atendimento', 'resolvido', 'cancelado']
      when 'aguardando_terceiro' then array['em_atendimento', 'resolvido', 'cancelado']
      when 'aguardando_interno'  then array['em_atendimento', 'resolvido', 'cancelado']
      when 'resolvido'           then array['fechado', 'reaberto']
      when 'reaberto'            then array['atribuido', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'cancelado']
      else array[]::text[]  -- fechado e cancelado são finais
    end;
    if not (new.estado = any (v_permitidas)) then
      raise exception 'protocolo_transicao_invalida'
        using errcode = 'P0001', detail = format('%s -> %s', old.estado, new.estado);
    end if;

    if new.estado = 'em_atendimento' and old.primeira_resposta_em is null then
      new.primeira_resposta_em := coalesce(new.primeira_resposta_em, now());
    end if;
    if new.estado = 'resolvido' then
      new.resolvido_em := now();
    end if;
    if new.estado = 'reaberto' then
      new.reaberturas := old.reaberturas + 1;
      new.resolvido_em := null;
    end if;
    if new.estado in ('fechado', 'cancelado') then
      new.fechado_em := now();
    end if;
  end if;

  if tg_op = 'INSERT' and new.estado in ('fechado', 'cancelado') then
    raise exception 'protocolo_nasce_aberto' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---- linha do tempo do protocolo ----
-- Os eventos guardam campos operacionais campo a campo (estado, prioridade, ids) — o texto livre
-- só entra por `nota`/`complemento_do_cliente`, pela função abaixo, e é seção de LGPD.
create or replace function public.fn_protocolo_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := coalesce(auth.uid(), new.alterado_por);
  v_kind text := case when v_ator is not null then 'humano'
                      when tg_op = 'INSERT' and new.origem = 'agente' then 'ia'
                      else 'sistema' end;
begin
  if tg_op = 'INSERT' then
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id, 'aberto',
            jsonb_build_object('numero', new.numero, 'ano', new.ano, 'categoria_id', new.categoria_id,
                               'subcategoria_id', new.subcategoria_id, 'prioridade', new.prioridade,
                               'prioridade_origem', new.prioridade_origem, 'area', new.area,
                               'origem', new.origem),
            v_kind, v_ator);
    return null;
  end if;

  if new.estado is distinct from old.estado then
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id,
            case new.estado when 'resolvido' then 'resolvido'
                            when 'fechado' then 'fechado'
                            when 'cancelado' then 'cancelado'
                            when 'reaberto' then 'reaberto'
                            else 'estado_alterado' end,
            jsonb_build_object('estado', old.estado),
            jsonb_build_object('estado', new.estado),
            v_kind, v_ator);
  end if;

  if (new.categoria_id, new.subcategoria_id) is distinct from (old.categoria_id, old.subcategoria_id) then
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id, 'classificacao_corrigida',
            jsonb_build_object('categoria_id', old.categoria_id, 'subcategoria_id', old.subcategoria_id),
            jsonb_build_object('categoria_id', new.categoria_id, 'subcategoria_id', new.subcategoria_id),
            v_kind, v_ator);
  end if;

  if new.prioridade is distinct from old.prioridade then
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id, 'prioridade_alterada',
            jsonb_build_object('prioridade', old.prioridade, 'origem', old.prioridade_origem),
            jsonb_build_object('prioridade', new.prioridade, 'origem', new.prioridade_origem),
            v_kind, v_ator);
  end if;

  if new.responsavel_user_id is distinct from old.responsavel_user_id then
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id,
            case when old.responsavel_user_id is null then 'atribuido' else 'transferido' end,
            jsonb_build_object('responsavel_user_id', old.responsavel_user_id),
            jsonb_build_object('responsavel_user_id', new.responsavel_user_id,
                               'distribuido_por', new.distribuido_por),
            v_kind, v_ator);
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_protocolo_categoria_coerente() from public, anon, authenticated;
revoke execute on function public.fn_protocolo_antes_de_gravar() from public, anon, authenticated;
revoke execute on function public.fn_protocolo_evento() from public, anon, authenticated;

-- ---- fn_protocolo_registrar_evento: nota, complemento do cliente e marcos de SLA ----
--
-- A linha do tempo é append-only até para o service role; o que não nasce de uma mudança de
-- coluna (uma nota, o que o cliente acrescentou, um alerta de SLA) entra por aqui. Só os tipos
-- que não são deduzidos pelo gatilho — os demais mentiriam sobre o que aconteceu.
create or replace function public.fn_protocolo_registrar_evento(
  p_org uuid,
  p_protocolo uuid,
  p_tipo text,
  p_texto text default null,
  p_ator uuid default null,
  p_ator_kind text default 'sistema',
  p_novo jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tipo is null or p_tipo not in ('nota', 'complemento_do_cliente', 'sla_alerta', 'sla_estourado') then
    raise exception 'protocolo_evento_invalido' using errcode = '22023';
  end if;
  if p_ator_kind is null or p_ator_kind not in ('humano', 'ia', 'sistema') then
    raise exception 'protocolo_evento_invalido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.protocolos where id = p_protocolo and organization_id = p_org) then
    raise exception 'protocolo_nao_encontrado' using errcode = 'P0002';
  end if;

  insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, novo, texto, ator_kind, ator_user_id)
  values (p_org, p_protocolo, p_tipo, p_novo, p_texto, p_ator_kind, p_ator)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_protocolo_registrar_evento(uuid, uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_protocolo_registrar_evento(uuid, uuid, text, text, uuid, text, jsonb) to service_role;

-- ---- LGPD (D8): as seções de texto livre sobre a pessoa ----
--
-- `fn_lgpd_redigir_secoes_de_modulo` (0485) as alcança na anonimização do contato, por
-- `to_regclass` — onde o módulo não está instalado, pula sem erro. `titulo` e `descricao` são NOT
-- NULL e viram o rótulo "Cliente Anonimizado #…"; o resto vira nulo. A ordem do gatilho é por
-- nome de tabela: `protocolo_eventos` vem antes de `protocolos`, então a ligação dos eventos (pelo
-- contato do protocolo) ainda acha o protocolo.
insert into public.modulo_secoes_lgpd (modulo, tabela, ligacao, colunas, colunas_rotulo)
values
  ('protocolos', 'protocolos',
   'organization_id = $1 and contact_id = $2',
   array['resumo', 'urgencia_declarada', 'prioridade_motivo', 'motivo_encerramento'],
   array['titulo', 'descricao']),
  ('protocolos', 'protocolo_eventos',
   'organization_id = $1 and protocolo_id in (select p.id from public.protocolos p where p.organization_id = $1 and p.contact_id = $2)',
   array['texto', 'anterior', 'novo'],
   array[]::text[])
on conflict (modulo, tabela) do update
  set ligacao = excluded.ligacao,
      colunas = excluded.colunas,
      colunas_rotulo = excluded.colunas_rotulo;
