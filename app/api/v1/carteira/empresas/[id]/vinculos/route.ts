/**
 * POST /api/v1/carteira/empresas/:id/vinculos — liga um contato à empresa (spec 21 §4.4).
 *
 * O vínculo é o do NÚCLEO: contato → pessoa (`contacts.person_id`) → `company_people`. O contato
 * sem pessoa ganha uma; a pessoa sem vínculo com a empresa ganha o `company_people`; e o módulo
 * grava o detalhe (papel, áreas). `manager`, porque inserir em `company_people` é `manager`+ na
 * RLS do núcleo (0239) — a rota não promete o que o banco recusaria.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/carteira/rota";
import { vinculoNovoSchema } from "@/lib/carteira/schemas";
import { vincularContato } from "@/lib/carteira/servico";
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
    const corpo = await corpoValidado(req, vinculoNovoSchema, requestId);
    const vinculo = await vincularContato(
      await createClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyId,
      corpo,
    );
    return ok(vinculo, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
