-- 0902 — Carteira de empresas: módulo opcional (spec 21, docs/specs/21-spec-modulo-carteira.md).
--
-- Liga o contato que escreve no WhatsApp às empresas que ele representa, guarda o estado do
-- relacionamento de cada empresa (prospect → ativo → inativo), o grupo, matriz/filial, quem
-- cuida dela em cada área, e a EMPRESA ATIVA DE CADA CONVERSA com histórico. É o que deixa
-- uma operação com UM número só saber, na primeira mensagem, se quem escreve já é cliente e de
-- qual CNPJ está falando.
--
-- ── Por que MÓDULO (ADR-0002) ─────────────────────────────────────────────────
-- Quem vende para pessoa física não tem carteira de empresas. Se nenhuma instalação ligar
-- isto, a operação comum continua inteira. As tabelas nascem por `fn_carteira_provisionar()`
-- quando o administrador da instalação instala o módulo em /admin/modulos; criar a função
-- aqui não cria tabela nenhuma.
--
-- ── DIRC: a empresa é a do núcleo ─────────────────────────────────────────────
-- `companies` (núcleo) continua sendo A empresa, com o CNPJ normalizado e único por
-- organização (`companies_org_normalized_cnpj_uidx`) e o enriquecimento da BrasilAPI. O
-- módulo só PENDURA o relacionamento nela (1:1 em `carteira_perfis`) — a provisionadora não
-- pode escrever no núcleo (D4), e duas tabelas de empresa seriam duas fontes de verdade.
--
-- ── As seis tabelas ───────────────────────────────────────────────────────────
-- carteira_grupos             — grupo empresarial.
-- carteira_perfis             — o relacionamento com a empresa (estado, cliente desde,
--                               grupo, matriz/filial, atributos do nicho).
-- carteira_vinculos           — contato × empresa (N:N), com papel e áreas que o contato recebe.
-- carteira_responsaveis       — quem cuida da empresa em cada área, com vigência.
-- carteira_contexto_conversa  — a empresa ativa de cada conversa, por PERÍODO (append-only;
--                               trocar fecha o período e abre outro — nada do passado se move).
-- carteira_eventos            — a linha do tempo do módulo (append-only para os três papéis).
--
-- ── Quem escreve o quê ────────────────────────────────────────────────────────
-- * `estado` do perfil só muda por `fn_carteira_transicionar` (a tabela de transições mora
--   ali). A sessão E o service_role perdem UPDATE nessas colunas por privilégio de COLUNA —
--   não é convenção da rota, é do schema.
-- * O contexto da conversa só muda por `fn_carteira_definir_contexto`.
-- * A linha do tempo é escrita por GATILHO nas tabelas do módulo: a garantia é da TABELA e
--   vale para rota, motor, script e importação futura (mesma doutrina da 0148). Ninguém
--   escreve em `carteira_eventos` direto.
-- * Coerência entre organizações (contato, empresa, grupo, matriz da MESMA organização) é
--   gatilho BEFORE, e não só RLS: o service_role passa por cima de RLS, não de gatilho.
--
-- ── Sem event_log nesta migration, de propósito ───────────────────────────────
-- O drain deixa evento sem handler `pending` para sempre (anti-pattern nº 3; ver a nota da
-- 0155 no MANIFEST). Os eventos `carteira.*` entram junto com o primeiro consumidor real (o
-- roteador, spec 21 §7). Até lá, a linha do tempo é `carteira_eventos` e a auditoria é da rota.
--
-- ── LGPD (D8) ─────────────────────────────────────────────────────────────────
-- Nenhuma coluna do módulo é texto livre sobre a pessoa: papel, áreas, estado, ids e datas.
-- `carteira_eventos.anterior/novo` guardam só esses campos (os gatilhos montam o jsonb
-- campo a campo, nunca `to_jsonb(new)` inteiro). Por isso o módulo não declara seção em
-- `modulo_secoes_lgpd` — mesma decisão da 0480 para honorários. O vínculo sobrevive à
-- anonimização do contato pela mesma razão que `crm_leads.stage_id` sobrevive: é operação.
--
-- ── Junção de contatos ────────────────────────────────────────────────────────
-- `fn_mesclar_contatos` reponta TODA chave estrangeira para `contacts` lida do catálogo
-- (`pg_constraint`), então `carteira_vinculos.contact_id` acompanha a fusão sem código novo.
-- Colisão (os dois contatos já ligados à mesma empresa) cai no caminho linha a linha dela e
-- o vínculo do perdedor fica na lápide — nunca órfão.

create or replace function public.fn_carteira_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── carteira_grupos ────────────────────────────────────────────────────────
  create table if not exists public.carteira_grupos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    nome text not null check (char_length(btrim(nome)) between 1 and 120),
    descricao text check (descricao is null or char_length(descricao) <= 500),
    responsavel_user_id uuid references auth.users(id) on delete set null,
    ativo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint carteira_grupos_nome_unico unique (organization_id, nome),
    -- alvo da FK composta de carteira_perfis: o grupo é da MESMA organização
    constraint carteira_grupos_org_id_unico unique (organization_id, id)
  );

  -- ── carteira_perfis ────────────────────────────────────────────────────────
  create table if not exists public.carteira_perfis (
    company_id uuid primary key references public.companies(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `text` + CHECK, não enum (doutrina). A tabela de transições é de fn_carteira_transicionar.
    estado text not null default 'prospect'
      check (estado in ('prospect', 'em_qualificacao', 'proposta', 'em_implantacao',
                        'ativo', 'suspenso', 'em_distrato', 'inativo')),
    -- Gravado na PRIMEIRA entrada em `ativo`, nunca regravado: reativar um ex-cliente não
    -- apaga há quanto tempo ele é da casa.
    cliente_desde date,
    grupo_id uuid,
    tipo_estabelecimento text check (tipo_estabelecimento in ('matriz', 'filial')),
    matriz_company_id uuid references public.companies(id) on delete set null,
    -- Campos do nicho, validados pelo schema declarativo de
    -- organizations.settings.carteira.atributos (spec 21 §4.3), como pipeline.settings.fields.
    atributos jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
    estado_alterado_em timestamptz not null default now(),
    estado_alterado_por uuid references auth.users(id) on delete set null,
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint carteira_perfis_grupo_da_org
      foreign key (organization_id, grupo_id)
      references public.carteira_grupos (organization_id, id) on delete set null (grupo_id),
    constraint carteira_perfis_matriz_so_em_filial
      check (tipo_estabelecimento = 'filial' or matriz_company_id is null),
    constraint carteira_perfis_matriz_nao_e_ela_mesma
      check (matriz_company_id is null or matriz_company_id <> company_id)
  );

  create index if not exists carteira_perfis_org_estado_idx
    on public.carteira_perfis (organization_id, estado);
  create index if not exists carteira_perfis_grupo_idx
    on public.carteira_perfis (organization_id, grupo_id) where grupo_id is not null;
  create index if not exists carteira_perfis_matriz_idx
    on public.carteira_perfis (matriz_company_id) where matriz_company_id is not null;

  -- ── carteira_vinculos ──────────────────────────────────────────────────────
  create table if not exists public.carteira_vinculos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    papel text not null
      check (papel in ('socio', 'administrador', 'financeiro', 'rh', 'fiscal', 'procurador',
                       'funcionario', 'contador_externo', 'outro')),
    -- O contato principal DA EMPRESA (um só entre os ativos — índice parcial abaixo).
    principal boolean not null default false,
    -- Áreas que este contato recebe; vazio = todas. Slugs do vocabulário de áreas da
    -- organização (organizations.settings.carteira.areas).
    areas text[] not null default '{}'::text[],
    ativo boolean not null default true,
    origem text not null default 'manual' check (origem in ('manual', 'agente', 'importacao', 'api')),
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint carteira_vinculos_par_unico unique (organization_id, contact_id, company_id),
    constraint carteira_vinculos_areas_slug
      check (array_position(areas, null) is null
             and coalesce(array_to_string(areas, ','), '') ~ '^([a-z][a-z0-9_]{1,40}(,[a-z][a-z0-9_]{1,40})*)?$')
  );

  create unique index if not exists carteira_vinculos_um_principal_idx
    on public.carteira_vinculos (organization_id, company_id) where principal and ativo;
  -- O resolvedor lê "as empresas DESTE contato" a cada turno.
  create index if not exists carteira_vinculos_contato_idx
    on public.carteira_vinculos (organization_id, contact_id) where ativo;
  create index if not exists carteira_vinculos_empresa_idx
    on public.carteira_vinculos (organization_id, company_id);

  -- ── carteira_responsaveis ──────────────────────────────────────────────────
  create table if not exists public.carteira_responsaveis (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    company_id uuid not null references public.companies(id) on delete cascade,
    area text not null check (area ~ '^[a-z][a-z0-9_]{1,40}$'),
    user_id uuid not null,
    principal boolean not null default true,
    vigencia_inicio date not null default current_date,
    vigencia_fim date,
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- Mesma forma de channel_routing_responsibles: o responsável é MEMBRO desta organização,
    -- e sair dela leva a linha junto.
    constraint carteira_responsaveis_membro_da_org
      foreign key (organization_id, user_id)
      references public.user_organizations (organization_id, user_id) on delete cascade,
    constraint carteira_responsaveis_vigencia
      check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
  );

  create unique index if not exists carteira_responsaveis_um_principal_vigente_idx
    on public.carteira_responsaveis (organization_id, company_id, area)
    where principal and vigencia_fim is null;
  create index if not exists carteira_responsaveis_usuario_idx
    on public.carteira_responsaveis (organization_id, user_id) where vigencia_fim is null;

  -- ── carteira_contexto_conversa ─────────────────────────────────────────────
  create table if not exists public.carteira_contexto_conversa (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    -- null = "sem empresa" declarado (o atendente limpou o contexto); a empresa apagada
    -- também vira null, e o período continua contando a história.
    company_id uuid references public.companies(id) on delete set null,
    definido_por text not null
      check (definido_por in ('automatico_unico_vinculo', 'agente', 'humano', 'cliente_informou')),
    definido_por_user_id uuid references auth.users(id) on delete set null,
    inicio timestamptz not null default now(),
    fim timestamptz,
    constraint carteira_contexto_periodo check (fim is null or fim >= inicio)
  );

  create unique index if not exists carteira_contexto_um_corrente_idx
    on public.carteira_contexto_conversa (conversation_id) where fim is null;
  create index if not exists carteira_contexto_empresa_idx
    on public.carteira_contexto_conversa (organization_id, company_id, inicio desc);

  -- ── carteira_eventos ───────────────────────────────────────────────────────
  create table if not exists public.carteira_eventos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    company_id uuid references public.companies(id) on delete set null,
    contact_id uuid references public.contacts(id) on delete set null,
    conversation_id uuid references public.conversations(id) on delete set null,
    tipo text not null
      check (tipo in ('perfil_criado', 'estado_alterado', 'perfil_atualizado',
                      'vinculo_criado', 'vinculo_atualizado',
                      'responsavel_definido', 'responsavel_atualizado',
                      'contexto_alterado')),
    anterior jsonb,
    novo jsonb,
    ator_kind text not null check (ator_kind in ('humano', 'ia', 'sistema')),
    ator_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  create index if not exists carteira_eventos_empresa_idx
    on public.carteira_eventos (organization_id, company_id, created_at desc);
  create index if not exists carteira_eventos_conversa_idx
    on public.carteira_eventos (organization_id, conversation_id, created_at desc)
    where conversation_id is not null;

  -- ── Gatilhos: coerência entre organizações e linha do tempo ─────────────────
  -- As funções dos gatilhos são criadas pela migration (D7), fora daqui; aqui só se prende
  -- cada uma à sua tabela. `drop ... if exists` + `create`: reaplicável.
  drop trigger if exists carteira_perfis_coerencia on public.carteira_perfis;
  create trigger carteira_perfis_coerencia
    before insert or update on public.carteira_perfis
    for each row execute function public.fn_carteira_perfil_coerente();
  drop trigger if exists carteira_perfis_linha_do_tempo on public.carteira_perfis;
  create trigger carteira_perfis_linha_do_tempo
    after insert or update on public.carteira_perfis
    for each row execute function public.fn_carteira_evento_de_perfil();

  drop trigger if exists carteira_vinculos_coerencia on public.carteira_vinculos;
  create trigger carteira_vinculos_coerencia
    before insert or update on public.carteira_vinculos
    for each row execute function public.fn_carteira_vinculo_coerente();
  drop trigger if exists carteira_vinculos_linha_do_tempo on public.carteira_vinculos;
  create trigger carteira_vinculos_linha_do_tempo
    after insert or update on public.carteira_vinculos
    for each row execute function public.fn_carteira_evento_de_vinculo();

  drop trigger if exists carteira_responsaveis_coerencia on public.carteira_responsaveis;
  create trigger carteira_responsaveis_coerencia
    before insert or update on public.carteira_responsaveis
    for each row execute function public.fn_carteira_responsavel_coerente();
  drop trigger if exists carteira_responsaveis_linha_do_tempo on public.carteira_responsaveis;
  create trigger carteira_responsaveis_linha_do_tempo
    after insert or update on public.carteira_responsaveis
    for each row execute function public.fn_carteira_evento_de_responsavel();

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui e não pela rotina automática) ────────
  -- Molde da 0480. Leitura: qualquer papel da organização. Escrita espelha as rotas da spec
  -- 21 §9: vínculos `agent`+; grupos, perfis e responsáveis `manager`+. Nada se APAGA pela
  -- sessão: vínculo e responsável se desativam/encerram (a conversa antiga continua
  -- apontando para a empresa certa); perfil e grupo saem junto com a empresa ou a organização.
  -- Cada `create policy` ocupa DUAS linhas (nome / tabela) de propósito (#1906): o update.sh
  -- de v1.39.0 a v1.63.0 lê as regras do TEXTO do baseline, até dentro de corpo de função.
  alter table public.carteira_grupos enable row level security;
  drop policy if exists carteira_grupos_select on public.carteira_grupos;
  create policy carteira_grupos_select
    on public.carteira_grupos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists carteira_grupos_insert on public.carteira_grupos;
  create policy carteira_grupos_insert
    on public.carteira_grupos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists carteira_grupos_update on public.carteira_grupos;
  create policy carteira_grupos_update
    on public.carteira_grupos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.carteira_grupos from anon;

  alter table public.carteira_perfis enable row level security;
  drop policy if exists carteira_perfis_select on public.carteira_perfis;
  create policy carteira_perfis_select
    on public.carteira_perfis
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  -- Perfil novo pela sessão nasce `prospect`: qualquer outro estado é transição, e transição
  -- é da função.
  drop policy if exists carteira_perfis_insert on public.carteira_perfis;
  create policy carteira_perfis_insert
    on public.carteira_perfis
    for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and estado = 'prospect' and cliente_desde is null);
  drop policy if exists carteira_perfis_update on public.carteira_perfis;
  create policy carteira_perfis_update
    on public.carteira_perfis
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.carteira_perfis from anon;
  -- `estado`, `cliente_desde` e `estado_alterado_*` só por fn_carteira_transicionar (dona da
  -- tabela). Privilégio de coluna só vale se o de TABELA sair antes — um GRANT UPDATE na
  -- tabela inteira cobre todas as colunas, e o default ACL do baseline dá um.
  revoke update on public.carteira_perfis from authenticated, service_role;
  grant update (grupo_id, tipo_estabelecimento, matriz_company_id, atributos, alterado_por, updated_at)
    on public.carteira_perfis to authenticated, service_role;

  alter table public.carteira_vinculos enable row level security;
  drop policy if exists carteira_vinculos_select on public.carteira_vinculos;
  create policy carteira_vinculos_select
    on public.carteira_vinculos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists carteira_vinculos_insert on public.carteira_vinculos;
  create policy carteira_vinculos_insert
    on public.carteira_vinculos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')));
  drop policy if exists carteira_vinculos_update on public.carteira_vinculos;
  create policy carteira_vinculos_update
    on public.carteira_vinculos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'agent')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'agent')));
  revoke all on public.carteira_vinculos from anon;
  revoke delete, truncate on public.carteira_vinculos from authenticated;

  alter table public.carteira_responsaveis enable row level security;
  drop policy if exists carteira_responsaveis_select on public.carteira_responsaveis;
  create policy carteira_responsaveis_select
    on public.carteira_responsaveis
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists carteira_responsaveis_insert on public.carteira_responsaveis;
  create policy carteira_responsaveis_insert
    on public.carteira_responsaveis
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  drop policy if exists carteira_responsaveis_update on public.carteira_responsaveis;
  create policy carteira_responsaveis_update
    on public.carteira_responsaveis
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));
  revoke all on public.carteira_responsaveis from anon;
  revoke delete, truncate on public.carteira_responsaveis from authenticated;

  -- O contexto revela de qual empresa é a conversa: quem não enxerga a CONVERSA (RLS por
  -- atendente, fn_can_view_conversation, 0035) também não enxerga o contexto dela. A
  -- subconsulta em `conversations` roda com o papel de quem lê, então herda aquela RLS.
  alter table public.carteira_contexto_conversa enable row level security;
  drop policy if exists carteira_contexto_conversa_select on public.carteira_contexto_conversa;
  create policy carteira_contexto_conversa_select
    on public.carteira_contexto_conversa
    for select using (
      public.fn_is_platform_admin()
      or (organization_id in (select public.fn_user_org_ids())
          and exists (select 1 from public.conversations cv
                       where cv.id = carteira_contexto_conversa.conversation_id))
    );
  revoke all on public.carteira_contexto_conversa from anon;
  -- Escrita só por fn_carteira_definir_contexto.
  revoke insert, update, delete, truncate on public.carteira_contexto_conversa
    from authenticated, service_role;

  alter table public.carteira_eventos enable row level security;
  drop policy if exists carteira_eventos_select on public.carteira_eventos;
  create policy carteira_eventos_select
    on public.carteira_eventos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.carteira_eventos from anon;
  -- Append-only para os três papéis do PostgREST — service_role inclusive (lição da 0258:
  -- o default ACL do Supabase concede tudo, e o GRANT enumerado do dump só acrescenta). Só
  -- os gatilhos do módulo (definer, dono da tabela) escrevem aqui.
  revoke insert, update, delete, truncate on public.carteira_eventos
    from authenticated, service_role;

  comment on table public.carteira_grupos is
    'Grupo empresarial (módulo carteira, migration 0902). Consolida o relacionamento de várias empresas sem perder o CNPJ de cada uma.';
  comment on table public.carteira_perfis is
    'O relacionamento com a empresa (1:1 com companies). estado só muda por fn_carteira_transicionar; cliente_desde é gravado na primeira entrada em ativo e nunca regravado.';
  comment on table public.carteira_vinculos is
    'Contato × empresa (N:N): quem escreve representa quais empresas, com que papel e quais áreas recebe. Desativa, não apaga.';
  comment on table public.carteira_responsaveis is
    'Carteira interna: quem cuida da empresa em cada área, com vigência. Um principal vigente por (empresa, área).';
  comment on table public.carteira_contexto_conversa is
    'Empresa ativa da conversa, por período (append-only). Trocar fecha o período corrente e abre outro; o passado nunca se move. Escrito só por fn_carteira_definir_contexto.';
  comment on table public.carteira_eventos is
    'Linha do tempo do módulo carteira, escrita só pelos gatilhos das tabelas do módulo. anterior/novo guardam campos operacionais, nunca texto sobre a pessoa.';

  -- RLS já ligada por nós, então esta rotina não mexe mais nelas (D5) — só aplica as travas
  -- de suporte, que dependem de RLS já estar de pé.
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9).
revoke execute on function public.fn_carteira_provisionar() from public, anon, authenticated;
grant execute on function public.fn_carteira_provisionar() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Funções do módulo. Existem mesmo sem as tabelas (D7): `record`, nunca `%rowtype`, e
-- nenhuma referência resolvida na criação — PL/pgSQL só resolve nome de tabela ao executar.
-- ════════════════════════════════════════════════════════════════════════════

-- Quem fez, nos gatilhos: `auth.uid()` quando é a sessão; quando é o service_role (rota ou
-- motor), `auth.uid()` é nulo e vale a coluna `*_por` que quem escreveu preencheu na linha.

-- ---- coerência do perfil: empresa, grupo e matriz da MESMA organização ----
create or replace function public.fn_carteira_perfil_coerente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.companies
                  where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'carteira_empresa_de_outra_organizacao' using errcode = '23514';
  end if;
  if new.matriz_company_id is not null and not exists (
       select 1 from public.companies
        where id = new.matriz_company_id and organization_id = new.organization_id) then
    raise exception 'carteira_matriz_de_outra_organizacao' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'carteira_organizacao_imutavel' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- coerência do vínculo: contato e empresa da MESMA organização ----
-- E o perfil nasce no primeiro vínculo (spec 21 §4.2): a empresa ligada a alguém passa a ter
-- relacionamento, `prospect` até alguém dizer outra coisa.
create or replace function public.fn_carteira_vinculo_coerente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'carteira_organizacao_imutavel' using errcode = '23514';
  end if;
  if not exists (select 1 from public.companies
                  where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'carteira_empresa_de_outra_organizacao' using errcode = '23514';
  end if;
  if not exists (select 1 from public.contacts
                  where id = new.contact_id and organization_id = new.organization_id) then
    raise exception 'carteira_contato_de_outra_organizacao' using errcode = '23514';
  end if;
  insert into public.carteira_perfis (company_id, organization_id)
  values (new.company_id, new.organization_id)
  on conflict (company_id) do nothing;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- coerência do responsável: empresa da MESMA organização ----
-- (o usuário já é conferido pela FK composta para user_organizations)
create or replace function public.fn_carteira_responsavel_coerente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id
                           or new.company_id is distinct from old.company_id
                           or new.area is distinct from old.area
                           or new.user_id is distinct from old.user_id) then
    -- Trocar o responsável é ENCERRAR a vigência e abrir outra linha: editar a pessoa na
    -- mesma linha reescreveria quem cuidou da empresa naquele período.
    raise exception 'carteira_responsavel_encerre_e_abra_outro' using errcode = '23514';
  end if;
  if not exists (select 1 from public.companies
                  where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'carteira_empresa_de_outra_organizacao' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- linha do tempo: perfil ----
create or replace function public.fn_carteira_evento_de_perfil()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid;
begin
  if tg_op = 'INSERT' then
    v_ator := coalesce(auth.uid(), new.estado_alterado_por, new.alterado_por);
    insert into public.carteira_eventos
      (organization_id, company_id, tipo, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, 'perfil_criado',
            jsonb_build_object('estado', new.estado),
            case when v_ator is null then 'sistema' else 'humano' end, v_ator);
    return null;
  end if;

  if new.estado is distinct from old.estado then
    v_ator := coalesce(auth.uid(), new.estado_alterado_por);
    insert into public.carteira_eventos
      (organization_id, company_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, 'estado_alterado',
            jsonb_build_object('estado', old.estado),
            jsonb_build_object('estado', new.estado, 'cliente_desde', new.cliente_desde),
            case when v_ator is null then 'sistema' else 'humano' end, v_ator);
  end if;

  if (new.grupo_id, new.tipo_estabelecimento, new.matriz_company_id, new.atributos)
       is distinct from (old.grupo_id, old.tipo_estabelecimento, old.matriz_company_id, old.atributos) then
    v_ator := coalesce(auth.uid(), new.alterado_por);
    insert into public.carteira_eventos
      (organization_id, company_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, 'perfil_atualizado',
            jsonb_build_object('grupo_id', old.grupo_id, 'tipo_estabelecimento', old.tipo_estabelecimento,
                               'matriz_company_id', old.matriz_company_id, 'atributos', old.atributos),
            jsonb_build_object('grupo_id', new.grupo_id, 'tipo_estabelecimento', new.tipo_estabelecimento,
                               'matriz_company_id', new.matriz_company_id, 'atributos', new.atributos),
            case when v_ator is null then 'sistema' else 'humano' end, v_ator);
  end if;
  return null;
end;
$$;

-- ---- linha do tempo: vínculo ----
-- `origem = 'agente'` vira ator `ia`: foi a ferramenta do agente que ligou.
create or replace function public.fn_carteira_evento_de_vinculo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := coalesce(auth.uid(), new.alterado_por);
  v_kind text := case when new.origem = 'agente' and auth.uid() is null then 'ia'
                      when v_ator is null then 'sistema' else 'humano' end;
begin
  if tg_op = 'INSERT' then
    insert into public.carteira_eventos
      (organization_id, company_id, contact_id, tipo, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, new.contact_id, 'vinculo_criado',
            jsonb_build_object('papel', new.papel, 'principal', new.principal,
                               'areas', to_jsonb(new.areas), 'ativo', new.ativo, 'origem', new.origem),
            v_kind, v_ator);
  elsif (new.contact_id, new.papel, new.principal, new.areas, new.ativo)
          is distinct from (old.contact_id, old.papel, old.principal, old.areas, old.ativo) then
    insert into public.carteira_eventos
      (organization_id, company_id, contact_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, new.contact_id, 'vinculo_atualizado',
            jsonb_build_object('contact_id', old.contact_id, 'papel', old.papel, 'principal', old.principal,
                               'areas', to_jsonb(old.areas), 'ativo', old.ativo),
            jsonb_build_object('contact_id', new.contact_id, 'papel', new.papel, 'principal', new.principal,
                               'areas', to_jsonb(new.areas), 'ativo', new.ativo),
            v_kind, v_ator);
  end if;
  return null;
end;
$$;

-- ---- linha do tempo: responsável ----
create or replace function public.fn_carteira_evento_de_responsavel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := coalesce(auth.uid(), new.alterado_por);
begin
  if tg_op = 'INSERT' then
    insert into public.carteira_eventos
      (organization_id, company_id, tipo, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, 'responsavel_definido',
            jsonb_build_object('area', new.area, 'user_id', new.user_id, 'principal', new.principal,
                               'vigencia_inicio', new.vigencia_inicio),
            case when v_ator is null then 'sistema' else 'humano' end, v_ator);
  elsif (new.principal, new.vigencia_inicio, new.vigencia_fim)
          is distinct from (old.principal, old.vigencia_inicio, old.vigencia_fim) then
    insert into public.carteira_eventos
      (organization_id, company_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.company_id, 'responsavel_atualizado',
            jsonb_build_object('area', old.area, 'user_id', old.user_id, 'principal', old.principal,
                               'vigencia_fim', old.vigencia_fim),
            jsonb_build_object('area', new.area, 'user_id', new.user_id, 'principal', new.principal,
                               'vigencia_fim', new.vigencia_fim),
            case when v_ator is null then 'sistema' else 'humano' end, v_ator);
  end if;
  return null;
end;
$$;

-- Funções de gatilho não precisam de grant para disparar (D4 / 0485): fechadas a todos.
revoke execute on function public.fn_carteira_perfil_coerente() from public, anon, authenticated;
revoke execute on function public.fn_carteira_vinculo_coerente() from public, anon, authenticated;
revoke execute on function public.fn_carteira_responsavel_coerente() from public, anon, authenticated;
revoke execute on function public.fn_carteira_evento_de_perfil() from public, anon, authenticated;
revoke execute on function public.fn_carteira_evento_de_vinculo() from public, anon, authenticated;
revoke execute on function public.fn_carteira_evento_de_responsavel() from public, anon, authenticated;

-- ---- fn_carteira_transicionar: a ÚNICA escrita do estado do relacionamento ----
--
-- A tabela de transições (spec 21 §4.2) mora aqui, e não na rota: o agente, a importação e a
-- tela passam pelo mesmo portão. `prospect → ativo` existe de propósito — é a carga inicial
-- da carteira de quem já é cliente há anos; exigir o funil inteiro para cadastrar um cliente
-- antigo seria mentir sobre como ele chegou.
--
-- `for update` serializa duas transições da mesma empresa. Sem perfil, cria um `prospect`
-- antes (a empresa existe no núcleo; o relacionamento nasce agora).
--
-- Só `service_role` executa: quem chama é a rota (depois de requireRole manager) e o motor
-- do agente, e quem fez vem em `p_ator`. Com `authenticated` ela entraria na régua de
-- definer-membership-varredura sem precisar estar lá.
create or replace function public.fn_carteira_transicionar(
  p_org uuid,
  p_company uuid,
  p_estado text,
  p_ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_perfil record;
  v_permitidas text[];
begin
  if p_org is null or p_company is null or p_estado is null then
    raise exception 'carteira_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = p_company and organization_id = p_org) then
    raise exception 'carteira_empresa_nao_encontrada' using errcode = 'P0002';
  end if;

  insert into public.carteira_perfis (company_id, organization_id, estado_alterado_por)
  values (p_company, p_org, p_ator)
  on conflict (company_id) do nothing;

  select * into v_perfil from public.carteira_perfis
   where company_id = p_company and organization_id = p_org
   for update;

  if v_perfil.estado = p_estado then
    return jsonb_build_object('company_id', p_company, 'de', v_perfil.estado, 'para', p_estado,
                              'alterado', false, 'cliente_desde', v_perfil.cliente_desde);
  end if;

  v_permitidas := case v_perfil.estado
    when 'prospect'        then array['em_qualificacao', 'proposta', 'em_implantacao', 'ativo', 'inativo']
    when 'em_qualificacao' then array['prospect', 'proposta', 'em_implantacao', 'inativo']
    when 'proposta'        then array['em_qualificacao', 'em_implantacao', 'inativo']
    when 'em_implantacao'  then array['ativo', 'inativo']
    when 'ativo'           then array['suspenso', 'em_distrato', 'inativo']
    when 'suspenso'        then array['ativo', 'em_distrato', 'inativo']
    when 'em_distrato'     then array['ativo', 'inativo']
    when 'inativo'         then array['prospect']
    else array[]::text[]
  end;

  if not (p_estado = any (v_permitidas)) then
    raise exception 'carteira_transicao_invalida'
      using errcode = 'P0001', detail = format('%s -> %s', v_perfil.estado, p_estado);
  end if;

  update public.carteira_perfis
     set estado = p_estado,
         cliente_desde = case when p_estado = 'ativo' and cliente_desde is null
                              then current_date else cliente_desde end,
         estado_alterado_em = now(),
         estado_alterado_por = p_ator
   where company_id = p_company;

  return jsonb_build_object(
    'company_id', p_company,
    'de', v_perfil.estado,
    'para', p_estado,
    'alterado', true,
    'cliente_desde', case when p_estado = 'ativo' and v_perfil.cliente_desde is null
                          then current_date else v_perfil.cliente_desde end
  );
end;
$$;

revoke execute on function public.fn_carteira_transicionar(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_carteira_transicionar(uuid, uuid, text, uuid) to service_role;

-- ---- fn_carteira_definir_contexto: a ÚNICA escrita do contexto da conversa ----
--
-- Fecha o período corrente e abre outro (spec 21 §4.6). Mesma empresa já corrente = nada muda
-- (idempotente: o agente pode chamar duas vezes no mesmo turno). `p_company` nulo = "sem
-- empresa", e também abre período — limpar o contexto é uma decisão que a história registra.
--
-- Quem NÃO é humano só aponta para empresa com vínculo ATIVO do contato da conversa: a IA
-- nunca escolhe uma empresa à qual quem escreve não está ligado (spec 21 §8). O humano pode
-- apontar para qualquer empresa da organização — é ele quem conhece o cliente.
--
-- `for update` na conversa serializa duas definições concorrentes; o índice parcial único
-- (um corrente por conversa) é a segunda cerca.
create or replace function public.fn_carteira_definir_contexto(
  p_org uuid,
  p_conversation uuid,
  p_company uuid,
  p_definido_por text,
  p_user uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversa record;
  v_corrente record;
  v_novo uuid;
begin
  if p_org is null or p_conversation is null
     or p_definido_por is null
     or p_definido_por not in ('automatico_unico_vinculo', 'agente', 'humano', 'cliente_informou') then
    raise exception 'carteira_entrada_invalida' using errcode = '22023';
  end if;
  if p_definido_por = 'humano' and p_user is null then
    raise exception 'carteira_humano_sem_usuario' using errcode = '22023';
  end if;

  select id, contact_id into v_conversa from public.conversations
   where id = p_conversation and organization_id = p_org
   for update;
  if not found then
    raise exception 'carteira_conversa_nao_encontrada' using errcode = 'P0002';
  end if;

  if p_company is not null then
    if not exists (select 1 from public.companies where id = p_company and organization_id = p_org) then
      raise exception 'carteira_empresa_nao_encontrada' using errcode = 'P0002';
    end if;
    if p_definido_por <> 'humano' and not exists (
         select 1 from public.carteira_vinculos v
          where v.organization_id = p_org and v.contact_id = v_conversa.contact_id
            and v.company_id = p_company and v.ativo) then
      raise exception 'carteira_contato_sem_vinculo_com_a_empresa' using errcode = 'P0001';
    end if;
  end if;

  select id, company_id into v_corrente from public.carteira_contexto_conversa
   where conversation_id = p_conversation and fim is null;

  if found and v_corrente.company_id is not distinct from p_company then
    return jsonb_build_object('conversation_id', p_conversation, 'company_id', p_company,
                              'alterado', false, 'contexto_id', v_corrente.id);
  end if;

  if found then
    update public.carteira_contexto_conversa set fim = now() where id = v_corrente.id;
  end if;

  insert into public.carteira_contexto_conversa
    (organization_id, conversation_id, company_id, definido_por, definido_por_user_id)
  values (p_org, p_conversation, p_company, p_definido_por, p_user)
  returning id into v_novo;

  insert into public.carteira_eventos
    (organization_id, company_id, contact_id, conversation_id, tipo, anterior, novo, ator_kind, ator_user_id)
  values (p_org, p_company, v_conversa.contact_id, p_conversation, 'contexto_alterado',
          case when v_corrente.id is null then null
               else jsonb_build_object('company_id', v_corrente.company_id) end,
          jsonb_build_object('company_id', p_company, 'definido_por', p_definido_por),
          case p_definido_por when 'humano' then 'humano'
                              when 'agente' then 'ia'
                              else 'sistema' end,
          p_user);

  return jsonb_build_object('conversation_id', p_conversation, 'company_id', p_company,
                            'alterado', true, 'contexto_id', v_novo,
                            'anterior', v_corrente.company_id);
end;
$$;

revoke execute on function public.fn_carteira_definir_contexto(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_carteira_definir_contexto(uuid, uuid, uuid, text, uuid) to service_role;
