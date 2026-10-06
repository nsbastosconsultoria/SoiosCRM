/**
 * A equipe fala com o cliente pela ficha: as recusas vêm antes de qualquer efeito, o caso, a
 * resposta, o turno da IA e a ligação ao protocolo saem numa transação só, e o estado do protocolo
 * vem depois — sem mentir quando só ele falha.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openCase = vi.fn();
const markAwaitingLead = vi.fn(async (..._a: unknown[]) => true);
const resolveCaseFromHuman = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/agent-engine/agent/human-cases", () => ({
  openCase: (...a: unknown[]) => openCase(...a),
  markAwaitingLead: (...a: unknown[]) => markAwaitingLead(...a),
  resolveCaseFromHuman: (...a: unknown[]) => resolveCaseFromHuman(...a),
}));
const enqueueJob = vi.fn(async (..._a: unknown[]) => ({ deduped: false }));
vi.mock("@/lib/agent-engine/queue/queue", () => ({ enqueueJob: (...a: unknown[]) => enqueueJob(...a) }));
const mudarEstado = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("./servico", () => ({
  mudarEstado: (...a: unknown[]) => mudarEstado(...a),
  numeroDoProtocolo: (p: { ano: number; numero: number }) => `${p.ano}-${String(p.numero).padStart(6, "0")}`,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { falarComCliente } = await import("./falar-com-cliente");

const ORG = "org-1";
const CTX = { organization_id: ORG, requestId: "r" } as never;
const ATOR = { userId: "u1", role: "agent" as const };

type Resposta = { data: unknown; error: unknown };
function adminDe(respostas: Record<string, Resposta>) {
  return {
    from(tabela: string) {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => respostas[tabela] ?? { data: null, error: null };
      return q;
    },
  } as never;
}

function poolFalso() {
  const sql: string[] = [];
  const client = {
    query: vi.fn(async (texto: string) => {
      sql.push(texto.trim().split(/\s+/).slice(0, 3).join(" "));
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return { sql, client, pool: { connect: async () => client } as never };
}

const PROTOCOLO = {
  id: "p1",
  ano: 2026,
  numero: 7,
  titulo: "Guia do DAS",
  estado: "em_atendimento",
  conversation_id: "conv",
  contact_id: "c1",
};

beforeEach(() => {
  vi.clearAllMocks();
  openCase.mockResolvedValue({ ok: true, caseId: "case-1" });
});

describe("falarComCliente", () => {
  it("pedir informação: caso + resposta + turno + ligação numa transação, depois o estado", async () => {
    const { pool, sql } = poolFalso();
    const r = await falarComCliente(
      pool,
      adminDe({ protocolos: { data: PROTOCOLO, error: null }, contacts: { data: { force_human: false }, error: null } }),
      CTX,
      ATOR,
      "p1",
      { acao: "pedir_informacao", texto: "Precisamos do CNPJ da filial." },
    );
    expect(r).toEqual({ case_id: "case-1", estado: "aguardando_cliente", estado_atualizado: true });
    expect(openCase.mock.calls[0]![2]).toMatchObject({ source: "protocolo", actorUserId: "u1" });
    expect(markAwaitingLead).toHaveBeenCalledWith(expect.anything(), ORG, "case-1", "u1", "Precisamos do CNPJ da filial.");
    expect(enqueueJob.mock.calls[0]![2]).toEqual({
      kind: "case_reply_turn",
      leadId: "c1",
      payload: { case_id: "case-1", action: "need_lead_info", body: "Precisamos do CNPJ da filial." },
    });
    expect(sql[0]).toBe("begin");
    expect(sql.some((s) => s.startsWith("update public.protocolos"))).toBe(true);
    expect(sql[sql.length - 1]).toBe("commit");
    expect(mudarEstado).toHaveBeenCalledWith(expect.anything(), CTX, { userId: "u1", kind: "humano" }, "p1", "aguardando_cliente", null);
  });

  it("avisar que resolveu: o caso já nasce resolvido e a IA é enfileirada com 'resolved'", async () => {
    const { pool } = poolFalso();
    await falarComCliente(
      pool,
      adminDe({ protocolos: { data: PROTOCOLO, error: null }, contacts: { data: { force_human: false }, error: null } }),
      CTX,
      ATOR,
      "p1",
      { acao: "avisar_resolvido", texto: "A guia está no seu e-mail." },
    );
    expect(resolveCaseFromHuman).toHaveBeenCalled();
    expect((enqueueJob.mock.calls[0]![2] as { payload: { action: string } }).payload.action).toBe("resolved");
    expect(mudarEstado.mock.calls[0]![4]).toBe("resolvido");
  });

  it("conversa com uma pessoa (handoff): recusa antes de qualquer efeito", async () => {
    const { pool, client } = poolFalso();
    await expect(
      falarComCliente(
        pool,
        adminDe({ protocolos: { data: PROTOCOLO, error: null }, contacts: { data: { force_human: true }, error: null } }),
        CTX,
        ATOR,
        "p1",
        { acao: "pedir_informacao", texto: "abc" },
      ),
    ).rejects.toMatchObject({ code: "conversa_com_pessoa" });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("protocolo sem conversa: recusa e manda para a inbox", async () => {
    const { pool } = poolFalso();
    await expect(
      falarComCliente(pool, adminDe({ protocolos: { data: { ...PROTOCOLO, conversation_id: null }, error: null } }), CTX, ATOR, "p1", {
        acao: "pedir_informacao",
        texto: "abc",
      }),
    ).rejects.toMatchObject({ code: "protocolo_sem_conversa" });
  });

  it("transição que a tabela não aceita (triagem não resolve): recusa", async () => {
    const { pool } = poolFalso();
    await expect(
      falarComCliente(pool, adminDe({ protocolos: { data: { ...PROTOCOLO, estado: "triagem" }, error: null } }), CTX, ATOR, "p1", {
        acao: "avisar_resolvido",
        texto: "abc",
      }),
    ).rejects.toMatchObject({ code: "protocolo_transicao_invalida" });
  });

  it("conversa que já tem chamado aberto: desfaz a transação e explica", async () => {
    openCase.mockResolvedValue({ ok: false, error: { code: "case_already_open", message: "x" } });
    const { pool, sql } = poolFalso();
    await expect(
      falarComCliente(
        pool,
        adminDe({ protocolos: { data: PROTOCOLO, error: null }, contacts: { data: { force_human: false }, error: null } }),
        CTX,
        ATOR,
        "p1",
        { acao: "pedir_informacao", texto: "abc" },
      ),
    ).rejects.toMatchObject({ code: "conversa_com_chamado_aberto" });
    expect(sql).toContain("rollback");
    expect(sql).not.toContain("commit");
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("mensagem saiu e só o estado falhou: responde isso, sem erro que convide a repetir", async () => {
    mudarEstado.mockRejectedValueOnce(new Error("revision_conflict"));
    const { pool } = poolFalso();
    const r = await falarComCliente(
      pool,
      adminDe({ protocolos: { data: PROTOCOLO, error: null }, contacts: { data: { force_human: false }, error: null } }),
      CTX,
      ATOR,
      "p1",
      { acao: "pedir_informacao", texto: "abc" },
    );
    expect(r).toEqual({ case_id: "case-1", estado: "em_atendimento", estado_atualizado: false });
  });
});
