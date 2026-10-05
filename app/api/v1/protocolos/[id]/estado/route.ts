/**
 * POST /api/v1/protocolos/:id/estado — muda o estado (spec 22 §4.2, §10.3). `agent`.
 *
 * A máquina de estados é do gatilho do banco: fora da tabela → 409 `protocolo_transicao_invalida`.
 * O serviço pausa e retoma o relógio de resolução. Revisão mudou no meio → 409 `revision_conflict`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { transicaoSchema } from "@/lib/protocolos/schemas";
import { mudarEstado } from "@/lib/protocolos/servico";
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
    const { estado, motivo } = await corpoValidado(req, transicaoSchema, requestId);
    const r = await mudarEstado(
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, kind: "humano", role: authz.org.role },
      id,
      estado,
      motivo,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
