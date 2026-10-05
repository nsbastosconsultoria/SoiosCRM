/**
 * POST /api/v1/carteira/empresas/:id/responsaveis — define quem cuida da empresa numa área
 * (spec 21 §4.5). `manager`.
 *
 * Trocar o responsável encerra a vigência do atual e abre outra linha: quem cuidou da empresa
 * naquele período continua registrado. A mesma pessoa de novo → 200 com `alterado: false`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/carteira/rota";
import { responsavelNovoSchema } from "@/lib/carteira/schemas";
import { definirResponsavel } from "@/lib/carteira/servico";
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
    const companyId = idDoCaminho((await ctx.params).id, requestId);
    const corpo = await corpoValidado(req, responsavelNovoSchema, requestId);
    const resultado = await definirResponsavel(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyId,
      corpo,
    );
    return ok(resultado, { requestId, status: resultado.alterado ? 201 : 200 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
