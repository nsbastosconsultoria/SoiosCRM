-- 0485 — Honorários: como pagar a parcela.
--
-- A Sofia (agente financeiro de um escritório de advocacia) precisa responder
-- "me manda o boleto" com o que o escritório oficialmente disponibilizou, e a
-- parcela só tinha vencimento, valor e status. Esta migration acrescenta
-- `honorarios_parcelas.instrucao_pagamento` (texto livre, até 1000 caracteres):
-- link do boleto, Pix copia-e-cola ou linha digitável, colado pelo escritório.
--
-- ── Por que pela PROVISIONADORA, e não por `alter table` solto ──────────────
-- As tabelas do módulo só existem onde ele foi instalado (ADR-0002). A coluna
-- entra na própria `fn_honorarios_provisionar()`: instalação nova já nasce com
-- ela, e quem instalou antes a recebe na reaplicação que toda atualização faz
-- (`fn_reaplicar_modulos_instalados`, migration 0340). Onde o módulo não está
-- instalado, nada acontece.
--
-- Nenhum dado existente muda: a coluna nasce nula em toda parcela.

create or replace function public.fn_honorarios_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.honorarios_contratos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- Preservado mesmo se o lead for excluído (mesma decisão de
    -- `financial_entries.sale_id`): o contrato é registro financeiro e sobrevive
    -- à linha operacional que o originou.
    lead_id uuid references public.crm_leads(id) on delete set null,

    -- `text` + CHECK, não enum (doutrina: enum é difícil de estender).
    modelo text not null check (modelo in ('fixo', 'exito', 'misto')),

    valor_fixo_cents bigint check (valor_fixo_cents is null or valor_fixo_cents > 0),
    percentual_exito numeric(5,2) check (percentual_exito is null or (percentual_exito > 0 and percentual_exito <= 100)),
    repasse_advogado_pct numeric(5,2) check (repasse_advogado_pct is null or (repasse_advogado_pct >= 0 and repasse_advogado_pct <= 100)),

    -- Modelo declara o campo que faz sentido: fixo pede valor, êxito pede
    -- percentual, misto pede os dois. Não impede o resto de ficar em branco.
    constraint honorarios_contratos_modelo_tem_o_campo check (
      (modelo = 'fixo' and valor_fixo_cents is not null)
      or (modelo = 'exito' and percentual_exito is not null)
      or (modelo = 'misto' and valor_fixo_cents is not null and percentual_exito is not null)
    ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists honorarios_contratos_org_idx
    on public.honorarios_contratos (organization_id);
  create index if not exists honorarios_contratos_lead_idx
    on public.honorarios_contratos (organization_id, lead_id) where lead_id is not null;

  create table if not exists public.honorarios_parcelas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contrato_id uuid not null references public.honorarios_contratos(id) on delete cascade,

    numero integer not null check (numero > 0),
    vencimento date not null,
    valor_cents bigint not null check (valor_cents > 0),

    -- Preservada mesmo se o lançamento do caixa for desfeito — a MESMA decisão
    -- de `financial_entries.sale_id`: o link é conveniência de navegação, nunca
    -- a fonte da verdade do valor ou da data.
    financial_entry_id uuid references public.financial_entries(id) on delete set null,

    status text not null default 'pendente' check (status in ('pendente', 'pago', 'atrasado')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint honorarios_parcelas_numero_unico unique (contrato_id, numero)
  );

  create index if not exists honorarios_parcelas_org_idx
    on public.honorarios_parcelas (organization_id);
  create index if not exists honorarios_parcelas_contrato_idx
    on public.honorarios_parcelas (organization_id, contrato_id);
  create index if not exists honorarios_parcelas_vencimento_idx
    on public.honorarios_parcelas (organization_id, vencimento) where status = 'pendente';

  -- ── RLS POR OPERAÇÃO (D5, ligada aqui e não pela rotina automática) ────────
  -- Molde da 0464 (propostas): uma policy por operação, espelhando as ROTAS,
  -- porque o PostgREST é porta tão aberta quanto elas (o JWT da sessão fala com
  -- ele direto; ver 0150) e o baseline dá GRANT ALL a `authenticated`.
  --   SELECT  qualquer papel da organização (GET /honorarios/... é `viewer`);
  --   INSERT  `manager` (POST de contrato e de parcela é `manager`);
  --   UPDATE  `manager` — nenhuma rota edita, e dinheiro não é coisa que
  --           `agent` configure (mesmo piso do caixa núcleo, migration 0350);
  --   DELETE  `manager`, e PARCELA PAGA NÃO SE APAGA: nem ela, nem o contrato
  --           que a tem (o `on delete cascade` levaria a parcela junto, e a
  --           cascata de FK não passa por RLS).
  -- A policy anterior era UMA só, `for all`, com USING = membro e WITH CHECK =
  -- manager+. DELETE só avalia o USING: `viewer` e `agent` apagavam contrato
  -- (com as parcelas) ou parcela paga (revisão do #1578).
  --
  -- Parcela paga é imutável pela sessão, e a sessão não marca parcela como
  -- paga: `pago` com `financial_entry_id` só nasce em fn_honorarios_parcela_pagar
  -- (definer, dona da tabela, não passa por aqui), que lança o caixa junto.
  -- Deixar a sessão escrever `status`/`financial_entry_id` à mão desfaria esse
  -- par: "pago" sem lançamento, ou "pendente" de novo para pagar duas vezes.
  -- A parcela só aponta para contrato da própria organização (a FK só confere
  -- que o contrato existe).
  alter table public.honorarios_contratos enable row level security;
  drop policy if exists tenant_isolation_honorarios_contratos_all on public.honorarios_contratos;

  drop policy if exists honorarios_contratos_select on public.honorarios_contratos;
  create policy honorarios_contratos_select on public.honorarios_contratos
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists honorarios_contratos_insert on public.honorarios_contratos;
  create policy honorarios_contratos_insert on public.honorarios_contratos
    for insert
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists honorarios_contratos_update on public.honorarios_contratos;
  create policy honorarios_contratos_update on public.honorarios_contratos
    for update
    using (public.fn_is_platform_admin()
           or (organization_id in (select public.fn_user_org_ids())
               and public.fn_role_at_least(organization_id, 'manager')))
    with check (public.fn_is_platform_admin()
                or (organization_id in (select public.fn_user_org_ids())
                    and public.fn_role_at_least(organization_id, 'manager')));

  drop policy if exists honorarios_contratos_delete on public.honorarios_contratos;
  create policy honorarios_contratos_delete on public.honorarios_contratos
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and not exists (select 1 from public.honorarios_parcelas p
                            where p.contrato_id = honorarios_contratos.id and p.status = 'pago'));
  revoke all on public.honorarios_contratos from anon;

  alter table public.honorarios_parcelas enable row level security;
  drop policy if exists tenant_isolation_honorarios_parcelas_all on public.honorarios_parcelas;

  drop policy if exists honorarios_parcelas_select on public.honorarios_parcelas;
  create policy honorarios_parcelas_select on public.honorarios_parcelas
    for select using (
      organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin()
    );

  drop policy if exists honorarios_parcelas_insert on public.honorarios_parcelas;
  create policy honorarios_parcelas_insert on public.honorarios_parcelas
    for insert
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and status <> 'pago' and financial_entry_id is null
                and exists (select 1 from public.honorarios_contratos c
                             where c.id = contrato_id
                               and c.organization_id = honorarios_parcelas.organization_id));

  drop policy if exists honorarios_parcelas_update on public.honorarios_parcelas;
  create policy honorarios_parcelas_update on public.honorarios_parcelas
    for update
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and status <> 'pago')
    with check ((public.fn_is_platform_admin()
                 or (organization_id in (select public.fn_user_org_ids())
                     and public.fn_role_at_least(organization_id, 'manager')))
                and status <> 'pago' and financial_entry_id is null
                and exists (select 1 from public.honorarios_contratos c
                             where c.id = contrato_id
                               and c.organization_id = honorarios_parcelas.organization_id));

  drop policy if exists honorarios_parcelas_delete on public.honorarios_parcelas;
  create policy honorarios_parcelas_delete on public.honorarios_parcelas
    for delete
    using ((public.fn_is_platform_admin()
            or (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager')))
           and status <> 'pago');
  revoke all on public.honorarios_parcelas from anon;

  comment on table public.honorarios_contratos is
    'Modelo de cobrança do caso (fixo/êxito/misto). Financeiro real (contas, lançamentos) é o caixa núcleo — este módulo só descreve o contrato.';
  comment on table public.honorarios_parcelas is
    'Calendário de parcelas do contrato. Pagar uma parcela cria um financial_entries e liga por financial_entry_id; não há tabela de "pagamento" própria.';

  -- RLS já ligada por nós, então esta rotina não mexe mais nelas (D5) — só
  -- aplica as travas de suporte, que dependem de RLS já estar de pé.
  -- ── COMO PAGAR A PARCELA (migration 0485) ──────────────────────────────────
  -- O agente financeiro lia vencimento e valor, mas não tinha o que entregar a
  -- quem pedia "me manda o boleto": não havia campo. É texto que o ESCRITÓRIO
  -- cola — link do boleto, Pix copia-e-cola ou linha digitável —, sem gateway:
  -- o módulo continua só descrevendo o contrato (DIRC "integrar"). Nasce por
  -- `add column if not exists` DEPOIS do `create table`, e não dentro dele,
  -- para chegar também a quem instalou o módulo antes: a reaplicação das
  -- atualizações (fn_reaplicar_modulos_instalados) roda esta função de novo.
  alter table public.honorarios_parcelas
    add column if not exists instrucao_pagamento text;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.honorarios_parcelas'::regclass
       and conname = 'honorarios_parcelas_instrucao_pagamento_tamanho'
  ) then
    alter table public.honorarios_parcelas
      add constraint honorarios_parcelas_instrucao_pagamento_tamanho
      check (instrucao_pagamento is null or char_length(instrucao_pagamento) between 1 and 1000);
  end if;
  comment on column public.honorarios_parcelas.instrucao_pagamento is
    'Como pagar esta parcela, como o escritório escreveu: link do boleto, Pix copia-e-cola ou linha digitável. null = não informado. O agente repassa sem alterar; nunca é gerado pelo sistema.';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- As DUAS origens de EXECUTE (CLAUDE.md, migrations item 9), de novo: `create or
-- replace` preserva os grants, mas a revogação explícita é o que a varredura de
-- `security definer` mede.
revoke execute on function public.fn_honorarios_provisionar() from public, anon, authenticated;
grant execute on function public.fn_honorarios_provisionar() to service_role;
