/**
 * Lançar fatura: o valor e o vencimento vêm da assinatura, o período avança um intervalo, e dois
 * cliques no mesmo vencimento não cobram em dobro.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Banco } from "@/lib/cobranca/banco-falso.test-helper";
import type * as Rota from "@/lib/cobranca/rota";

const estado = vi.hoisted(() => ({ banco: {} as Banco, admin: true }));
const reavaliar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/cobranca/rota", async (original) => {
  const { fail } = await import("@/lib/api/wrappers");
  const { bancoFalso: falso } = await import("@/lib/cobranca/banco-falso.test-helper");
  return {
    ...(await original<typeof Rota>()),
    reavaliar: (...a: unknown[]) => reavaliar(...a),
    guardaDaCobranca: async (requestId: string) =>
      estado.admin
        ? {
            ok: true,
            user: { id: "admin-plataforma" },
            db: falso(estado.banco, { billing_invoices: [["subscription_id", "due_date"]] }),
          }
        : { ok: false, response: fail("forbidden", "Platform admin required", 403, { requestId }) },
  };
});

import { POST } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: ORG }) };
const req = (corpo: unknown = {}) => ({ json: async () => corpo }) as never;

function montar(preco = 19990) {
  estado.banco = {
    billing_plans: [{ id: "plano", price_cents: preco, currency: "BRL", interval_months: 1 }],
    billing_subscriptions: [
      { id: "sub", organization_id: ORG, status: "active", plan_id: "plano", current_period_end: "2026-01-31" },
    ],
    billing_invoices: [],
  };
}

beforeEach(() => {
  estado.admin = true;
  reavaliar.mockReset();
  montar();
});

describe("POST /api/v1/admin/cobranca/tenants/[id]/faturas", () => {
  it("quem não é administrador da plataforma: 403", async () => {
    estado.admin = false;
    expect((await POST(req(), ctx)).status).toBe(403);
  });

  it("⭐ lança com valor do plano e vencimento do período, e avança um mês (31/01 → 28/02)", async () => {
    const r = await POST(req({ instrucao_pagamento: "Pix: chave@exemplo.com" }), ctx);
    expect(r.status).toBe(201);
    expect(estado.banco.billing_invoices).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        subscription_id: "sub",
        amount_cents: 19990,
        due_date: "2026-01-31",
        status: "open",
        instrucao_pagamento: "Pix: chave@exemplo.com",
      }),
    ]);
    expect(estado.banco.billing_subscriptions![0]!.current_period_end).toBe("2026-02-28");
    expect(reavaliar).toHaveBeenCalledWith(ORG, expect.any(String), "admin-plataforma");
  });

  it("⭐ o segundo lançamento cai no período seguinte, não duplica", async () => {
    await POST(req(), ctx);
    await POST(req(), ctx);
    expect(estado.banco.billing_invoices!.map((f) => f.due_date)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("⭐ vencimento já faturado: 409, e o período destrava", async () => {
    estado.banco.billing_invoices!.push({
      id: "velha",
      organization_id: ORG,
      subscription_id: "sub",
      due_date: "2026-01-31",
      status: "open",
    });
    const r = await POST(req(), ctx);
    expect(r.status).toBe(409);
    expect(estado.banco.billing_invoices).toHaveLength(1);
    expect(estado.banco.billing_subscriptions![0]!.current_period_end).toBe("2026-02-28");
  });

  it("data avulsa não mexe no período", async () => {
    const r = await POST(req({ due_date: "2026-01-15", amount_cents: 5000 }), ctx);
    expect(r.status).toBe(201);
    expect(estado.banco.billing_subscriptions![0]!.current_period_end).toBe("2026-01-31");
  });

  it("plano gratuito sem valor informado: 422", async () => {
    montar(0);
    expect((await POST(req(), ctx)).status).toBe(422);
    expect(estado.banco.billing_invoices).toHaveLength(0);
  });

  it("assinatura cancelada não recebe fatura: 409", async () => {
    estado.banco.billing_subscriptions![0]!.status = "canceled";
    expect((await POST(req(), ctx)).status).toBe(409);
  });
});
