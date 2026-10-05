/**
 * GET /api/v1/protocolos/config — categorias, políticas de SLA, membros das filas, feriados,
 * expediente, áreas e regra de prazo. `viewer`: o formulário de abertura precisa das categorias,
 * e a fila precisa das áreas. Escrever a configuração é `admin` (rotas filhas).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { lerConfiguracao } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await lerConfiguracao(await createClient(), createAdminClient(), ctxFromAuthz(authz, requestId)), {
      requestId,
    });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
