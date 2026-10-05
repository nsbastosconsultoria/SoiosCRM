/** POST /api/v1/protocolos/config/membros — põe alguém na fila de uma área (ou como líder). `admin`. */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { membroSchema } from "@/lib/protocolos/schemas";
import { adicionarMembro } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const corpo = await corpoValidado(req, membroSchema, requestId);
    const r = await adicionarMembro(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      corpo,
    );
    return ok(r, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
