/** DELETE /api/v1/protocolos/config/membros/:id — tira alguém da fila de uma área. `admin`. */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { removerLinhaDeConfig } from "@/lib/protocolos/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const r = await removerLinhaDeConfig(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      "protocolo_area_membros",
      id,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
