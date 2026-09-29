/**
 * POST /api/v1/admin/cobranca/faturas/[id]/cancelar — cancela uma fatura em aberto ou em atraso
 * (lançada errado, ou perdoada). Fatura cancelada não conta como atraso, então cancelar a última
 * que estava em atraso reativa a organização que a cobrança suspendeu — pela mesma reavaliação
 * da baixa.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  COLUNAS_DA_FATURA,
  guardaDaCobranca,
  reavaliar,
  respostaDoErroDeCobranca,
} from "@/lib/cobranca/rota";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Fatura não encontrada.", 404, { requestId });
  }

  const { data: fatura, error } = await guarda.db
    .from("billing_invoices")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["open", "overdue"])
    .select(COLUNAS_DA_FATURA)
    .maybeSingle();
  if (error) return respostaDoErroDeCobranca(error, requestId, "cancelar a fatura");
  if (!fatura) {
    return fail("state_conflict", "Fatura não encontrada, já paga ou cancelada.", 409, { requestId });
  }

  const orgId = fatura.organization_id as string;
  await audit({
    action: "cobranca.fatura_cancelada",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    organizationId: orgId,
    resourceType: "billing_invoice",
    resourceId: id,
    requestId,
    metadata: { amount_cents: fatura.amount_cents, due_date: fatura.due_date },
  });

  const r = await reavaliar(orgId, requestId, guarda.user.id);
  return ok({ ...fatura, organizacao_reativada: r?.reativou ?? false }, { requestId });
}
