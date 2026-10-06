/**
 * PATCH /api/v1/implantacoes/:id/itens/:item — estado, responsável, prazo, observação, evidência e
 * dispensa de um item (spec 23 §5.2). `agent`; dispensar e tirar da dispensa, `manager` (o serviço
 * confere). `revision` obrigatório: mudou no meio → 409 `revision_conflict`. Transição, evidência e
 * motivo de dispensa são conferidos pelo banco.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { itemPatchSchema } from "@/lib/implantacao/schemas";
import { alterarItem } from "@/lib/implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; item: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const params = await ctx.params;
    const id = idDoCaminho(params.id, requestId);
    const item = idDoCaminho(params.item, requestId);
    const patch = await corpoValidado(req, itemPatchSchema, requestId);
    return ok(
      await alterarItem(createAdminClient(), ctxFromAuthz(authz, requestId), { userId: authz.user.id, role: authz.org.role }, id, item, patch),
      { requestId },
    );
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
