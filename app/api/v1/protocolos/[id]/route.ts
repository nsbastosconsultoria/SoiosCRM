/**
 * GET/PATCH /api/v1/protocolos/:id — a ficha e a correção de classificação/prioridade.
 *
 * GET (`viewer`): o protocolo e a linha do tempo, pela sessão.
 * PATCH (`agent`): categoria, subcategoria, competência, título, prazo do cliente e prioridade
 * (com motivo). BAIXAR a prioridade é de gestor (spec 22 Q2) — o serviço recusa com 403. Mudar
 * prioridade ou categoria recalcula os prazos a partir da abertura.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { patchSchema } from "@/lib/protocolos/schemas";
import { alterarProtocolo, fichaDoProtocolo } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    return ok(await fichaDoProtocolo(await createClient(), ctxFromAuthz(authz, requestId), id), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const patch = await corpoValidado(req, patchSchema, requestId);
    const r = await alterarProtocolo(
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, kind: "humano", role: authz.org.role },
      id,
      patch,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
