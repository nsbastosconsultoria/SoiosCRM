/**
 * POST /api/v1/protocolos/config/modelo — aplica o modelo de nicho (`contabilidade` ou `generico`):
 * as áreas e as categorias que faltam. Idempotente; não apaga nada; não semeia prazos. `admin`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { modeloSchema } from "@/lib/protocolos/schemas";
import { aplicarModelo } from "@/lib/protocolos/servico";
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
    const { modelo } = await corpoValidado(req, modeloSchema, requestId);
    const r = await aplicarModelo(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      modelo,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
