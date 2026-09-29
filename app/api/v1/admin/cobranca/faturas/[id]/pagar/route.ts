/**
 * POST /api/v1/admin/cobranca/faturas/[id]/pagar — dá baixa numa fatura (Fase 1: pagamento
 * confirmado à mão, por Pix ou transferência).
 *
 * A baixa REAVALIA a assinatura na mesma requisição: se era a última fatura em atraso e foi a
 * cobrança que suspendeu, a organização volta na hora — "paguei e continuo bloqueado até amanhã"
 * não existe. A condição `status in (open, overdue)` no UPDATE faz dois cliques darem uma baixa.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  COLUNAS_DA_FATURA,
  guardaDaCobranca,
  primeiraMensagem,
  reavaliar,
  respostaDoErroDeCobranca,
} from "@/lib/cobranca/rota";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  payment_note: z.string().trim().max(500).optional(),
  /** Quando o dinheiro entrou; o padrão é agora. */
  paid_at: z.string().datetime({ offset: true }).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Fatura não encontrada.", 404, { requestId });
  }
  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }

  const agora = new Date().toISOString();
  const { data: fatura, error } = await guarda.db
    .from("billing_invoices")
    .update({
      status: "paid",
      paid_at: lido.data.paid_at ?? agora,
      payment_note: lido.data.payment_note || null,
      updated_at: agora,
    })
    .eq("id", id)
    .in("status", ["open", "overdue"])
    .select(COLUNAS_DA_FATURA)
    .maybeSingle();
  if (error) return respostaDoErroDeCobranca(error, requestId, "dar baixa na fatura");
  if (!fatura) {
    return fail("state_conflict", "Fatura não encontrada, já paga ou cancelada.", 409, { requestId });
  }

  const orgId = fatura.organization_id as string;
  await audit({
    action: "cobranca.fatura_paga",
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
