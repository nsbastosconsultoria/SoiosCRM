import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { avisoDeCobranca, esquecerMemoDoAviso } from "./aviso";
import { bancoFalso, type Banco } from "./banco-falso.test-helper";

const ORG = "org-a";
const AGORA = new Date("2026-10-12T15:00:00Z");

function banco(assinatura: Record<string, unknown> | null): Banco {
  return {
    billing_subscriptions: assinatura
      ? [{ organization_id: ORG, grace_days: 7, suspended_by_billing: false, ...assinatura }]
      : [],
    billing_invoices: [
      { organization_id: ORG, status: "overdue", due_date: "2026-10-10", amount_cents: 19990, currency: "BRL", instrucao_pagamento: "Pix: x" },
      { organization_id: ORG, status: "paid", due_date: "2026-09-10", amount_cents: 19990, currency: "BRL" },
      { organization_id: "outra", status: "overdue", due_date: "2026-01-01", amount_cents: 1, currency: "BRL" },
    ],
  };
}

beforeEach(() => esquecerMemoDoAviso());

describe("avisoDeCobranca", () => {
  it("⭐ em atraso: vencimento, dias, a data da suspensão e como pagar", async () => {
    const a = await avisoDeCobranca(bancoFalso(banco({ status: "past_due" })) as never, ORG, AGORA);
    expect(a).toEqual({
      situacao: "past_due",
      vencimento: "2026-10-10",
      diasDeAtraso: 2,
      suspendeEm: "2026-10-18",
      valorCents: 19990,
      moeda: "BRL",
      instrucao: "Pix: x",
    });
  });

  it("em dia, sem assinatura ou suspensa À MÃO: nenhum aviso", async () => {
    for (const assinatura of [{ status: "active" }, null, { status: "suspended", suspended_by_billing: false }]) {
      expect(await avisoDeCobranca(bancoFalso(banco(assinatura)) as never, ORG, AGORA)).toBeNull();
    }
  });

  it("suspensa pela cobrança: mostra a fatura, sem data de suspensão", async () => {
    const a = await avisoDeCobranca(
      bancoFalso(banco({ status: "suspended", suspended_by_billing: true })) as never,
      ORG,
      AGORA,
    );
    expect(a).toMatchObject({ situacao: "suspended", suspendeEm: null, vencimento: "2026-10-10" });
  });

  it("⭐ módulo não instalado: null, e o processo para de perguntar por um tempo", async () => {
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "PGRST205" } }) }) }),
    }));
    expect(await avisoDeCobranca({ from } as never, ORG, AGORA)).toBeNull();
    expect(await avisoDeCobranca({ from } as never, ORG, AGORA)).toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("nunca lança", async () => {
    const from = () => {
      throw new Error("rede caiu");
    };
    expect(await avisoDeCobranca({ from } as never, ORG, AGORA)).toBeNull();
  });
});
