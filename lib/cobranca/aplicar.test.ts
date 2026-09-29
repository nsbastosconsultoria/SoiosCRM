/**
 * `aplicarCobranca` contra um banco em memória: o que a regra decide chega às linhas certas, e
 * só elas — sempre filtrado pela organização, e sem passar por cima de quem mexeu à mão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditou = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => auditou(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { aplicarCobranca } from "./aplicar";

type Linha = Record<string, unknown>;
type Banco = Record<string, Linha[]>;

/** Dublê mínimo do PostgREST: `eq`/`neq`/`in` filtram; `update`/`insert` escrevem. */
function adminFalso(banco: Banco) {
  const consultas: Array<{ tabela: string; filtros: string[] }> = [];
  return {
    consultas,
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      const nomes: string[] = [];
      let patch: Linha | null = null;
      const alvo = () => (banco[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (nomes.push(`eq:${c}`), filtros.push((l) => l[c] === v), q),
        neq: (c: string, v: unknown) => (nomes.push(`neq:${c}`), filtros.push((l) => l[c] !== v), q),
        in: (c: string, vs: unknown[]) => (
          nomes.push(`in:${c}`), filtros.push((l) => vs.includes(l[c])), q
        ),
        update: (p: Linha) => ((patch = p), q),
        insert: async (l: Linha) => {
          (banco[tabela] ??= []).push(l);
          return { error: null };
        },
        maybeSingle: async () => {
          consultas.push({ tabela, filtros: nomes });
          const l = alvo()[0];
          return { data: l ? { ...l } : null, error: null };
        },
        then: (res: (v: unknown) => unknown) => {
          consultas.push({ tabela, filtros: nomes });
          const linhas = alvo();
          if (patch) for (const l of linhas) Object.assign(l, patch);
          return Promise.resolve({ data: linhas.map((l) => ({ ...l })), error: null }).then(res);
        },
      };
      return q;
    },
  };
}

const ORG = "org-a";
const OUTRA = "org-b";
const DIA = (d: string) => new Date(`${d}T15:00:00Z`);

function banco(opcoes: {
  orgStatus?: string;
  assinatura?: Partial<Linha>;
  faturas?: Array<Partial<Linha>>;
} = {}): Banco {
  return {
    organizations: [
      { id: ORG, status: opcoes.orgStatus ?? "active", suspended_reason: null },
      { id: OUTRA, status: "active", suspended_reason: null },
    ],
    billing_subscriptions: [
      {
        id: "sub-a",
        organization_id: ORG,
        status: "active",
        trial_ends_at: null,
        grace_days: 7,
        suspended_by_billing: false,
        ...opcoes.assinatura,
      },
      {
        id: "sub-b",
        organization_id: OUTRA,
        status: "active",
        trial_ends_at: null,
        grace_days: 7,
        suspended_by_billing: false,
      },
    ],
    billing_invoices: [
      ...(opcoes.faturas ?? []).map((f, i) => ({
        id: `f${i + 1}`,
        organization_id: ORG,
        subscription_id: "sub-a",
        status: "open",
        ...f,
      })),
      // A fatura atrasadíssima de OUTRA organização nunca pode ser tocada.
      { id: "fb", organization_id: OUTRA, subscription_id: "sub-b", status: "open", due_date: "2026-01-01" },
    ],
    event_log: [],
  };
}

beforeEach(() => auditou.mockReset());

describe("aplicarCobranca", () => {
  it("sem assinatura: não avalia e não escreve", async () => {
    const b = banco();
    b.billing_subscriptions = b.billing_subscriptions!.filter((s) => s.organization_id !== ORG);
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-20") });
    expect(r).toMatchObject({ avaliada: false, efeito: false });
    expect(auditou).not.toHaveBeenCalled();
  });

  it("em dia e sem nada vencido: rodada sem efeito não audita", async () => {
    const b = banco({ faturas: [{ due_date: "2026-11-10" }] });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-20") });
    expect(r.efeito).toBe(false);
    expect(auditou).not.toHaveBeenCalled();
  });

  it("fatura venceu: vira overdue, assinatura past_due, organização segue ativa", async () => {
    const b = banco({ faturas: [{ due_date: "2026-10-10" }] });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-12") });
    expect(r.efeito).toBe(true);
    expect(b.billing_invoices!.find((f) => f.id === "f1")!.status).toBe("overdue");
    expect(b.billing_subscriptions![0]!.status).toBe("past_due");
    expect(b.organizations![0]!.status).toBe("active");
    expect(auditou.mock.calls.map((c) => (c[0] as { action: string }).action)).toEqual([
      "cobranca.fatura_vencida",
      "cobranca.assinatura_status_alterado",
    ]);
  });

  it("⭐ passou da carência: suspende, marca suspended_by_billing, emite tenant.suspended", async () => {
    const b = banco({ faturas: [{ due_date: "2026-10-10", status: "overdue" }] });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-18") });
    expect(r.suspendeu).toBe(true);
    const org = b.organizations![0]!;
    expect(org.status).toBe("suspended");
    expect(org.suspended_by).toBeNull();
    expect(String(org.suspended_reason)).toContain("2026-10-10");
    expect(b.billing_subscriptions![0]).toMatchObject({ status: "suspended", suspended_by_billing: true });
    expect(b.event_log).toEqual([
      expect.objectContaining({ organization_id: ORG, event_type: "tenant.suspended" }),
    ]);
    expect(auditou).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tenant.suspended", organizationId: ORG }),
    );
  });

  it("⭐ a outra organização nunca é tocada", async () => {
    const b = banco({ faturas: [{ due_date: "2026-10-10", status: "overdue" }] });
    const admin = adminFalso(b);
    await aplicarCobranca(admin as never, ORG, { agora: DIA("2026-10-30") });
    expect(b.organizations![1]!.status).toBe("active");
    expect(b.billing_invoices!.find((f) => f.id === "fb")!.status).toBe("open");
    expect(b.billing_subscriptions![1]!.status).toBe("active");
    // Toda consulta às tabelas da cobrança filtrou a organização (service role, anti-pattern 10).
    for (const c of admin.consultas.filter((c) => c.tabela.startsWith("billing_"))) {
      expect(c.filtros).toContain("eq:organization_id");
    }
  });

  it("⭐ organização suspensa à mão: não vira 'suspensa pela cobrança'", async () => {
    const b = banco({ orgStatus: "suspended", faturas: [{ due_date: "2026-10-10", status: "overdue" }] });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-30") });
    expect(r.suspendeu).toBe(false);
    expect(b.billing_subscriptions![0]).toMatchObject({ status: "suspended", suspended_by_billing: false });
    expect(b.event_log).toEqual([]);
  });

  it("pagou: reativa o que a cobrança suspendeu e limpa a marca", async () => {
    const b = banco({
      orgStatus: "suspended",
      assinatura: { status: "suspended", suspended_by_billing: true },
      faturas: [{ due_date: "2026-10-10", status: "paid" }],
    });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-30") });
    expect(r.reativou).toBe(true);
    expect(b.organizations![0]).toMatchObject({ status: "active", suspended_reason: null });
    expect(b.billing_subscriptions![0]).toMatchObject({ status: "active", suspended_by_billing: false });
    expect(b.event_log).toEqual([expect.objectContaining({ event_type: "tenant.reactivated" })]);
  });

  it("⭐ pagou, mas quem suspendeu foi uma pessoa: continua suspensa", async () => {
    const b = banco({
      orgStatus: "suspended",
      assinatura: { status: "suspended", suspended_by_billing: false },
      faturas: [{ due_date: "2026-10-10", status: "paid" }],
    });
    const r = await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-30") });
    expect(r.reativou).toBe(false);
    expect(b.organizations![0]!.status).toBe("suspended");
    expect(b.billing_subscriptions![0]!.status).toBe("active");
  });

  it("alguém reativou à mão: a marca velha some, e não religa suspensão futura", async () => {
    const b = banco({
      assinatura: { status: "suspended", suspended_by_billing: true },
      faturas: [{ due_date: "2026-10-10", status: "paid" }],
    });
    await aplicarCobranca(adminFalso(b) as never, ORG, { agora: DIA("2026-10-30") });
    expect(b.billing_subscriptions![0]).toMatchObject({ status: "active", suspended_by_billing: false });
  });
});
