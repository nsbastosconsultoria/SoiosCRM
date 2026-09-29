-- 0486 — Cobrança dos tenants: módulo opcional (Fase 1 do plano
-- docs/superpowers/plans/cobranca-dos-tenants.md).
--
-- Quem opera a instalação cobra as empresas que atende: plano, assinatura por
-- organização, faturas lançadas à mão e o corte automático por inadimplência.
-- Sem gateway nesta fase — a fatura é registrada e baixada pelo administrador.
--
-- ── Por que MÓDULO (ADR-0002) ─────────────────────────────────────────────────
-- Quem instala o CRM para uma empresa só não cobra ninguém. Se nenhuma
-- instalação ligar isto, a operação comum continua inteira — é o estado de
-- hoje. Então as tabelas nascem por `fn_cobranca_provisionar()`, quando o
-- administrador da instalação instala o módulo em /admin/modulos, e não no
-- baseline para todos. Criar a função aqui não cria tabela nenhuma.
--
-- ── As três tabelas ───────────────────────────────────────────────────────────
-- billing_plans          — da INSTALAÇÃO (sem organization_id): o catálogo de
--                          planos que o operador vende. `trial_days` por plano
--                          (decisão de 2026-09-29).
-- billing_subscriptions  — uma por organização (`unique (organization_id)`).
--                          `grace_days` padrão 7 (decisão de 2026-09-29).
--                          `suspended_by_billing` separa a suspensão por falta de
--                          pagamento da suspensão manual: a reativação
--                          automática SÓ desfaz a primeira. Religar sozinho um
--                          tenant que alguém suspendeu por outro motivo seria
--                          desfazer a decisão de uma pessoa.
-- billing_invoices       — as faturas. `unique (subscription_id, due_date)`: a
--                          mesma competência não é faturada duas vezes, e o
--                          23505 é resposta, não erro. `provider`/`external_id`
--                          já nascem para a Fase 2 (gateway), com o índice único
--                          que o webhook idempotente vai usar.
--
-- ── RLS por papel, ligada aqui (D5) ──────────────────────────────────────────
-- Escrita: só o administrador da PLATAFORMA — cobrança é da instalação, e um
-- admin de tenant que pudesse editar a própria fatura se daria baixa sozinho.
-- Leitura: o administrador da plataforma, e os membros da organização o que é
-- dela (é o que alimenta a faixa de aviso e a tela da conta suspensa). O plano
-- é legível por quem tem assinatura nele. Como a RLS é ligada dentro da função,
-- `fn_proteger_tabelas_de_organizacao()` não aplica a policy ampla por cima.
--
-- ── A suspensão NÃO mora aqui ────────────────────────────────────────────────
-- Suspender é o mesmo `organizations.status = 'suspended'` da suspensão manual,
-- escrito pelo cron `cobranca-watcher` (lib/cobranca/). Suspenso por cobrança, o
-- tenant perde só as telas; WhatsApp e IA seguem atendendo o cliente final
-- (decisão de 2026-09-29) — o que a suspensão de hoje já faz.

create or replace function public.fn_cobranca_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.billing_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(btrim(name)) between 1 and 120),
    price_cents bigint not null check (price_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    -- Meses entre uma fatura e a próxima. Lista fechada: é o que um operador
    -- vende, e `interval` livre faria o cálculo do próximo vencimento ambíguo.
    interval_months integer not null default 1 check (interval_months in (1, 3, 6, 12)),
    trial_days integer not null default 0 check (trial_days between 0 and 365),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.billing_subscriptions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    plan_id uuid not null references public.billing_plans(id) on delete restrict,
    status text not null default 'active'
      check (status in ('trialing', 'active', 'past_due', 'suspended', 'canceled')),
    trial_ends_at date,
    -- O próximo vencimento: a data que a PRÓXIMA fatura a lançar deve ter.
    current_period_end date not null,
    grace_days integer not null default 7 check (grace_days between 0 and 60),
    suspended_by_billing boolean not null default false,
    canceled_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint billing_subscriptions_uma_por_organizacao unique (organization_id)
  );

  create table if not exists public.billing_invoices (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
    amount_cents bigint not null check (amount_cents > 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    due_date date not null,
    status text not null default 'open' check (status in ('open', 'paid', 'overdue', 'canceled')),
    paid_at timestamptz,
    -- Como foi pago ("Pix em 03/10", "transferência") — texto do operador.
    payment_note text check (payment_note is null or char_length(payment_note) <= 500),
    -- Como pagar: link, Pix copia-e-cola ou linha digitável, colado à mão
    -- (mesma ideia de honorarios_parcelas.instrucao_pagamento, 0485).
    instrucao_pagamento text
      check (instrucao_pagamento is null or char_length(instrucao_pagamento) between 1 and 1000),
    provider text,
    external_id text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint billing_invoices_uma_por_vencimento unique (subscription_id, due_date),
    constraint billing_invoices_paga_tem_data check (status <> 'paid' or paid_at is not null)
  );

  create unique index if not exists billing_invoices_provider_external_idx
    on public.billing_invoices (provider, external_id)
    where provider is not null and external_id is not null;
  create index if not exists billing_invoices_org_idx
    on public.billing_invoices (organization_id, due_date);
  create index if not exists billing_invoices_em_aberto_idx
    on public.billing_invoices (subscription_id, due_date) where status in ('open', 'overdue');

  -- ── RLS ────────────────────────────────────────────────────────────────────
  alter table public.billing_plans enable row level security;
  alter table public.billing_subscriptions enable row level security;
  alter table public.billing_invoices enable row level security;

  drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
  create policy billing_subscriptions_select on public.billing_subscriptions
    for select using (
      public.fn_is_platform_admin() or organization_id in (select public.fn_user_org_ids())
    );
  drop policy if exists billing_subscriptions_admin on public.billing_subscriptions;
  create policy billing_subscriptions_admin on public.billing_subscriptions
    for all using (public.fn_is_platform_admin()) with check (public.fn_is_platform_admin());

  drop policy if exists billing_invoices_select on public.billing_invoices;
  create policy billing_invoices_select on public.billing_invoices
    for select using (
      public.fn_is_platform_admin() or organization_id in (select public.fn_user_org_ids())
    );
  drop policy if exists billing_invoices_admin on public.billing_invoices;
  create policy billing_invoices_admin on public.billing_invoices
    for all using (public.fn_is_platform_admin()) with check (public.fn_is_platform_admin());

  drop policy if exists billing_plans_select on public.billing_plans;
  create policy billing_plans_select on public.billing_plans
    for select using (
      public.fn_is_platform_admin()
      or exists (
        select 1 from public.billing_subscriptions s
         where s.plan_id = billing_plans.id
           and s.organization_id in (select public.fn_user_org_ids())
      )
    );
  drop policy if exists billing_plans_admin on public.billing_plans;
  create policy billing_plans_admin on public.billing_plans
    for all using (public.fn_is_platform_admin()) with check (public.fn_is_platform_admin());

  revoke all on public.billing_plans from anon;
  revoke all on public.billing_subscriptions from anon;
  revoke all on public.billing_invoices from anon;

  comment on table public.billing_plans is
    'Planos que a instalação vende aos tenants (módulo cobranca, migration 0486). Sem organization_id: é da instalação.';
  comment on table public.billing_subscriptions is
    'Uma assinatura por organização. suspended_by_billing = a suspensão foi por falta de pagamento, e só essa a reativação automática desfaz.';
  comment on table public.billing_invoices is
    'Faturas da assinatura. Fase 1: lançadas e baixadas à mão pelo administrador da plataforma; provider/external_id reservados ao gateway (Fase 2).';

  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE (CLAUDE.md, migrations item 9).
revoke execute on function public.fn_cobranca_provisionar() from public, anon, authenticated;
grant execute on function public.fn_cobranca_provisionar() to service_role;
