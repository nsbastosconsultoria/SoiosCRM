/**
 * O cliente respondeu o que a equipe pediu pela ficha: a resposta entra no protocolo, o prazo volta
 * a correr e o caso fecha — numa transação. Sem o módulo, ou caso sem protocolo, nada acontece.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fechar = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/agent-engine/agent/human-cases", () => ({
  fecharCasoDoProtocoloRespondido: (...a: unknown[]) => fechar(...a),
}));

const { registrarRespostaNoProtocolo } = await import("./resposta-do-cliente");

type Linha = Record<string, unknown>;
function poolFalso(opts: { modulo: boolean; protocolo?: Linha | null; politica?: Linha | null }) {
  const chamadas: Array<{ sql: string; params: unknown[] }> = [];
  const responder = async (sql: string, params: unknown[] = []) => {
    chamadas.push({ sql, params });
    if (sql.includes("to_regclass")) return { rows: [{ ok: opts.modulo }] };
    if (sql.includes("from public.protocolos")) return { rows: opts.protocolo ? [opts.protocolo] : [] };
    if (sql.includes("protocolo_politicas_sla")) return { rows: opts.politica ? [opts.politica] : [] };
    if (sql.includes("from public.organizations")) return { rows: [{ settings: {} }] };
    if (sql.includes("protocolo_feriados")) return { rows: [] };
    return { rows: [], rowCount: 1 };
  };
  const client = { query: vi.fn(responder), release: vi.fn() };
  return { chamadas, pool: { query: vi.fn(responder), connect: async () => client } as never };
}

const PROTOCOLO = {
  id: "p1",
  ano: 2026,
  numero: 7,
  estado: "aguardando_cliente",
  // No passado de verdade: o relógio mede até `new Date()`.
  pausado_desde: new Date(Date.now() - 2 * 3600_000),
  pausa_min: 0,
  resolucao_vence_em: new Date("2026-10-08T13:00:00.000Z"),
  politica_sla_id: "pol",
};

beforeEach(() => vi.clearAllMocks());

describe("registrarRespostaNoProtocolo", () => {
  it("sem o módulo instalado: não abre transação nem toca em nada", async () => {
    const { pool, chamadas } = poolFalso({ modulo: false });
    expect(await registrarRespostaNoProtocolo(pool, "org", "case", "o CNPJ é 123")).toBeNull();
    expect(chamadas).toHaveLength(1);
    expect(fechar).not.toHaveBeenCalled();
  });

  it("caso sem protocolo: segue o caminho de sempre (null), sem fechar o caso", async () => {
    const { pool } = poolFalso({ modulo: true, protocolo: null });
    expect(await registrarRespostaNoProtocolo(pool, "org", "case", "x")).toBeNull();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("aguardando o cliente: volta a em atendimento, retoma o prazo, registra e fecha o caso", async () => {
    const { pool, chamadas } = poolFalso({
      modulo: true,
      protocolo: PROTOCOLO,
      politica: { em_horario_util: false, pausa_aguardando_cliente: true, pausa_aguardando_terceiro: false },
    });
    expect(await registrarRespostaNoProtocolo(pool, "org", "case", "o CNPJ é 123")).toEqual({ numero: "2026-000007" });

    const update = chamadas.find((c) => c.sql.startsWith("update public.protocolos"))!;
    expect(update.sql).toContain("estado = $3");
    expect(update.params.slice(0, 4)).toEqual(["org", "p1", "em_atendimento", null]);
    expect(update.sql).toContain("pausado_desde");
    expect(update.sql).toContain("resolucao_vence_em");
    const evento = chamadas.find((c) => c.sql.includes("fn_protocolo_registrar_evento"))!;
    expect(evento.params).toEqual(["org", "p1", "o CNPJ é 123"]);
    expect(fechar).toHaveBeenCalledWith(expect.anything(), "org", "case");
    expect(chamadas[chamadas.length - 1]!.sql).toBe("commit");
    expect(chamadas.find((c) => c.sql.includes("for update"))).toBeDefined();
  });

  it("protocolo já em outro estado: só registra a resposta e fecha o caso, sem mexer no estado", async () => {
    const { pool, chamadas } = poolFalso({ modulo: true, protocolo: { ...PROTOCOLO, estado: "em_atendimento", pausado_desde: null } });
    await registrarRespostaNoProtocolo(pool, "org", "case", "x");
    expect(chamadas.some((c) => c.sql.startsWith("update public.protocolos"))).toBe(false);
    expect(fechar).toHaveBeenCalled();
  });
});
