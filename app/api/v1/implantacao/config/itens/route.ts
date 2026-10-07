/**
 * POST/DELETE /api/v1/implantacao/config/itens — itens dos modelos. POST cria ou altera (`id`
 * presente = alterar); DELETE `?id=` remove. Tirar um item do modelo não mexe nas implantações já
 * começadas (os itens delas são cópias). `admin`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { itemDeModeloSchema } from "@/lib/implantacao/schemas";
import { removerItemDeModelo, salvarItemDeModelo } from "@/lib/implantacao/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const entrada = await corpoValidado(req, itemDeModeloSchema, requestId);
    return ok(await salvarItemDeModelo(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, entrada), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho(req.nextUrl.searchParams.get("id") ?? "", requestId);
    return ok(await removerItemDeModelo(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, id), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
