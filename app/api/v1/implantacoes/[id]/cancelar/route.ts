/**
 * POST /api/v1/implantacoes/:id/cancelar — cancela com motivo e, se pedido, inativa a empresa na
 * carteira (spec 23 §5.4). `manager`. Corpo: `{ motivo, inativar? }`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { cancelarSchema } from "@/lib/implantacao/schemas";
import { cancelarImplantacao } from "@/lib/implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const { motivo, inativar } = await corpoValidado(req, cancelarSchema, requestId);
    return ok(await cancelarImplantacao(createAdminClient(), ctxFromAuthz(authz, requestId), authz.user.id, id, motivo, inativar), {
      requestId,
    });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
