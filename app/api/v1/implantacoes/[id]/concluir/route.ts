/**
 * POST /api/v1/implantacoes/:id/concluir — conclui a implantação e ATIVA o cliente na carteira
 * (spec 23 §5.3). `manager` — a decisão é do clique do gestor (Q1). Com obrigatório aberto, o
 * banco recusa: 409 `implantacao_obrigatorios_abertos`, com a contagem no detalhe.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { concluirImplantacao } from "@/lib/implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    return ok(await concluirImplantacao(createAdminClient(), ctxFromAuthz(authz, requestId), authz.user.id, id), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
