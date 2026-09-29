import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, GOV_VIEWER, countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * A RLS DO MÓDULO DE COBRANÇA (migration 0486).
 *
 * A regra que o banco precisa garantir, e não só a rota: cobrança é da INSTALAÇÃO. O `admin` de
 * um tenant lê a própria assinatura e as próprias faturas — é o que alimenta a faixa de aviso —,
 * mas não escreve nelas: um admin de tenant que pudesse dar baixa na própria fatura ou mudar o
 * próprio plano pelo PostgREST (o JWT da sessão fala com ele direto) se cobraria sozinho. E
 * nenhum tenant enxerga a assinatura, as faturas ou o plano de outro.
 */
const ORG_B = "cccccccc-9999-4000-8000-00000000f0b0";
const PLATAFORMA = "cccccccc-9999-4000-8000-00000000f0ad";
const PLANO_A = "cccccccc-9999-4000-8000-00000000f001";
const PLANO_B = "cccccccc-9999-4000-8000-00000000f002";
const ASSINATURA_A = "cccccccc-9999-4000-8000-00000000f011";
const ASSINATURA_B = "cccccccc-9999-4000-8000-00000000f012";
const FATURA_A = "cccccccc-9999-4000-8000-00000000f021";
const FATURA_B = "cccccccc-9999-4000-8000-00000000f022";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_cobranca_provisionar();

    insert into auth.users (id, email) values ('${PLATAFORMA}', 'plataforma-cobranca@invariant.test')
      on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${PLATAFORMA}', '${PLATAFORMA}', 'full', false, 'cobranca rls')
      on conflict (user_id) do update set scope = 'full', revoked_at = null, mfa_required = false;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'cobranca-rls-b', 'Cobranca RLS B', 'Cob B') on conflict (id) do nothing;

    insert into public.billing_plans (id, name, price_cents) values
      ('${PLANO_A}', 'Plano A', 19900), ('${PLANO_B}', 'Plano B', 29900)
      on conflict (id) do nothing;
    insert into public.billing_subscriptions (id, organization_id, plan_id, current_period_end) values
      ('${ASSINATURA_A}', '${GOV_ORG}', '${PLANO_A}', '2026-10-10'),
      ('${ASSINATURA_B}', '${ORG_B}', '${PLANO_B}', '2026-10-10')
      on conflict (id) do nothing;
    insert into public.billing_invoices (id, organization_id, subscription_id, amount_cents, due_date) values
      ('${FATURA_A}', '${GOV_ORG}', '${ASSINATURA_A}', 19900, '2026-10-10'),
      ('${FATURA_B}', '${ORG_B}', '${ASSINATURA_B}', 29900, '2026-10-10')
      on conflict (id) do nothing;
  `);
});

describe("leitura: cada tenant vê o que é dele", () => {
  it("o viewer da organização lê a própria assinatura, a própria fatura e o próprio plano", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.billing_subscriptions;`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.billing_invoices;`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.billing_plans where id = '${PLANO_A}';`)).toBe(1);
  });

  it("⭐ nenhum tenant enxerga a assinatura, a fatura ou o plano de outro", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.billing_subscriptions where id = '${ASSINATURA_B}';`)).toBe(0);
    expect(countAs(GOV_ADMIN, `select count(*) from public.billing_invoices where id = '${FATURA_B}';`)).toBe(0);
    expect(countAs(GOV_ADMIN, `select count(*) from public.billing_plans where id = '${PLANO_B}';`)).toBe(0);
  });

  it("o administrador da plataforma lê tudo — controle positivo", () => {
    expect(countAs(PLATAFORMA, `select count(*) from public.billing_invoices where id in ('${FATURA_A}', '${FATURA_B}');`)).toBe(2);
  });
});

describe("escrita: só o administrador da plataforma", () => {
  it("⭐ o admin do tenant não dá baixa na própria fatura", () => {
    expect(
      writeCountAs(GOV_ADMIN, `update public.billing_invoices set status = 'paid', paid_at = now() where id = '${FATURA_A}'`),
    ).toBe(0);
  });

  it("⭐ o admin do tenant não troca o próprio plano nem se tira da suspensão", () => {
    expect(
      writeCountAs(GOV_ADMIN, `update public.billing_subscriptions set plan_id = '${PLANO_B}', status = 'active' where id = '${ASSINATURA_A}'`),
    ).toBe(0);
  });

  it("⭐ o admin do tenant não cria plano nem fatura", () => {
    expect(writeCountAs(GOV_ADMIN, `insert into public.billing_plans (name, price_cents) values ('grátis', 0)`)).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.billing_invoices (organization_id, subscription_id, amount_cents, due_date) values ('${GOV_ORG}', '${ASSINATURA_A}', 1, '2027-01-01')`,
      ),
    ).toBe(0);
  });

  it("o administrador da plataforma escreve — controle positivo", () => {
    expect(
      writeCountAs(PLATAFORMA, `update public.billing_invoices set payment_note = 'conferido' where id = '${FATURA_A}'`),
    ).toBe(1);
  });
});
