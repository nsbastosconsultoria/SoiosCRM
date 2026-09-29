/**
 * PATCH /api/v1/admin/cobranca/planos/[id] — altera um plano.
 *
 * Mudar o preço NÃO reescreve fatura já lançada: a fatura guarda o próprio `amount_cents`. O
 * preço novo vale da próxima fatura em diante. Desativar (`is_active=false`) tira o plano da
 * lista de novas assinaturas, sem mexer nas que já o usam.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  COLUNAS_DO_PLANO,
  guardaDaCobranca,
  primeiraMensagem,
  respostaDoErroDeCobranca,
} from "@/lib/cobranca/rota";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const corpoSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    price_cents: z.number().int().min(0).max(1_000_000_000),
    interval_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    trial_days: z.number().int().min(0).max(365),
    is_active: z.boolean(),
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, "Nada para alterar");

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Plano não encontrado.", 404, { requestId });
  }

  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }

  const { data, error } = await guarda.db
    .from("billing_plans")
    .update({ ...lido.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUNAS_DO_PLANO)
    .maybeSingle();
  if (error) return respostaDoErroDeCobranca(error, requestId, "alterar o plano");
  if (!data) return fail("not_found", "Plano não encontrado.", 404, { requestId });

  await audit({
    action: "cobranca.plano_alterado",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    resourceType: "billing_plan",
    resourceId: id,
    requestId,
    metadata: { campos: lido.data },
  });
  return ok(data, { requestId });
}
