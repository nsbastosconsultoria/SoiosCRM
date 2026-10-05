/**
 * PUT /api/v1/protocolos/config/expediente — o expediente que o relógio do SLA conta (dias, início,
 * fim, fuso). `admin`. `null` = relógio corrido (24×7). Grava em `organizations.settings` por merge.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { expedienteSchema } from "@/lib/protocolos/schemas";
import { salvarExpediente } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const expediente = await corpoValidado(req, expedienteSchema, requestId);
    const r = await salvarExpediente(createAdminClient(), ctxFromAuthz(authz, requestId), authz.user.id, expediente);
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
