/**
 * POST /api/v1/protocolos/:id/assumir — o atendente pega o protocolo para si. `agent`, e só se
 * for da fila da área (gestor assume qualquer um). Fora da área → 403 `fora_da_area`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { atribuir } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const r = await atribuir(
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, kind: "humano", role: authz.org.role },
      id,
      authz.user.id,
      "assumir",
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
