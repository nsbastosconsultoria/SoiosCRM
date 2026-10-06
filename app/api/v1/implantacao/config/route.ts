/**
 * GET /api/v1/implantacao/config — modelos, itens dos modelos e áreas. `viewer`: a carteira precisa
 * dos modelos para iniciar; escrever a configuração é `admin` (rotas filhas).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { lerConfiguracao } from "@/lib/implantacao/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await lerConfiguracao(await createClient(), ctxFromAuthz(authz, requestId)), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
