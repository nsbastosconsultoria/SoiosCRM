/**
 * Faturas de UM tenant (módulo `cobranca`, Fase 1 — lançadas à mão).
 *
 * GET  — as faturas da organização, da mais nova para a mais antiga.
 * POST — lança a PRÓXIMA fatura: valor do plano, vencimento = `current_period_end` da assinatura
 *        (ou o informado). Depois de lançar a do período corrente, a assinatura avança um
 *        intervalo do plano — é o que faz a fatura seguinte nascer com a data certa.
 *
 * `unique (subscription_id, due_date)`: o mesmo vencimento não é faturado duas vezes, e o 23505
 * vira 409 — dois cliques em "Lançar" não cobram em dobro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { somarMeses } from "@/lib/cobranca/estado";
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
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").optional(),
  amount_cents: z.number().int().min(1).max(1_000_000_000).optional(),
  instrucao_pagamento: z.string().trim().min(1).max(1000).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;
  const { id: orgId } = await ctx.params;
  if (!z.string().uuid().safeParse(orgId).success) return ok([], { requestId });

  const { data, error } = await guarda.db
    .from("billing_invoices")
    .select(COLUNAS_DA_FATURA)
    .eq("organization_id", orgId)
    .order("due_date", { ascending: false })
    .limit(100);
  if (error) return respostaDoErroDeCobranca(error, requestId, "listar as faturas");
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id: orgId } = await ctx.params;
  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }
  if (!z.string().uuid().safeParse(orgId).success) {
    return fail("not_found", "Assinatura não encontrada.", 404, { requestId });
  }

  const { data: assinatura, error: erroAssinatura } = await guarda.db
    .from("billing_subscriptions")
    .select("id, status, current_period_end, plan_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroAssinatura) return respostaDoErroDeCobranca(erroAssinatura, requestId, "ler a assinatura");
  if (!assinatura) return fail("not_found", "Esta organização não tem assinatura.", 404, { requestId });
  if (assinatura.status === "canceled") {
    return fail("state_conflict", "Assinatura cancelada não recebe fatura nova.", 409, { requestId });
  }

  const { data: plano, error: erroPlano } = await guarda.db
    .from("billing_plans")
    .select("price_cents, currency, interval_months")
    .eq("id", assinatura.plan_id as string)
    .maybeSingle();
  if (erroPlano) return respostaDoErroDeCobranca(erroPlano, requestId, "ler o plano");
  if (!plano) return fail("not_found", "Plano da assinatura não encontrado.", 404, { requestId });

  const valor = lido.data.amount_cents ?? (plano.price_cents as number);
  if (valor <= 0) {
    return fail(
      "validation_failed",
      "O plano é gratuito: informe o valor da fatura.",
      422,
      { requestId },
    );
  }

  const periodoAtual = assinatura.current_period_end as string;
  const vencimento = lido.data.due_date ?? periodoAtual;

  const { data: fatura, error } = await guarda.db
    .from("billing_invoices")
    .insert({
      organization_id: orgId,
      subscription_id: assinatura.id as string,
      amount_cents: valor,
      currency: plano.currency as string,
      due_date: vencimento,
      status: "open",
      instrucao_pagamento: lido.data.instrucao_pagamento ?? null,
      created_by: guarda.user.id,
    })
    .select(COLUNAS_DA_FATURA)
    .single();

  const ehDoPeriodoAtual = vencimento === periodoAtual;
  if (ehDoPeriodoAtual && (!error || error.code === "23505")) {
    // Avança o período. Condicionado ao valor lido: dois lançamentos simultâneos avançam uma vez
    // só. E também no 23505: se a fatura deste vencimento já existia (um lançamento anterior que
    // gravou a fatura e caiu antes de avançar), avançar agora destrava o próximo lançamento.
    await guarda.db
      .from("billing_subscriptions")
      .update({
        current_period_end: somarMeses(periodoAtual, plano.interval_months as number),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", assinatura.id as string)
      .eq("current_period_end", periodoAtual);
  }

  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", "Já existe fatura com este vencimento.", 409, { requestId });
    }
    return respostaDoErroDeCobranca(error, requestId, "lançar a fatura");
  }

  await audit({
    action: "cobranca.fatura_criada",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    organizationId: orgId,
    resourceType: "billing_invoice",
    resourceId: fatura.id as string,
    requestId,
    metadata: {
      amount_cents: valor,
      due_date: vencimento,
      com_instrucao_de_pagamento: Boolean(lido.data.instrucao_pagamento),
    },
  });

  // Uma fatura lançada com vencimento já passado entra em atraso agora, não amanhã.
  await reavaliar(orgId, requestId, guarda.user.id);
  return ok(fatura, { requestId, status: 201 });
}
