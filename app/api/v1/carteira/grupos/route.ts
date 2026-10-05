/**
 * GET/POST /api/v1/carteira/grupos — grupos empresariais (spec 21 §4.1).
 * GET `viewer`; POST `manager` (mesma RLS da migration 0902).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/carteira/rota";
import { grupoNovoSchema } from "@/lib/carteira/schemas";
import { criarGrupo, listarGrupos } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    return ok(await listarGrupos(await createClient(), ctxFromAuthz(authz, requestId)), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const corpo = await corpoValidado(req, grupoNovoSchema, requestId);
    const grupo = await criarGrupo(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, corpo);
    return ok(grupo, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
