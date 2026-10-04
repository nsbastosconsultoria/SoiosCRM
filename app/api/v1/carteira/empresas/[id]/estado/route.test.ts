/**
 * POST /api/v1/carteira/empresas/:id/estado — a rota só autentica, valida e chama a função.
 *
 * O que se prova aqui: `manager` é o degrau; o corpo é estrito (estado fora do vocabulário é
 * 422 SEM chamar o banco); a organização que vai para `fn_carteira_transicionar` é a do cookie
 * (`authz`), nunca do corpo; a recusa da função vira 409 com código estável; e só a transição
 * que de fato mudou o estado é auditada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

function autorizado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
}

function rpcQueDevolve(resultado: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => resultado);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return rpc;
}

function post(id: string, corpo: unknown): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost/api/v1/carteira/empresas/${id}/estado`, {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/carteira/empresas/:id/estado", () => {
  it("sem papel → repassa o 403 de requireRole, e o banco não é chamado", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Papel insuficiente.", 403, {}),
    } as never);
    const rpc = rpcQueDevolve({ data: null, error: null });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "ativo" }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager");
  });

  it("estado fora do vocabulário → 422 sem tocar o banco", async () => {
    autorizado();
    const rpc = rpcQueDevolve({ data: null, error: null });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "vip" }));
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("organização no corpo é recusada (schema estrito) — ela só vem do cookie", async () => {
    autorizado();
    const rpc = rpcQueDevolve({ data: null, error: null });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "ativo", organization_id: "outra" }));
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("id que não é uuid → 404", async () => {
    autorizado();
    rpcQueDevolve({ data: null, error: null });
    const { POST } = await import("./route");
    const res = await POST(...post("nao-e-uuid", { estado: "ativo" }));
    expect(res.status).toBe(404);
  });

  it("transição aceita → 200, a função recebe a org do cookie e o ator, e a rota audita", async () => {
    autorizado();
    const rpc = rpcQueDevolve({
      data: { de: "prospect", para: "ativo", alterado: true, cliente_desde: "2026-10-04" },
      error: null,
    });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "ativo" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_carteira_transicionar", {
      p_org: ORG_ID,
      p_company: EMPRESA,
      p_estado: "ativo",
      p_ator: USER_ID,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "carteira.estado_alterado", metadata: { de: "prospect", para: "ativo" } }),
    );
  });

  it("mesma transição de novo → 200 com alterado:false, sem auditar", async () => {
    autorizado();
    rpcQueDevolve({ data: { de: "ativo", para: "ativo", alterado: false, cliente_desde: null }, error: null });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "ativo" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.alterado).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("transição recusada pela função → 409 carteira_transicao_invalida", async () => {
    autorizado();
    rpcQueDevolve({
      data: null,
      error: { code: "P0001", message: "carteira_transicao_invalida", details: "ativo -> proposta" },
    });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "proposta" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("carteira_transicao_invalida");
  });

  it("módulo não instalado → 409 module_not_installed, não 500", async () => {
    autorizado();
    rpcQueDevolve({ data: null, error: { code: "PGRST205", message: "not found" } });
    const { POST } = await import("./route");
    const res = await POST(...post(EMPRESA, { estado: "ativo" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("module_not_installed");
  });
});
