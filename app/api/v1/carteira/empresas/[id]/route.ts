/**
 * GET/PATCH /api/v1/carteira/empresas/:id — a ficha da empresa na carteira (spec 21 §9).
 *
 * GET (`viewer`): perfil, a empresa e as pessoas ligadas pelo núcleo (`company_people`), o
 * detalhe de cada vínculo, os responsáveis vigentes e a linha do tempo.
 * PATCH (`manager`): grupo, matriz/filial e atributos do nicho. O ESTADO não muda aqui — o
 * schema recusa campo desconhecido e o estado tem rota própria (`/estado`).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/carteira/rota";
import { patchDoPerfilSchema } from "@/lib/carteira/schemas";
import { atualizarPerfil, detalheDaEmpresa } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const companyId = idDoCaminho((await ctx.params).id, requestId);
    const ficha = await detalheDaEmpresa(await createClient(), ctxFromAuthz(authz, requestId), companyId);
    return ok(ficha, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const companyId = idDoCaminho((await ctx.params).id, requestId);
    const patch = await corpoValidado(req, patchDoPerfilSchema, requestId);
    const perfil = await atualizarPerfil(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyId,
      patch,
    );
    return ok(perfil, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
