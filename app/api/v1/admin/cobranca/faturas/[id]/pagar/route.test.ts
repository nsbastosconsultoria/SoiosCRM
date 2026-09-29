/** Dar baixa: só fatura em aberto ou vencida, uma vez, e a reavaliação reativa na hora. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Banco } from "@/lib/cobranca/banco-falso.test-helper";
import type * as Rota from "@/lib/cobranca/rota";

const estado = vi.hoisted(() => ({ banco: {} as Banco }));
const reavaliar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/cobranca/rota", async (original) => {
  const { bancoFalso } = await import("@/lib/cobranca/banco-falso.test-helper");
  return {
    ...(await original<typeof Rota>()),
    reavaliar: (...a: unknown[]) => reavaliar(...a),
    guardaDaCobranca: async () => ({ ok: true, user: { id: "adm" }, db: bancoFalso(estado.banco) }),
  };
});

import { POST } from "./route";

const FATURA = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: FATURA }) };
const req = (corpo: unknown = {}) => ({ json: async () => corpo }) as never;

beforeEach(() => {
  reavaliar.mockReset().mockResolvedValue({ reativou: true });
  estado.banco = {
    billing_invoices: [
      { id: FATURA, organization_id: "org", status: "overdue", amount_cents: 100, due_date: "2026-01-10" },
    ],
  };
});

describe("POST /api/v1/admin/cobranca/faturas/[id]/pagar", () => {
  it("⭐ dá baixa e reavalia a organização da FATURA (não do corpo)", async () => {
    const r = await POST(req({ payment_note: "Pix em 12/01", organization_id: "outra" }), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ status: "paid", organizacao_reativada: true });
    expect(estado.banco.billing_invoices![0]).toMatchObject({ status: "paid", payment_note: "Pix em 12/01" });
    expect(estado.banco.billing_invoices![0]!.paid_at).toBeTruthy();
    expect(reavaliar).toHaveBeenCalledWith("org", expect.any(String), "adm");
  });

  it("⭐ segundo clique: 409, sem nova baixa", async () => {
    await POST(req(), ctx);
    const r = await POST(req(), ctx);
    expect(r.status).toBe(409);
    expect(reavaliar).toHaveBeenCalledTimes(1);
  });

  it("id que não é UUID: 404", async () => {
    expect((await POST(req(), { params: Promise.resolve({ id: "x" }) })).status).toBe(404);
  });
});
