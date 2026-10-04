/**
 * POST /api/v1/carteira/conversas/:id/contexto — a pessoa da tela troca a empresa da conversa.
 *
 * O que se prova: `agent` é o degrau; quem não enxerga a conversa pela SESSÃO recebe 404 e a
 * função do banco nem é chamada (senão o service role apontaria o contexto de uma conversa que a
 * RLS esconde dele); a função recebe `humano`, o usuário e a organização do cookie; e só a troca
 * que mudou algo é auditada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "55555555-5555-4555-8555-555555555555";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

function sessaoQueEnxerga(visivel: boolean): void {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: visivel ? { id: CONVERSA } : null, error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => q } as never);
}

function post(corpo: unknown): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost/api/v1/carteira/conversas/${CONVERSA}/contexto`, {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id: CONVERSA }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, idioma: "pt-BR" },
    org: { orgId: ORG, name: "Org", role: "agent" },
  } as never);
});

describe("POST /api/v1/carteira/conversas/:id/contexto", () => {
  it("exige `agent`", async () => {
    sessaoQueEnxerga(true);
    vi.mocked(createAdminClient).mockReturnValue({ rpc: vi.fn() } as never);
    const { POST } = await import("./route");
    await POST(...post({ company_id: EMPRESA }));
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("agent");
  });

  it("conversa que a sessão não enxerga → 404, sem chamar a função do banco", async () => {
    sessaoQueEnxerga(false);
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const { POST } = await import("./route");
    const res = await POST(...post({ company_id: EMPRESA }));
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("troca pela função, como humano, com a organização do cookie, e audita", async () => {
    sessaoQueEnxerga(true);
    const rpc = vi.fn().mockResolvedValue({
      data: { alterado: true, company_id: EMPRESA, anterior: null },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const { POST } = await import("./route");
    const res = await POST(...post({ company_id: EMPRESA }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_carteira_definir_contexto", {
      p_org: ORG,
      p_conversation: CONVERSA,
      p_company: EMPRESA,
      p_definido_por: "humano",
      p_user: USER,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "carteira.contexto_alterado" }));
  });

  it("limpar o contexto (`null`) é aceito; a mesma empresa de novo não audita", async () => {
    sessaoQueEnxerga(true);
    const rpc = vi.fn().mockResolvedValue({ data: { alterado: false, company_id: null }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const { POST } = await import("./route");
    const res = await POST(...post({ company_id: null }));
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it("corpo com campo desconhecido → 422", async () => {
    sessaoQueEnxerga(true);
    vi.mocked(createAdminClient).mockReturnValue({ rpc: vi.fn() } as never);
    const { POST } = await import("./route");
    const res = await POST(...post({ company_id: EMPRESA, definido_por: "agente" }));
    expect(res.status).toBe(422);
  });
});
