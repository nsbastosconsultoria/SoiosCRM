/**
 * PATCH/DELETE /api/v1/protocolos/config/categorias/:id — `admin`. Remover só categoria nunca
 * usada; usada, a resposta (409 `categoria_em_uso`) ensina a desativar.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { patchDeCategoriaSchema } from "@/lib/protocolos/schemas";
import { atualizarCategoria, removerCategoria } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const patch = await corpoValidado(req, patchDeCategoriaSchema, requestId);
    const r = await atualizarCategoria(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      id,
      patch,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    return ok(await removerCategoria(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, id), {
      requestId,
    });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
