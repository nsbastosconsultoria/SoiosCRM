import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pergunta de data configurada na fonte: a captação grava a data em AAAA-MM-DD
 * no campo personalizado, venha do `<input type="date">` do formulário gerado
 * ou em DD/MM/AAAA de um formulário de terceiro. Uma resposta que não é data
 * NÃO recusa o lead: o valor segue como veio, porque perder o contato por causa
 * da data seria pior do que guardar o texto.
 */

const h = vi.hoisted(() => ({
  registrar: vi.fn(async () => undefined),
  criarLead: vi.fn(),
}));

const FONTE = {
  id: "fonte-1",
  name: "Formulário do site",
  organization_id: "org-1",
  secret_encrypted: null,
  default_pipeline_id: "pipe-1",
  default_stage_id: "stage-1",
  field_map: {},
  form_fields: [{ key: "data", label: "Data", type: "date", required: false }],
  redirect_to: null,
  is_active: true,
  authorize_ai_on_capture: false,
};

/** Cadeia do PostgREST que aceita qualquer método e resolve vazio — só a fonte é lida de verdade. */
function cadeia(tabela: string): unknown {
  const resultado = { data: tabela === "webhook_sources" ? FONTE : null, error: null };
  const proxy: unknown = new Proxy(() => undefined, {
    get(_alvo, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(resultado);
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (t: string) => cadeia(t), rpc: async () => ({ data: null, error: null }) }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: h.registrar,
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: h.criarLead }));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));

import { POST } from "@/app/api/v1/webhooks/in/[token]/route";

const TOKEN = "token-da-fonte-0001";

async function enviar(corpo: Record<string, unknown>): Promise<Response | Error> {
  const req = new NextRequest(`http://localhost/api/v1/webhooks/in/${TOKEN}`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) }).catch((e: Error) => e);
}

beforeEach(() => {
  h.registrar.mockClear();
  h.criarLead.mockReset().mockRejectedValue(new Error("chegou à criação do negócio"));
});

describe("pergunta de data configurada na fonte de formulário", () => {
  it.each([
    ["2026-11-03", "2026-11-03"],
    ["03/11/2026", "2026-11-03"],
  ])("%s chega ao negócio como %s", async (enviado, gravado) => {
    await enviar({ nome: "Dora", telefone: "+5511999990000", data: enviado });

    expect(h.criarLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ custom_fields: expect.objectContaining({ data: gravado }) }),
      expect.anything(),
    );
  });

  it("resposta que não é data não recusa o lead e segue como veio", async () => {
    const res = await enviar({ nome: "Dora", telefone: "+5511999990000", data: "semana que vem" });

    expect(res).not.toBeInstanceOf(Response);
    expect(h.registrar).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: "recusado" }));
    expect(h.criarLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ custom_fields: expect.objectContaining({ data: "semana que vem" }) }),
      expect.anything(),
    );
  });
});
