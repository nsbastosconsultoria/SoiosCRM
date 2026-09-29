/**
 * A rodada diária da cobrança: sem o módulo instalado é resposta, não erro; e uma organização que
 * falha não trava as outras.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { SEGREDO } = vi.hoisted(() => ({ SEGREDO: "segredo-do-teste" }));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: SEGREDO, INTERNAL_SECRET: "" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let resposta: { data: unknown; error: { code?: string; message: string } | null };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ neq: async () => resposta }) }),
  }),
}));

const aplicar = vi.fn();
vi.mock("@/lib/cobranca/aplicar", () => ({ aplicarCobranca: (...a: unknown[]) => aplicar(...a) }));

import { GET } from "./route";

const req = (auth = `Bearer ${SEGREDO}`) => ({ headers: new Headers({ authorization: auth }) }) as never;

beforeEach(() => aplicar.mockReset());

describe("cron cobranca-watcher", () => {
  it("sem o segredo do cron: 403", async () => {
    resposta = { data: [], error: null };
    expect((await GET(req("Bearer errado"))).status).toBe(403);
  });

  it.each(["42P01", "PGRST205"])("módulo não instalado (%s): 200 com modulo_instalado=false", async (code) => {
    resposta = { data: null, error: { code, message: "tabela ausente" } };
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ modulo_instalado: false });
    expect(aplicar).not.toHaveBeenCalled();
  });

  it("outro erro de banco: 500", async () => {
    resposta = { data: null, error: { code: "08006", message: "conexão caiu" } };
    expect((await GET(req())).status).toBe(500);
  });

  it("aplica a cada organização, e a que falha não trava as outras", async () => {
    resposta = {
      data: [{ organization_id: "a" }, { organization_id: "b" }, { organization_id: "c" }],
      error: null,
    };
    aplicar
      .mockResolvedValueOnce({ avaliada: true, efeito: true, suspendeu: true, reativou: false })
      .mockRejectedValueOnce(new Error("falhou"))
      .mockResolvedValueOnce({ avaliada: true, efeito: false, suspendeu: false, reativou: false });
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({
      modulo_instalado: true,
      avaliadas: 2,
      com_efeito: 1,
      suspensas: 1,
      reativadas: 0,
      falharam: 1,
    });
    expect(aplicar.mock.calls.map((c) => c[1])).toEqual(["a", "b", "c"]);
  });
});
