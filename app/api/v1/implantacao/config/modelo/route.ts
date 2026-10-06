/**
 * POST /api/v1/implantacao/config/modelo — aplica o modelo de nicho (`contabilidade` ou
 * `generico`): cria o modelo e os itens. Já existindo um modelo com o mesmo nome, não mexe em nada
 * (`criado: false`). `admin`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { modeloDeNichoSchema } from "@/lib/implantacao/schemas";
import { aplicarModeloDeNicho } from "@/lib/implantacao/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const { modelo } = await corpoValidado(req, modeloDeNichoSchema, requestId);
    return ok(await aplicarModeloDeNicho(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, modelo), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
