/**
 * Ferramentas de protocolo — o que o assistente vê e o que acontece sozinho.
 *
 *   - abrir devolve número e situação, NUNCA prazo nem responsável;
 *   - categoria que exige pessoa dispara o handoff DENTRO da abertura (não depende do modelo);
 *   - consultar e complementar só enxergam protocolos do contato da conversa;
 *   - complementar reabre o resolvido recente e recusa o antigo com instrução.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpContext } from "../types";

const abrirProtocolo = vi.fn();
const mudarEstado = vi.fn();
vi.mock("@/lib/protocolos/servico", () => ({
  abrirProtocolo: (...a: unknown[]) => abrirProtocolo(...a),
  mudarEstado: (...a: unknown[]) => mudarEstado(...a),
  numeroDoProtocolo: (p: { ano: number; numero: number }) => `${p.ano}-${String(p.numero).padStart(6, "0")}`,
}));
const handoff = vi.fn(async (..._a: unknown[]) => ({ queued: true }));
vi.mock("./handoff", () => ({ crmRequestHumanHandoff: { handler: (...a: unknown[]) => handoff(...a) } }));

const { crmProtocoloAbrir, crmProtocoloComplementar, crmProtocoloConsultar, estadoEmPalavras } = await import("./protocolos");

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "55555555-5555-4555-8555-555555555555";

type Resposta = { data: unknown; error: unknown };
function ctxDe(respostas: Record<string, Resposta[]> = {}) {
  const filtros: Array<[string, string, unknown]> = [];
  const rpc = vi.fn(async () => ({ data: "ev", error: null }));
  const from = (tabela: string) => {
    const resolver = () => Promise.resolve((respostas[tabela] ?? []).shift() ?? { data: null, error: null });
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "or"]) q[m] = () => q;
    q.eq = (c: string, v: unknown) => (filtros.push([tabela, c, v]), q);
    q.limit = () => resolver();
    q.maybeSingle = () => resolver();
    return q;
  };
  return {
    filtros,
    rpc,
    ctx: {
      organizationId: ORG,
      role: "agent",
      actor: { type: "ai_agent", id: "run", agent_id: "a" },
      apiTokenId: "t",
      requestId: "r",
      supabase: { from, rpc },
    } as unknown as McpContext,
  };
}

const ENTRADA = {
  conversation_id: CONVERSA,
  categoria_id: "33333333-3333-4333-8333-333333333333",
  titulo: "Guia do DAS de setembro",
  descricao: "O cliente pediu a guia do DAS de setembro.",
  resumo: { solicitacao: "Guia do DAS de setembro" },
};

beforeEach(() => vi.clearAllMocks());

describe("crm_protocolo_abrir", () => {
  it("devolve número e situação — e nada de prazo, responsável ou id interno", async () => {
    abrirProtocolo.mockResolvedValue({
      protocolo: { id: "p", estado: "triagem", resolucao_vence_em: "2026-10-06T10:00:00Z", responsavel_user_id: "u" },
      numero: "2026-000042",
      deduplicado: false,
      exige_handoff: false,
    });
    const { ctx } = ctxDe();
    const r = await crmProtocoloAbrir.handler(ENTRADA as never, ctx);
    expect(r).toEqual({
      numero: "2026-000042",
      ja_existia: false,
      situacao: "recebido, aguardando alguém da equipe pegar",
      passou_para_pessoa: false,
    });
    expect(JSON.stringify(r)).not.toMatch(/vence|responsavel|2026-10-06/);
    expect(abrirProtocolo.mock.calls[0]![3]).toEqual({ userId: null, kind: "ia" });
    expect(abrirProtocolo.mock.calls[0]![4]).toBe("agente");
    expect(handoff).not.toHaveBeenCalled();
  });

  it("categoria que exige pessoa: a passagem acontece DENTRO da abertura", async () => {
    abrirProtocolo.mockResolvedValue({ protocolo: { estado: "atribuido" }, numero: "2026-000043", deduplicado: false, exige_handoff: true });
    const { ctx } = ctxDe();
    const r = await crmProtocoloAbrir.handler(ENTRADA as never, ctx);
    expect(r).toMatchObject({ passou_para_pessoa: true });
    expect(handoff).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: CONVERSA, urgency: "high", reason: expect.stringContaining("2026-000043") }),
      ctx,
    );
  });

  it("pedido que já tinha protocolo: não abre outro nem passa de novo para pessoa", async () => {
    abrirProtocolo.mockResolvedValue({ protocolo: { estado: "em_atendimento" }, numero: "2026-000001", deduplicado: true, exige_handoff: true });
    const { ctx } = ctxDe();
    expect(await crmProtocoloAbrir.handler(ENTRADA as never, ctx)).toMatchObject({ ja_existia: true, passou_para_pessoa: false });
    expect(handoff).not.toHaveBeenCalled();
  });
});

describe("crm_protocolo_consultar", () => {
  it("só os protocolos do contato da conversa, filtrando a organização", async () => {
    const { ctx, filtros } = ctxDe({
      conversations: [{ data: { contact_id: "c1" }, error: null }],
      protocolos: [{ data: [{ ano: 2026, numero: 5, titulo: "DAS", estado: "aguardando_cliente", aberto_em: "2026-10-02T10:00:00Z" }], error: null }],
    });
    const r = await crmProtocoloConsultar.handler({ conversation_id: CONVERSA }, ctx);
    expect(r).toEqual({ protocolos: [{ numero: "2026-000005", titulo: "DAS", situacao: "aguardando uma informação do cliente", aberto_em: "2026-10-02" }] });
    expect(filtros).toContainEqual(["protocolos", "organization_id", ORG]);
    expect(filtros).toContainEqual(["protocolos", "contact_id", "c1"]);
  });
});

describe("crm_protocolo_complementar", () => {
  it("protocolo aberto: registra o complemento", async () => {
    const { ctx, rpc } = ctxDe({
      conversations: [{ data: { contact_id: "c1" }, error: null }],
      protocolos: [{ data: { id: "p", ano: 2026, numero: 5, estado: "em_atendimento", resolvido_em: null }, error: null }],
    });
    expect(await crmProtocoloComplementar.handler({ conversation_id: CONVERSA, numero: "2026-000005", texto: "segue o CNPJ" }, ctx)).toEqual({
      numero: "2026-000005",
      reaberto: false,
    });
    expect(rpc).toHaveBeenCalledWith("fn_protocolo_registrar_evento", expect.objectContaining({ p_tipo: "complemento_do_cliente", p_ator_kind: "ia" }));
  });

  it("resolvido há 2 dias reabre; há 30 dias recusa com instrução de abrir novo", async () => {
    const recente = ctxDe({
      conversations: [{ data: { contact_id: "c1" }, error: null }],
      protocolos: [{ data: { id: "p", ano: 2026, numero: 5, estado: "resolvido", resolvido_em: new Date(Date.now() - 2 * 86400_000).toISOString() }, error: null }],
    });
    expect(await crmProtocoloComplementar.handler({ conversation_id: CONVERSA, numero: "2026-000005", texto: "ainda falta" }, recente.ctx)).toMatchObject({ reaberto: true });
    expect(mudarEstado).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userId: null, kind: "ia" }, "p", "reaberto");

    const antigo = ctxDe({
      conversations: [{ data: { contact_id: "c1" }, error: null }],
      protocolos: [{ data: { id: "p", ano: 2026, numero: 5, estado: "resolvido", resolvido_em: new Date(Date.now() - 30 * 86400_000).toISOString() }, error: null }],
    });
    await expect(
      crmProtocoloComplementar.handler({ conversation_id: CONVERSA, numero: "2026-000005", texto: "x".repeat(5) }, antigo.ctx),
    ).rejects.toThrow(/Abra um protocolo novo/);
  });

  it("número de outro cliente: não acha, e ensina a consultar", async () => {
    const { ctx } = ctxDe({ conversations: [{ data: { contact_id: "c1" }, error: null }], protocolos: [{ data: null, error: null }] });
    await expect(
      crmProtocoloComplementar.handler({ conversation_id: CONVERSA, numero: "2026-000099", texto: "abc" }, ctx),
    ).rejects.toThrow(/crm_protocolo_consultar/);
  });
});

describe("estadoEmPalavras", () => {
  it("cobre os 11 estados sem jargão", () => {
    for (const e of ["novo", "triagem", "atribuido", "em_atendimento", "aguardando_cliente", "aguardando_terceiro", "aguardando_interno", "resolvido", "fechado", "cancelado", "reaberto"] as const) {
      expect(estadoEmPalavras(e)).not.toMatch(/triagem|atribuido|_/);
    }
  });
});
