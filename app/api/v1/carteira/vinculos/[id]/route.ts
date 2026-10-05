/**
 * PATCH /api/v1/carteira/vinculos/:company_people_id — papel, áreas e ativo de um vínculo
 * (spec 21 §4.4). `agent`, o mesmo degrau que o núcleo exige para editar `company_people`.
 *
 * O id é o do `company_people` (núcleo). Vínculo criado pela tela de Pessoas ainda não tem
 * detalhe: este PATCH o cria. Desativar é `ativo: false` — nada se apaga.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { patchDoVinculoSchema } from "@/lib/carteira/schemas";
import { atualizarVinculo } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const companyPeopleId = idDoCaminho((await ctx.params).id, requestId);
    const patch = await corpoValidado(req, patchDoVinculoSchema, requestId);
    const detalhe = await atualizarVinculo(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyPeopleId,
      patch,
    );
    return ok(detalhe, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
