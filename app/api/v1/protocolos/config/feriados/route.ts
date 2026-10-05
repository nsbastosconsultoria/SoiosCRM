/** POST /api/v1/protocolos/config/feriados — dia sem expediente para o relógio do SLA. `admin`. */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { feriadoSchema } from "@/lib/protocolos/schemas";
import { adicionarFeriado } from "@/lib/protocolos/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const corpo = await corpoValidado(req, feriadoSchema, requestId);
    const r = await adicionarFeriado(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, corpo);
    return ok(r, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
