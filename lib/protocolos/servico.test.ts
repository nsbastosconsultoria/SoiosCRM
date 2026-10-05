/**
 * O serviço de protocolos — o que é NEGÓCIO e não está no banco: abrir (deduplicar, priorizar,
 * distribuir, calcular prazo), pausar e retomar o relógio, quem pode baixar prioridade, quem pode
 * assumir, e o modelo de nicho que não duplica nada.
 *
 * O banco falso responde por `<tabela>:<operação>` numa fila e registra cada escrita. O que o
 * schema garante (número, máquina de estados, imutáveis) é provado nos invariantes, não aqui.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";

import {
  abrirProtocolo,
  alterarProtocolo,
  aplicarModelo,
  atribuir,
  distribuir,
  minutosDoIntervalo,
  mudarEstado,
  numeroDoProtocolo,
} from "./servico";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const CAT = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const EMPRESA = "55555555-5555-4555-8555-555555555555";
const CONVERSA = "66666666-6666-4666-8666-666666666666";
const PROT = "77777777-7777-4777-8777-777777777777";

const ctx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "r" } as HandlerCtx;

type Resposta = { data: unknown; error: unknown };
type Escrita = { tabela: string; op: string; carga: unknown };

function bancoFalso(respostas: Record<string, Resposta[]>) {
  const escritas: Escrita[] = [];
  const rpcs: Array<{ nome: string; args: unknown }> = [];
  const cliente = {
    from(tabela: string) {
      let op = "select";
      let carga: unknown;
      const resolver = (): Promise<Resposta> => {
        if (op !== "select") escritas.push({ tabela, op, carga });
        return Promise.resolve((respostas[`${tabela}:${op}`] ?? []).shift() ?? { data: null, error: null });
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "not", "lte", "order", "limit"]) b[m] = () => b;
      b.insert = (x: unknown) => ((op = "insert"), (carga = x), b);
      b.update = (x: unknown) => ((op = "update"), (carga = x), b);
      b.delete = () => ((op = "delete"), b);
      b.single = resolver;
      b.maybeSingle = resolver;
      b.then = (ok: (r: Resposta) => unknown, ko: (e: unknown) => unknown) => resolver().then(ok, ko);
      return b;
    },
    rpc(nome: string, args: unknown) {
      rpcs.push({ nome, args });
      return Promise.resolve((respostas[`rpc:${nome}`] ?? []).shift() ?? { data: null, error: null });
    },
  };
  return { cliente: cliente as never, escritas, rpcs };
}

const categoria = (extra: Record<string, unknown> = {}) => ({
  id: CAT,
  parent_id: null,
  area: "fiscal",
  prioridade_padrao: "P3",
  exige_competencia: true,
  exige_handoff: false,
  ...extra,
});

const ENTRADA = {
  categoria_id: CAT,
  competencia: "2026-09",
  titulo: "Guia do DAS",
  descricao: "Cliente pediu a guia do DAS de setembro",
  company_id: EMPRESA,
};

beforeEach(() => vi.clearAllMocks());

describe("apoio", () => {
  it("número de exibição e intervalo do Postgres", () => {
    expect(numeroDoProtocolo({ ano: 2026, numero: 123 })).toBe("2026-000123");
    expect(minutosDoIntervalo("00:30:00")).toBe(30);
    expect(minutosDoIntervalo("2 days 01:15:00")).toBe(2 * 24 * 60 + 75);
    expect(minutosDoIntervalo(null)).toBe(0);
  });
});

describe("distribuir", () => {
  it("1º: o responsável da empresa na área, pela carteira, se ainda é membro ativo", async () => {
    const { cliente } = bancoFalso({
      "carteira_responsaveis:select": [{ data: { user_id: USER }, error: null }],
      "user_organizations:select": [{ data: { user_id: USER }, error: null }],
    });
    expect(await distribuir(cliente, ctx, "fiscal", EMPRESA)).toEqual({ responsavel_user_id: USER, distribuido_por: "carteira" });
  });

  it("sem carteira instalada (tabela ausente) segue para a fila, sem erro", async () => {
    const { cliente } = bancoFalso({
      "carteira_responsaveis:select": [{ data: null, error: { code: "PGRST205" } }],
      "protocolo_area_membros:select": [{ data: [{ user_id: "x", papel: "membro" }], error: null }],
    });
    expect(await distribuir(cliente, ctx, "fiscal", EMPRESA)).toEqual({ responsavel_user_id: null, distribuido_por: "fila" });
  });

  it("fila sem membro: vai para o líder; sem líder: fila sem dono", async () => {
    const comLider = bancoFalso({
      "protocolo_area_membros:select": [{ data: [{ user_id: USER, papel: "lider" }], error: null }],
      "user_organizations:select": [{ data: { user_id: USER }, error: null }],
    });
    expect(await distribuir(comLider.cliente, ctx, "dp", null)).toEqual({ responsavel_user_id: USER, distribuido_por: "fallback" });
    const vazia = bancoFalso({ "protocolo_area_membros:select": [{ data: [], error: null }] });
    expect(await distribuir(vazia.cliente, ctx, "dp", null)).toEqual({ responsavel_user_id: null, distribuido_por: "fila" });
  });
});

describe("abrirProtocolo", () => {
  function semDuplicata(extra: Record<string, Resposta[]> = {}) {
    return bancoFalso({
      "protocolo_categorias:select": [{ data: categoria(), error: null }],
      "protocolos:select": [{ data: null, error: null }],
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "protocolo_feriados:select": [{ data: [], error: null }],
      "carteira_responsaveis:select": [{ data: null, error: null }],
      "protocolo_area_membros:select": [{ data: [{ user_id: "m", papel: "membro" }], error: null }],
      "protocolo_politicas_sla:select": [
        {
          data: [
            {
              id: "pol-geral",
              categoria_id: null,
              primeira_resposta_min: 60,
              resolucao_min: 480,
              em_horario_util: false,
              pausa_aguardando_cliente: true,
              pausa_aguardando_terceiro: true,
            },
          ],
          error: null,
        },
      ],
      "protocolos:insert": [{ data: { id: PROT, ano: 2026, numero: 7 }, error: null }],
      ...extra,
    });
  }

  it("abre na fila da área, com a prioridade da categoria e os dois prazos da política", async () => {
    const { cliente, escritas } = semDuplicata();
    const r = await abrirProtocolo(null, cliente, ctx, { userId: USER, kind: "humano" }, "humano", ENTRADA);
    expect(r.numero).toBe("2026-000007");
    expect(r.deduplicado).toBe(false);
    const insert = escritas.find((e) => e.tabela === "protocolos" && e.op === "insert")!.carga as Record<string, unknown>;
    expect(insert).toMatchObject({
      organization_id: ORG,
      prioridade: "P3",
      prioridade_origem: "regra",
      area: "fiscal",
      estado: "triagem",
      distribuido_por: "fila",
      responsavel_user_id: null,
      politica_sla_id: "pol-geral",
      alterado_por: USER,
    });
    const abertura = new Date(insert.aberto_em as string).getTime();
    expect(new Date(insert.primeira_resposta_vence_em as string).getTime() - abertura).toBe(60 * 60_000);
    expect(new Date(insert.resolucao_vence_em as string).getTime() - abertura).toBe(480 * 60_000);
  });

  it("prazo do cliente HOJE vira P1 (a guia vence hoje)", async () => {
    const { cliente, escritas } = semDuplicata({
      "protocolo_politicas_sla:select": [{ data: [], error: null }],
    });
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    await abrirProtocolo(null, cliente, ctx, { userId: USER, kind: "humano" }, "humano", { ...ENTRADA, prazo_cliente: hoje });
    const insert = escritas.find((e) => e.op === "insert")!.carga as Record<string, unknown>;
    expect(insert.prioridade).toBe("P1");
    expect(insert.politica_sla_id).toBeNull();
    expect(insert.resolucao_vence_em).toBeNull();
  });

  it("categoria que pede competência recusa sem ela, antes de qualquer escrita", async () => {
    const { cliente, escritas } = bancoFalso({ "protocolo_categorias:select": [{ data: categoria(), error: null }] });
    await expect(
      abrirProtocolo(null, cliente, ctx, { userId: USER, kind: "humano" }, "humano", { ...ENTRADA, competencia: null }),
    ).rejects.toMatchObject({ status: 422, code: "competencia_obrigatoria" });
    expect(escritas).toEqual([]);
  });

  it("subcategoria de outra categoria é recusada", async () => {
    const { cliente } = bancoFalso({
      "protocolo_categorias:select": [
        { data: categoria(), error: null },
        { data: { ...categoria(), id: SUB, parent_id: "outra" }, error: null },
      ],
    });
    await expect(
      abrirProtocolo(null, cliente, ctx, { userId: USER, kind: "humano" }, "humano", { ...ENTRADA, subcategoria_id: SUB }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("mesmo pedido aberto para a mesma empresa: não abre outro, acrescenta complemento", async () => {
    const { cliente, escritas, rpcs } = bancoFalso({
      "protocolo_categorias:select": [{ data: categoria(), error: null }],
      "protocolos:select": [{ data: { id: PROT, ano: 2026, numero: 3 }, error: null }],
    });
    const r = await abrirProtocolo(null, cliente, ctx, { userId: null, kind: "ia" }, "agente", ENTRADA);
    expect(r).toMatchObject({ deduplicado: true, numero: "2026-000003" });
    expect(escritas).toEqual([]);
    expect(rpcs[0]).toMatchObject({
      nome: "fn_protocolo_registrar_evento",
      args: { p_tipo: "complemento_do_cliente", p_ator_kind: "ia", p_protocolo: PROT },
    });
  });

  it("pela conversa: a sessão precisa enxergá-la, e a empresa vem do contexto da carteira", async () => {
    const sessaoCega = bancoFalso({ "conversations:select": [{ data: null, error: null }] });
    const { cliente } = semDuplicata();
    await expect(
      abrirProtocolo(sessaoCega.cliente, cliente, ctx, { userId: USER, kind: "humano" }, "humano", {
        ...ENTRADA,
        company_id: null,
        conversation_id: CONVERSA,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const sessao = bancoFalso({ "conversations:select": [{ data: { id: CONVERSA }, error: null }] });
    const admin = semDuplicata({
      "conversations:select": [{ data: { contact_id: "contato-1" }, error: null }],
      "carteira_contexto_conversa:select": [{ data: { company_id: EMPRESA }, error: null }],
    });
    await abrirProtocolo(sessao.cliente, admin.cliente, ctx, { userId: USER, kind: "humano" }, "humano", {
      ...ENTRADA,
      company_id: null,
      conversation_id: CONVERSA,
    });
    const insert = admin.escritas.find((e) => e.op === "insert")!.carga as Record<string, unknown>;
    expect(insert).toMatchObject({ company_id: EMPRESA, contact_id: "contato-1", conversation_id: CONVERSA });
  });

  it("categoria que exige passagem para humano avisa quem chamou", async () => {
    const { cliente } = semDuplicata({
      "protocolo_categorias:select": [{ data: categoria({ exige_handoff: true, exige_competencia: false, prioridade_padrao: "P1" }), error: null }],
    });
    const r = await abrirProtocolo(null, cliente, ctx, { userId: null, kind: "ia" }, "agente", { ...ENTRADA, competencia: null });
    expect(r.exige_handoff).toBe(true);
  });
});

const ATUAL = {
  id: PROT,
  ano: 2026,
  numero: 1,
  company_id: null,
  contact_id: null,
  conversation_id: null,
  categoria_id: CAT,
  subcategoria_id: null,
  competencia: null,
  prioridade: "P2",
  area: "fiscal",
  responsavel_user_id: null,
  estado: "em_atendimento",
  politica_sla_id: "pol",
  aberto_em: "2026-10-05T12:00:00.000Z",
  resolucao_vence_em: "2026-10-05T20:00:00.000Z",
  pausado_desde: null,
  pausa_acumulada: "00:00:00",
  revision: 4,
};
const POLITICA = {
  id: "pol",
  primeira_resposta_min: 60,
  resolucao_min: 480,
  em_horario_util: false,
  pausa_aguardando_cliente: true,
  pausa_aguardando_terceiro: false,
};

describe("mudarEstado — o relógio", () => {
  it("aguardando cliente pausa (a política manda); a gravação exige a mesma revisão", async () => {
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [{ data: ATUAL, error: null }],
      "protocolo_politicas_sla:select": [{ data: POLITICA, error: null }],
      "protocolos:update": [{ data: { ...ATUAL, estado: "aguardando_cliente" }, error: null }],
    });
    await mudarEstado(cliente, ctx, { userId: USER, kind: "humano" }, PROT, "aguardando_cliente");
    const carga = escritas[0]!.carga as Record<string, unknown>;
    expect(carga.estado).toBe("aguardando_cliente");
    expect(typeof carga.pausado_desde).toBe("string");
  });

  it("aguardando terceiro NÃO pausa quando a política diz que não", async () => {
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [{ data: ATUAL, error: null }],
      "protocolo_politicas_sla:select": [{ data: POLITICA, error: null }],
      "protocolos:update": [{ data: ATUAL, error: null }],
    });
    await mudarEstado(cliente, ctx, { userId: USER, kind: "humano" }, PROT, "aguardando_terceiro");
    expect((escritas[0]!.carga as Record<string, unknown>).pausado_desde).toBeUndefined();
  });

  it("sair da pausa soma o tempo pausado à pausa acumulada e empurra o prazo de resolução", async () => {
    const pausadoHa30 = new Date(Date.now() - 30 * 60_000).toISOString();
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [{ data: { ...ATUAL, estado: "aguardando_cliente", pausado_desde: pausadoHa30, pausa_acumulada: "00:10:00" }, error: null }],
      "protocolo_politicas_sla:select": [{ data: POLITICA, error: null }],
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "protocolo_feriados:select": [{ data: [], error: null }],
      "protocolos:update": [{ data: ATUAL, error: null }],
    });
    await mudarEstado(cliente, ctx, { userId: USER, kind: "humano" }, PROT, "em_atendimento");
    const carga = escritas[0]!.carga as Record<string, unknown>;
    expect(carga.pausado_desde).toBeNull();
    expect(carga.pausa_acumulada).toBe("40 minutes");
    expect(new Date(carga.resolucao_vence_em as string).getTime()).toBe(new Date(ATUAL.resolucao_vence_em).getTime() + 30 * 60_000);
  });

  it("revisão mudou no meio → 409 revision_conflict", async () => {
    const { cliente } = bancoFalso({
      "protocolos:select": [{ data: ATUAL, error: null }],
      "protocolo_politicas_sla:select": [{ data: POLITICA, error: null }],
      "protocolos:update": [{ data: null, error: null }],
    });
    await expect(mudarEstado(cliente, ctx, { userId: USER, kind: "humano" }, PROT, "resolvido")).rejects.toMatchObject({
      status: 409,
      code: "revision_conflict",
    });
  });
});

describe("alterarProtocolo e atribuir — quem pode", () => {
  it("atendente não baixa a prioridade (P2 → P3); gestor baixa, e os prazos são recalculados", async () => {
    const { cliente } = bancoFalso({ "protocolos:select": [{ data: ATUAL, error: null }] });
    await expect(
      alterarProtocolo(cliente, ctx, { userId: USER, kind: "humano", role: "agent" }, PROT, {
        prioridade: "P3",
        prioridade_motivo: "não é urgente",
      }),
    ).rejects.toMatchObject({ status: 403, code: "baixar_prioridade_exige_gestor" });

    const gestor = bancoFalso({
      "protocolos:select": [{ data: ATUAL, error: null }],
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "protocolo_feriados:select": [{ data: [], error: null }],
      "protocolo_politicas_sla:select": [{ data: [{ ...POLITICA, id: "pol-p3", categoria_id: null }], error: null }],
      "protocolos:update": [{ data: ATUAL, error: null }],
    });
    await alterarProtocolo(gestor.cliente, ctx, { userId: USER, kind: "humano", role: "manager" }, PROT, {
      prioridade: "P3",
      prioridade_motivo: "não é urgente",
    });
    expect(gestor.escritas[0]!.carga).toMatchObject({ prioridade: "P3", prioridade_origem: "humano", politica_sla_id: "pol-p3" });
  });

  it("atendente fora da fila da área não assume; da área, assume e o protocolo vai a atribuído", async () => {
    const fora = bancoFalso({
      "protocolos:select": [{ data: { ...ATUAL, estado: "triagem" }, error: null }],
      "protocolo_area_membros:select": [{ data: null, error: null }],
    });
    await expect(
      atribuir(fora.cliente, ctx, { userId: USER, kind: "humano", role: "agent" }, PROT, USER, "assumir"),
    ).rejects.toMatchObject({ status: 403, code: "fora_da_area" });

    const dentro = bancoFalso({
      "protocolos:select": [{ data: { ...ATUAL, estado: "triagem" }, error: null }],
      "protocolo_area_membros:select": [{ data: { id: "m" }, error: null }],
      "user_organizations:select": [{ data: { user_id: USER }, error: null }],
      "protocolos:update": [{ data: ATUAL, error: null }],
    });
    await atribuir(dentro.cliente, ctx, { userId: USER, kind: "humano", role: "agent" }, PROT, USER, "assumir");
    expect(dentro.escritas[0]!.carga).toMatchObject({ responsavel_user_id: USER, estado: "atribuido", distribuido_por: "humano" });
  });
});

describe("aplicarModelo", () => {
  it("contabilidade: cria as categorias que faltam e não recria a que já existe", async () => {
    const { cliente: admin } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
    });
    const respostas: Record<string, Resposta[]> = {
      "protocolo_categorias:select": [{ data: [{ id: "ja", slug: "fiscal", parent_id: null }], error: null }],
      "protocolo_categorias:insert": Array.from({ length: 80 }, (_, i) => ({ data: { id: `nova-${i}` }, error: null })),
    };
    const { cliente: db, escritas } = bancoFalso(respostas);
    await aplicarModelo(db, admin, ctx, USER, "contabilidade");
    const raizes = escritas.filter((e) => e.op === "insert" && !(e.carga as { parent_id?: string }).parent_id);
    expect(raizes.map((e) => (e.carga as { slug: string }).slug)).not.toContain("fiscal");
    expect(raizes.map((e) => (e.carga as { slug: string }).slug)).toContain("notificacao");
    const notificacao = raizes.find((e) => (e.carga as { slug: string }).slug === "notificacao")!.carga;
    expect(notificacao).toMatchObject({ prioridade_padrao: "P1", exige_handoff: true });
    // As subcategorias do Fiscal entram penduradas na categoria que JÁ existia.
    expect(escritas.some((e) => (e.carga as { parent_id?: string; slug?: string }).parent_id === "ja")).toBe(true);
  });
});
