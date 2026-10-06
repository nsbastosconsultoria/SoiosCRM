-- 0907 — Implantação de clientes: módulo opcional (spec 23, docs/specs/23-spec-modulo-implantacao.md).
--
-- O onboarding de um cliente que acabou de contratar: um checklist (contrato, certificado digital,
-- procurações, dados de folha…) com de quem é a vez em cada item — escritório, cliente ou
-- terceiro — e a ATIVAÇÃO da empresa na carteira travada pelos itens obrigatórios (modelo §25.3).
--
-- ── Por que MÓDULO (ADR-0002), e por que depende da CARTEIRA ──────────────────
-- Quem vende para pessoa física não tem implantação de cliente. Se nenhuma instalação ligar
-- isto, a operação comum continua inteira. As tabelas nascem por `fn_implantacao_provisionar()`
-- quando o administrador instala o módulo em /admin/modulos — e só depois da carteira (spec 21):
-- é ela que guarda o estado do relacionamento (`em_implantacao` → `ativo`) que este módulo
-- controla. A provisionadora recusa sem a carteira (`implantacao_exige_carteira`); a tela de
-- módulos explica antes (`requer` no catálogo, `lib/modulos/catalogo.ts`).
--
-- ── As tabelas ───────────────────────────────────────────────────────────────
-- implantacao_modelos        — modelos de checklist da organização (um padrão, para o início
--                              automático pelo negócio ganho).
-- implantacao_modelo_itens   — os itens de cada modelo.
-- implantacoes               — uma por empresa EM ANDAMENTO (índice parcial).
-- implantacao_itens          — os itens da implantação, COPIADOS do modelo no início: mudar o
--                              modelo depois não acrescenta nem tira item de quem já começou.
-- implantacao_eventos        — a linha do tempo (append-only para os três papéis).
--
-- ── Quem escreve o quê ────────────────────────────────────────────────────────
-- * Iniciar, concluir e cancelar só pelas funções do módulo (`security definer`, só
--   `service_role`, chamadas pela rota depois do `requireRole`): iniciar copia os itens e leva a
--   carteira a `em_implantacao`; concluir confere os obrigatórios e leva a carteira a `ativo` —
--   cada uma numa transação.
-- * Os itens são escritos pelo serviço (service role). O que não depende de papel mora em
--   GATILHO e vale para qualquer escritor: a tabela de transições do item, evidência exigida,
--   motivo de dispensa, carimbos, campos imutáveis, implantação encerrada congela os itens — e a
--   TRAVA da ativação: `implantacoes.estado = 'concluida'` é recusado com obrigatório aberto,
--   mesmo por um UPDATE direto do service role.
-- * Papel (dispensar é de gestor; concluir e cancelar também) é da rota: com o service role não
--   há `auth.uid()` para o gatilho conferir.
-- * Configuração (modelos e itens) é escrita pela sessão do `admin`, pela RLS por operação.
--
-- ── LGPD ─────────────────────────────────────────────────────────────────────
-- Sem seção em `modulo_secoes_lgpd`, como a carteira (0902): a anonimização é por TITULAR
-- (contato), e nada aqui se liga a um contato — os itens são da EMPRESA (pessoa jurídica). Os
-- campos de texto livre (`observacao`, `evidencia`, `motivo_*`) são sobre a operação da empresa;
-- a tela orienta a não registrar dado pessoal neles.
--
-- ── Sem event_log nesta migration ─────────────────────────────────────────────
-- Nenhum evento `implantacao.*` até haver consumidor (o módulo de rotinas) — evento sem handler
-- fica `pending` para sempre (anti-pattern nº 3).

create or replace function public.fn_implantacao_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- A carteira primeiro: `implantacoes.company_id` aponta para o perfil dela.
  if to_regclass('public.carteira_perfis') is null then
    raise exception 'implantacao_exige_carteira'
      using errcode = 'P0001',
            hint = 'Instale o módulo Carteira de empresas antes do módulo Implantação de clientes.';
  end if;

  -- ── implantacao_modelos ────────────────────────────────────────────────────
  create table if not exists public.implantacao_modelos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    nome text not null check (char_length(btrim(nome)) between 1 and 80),
    padrao boolean not null default false,
    ativo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint implantacao_modelos_org_id_unico unique (organization_id, id)
  );
  -- Um modelo padrão por organização: é o do início automático pelo negócio ganho.
  create unique index if not exists implantacao_modelos_um_padrao_idx
    on public.implantacao_modelos (organization_id) where padrao;
  create unique index if not exists implantacao_modelos_nome_idx
    on public.implantacao_modelos (organization_id, lower(nome));

  -- ── implantacao_modelo_itens ───────────────────────────────────────────────
  create table if not exists public.implantacao_modelo_itens (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    modelo_id uuid not null,
    grupo text not null check (char_length(btrim(grupo)) between 1 and 60),
    titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
    -- O que conta como pronto. A ferramenta da IA mostra este texto ao cliente nos itens dele.
    orientacao text check (orientacao is null or char_length(orientacao) <= 1000),
    posicao integer not null default 0,
    obrigatorio boolean not null default true,
    vez_de text not null default 'escritorio' check (vez_de in ('escritorio', 'cliente', 'terceiro')),
    -- Slug de `organizations.settings.atendimento.areas` (lib/atendimento/areas.ts).
    area text check (area is null or area ~ '^[a-z][a-z0-9_]{1,40}$'),
    prazo_dias integer check (prazo_dias is null or prazo_dias between 0 and 365),
    exige_evidencia boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint implantacao_modelo_itens_modelo_da_org
      foreign key (organization_id, modelo_id)
      references public.implantacao_modelos (organization_id, id) on delete cascade
  );
  create index if not exists implantacao_modelo_itens_modelo_idx
    on public.implantacao_modelo_itens (modelo_id, posicao);

  -- ── implantacoes ───────────────────────────────────────────────────────────
  create table if not exists public.implantacoes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- O perfil da empresa na carteira (spec 21). Apagar a empresa apaga a implantação.
    company_id uuid not null references public.carteira_perfis(company_id) on delete cascade,
    modelo_id uuid,
    estado text not null default 'em_andamento'
      check (estado in ('em_andamento', 'concluida', 'cancelada')),
    origem text not null check (origem in ('manual', 'negocio_ganho')),
    lead_id uuid references public.crm_leads(id) on delete set null,
    responsavel_user_id uuid,
    -- O estado da empresa na carteira quando a implantação começou (para a linha do tempo).
    estado_carteira_no_inicio text,
    iniciada_em timestamptz not null default now(),
    prevista_para date,
    concluida_em timestamptz,
    cancelada_em timestamptz,
    motivo_cancelamento text check (motivo_cancelamento is null or char_length(motivo_cancelamento) <= 300),
    revision bigint not null default 1,
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint implantacoes_org_id_unico unique (organization_id, id),
    constraint implantacoes_modelo_da_org
      foreign key (organization_id, modelo_id)
      references public.implantacao_modelos (organization_id, id) on delete set null (modelo_id),
    constraint implantacoes_responsavel_membro_da_org
      foreign key (organization_id, responsavel_user_id)
      references public.user_organizations (organization_id, user_id) on delete set null (responsavel_user_id),
    constraint implantacoes_encerramento_coerente
      check ((concluida_em is null) = (estado <> 'concluida')
             and (cancelada_em is null) = (estado <> 'cancelada')),
    constraint implantacoes_cancelamento_com_motivo
      check (estado <> 'cancelada' or motivo_cancelamento is not null)
  );
  create unique index if not exists implantacoes_uma_em_andamento_idx
    on public.implantacoes (organization_id, company_id) where estado = 'em_andamento';
  create index if not exists implantacoes_lista_idx
    on public.implantacoes (organization_id, estado, iniciada_em desc);
  create index if not exists implantacoes_empresa_idx
    on public.implantacoes (organization_id, company_id, iniciada_em desc);

  -- ── implantacao_itens ──────────────────────────────────────────────────────
  create table if not exists public.implantacao_itens (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    implantacao_id uuid not null,
    grupo text not null check (char_length(btrim(grupo)) between 1 and 60),
    titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
    orientacao text check (orientacao is null or char_length(orientacao) <= 1000),
    posicao integer not null default 0,
    obrigatorio boolean not null default true,
    vez_de text not null default 'escritorio' check (vez_de in ('escritorio', 'cliente', 'terceiro')),
    area text check (area is null or area ~ '^[a-z][a-z0-9_]{1,40}$'),
    exige_evidencia boolean not null default false,
    prazo date,
    estado text not null default 'pendente'
      check (estado in ('pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_terceiro',
                        'bloqueado', 'concluido', 'dispensado')),
    responsavel_user_id uuid,
    observacao text check (observacao is null or char_length(observacao) <= 2000),
    evidencia text check (evidencia is null or char_length(evidencia) <= 2000),
    motivo_dispensa text check (motivo_dispensa is null or char_length(btrim(motivo_dispensa)) between 1 and 300),
    concluido_em timestamptz,
    concluido_por uuid references auth.users(id) on delete set null,
    estado_desde timestamptz not null default now(),
    revision bigint not null default 1,
    alterado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint implantacao_itens_da_implantacao
      foreign key (organization_id, implantacao_id)
      references public.implantacoes (organization_id, id) on delete cascade,
    constraint implantacao_itens_responsavel_membro_da_org
      foreign key (organization_id, responsavel_user_id)
      references public.user_organizations (organization_id, user_id) on delete set null (responsavel_user_id),
    -- A dispensa formal (§25.3) tem motivo, e só a dispensa tem.
    constraint implantacao_itens_dispensa_com_motivo
      check ((estado = 'dispensado') = (motivo_dispensa is not null)),
    constraint implantacao_itens_conclusao_coerente
      check ((concluido_em is null) = (estado <> 'concluido'))
  );
  create index if not exists implantacao_itens_implantacao_idx
    on public.implantacao_itens (implantacao_id, posicao);
  -- O vigia e a lista de atrasados: itens abertos com prazo.
  create index if not exists implantacao_itens_abertos_prazo_idx
    on public.implantacao_itens (organization_id, prazo)
    where estado not in ('concluido', 'dispensado') and prazo is not null;
  create index if not exists implantacao_itens_responsavel_idx
    on public.implantacao_itens (organization_id, responsavel_user_id, estado);

  -- ── implantacao_eventos ────────────────────────────────────────────────────
  create table if not exists public.implantacao_eventos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    implantacao_id uuid not null references public.implantacoes(id) on delete cascade,
    item_id uuid references public.implantacao_itens(id) on delete cascade,
    tipo text not null
      check (tipo in ('iniciada', 'concluida', 'cancelada', 'responsavel_alterado',
                      'item_estado_alterado', 'item_responsavel_alterado', 'item_prazo_alterado')),
    anterior jsonb,
    novo jsonb,
    ator_kind text not null check (ator_kind in ('humano', 'sistema')),
    ator_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
  );
  create index if not exists implantacao_eventos_implantacao_idx
    on public.implantacao_eventos (implantacao_id, created_at);

  -- ── Gatilhos (as funções vêm da migration — D7; aqui só se prendem) ─────────
  drop trigger if exists implantacao_modelos_antes on public.implantacao_modelos;
  create trigger implantacao_modelos_antes
    before update on public.implantacao_modelos
    for each row execute function public.fn_implantacao_config_antes_de_gravar();
  drop trigger if exists implantacao_modelo_itens_antes on public.implantacao_modelo_itens;
  create trigger implantacao_modelo_itens_antes
    before update on public.implantacao_modelo_itens
    for each row execute function public.fn_implantacao_config_antes_de_gravar();

  drop trigger if exists implantacoes_antes on public.implantacoes;
  create trigger implantacoes_antes
    before insert or update on public.implantacoes
    for each row execute function public.fn_implantacao_antes_de_gravar();
  drop trigger if exists implantacoes_linha_do_tempo on public.implantacoes;
  create trigger implantacoes_linha_do_tempo
    after insert or update on public.implantacoes
    for each row execute function public.fn_implantacao_evento();

  drop trigger if exists implantacao_itens_antes on public.implantacao_itens;
  create trigger implantacao_itens_antes
    before insert or update on public.implantacao_itens
    for each row execute function public.fn_implantacao_item_antes_de_gravar();
  drop trigger if exists implantacao_itens_linha_do_tempo on public.implantacao_itens;
  create trigger implantacao_itens_linha_do_tempo
    after update on public.implantacao_itens
    for each row execute function public.fn_implantacao_item_evento();

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui) ─────────────────────────────────────
  -- Configuração: leitura da organização, escrita do `admin`. Cada `create policy` em DUAS
  -- linhas (nome / tabela) de propósito (#1906).
  alter table public.implantacao_modelos enable row level security;
  drop policy if exists implantacao_modelos_select on public.implantacao_modelos;
  create policy implantacao_modelos_select
    on public.implantacao_modelos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists implantacao_modelos_escrita on public.implantacao_modelos;
  create policy implantacao_modelos_escrita
    on public.implantacao_modelos
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.implantacao_modelos from anon;

  alter table public.implantacao_modelo_itens enable row level security;
  drop policy if exists implantacao_modelo_itens_select on public.implantacao_modelo_itens;
  create policy implantacao_modelo_itens_select
    on public.implantacao_modelo_itens
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  drop policy if exists implantacao_modelo_itens_escrita on public.implantacao_modelo_itens;
  create policy implantacao_modelo_itens_escrita
    on public.implantacao_modelo_itens
    for all
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'admin')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'admin')));
  revoke all on public.implantacao_modelo_itens from anon;

  -- Implantações e itens: a sessão só LÊ (o serviço escreve, ver o cabeçalho).
  alter table public.implantacoes enable row level security;
  drop policy if exists implantacoes_select on public.implantacoes;
  create policy implantacoes_select
    on public.implantacoes
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.implantacoes from anon;
  revoke insert, update, delete, truncate on public.implantacoes from authenticated;
  -- O service role não insere nem apaga implantação: nasce por fn_implantacao_iniciar e só se
  -- encerra (concluída/cancelada), nunca some.
  revoke insert, delete, truncate on public.implantacoes from service_role;

  alter table public.implantacao_itens enable row level security;
  drop policy if exists implantacao_itens_select on public.implantacao_itens;
  create policy implantacao_itens_select
    on public.implantacao_itens
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.implantacao_itens from anon;
  revoke insert, update, delete, truncate on public.implantacao_itens from authenticated;
  -- Item nasce copiado do modelo por fn_implantacao_iniciar e não se apaga (dispensa-se).
  revoke insert, delete, truncate on public.implantacao_itens from service_role;

  alter table public.implantacao_eventos enable row level security;
  drop policy if exists implantacao_eventos_select on public.implantacao_eventos;
  create policy implantacao_eventos_select
    on public.implantacao_eventos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );
  revoke all on public.implantacao_eventos from anon;
  -- Append-only para os três papéis do PostgREST (lição da 0258): só os gatilhos escrevem aqui.
  revoke insert, update, delete, truncate on public.implantacao_eventos from authenticated, service_role;

  comment on table public.implantacao_modelos is
    'Modelos de checklist de implantação (módulo implantacao, migration 0907). Um padrão por organização, usado no início automático pelo negócio ganho.';
  comment on table public.implantacao_modelo_itens is
    'Itens de um modelo de implantação: grupo, de quem é a vez, área, prazo relativo, obrigatoriedade e se exige evidência.';
  comment on table public.implantacoes is
    'Implantação (onboarding) de uma empresa da carteira. Uma em andamento por empresa. Nasce por fn_implantacao_iniciar; concluída só com todos os obrigatórios concluídos ou dispensados.';
  comment on table public.implantacao_itens is
    'Itens da implantação, copiados do modelo no início. Escritos pelo serviço; transições, evidência e dispensa conferidas por gatilho.';
  comment on table public.implantacao_eventos is
    'Linha do tempo da implantação, append-only. Escrita só pelos gatilhos.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9).
revoke execute on function public.fn_implantacao_provisionar() from public, anon, authenticated;
grant execute on function public.fn_implantacao_provisionar() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- Funções do módulo. Existem mesmo sem as tabelas (D7): `record`, nunca `%rowtype`.
-- Quem fez: `auth.uid()` quando é a sessão; com o service role, a coluna `alterado_por`.
-- ════════════════════════════════════════════════════════════════════════════

-- ---- configuração: organização imutável e updated_at ----
create or replace function public.fn_implantacao_config_antes_de_gravar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'implantacao_organizacao_imutavel' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- implantação, ANTES de gravar: imutáveis, coerência, estados e a TRAVA da ativação ----
create or replace function public.fn_implantacao_antes_de_gravar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abertos integer;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.companies where id = new.company_id and organization_id = new.organization_id) then
      raise exception 'implantacao_empresa_de_outra_organizacao' using errcode = '23514';
    end if;
    if new.estado <> 'em_andamento' then
      raise exception 'implantacao_nasce_em_andamento' using errcode = '23514';
    end if;
    if new.lead_id is not null and not exists (
         select 1 from public.crm_leads where id = new.lead_id and organization_id = new.organization_id) then
      raise exception 'implantacao_negocio_de_outra_organizacao' using errcode = '23514';
    end if;
    new.revision := 1;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.company_id is distinct from old.company_id
     or new.origem is distinct from old.origem
     or new.lead_id is distinct from old.lead_id
     or new.iniciada_em is distinct from old.iniciada_em
     or new.estado_carteira_no_inicio is distinct from old.estado_carteira_no_inicio then
    raise exception 'implantacao_campo_imutavel' using errcode = '23514';
  end if;

  if new.estado is distinct from old.estado then
    -- Concluída e cancelada são finais.
    if old.estado <> 'em_andamento' then
      raise exception 'implantacao_encerrada' using errcode = 'P0001',
        detail = format('%s -> %s', old.estado, new.estado);
    end if;
    if new.estado = 'concluida' then
      -- A TRAVA (spec 23 §5.3): nenhum obrigatório fora de concluído/dispensado.
      select count(*) into v_abertos
        from public.implantacao_itens
       where implantacao_id = new.id and obrigatorio and estado not in ('concluido', 'dispensado');
      if v_abertos > 0 then
        raise exception 'implantacao_obrigatorios_abertos' using errcode = 'P0001',
          detail = format('%s item(ns) obrigatório(s) aberto(s)', v_abertos);
      end if;
      new.concluida_em := now();
    elsif new.estado = 'cancelada' then
      new.cancelada_em := now();
    end if;
  elsif old.estado <> 'em_andamento'
        and (new.responsavel_user_id is distinct from old.responsavel_user_id
             or new.prevista_para is distinct from old.prevista_para
             or new.motivo_cancelamento is distinct from old.motivo_cancelamento) then
    raise exception 'implantacao_encerrada' using errcode = 'P0001';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- item, ANTES de gravar: imutáveis, implantação aberta, transições, evidência, carimbos ----
--
-- A tabela de transições (spec 23 §5.2) mora aqui e vale para todo escritor; o espelho em
-- TypeScript (`lib/implantacao/vocabulario.ts`) só decide que botões a tela mostra.
create or replace function public.fn_implantacao_item_antes_de_gravar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado_da_implantacao text;
  v_permitidas text[];
begin
  select estado into v_estado_da_implantacao
    from public.implantacoes
   where id = new.implantacao_id and organization_id = new.organization_id;
  if v_estado_da_implantacao is null then
    raise exception 'implantacao_nao_encontrada' using errcode = 'P0002';
  end if;
  if v_estado_da_implantacao <> 'em_andamento' then
    raise exception 'implantacao_encerrada' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.estado <> 'pendente' then
      raise exception 'implantacao_item_nasce_pendente' using errcode = '23514';
    end if;
    new.revision := 1;
    new.estado_desde := now();
    return new;
  end if;

  -- O compromisso copiado do modelo não muda no meio: obrigatoriedade e evidência são a régua da
  -- ativação, e trocá-las depois seria afrouxar a trava em silêncio.
  if new.organization_id is distinct from old.organization_id
     or new.implantacao_id is distinct from old.implantacao_id
     or new.obrigatorio is distinct from old.obrigatorio
     or new.exige_evidencia is distinct from old.exige_evidencia
     or new.vez_de is distinct from old.vez_de then
    raise exception 'implantacao_item_campo_imutavel' using errcode = '23514';
  end if;

  if new.estado is distinct from old.estado then
    v_permitidas := case old.estado
      when 'pendente'            then array['em_andamento', 'aguardando_cliente', 'aguardando_terceiro',
                                            'bloqueado', 'concluido', 'dispensado']
      when 'em_andamento'        then array['pendente', 'aguardando_cliente', 'aguardando_terceiro',
                                            'bloqueado', 'concluido', 'dispensado']
      when 'aguardando_cliente'  then array['em_andamento', 'concluido', 'dispensado']
      when 'aguardando_terceiro' then array['em_andamento', 'concluido', 'dispensado']
      when 'bloqueado'           then array['em_andamento', 'concluido', 'dispensado']
      when 'concluido'           then array['em_andamento']
      when 'dispensado'          then array['pendente']
      else array[]::text[]
    end;
    if not (new.estado = any (v_permitidas)) then
      raise exception 'implantacao_item_transicao_invalida'
        using errcode = 'P0001', detail = format('%s -> %s', old.estado, new.estado);
    end if;

    new.estado_desde := now();
    if new.estado = 'concluido' then
      if new.exige_evidencia and (new.evidencia is null or btrim(new.evidencia) = '') then
        raise exception 'implantacao_item_exige_evidencia' using errcode = 'P0001';
      end if;
      new.concluido_em := now();
      new.concluido_por := coalesce(auth.uid(), new.alterado_por);
    else
      new.concluido_em := null;
      new.concluido_por := null;
    end if;
    if new.estado <> 'dispensado' then
      new.motivo_dispensa := null;
    end if;
  elsif new.estado = 'concluido' and new.exige_evidencia
        and (new.evidencia is null or btrim(new.evidencia) = '') then
    -- Apagar a evidência de um item concluído reabriria a trava pela porta dos fundos.
    raise exception 'implantacao_item_exige_evidencia' using errcode = 'P0001';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- linha do tempo da implantação ----
create or replace function public.fn_implantacao_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := coalesce(auth.uid(), new.alterado_por);
  v_kind text := case when v_ator is not null then 'humano' else 'sistema' end;
begin
  if tg_op = 'INSERT' then
    insert into public.implantacao_eventos (organization_id, implantacao_id, tipo, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id, 'iniciada',
            jsonb_build_object('origem', new.origem, 'modelo_id', new.modelo_id, 'lead_id', new.lead_id,
                               'estado_carteira_no_inicio', new.estado_carteira_no_inicio,
                               'prevista_para', new.prevista_para),
            v_kind, v_ator);
    return null;
  end if;

  if new.estado is distinct from old.estado then
    insert into public.implantacao_eventos (organization_id, implantacao_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id,
            case new.estado when 'concluida' then 'concluida' else 'cancelada' end,
            jsonb_build_object('estado', old.estado),
            jsonb_build_object('estado', new.estado),
            v_kind, v_ator);
  end if;

  if new.responsavel_user_id is distinct from old.responsavel_user_id then
    insert into public.implantacao_eventos (organization_id, implantacao_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.id, 'responsavel_alterado',
            jsonb_build_object('responsavel_user_id', old.responsavel_user_id),
            jsonb_build_object('responsavel_user_id', new.responsavel_user_id),
            v_kind, v_ator);
  end if;
  return null;
end;
$$;

-- ---- linha do tempo dos itens ----
-- Campos operacionais campo a campo (estado, responsável, prazo). Observação e evidência não
-- entram aqui: ficam no item, e a linha do tempo não copia texto livre.
create or replace function public.fn_implantacao_item_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ator uuid := coalesce(auth.uid(), new.alterado_por);
  v_kind text := case when v_ator is not null then 'humano' else 'sistema' end;
begin
  if new.estado is distinct from old.estado then
    insert into public.implantacao_eventos (organization_id, implantacao_id, item_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.implantacao_id, new.id, 'item_estado_alterado',
            jsonb_build_object('estado', old.estado),
            jsonb_build_object('estado', new.estado),
            v_kind, v_ator);
  end if;
  if new.responsavel_user_id is distinct from old.responsavel_user_id then
    insert into public.implantacao_eventos (organization_id, implantacao_id, item_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.implantacao_id, new.id, 'item_responsavel_alterado',
            jsonb_build_object('responsavel_user_id', old.responsavel_user_id),
            jsonb_build_object('responsavel_user_id', new.responsavel_user_id),
            v_kind, v_ator);
  end if;
  if new.prazo is distinct from old.prazo then
    insert into public.implantacao_eventos (organization_id, implantacao_id, item_id, tipo, anterior, novo, ator_kind, ator_user_id)
    values (new.organization_id, new.implantacao_id, new.id, 'item_prazo_alterado',
            jsonb_build_object('prazo', old.prazo),
            jsonb_build_object('prazo', new.prazo),
            v_kind, v_ator);
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_implantacao_config_antes_de_gravar() from public, anon, authenticated;
revoke execute on function public.fn_implantacao_antes_de_gravar() from public, anon, authenticated;
revoke execute on function public.fn_implantacao_item_antes_de_gravar() from public, anon, authenticated;
revoke execute on function public.fn_implantacao_evento() from public, anon, authenticated;
revoke execute on function public.fn_implantacao_item_evento() from public, anon, authenticated;

-- ---- fn_implantacao_iniciar: a ÚNICA porta de nascimento ----
--
-- Numa transação: leva a empresa a `em_implantacao` na carteira (por fn_carteira_transicionar, a
-- única escrita do estado — que também cria o perfil se a empresa ainda não tem), cria a
-- implantação e COPIA os itens do modelo, com o prazo contado no fuso da organização e o
-- responsável do item vindo da carteira (o responsável da empresa NA ÁREA do item).
--
-- Idempotente: já havendo uma em andamento para a empresa, devolve ela (`criada = false`).
-- Empresa `ativo` pode ter implantação sem mudar de estado (serviço novo — spec 23 Q3); empresa
-- suspensa, em distrato ou inativa, não.
create or replace function public.fn_implantacao_iniciar(
  p_org uuid,
  p_company uuid,
  p_modelo uuid,
  p_origem text,
  p_lead uuid default null,
  p_responsavel uuid default null,
  p_ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existente uuid;
  v_estado text;
  v_fuso text;
  v_hoje date;
  v_id uuid;
  v_itens integer;
begin
  if p_org is null or p_company is null or p_modelo is null or p_origem is null
     or p_origem not in ('manual', 'negocio_ganho') then
    raise exception 'implantacao_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = p_company and organization_id = p_org) then
    raise exception 'implantacao_empresa_nao_encontrada' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.implantacao_modelos
                  where id = p_modelo and organization_id = p_org and ativo) then
    raise exception 'implantacao_modelo_nao_encontrado' using errcode = 'P0002';
  end if;

  -- Serializa dois inícios da mesma empresa: a trava é a linha do perfil na carteira.
  insert into public.carteira_perfis (company_id, organization_id, estado_alterado_por)
  values (p_company, p_org, p_ator)
  on conflict (company_id) do nothing;
  select estado into v_estado from public.carteira_perfis
   where company_id = p_company and organization_id = p_org
   for update;

  select id into v_existente from public.implantacoes
   where organization_id = p_org and company_id = p_company and estado = 'em_andamento';
  if v_existente is not null then
    return jsonb_build_object('implantacao_id', v_existente, 'criada', false);
  end if;

  if v_estado in ('suspenso', 'em_distrato', 'inativo') then
    raise exception 'implantacao_estado_da_empresa_nao_permite'
      using errcode = 'P0001', detail = v_estado;
  end if;
  if v_estado in ('prospect', 'em_qualificacao', 'proposta') then
    perform public.fn_carteira_transicionar(p_org, p_company, 'em_implantacao', p_ator);
  end if;

  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_fuso
    from public.organizations where id = p_org;
  v_hoje := (now() at time zone v_fuso)::date;

  insert into public.implantacoes
    (organization_id, company_id, modelo_id, origem, lead_id, responsavel_user_id,
     estado_carteira_no_inicio, alterado_por, prevista_para)
  values
    (p_org, p_company, p_modelo, p_origem, p_lead, p_responsavel, v_estado, p_ator,
     (select v_hoje + max(prazo_dias) from public.implantacao_modelo_itens
       where modelo_id = p_modelo and organization_id = p_org))
  returning id into v_id;

  insert into public.implantacao_itens
    (organization_id, implantacao_id, grupo, titulo, orientacao, posicao, obrigatorio, vez_de,
     area, exige_evidencia, prazo, responsavel_user_id, alterado_por)
  select p_org, v_id, mi.grupo, mi.titulo, mi.orientacao, mi.posicao, mi.obrigatorio, mi.vez_de,
         mi.area, mi.exige_evidencia,
         case when mi.prazo_dias is null then null else v_hoje + mi.prazo_dias end,
         coalesce(
           (select r.user_id from public.carteira_responsaveis r
             where r.organization_id = p_org and r.company_id = p_company and r.area = mi.area
               -- `current_date`, e não v_hoje: é a convenção com que a carteira grava a vigência
               -- (0902); comparar com a data no fuso da organização perderia o responsável
               -- cadastrado hoje entre 21h e meia-noite de São Paulo.
               and r.vigencia_inicio <= current_date
               and (r.vigencia_fim is null or r.vigencia_fim >= current_date)
             order by r.principal desc, r.vigencia_inicio desc
             limit 1),
           p_responsavel),
         p_ator
    from public.implantacao_modelo_itens mi
   where mi.modelo_id = p_modelo and mi.organization_id = p_org
   order by mi.posicao, mi.titulo;
  get diagnostics v_itens = row_count;

  return jsonb_build_object('implantacao_id', v_id, 'criada', true, 'itens', v_itens,
                            'estado_carteira_no_inicio', v_estado);
end;
$$;

revoke execute on function public.fn_implantacao_iniciar(uuid, uuid, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_implantacao_iniciar(uuid, uuid, uuid, text, uuid, uuid, uuid) to service_role;

-- ---- fn_implantacao_concluir: a ATIVAÇÃO ----
--
-- Numa transação: implantação → `concluida` (o gatilho recusa com obrigatório aberto e diz
-- quantos) e, se a empresa está em `em_implantacao`, carteira → `ativo` por
-- fn_carteira_transicionar (que grava `cliente_desde` na primeira vez). Empresa que já era
-- `ativo` (serviço novo) só tem a implantação concluída. Quem decide é o gestor, pelo clique
-- (spec 23 Q1) — nada aqui conclui sozinho.
create or replace function public.fn_implantacao_concluir(
  p_org uuid,
  p_implantacao uuid,
  p_ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_imp record;
  v_estado text;
  v_carteira jsonb;
begin
  select id, company_id, estado into v_imp from public.implantacoes
   where id = p_implantacao and organization_id = p_org
   for update;
  if v_imp.id is null then
    raise exception 'implantacao_nao_encontrada' using errcode = 'P0002';
  end if;

  update public.implantacoes
     set estado = 'concluida', alterado_por = p_ator
   where id = p_implantacao;

  select estado into v_estado from public.carteira_perfis
   where company_id = v_imp.company_id and organization_id = p_org
   for update;
  if v_estado = 'em_implantacao' then
    v_carteira := public.fn_carteira_transicionar(p_org, v_imp.company_id, 'ativo', p_ator);
  end if;

  return jsonb_build_object('implantacao_id', p_implantacao, 'ativou', v_carteira is not null,
                            'cliente_desde', v_carteira ->> 'cliente_desde');
end;
$$;

revoke execute on function public.fn_implantacao_concluir(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_implantacao_concluir(uuid, uuid, uuid) to service_role;

-- ---- fn_implantacao_cancelar ----
--
-- Com motivo. A carteira só sai de `em_implantacao` para `ativo` ou `inativo` (tabela de
-- transições da 0902), então cancelar não "volta" ao estado anterior: ou a empresa fica como
-- está (`p_inativar = false`), ou vai para `inativo` — quem cancela escolhe.
create or replace function public.fn_implantacao_cancelar(
  p_org uuid,
  p_implantacao uuid,
  p_motivo text,
  p_inativar boolean default false,
  p_ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_imp record;
  v_estado text;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'implantacao_cancelamento_sem_motivo' using errcode = '22023';
  end if;
  select id, company_id into v_imp from public.implantacoes
   where id = p_implantacao and organization_id = p_org
   for update;
  if v_imp.id is null then
    raise exception 'implantacao_nao_encontrada' using errcode = 'P0002';
  end if;

  update public.implantacoes
     set estado = 'cancelada', motivo_cancelamento = btrim(p_motivo), alterado_por = p_ator
   where id = p_implantacao;

  if p_inativar then
    select estado into v_estado from public.carteira_perfis
     where company_id = v_imp.company_id and organization_id = p_org
     for update;
    if v_estado = 'em_implantacao' then
      perform public.fn_carteira_transicionar(p_org, v_imp.company_id, 'inativo', p_ator);
    end if;
  end if;

  return jsonb_build_object('implantacao_id', p_implantacao, 'inativou', coalesce(v_estado = 'em_implantacao', false));
end;
$$;

revoke execute on function public.fn_implantacao_cancelar(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.fn_implantacao_cancelar(uuid, uuid, text, boolean, uuid) to service_role;
