/**
 * GET /api/v1/implantacoes/:id — a ficha: implantação, empresa, estado na carteira, itens, linha do
 * tempo e o resumo (obrigatórios fechados, vencidos, se já pode concluir). `viewer`.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { lerImplantacao } from "@/lib/implantacao/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    return ok(await lerImplantacao(await createClient(), ctxFromAuthz(authz, requestId), id), { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
