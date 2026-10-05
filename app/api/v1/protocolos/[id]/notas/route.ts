/**
 * POST /api/v1/protocolos/:id/notas — nota interna na linha do tempo. `agent`.
 * Entra por `fn_protocolo_registrar_evento`: a linha do tempo é append-only até para o service role.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { notaSchema } from "@/lib/protocolos/schemas";
import { registrarNota } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const { texto } = await corpoValidado(req, notaSchema, requestId);
    const r = await registrarNota(
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, kind: "humano" },
      id,
      texto,
    );
    return ok(r, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
