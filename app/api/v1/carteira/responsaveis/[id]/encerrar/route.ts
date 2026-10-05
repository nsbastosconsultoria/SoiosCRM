/**
 * POST /api/v1/carteira/responsaveis/:id/encerrar — encerra a vigência de um responsável
 * (spec 21 §4.5). `manager`. A linha fica, com `vigencia_fim`: "quem cuidou da empresa naquele
 * período" é história, não se apaga.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/carteira/rota";
import { encerrarResponsavel } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const responsavelId = idDoCaminho((await ctx.params).id, requestId);
    const encerrado = await encerrarResponsavel(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      responsavelId,
    );
    return ok(encerrado, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
