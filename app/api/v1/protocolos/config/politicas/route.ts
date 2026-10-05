/**
 * PUT /api/v1/protocolos/config/politicas — cria ou atualiza a política de SLA de uma prioridade
 * (e, opcionalmente, de uma categoria). `admin`. Os prazos são do escritório: nada vem semeado.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { politicaSchema } from "@/lib/protocolos/schemas";
import { salvarPolitica } from "@/lib/protocolos/servico";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("admin", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  try {
    const corpo = await corpoValidado(req, politicaSchema, requestId);
    const r = await salvarPolitica(await createClient(), ctxFromAuthz(authz, requestId), corpo);
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "protocolos.config_alterada",
      resourceType: "organizations",
      resourceId: authz.org.orgId,
      requestId,
      metadata: { campo: "politica", prioridade: corpo.prioridade, categoria_id: corpo.categoria_id ?? null },
    });
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
