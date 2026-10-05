/**
 * POST /api/v1/carteira/empresas/:id/estado — muda o estado do relacionamento (spec 21 §4.2).
 *
 * `manager`. A tabela de transições mora em `fn_carteira_transicionar` (migration 0902), que só
 * o service role executa: a rota autentica e passa a organização do cookie e o usuário como
 * ator. Transição fora da tabela → 409 `carteira_transicao_invalida`; a mesma transição duas
 * vezes → 200 com `alterado: false`, sem auditar.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { transicaoSchema } from "@/lib/carteira/schemas";
import { transicionar } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const { estado } = await corpoValidado(req, transicaoSchema, requestId);
    const resultado = await transicionar(
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyId,
      estado,
    );
    return ok(resultado, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
