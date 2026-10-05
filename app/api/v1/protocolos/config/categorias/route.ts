/** POST /api/v1/protocolos/config/categorias — cria categoria ou subcategoria. `admin`. */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { categoriaSchema } from "@/lib/protocolos/schemas";
import { criarCategoria } from "@/lib/protocolos/servico";
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
    const corpo = await corpoValidado(req, categoriaSchema, requestId);
    const r = await criarCategoria(
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
