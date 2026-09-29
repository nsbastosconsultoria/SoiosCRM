/**
 * PATCH /api/v1/honorarios/parcelas/[id] — como pagar a parcela (migration 0485).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PARCELA_ID = "66666666-6666-4666-8666-666666666666";
const params = { params: Promise.resolve({ id: PARCELA_ID }) };

function autorizado(): void {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1" },
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
}

/** Guarda o que foi gravado e os filtros, e devolve `resultado` no `maybeSingle`. */
function fakeSupabase(resultado: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}) {
  const visto: { update?: unknown; filtros: Array<[string, unknown]> } = { filtros: [] };
  const builder: Record<string, unknown> = {
    update: (v: unknown) => {
      visto.update = v;
      return builder;
    },
    eq: (c: string, v: unknown) => {
      visto.filtros.push([c, v]);
      return builder;
    },
    select: () => builder,
    maybeSingle: () => Promise.resolve(resultado),
  };
  return { cliente: { from: () => builder }, visto };
}

function patch(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/honorarios/parcelas/${PARCELA_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/v1/honorarios/parcelas/[id]", () => {
  it("grava a instrução aparada, filtra pela organização e audita SEM o texto", async () => {
    autorizado();
    const { cliente, visto } = fakeSupabase({
      data: { id: PARCELA_ID, contrato_id: "c1", numero: 2, instrucao_pagamento: "PIX-123" },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "  PIX-123  " }), params);

    expect(res.status).toBe(200);
    expect(visto.update).toEqual({ instrucao_pagamento: "PIX-123" });
    expect(visto.filtros).toContainEqual(["organization_id", ORG_ID]);
    const registro = vi.mocked(audit).mock.calls[0]![0] as { action: string; metadata: object };
    expect(registro.action).toBe("honorarios.parcela_instrucao_alterada");
    expect(JSON.stringify(registro.metadata)).not.toContain("PIX-123");
  });

  it("texto vazio apaga (grava null)", async () => {
    autorizado();
    const { cliente, visto } = fakeSupabase({
      data: { id: PARCELA_ID, contrato_id: "c1", numero: 1, instrucao_pagamento: null },
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "   " }), params);

    expect(res.status).toBe(200);
    expect(visto.update).toEqual({ instrucao_pagamento: null });
  });

  it("mais de 1000 caracteres → 422, sem ir ao banco", async () => {
    autorizado();
    const { cliente, visto } = fakeSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "x".repeat(1001) }), params);

    expect(res.status).toBe(422);
    expect(visto.update).toBeUndefined();
  });

  it("parcela paga, inexistente ou de outra organização (RLS devolve 0 linhas) → 404", async () => {
    autorizado();
    const { cliente } = fakeSupabase({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "PIX" }), params);

    expect(res.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("coluna ausente (módulo ainda não reaplicado, 42703) → 409 que manda atualizar", async () => {
    autorizado();
    const { cliente } = fakeSupabase({ data: null, error: { code: "42703" } });
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "PIX" }), params);

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("module_outdated");
  });

  it("papel abaixo de manager → a recusa do requireRole passa direto", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "Papel insuficiente.", 403, {}),
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ instrucao_pagamento: "PIX" }), params);

    expect(res.status).toBe(403);
  });
});
