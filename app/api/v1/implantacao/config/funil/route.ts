/**
 * PUT /api/v1/implantacao/config/funil — o funil cujo negócio ganho inicia a implantação (spec 23
 * §5.1). `admin`. Corpo: `{ pipeline_id }`; `null` desliga o início automático. Grava em
 * `organizations.settings` por merge.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { funilSchema } from "@/lib/implantacao/schemas";
import { salvarFunilComercial } from "@/lib/implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const { pipeline_id } = await corpoValidado(req, funilSchema, requestId);
    return ok(await salvarFunilComercial(createAdminClient(), ctxFromAuthz(authz, requestId), authz.user.id, pipeline_id), {
      requestId,
    });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
