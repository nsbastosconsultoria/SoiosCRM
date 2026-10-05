/**
 * O vigia de prazo: quanto do prazo passou (em minutos úteis), quais marcos foram cruzados, UM
 * aviso por cruzamento (a PK dos marcos é a trava), e a fila sem ninguém.
 */
import { describe, expect, it, vi } from "vitest";

import { fracaoDoPrazo, marcosAtingidos, rodarVigia } from "./vigia";
import type { Expediente } from "./sla";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const COMERCIAL: Expediente = { fuso: "America/Sao_Paulo", dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };
const sp = (d: string, h: string) => new Date(`${d}T${h}:00-03:00`);

describe("fracaoDoPrazo e marcos", () => {
  it("prazo de 10h úteis com 2h faltando = 80%", () => {
    const vence = sp("2026-10-06", "18:00");
    expect(fracaoDoPrazo(sp("2026-10-06", "16:00"), vence, 600, COMERCIAL, new Set())).toBeCloseTo(0.8);
  });

  it("fora do expediente o relógio não anda: sexta 18:00 e domingo 20:00 medem o mesmo", () => {
    const vence = sp("2026-10-12", "10:00");
    const sexta = fracaoDoPrazo(sp("2026-10-09", "18:00"), vence, 600, COMERCIAL, new Set());
    const domingo = fracaoDoPrazo(sp("2026-10-11", "20:00"), vence, 600, COMERCIAL, new Set());
    expect(domingo).toBeCloseTo(sexta);
  });

  it("depois de vencido, mede quanto passou além (2h além de 10h = 120%)", () => {
    expect(fracaoDoPrazo(sp("2026-10-06", "12:00"), sp("2026-10-06", "10:00"), 600, COMERCIAL, new Set())).toBeCloseTo(1.2);
  });

  it("marcos cruzados", () => {
    expect(marcosAtingidos(0.79)).toEqual([]);
    expect(marcosAtingidos(0.8)).toEqual([80]);
    expect(marcosAtingidos(1.3)).toEqual([80, 100, 120]);
  });
});

type Resposta = { data: unknown; error: unknown };

function bancoFalso(respostas: Record<string, Resposta[]>) {
  const escritas: Array<{ tabela: string; carga: unknown }> = [];
  const rpcs: unknown[] = [];
  return {
    escritas,
    rpcs,
    cliente: {
      from(tabela: string) {
        let op = "select";
        let carga: unknown;
        const resolver = (): Promise<Resposta> => {
          if (op === "insert") escritas.push({ tabela, carga });
          return Promise.resolve((respostas[`${tabela}:${op}`] ?? []).shift() ?? { data: null, error: null });
        };
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
        b.insert = (x: unknown) => ((op = "insert"), (carga = x), resolver());
        b.maybeSingle = resolver;
        b.then = (ok: (r: Resposta) => unknown) => resolver().then(ok);
        return b;
      },
      rpc(_n: string, args: unknown) {
        rpcs.push(args);
        return Promise.resolve({ data: null, error: null });
      },
    } as never,
  };
}

const PROTOCOLO = {
  id: "p1",
  organization_id: "org",
  ano: 2026,
  numero: 12,
  categoria_id: "cat",
  area: "fiscal",
  estado: "atribuido",
  responsavel_user_id: "u1",
  politica_sla_id: "pol",
  aberto_em: "2026-10-01T12:00:00.000Z",
  primeira_resposta_vence_em: null,
  primeira_resposta_em: "2026-10-01T12:05:00.000Z",
  pausado_desde: null,
};

describe("rodarVigia", () => {
  it("sem o módulo instalado: responde e não faz mais nada", async () => {
    const { cliente } = bancoFalso({ "protocolos:select": [{ data: null, error: { code: "PGRST205" } }] });
    expect(await rodarVigia(cliente, new Date(), "r")).toMatchObject({ modulo_instalado: false, avisos: 0 });
  });

  it("protocolo vencido há tempo: grava os três marcos e avisa UMA vez, pelo mais alto, sem texto da pessoa", async () => {
    const agora = new Date("2026-10-01T20:00:00.000Z");
    const { cliente, escritas, rpcs } = bancoFalso({
      "protocolos:select": [{ data: [{ ...PROTOCOLO, resolucao_vence_em: "2026-10-01T14:00:00.000Z" }], error: null }],
      "protocolo_politicas_sla:select": [{ data: { id: "pol", primeira_resposta_min: 60, resolucao_min: 120, em_horario_util: false }, error: null }],
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "protocolo_feriados:select": [{ data: [], error: null }],
      "protocolo_categorias:select": [{ data: { nome: "Fiscal" }, error: null }],
    });
    const r = await rodarVigia(cliente, agora, "r");
    expect(r).toMatchObject({ marcos_registrados: 3, avisos: 1 });
    const avisos = escritas.filter((e) => e.tabela === "agent_inbox_items");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.carga).toMatchObject({ kind: "protocolo_sla", severity: "critical", ref_kind: "protocolo", ref_id: "p1" });
    expect((avisos[0]!.carga as { title: string }).title).toContain("2026-000012");
    expect(rpcs[0]).toMatchObject({ p_tipo: "sla_estourado", p_novo: { relogio: "resolucao", marco: 120 } });
  });

  it("marco já registrado (PK 23505) não gera segundo aviso", async () => {
    const agora = new Date("2026-10-01T20:00:00.000Z");
    const jaTem = { data: null, error: { code: "23505" } };
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [{ data: [{ ...PROTOCOLO, resolucao_vence_em: "2026-10-01T14:00:00.000Z" }], error: null }],
      "protocolo_politicas_sla:select": [{ data: { id: "pol", primeira_resposta_min: 60, resolucao_min: 120, em_horario_util: false }, error: null }],
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "protocolo_feriados:select": [{ data: [], error: null }],
      "protocolo_marcos_sla:insert": [jaTem, jaTem, jaTem],
    });
    const r = await rodarVigia(cliente, agora, "r");
    expect(r.avisos).toBe(0);
    expect(escritas.filter((e) => e.tabela === "agent_inbox_items")).toHaveLength(0);
  });

  it("prazo pausado não é medido", async () => {
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [
        { data: [{ ...PROTOCOLO, resolucao_vence_em: "2026-10-01T14:00:00.000Z", pausado_desde: "2026-10-01T13:00:00.000Z" }], error: null },
      ],
    });
    await rodarVigia(cliente, new Date("2026-10-01T20:00:00.000Z"), "r");
    expect(escritas).toHaveLength(0);
  });

  it("fila sem ninguém na área há mais de 1h: avisa protocolo_sem_dono uma vez", async () => {
    const { cliente, escritas } = bancoFalso({
      "protocolos:select": [
        { data: [{ ...PROTOCOLO, responsavel_user_id: null, politica_sla_id: null, resolucao_vence_em: null }], error: null },
      ],
      "protocolo_area_membros:select": [{ data: [{ area: "dp" }], error: null }],
      "agent_inbox_items:select": [{ data: null, error: null }],
    });
    const r = await rodarVigia(cliente, new Date("2026-10-01T15:00:00.000Z"), "r");
    expect(r.sem_dono).toBe(1);
    expect(escritas[0]!.carga).toMatchObject({ kind: "protocolo_sem_dono", ref_kind: "protocolo" });
  });
});
