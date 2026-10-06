/**
 * POST /api/v1/implantacao/config/modelos — cria ou altera um modelo (`id` presente = alterar).
 * Marcar como padrão tira o padrão do outro. `admin` (a RLS exige o mesmo).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { modeloSchema } from "@/lib/implantacao/schemas";
import { salvarModelo } from "@/lib/implantacao/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const entrada = await corpoValidado(req, modeloSchema, requestId);
    return ok(await salvarModelo(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, entrada), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
