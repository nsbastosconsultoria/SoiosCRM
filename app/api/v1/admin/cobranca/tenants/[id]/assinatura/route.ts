/**
 * A assinatura de UM tenant (módulo `cobranca`).
 *
 * POST  — cria a assinatura no plano escolhido. O teste grátis é do PLANO (`trial_days`, decisão
 *         de 2026-09-29): com teste, a assinatura nasce `trialing` e o primeiro vencimento é o
 *         último dia do teste; sem teste, nasce `active` e o primeiro vencimento é o informado
 *         (ou hoje). Uma assinatura CANCELADA é reaproveitada — a linha é uma por organização.
 * PATCH — troca plano, carência ou cancela. Cancelar não reativa nem suspende a organização:
 *         assinatura cancelada só deixa de ser cobrada.
 *
 * A organização vem do PATH, nunca do corpo (CLAUDE.md, multi-tenancy).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { hojeNoFuso, somarDias } from "@/lib/cobranca/estado";
import {
  COLUNAS_DA_ASSINATURA,
  guardaDaCobranca,
  primeiraMensagem,
  reavaliar,
  respostaDoErroDeCobranca,
} from "@/lib/cobranca/rota";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { FUSO_PADRAO } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");

const criarSchema = z.object({
  plan_id: z.string().uuid("Escolha um plano"),
  primeiro_vencimento: DATA.optional(),
  grace_days: z.number().int().min(0).max(60).optional(),
});

const alterarSchema = z
  .object({
    plan_id: z.string().uuid(),
    grace_days: z.number().int().min(0).max(60),
    cancelar: z.literal(true),
  })
  .partial()
  .refine((c) => Object.keys(c).length > 0, "Nada para alterar");

type Ctx = { params: Promise<{ id: string }> };

async function orgExiste(orgId: string): Promise<boolean> {
  if (!z.string().uuid().safeParse(orgId).success) return false;
  const { data } = await createAdminClient()
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id: orgId } = await ctx.params;
  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const lido = criarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }
  if (!(await orgExiste(orgId))) {
    return fail("not_found", "Organização não encontrada.", 404, { requestId });
  }

  const { data: plano, error: erroPlano } = await guarda.db
    .from("billing_plans")
    .select("id, trial_days, is_active")
    .eq("id", lido.data.plan_id)
    .maybeSingle();
  if (erroPlano) return respostaDoErroDeCobranca(erroPlano, requestId, "ler o plano");
  if (!plano || !plano.is_active) {
    return fail("validation_failed", "Plano inexistente ou desativado.", 422, { requestId });
  }

  const { data: existente, error: erroExistente } = await guarda.db
    .from("billing_subscriptions")
    .select("id, status")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroExistente) return respostaDoErroDeCobranca(erroExistente, requestId, "ler a assinatura");
  if (existente && existente.status !== "canceled") {
    return fail("state_conflict", "Esta organização já tem assinatura.", 409, { requestId });
  }

  const hoje = hojeNoFuso(new Date(), FUSO_PADRAO);
  const diasDeTeste = plano.trial_days as number;
  const fimDoTeste = diasDeTeste > 0 ? somarDias(hoje, diasDeTeste) : null;
  const linha = {
    organization_id: orgId,
    plan_id: plano.id as string,
    status: fimDoTeste ? "trialing" : "active",
    trial_ends_at: fimDoTeste,
    // Com teste, a primeira fatura vence quando o teste acaba — "o primeiro vencimento cai no
    // fim do teste" (decisão 3). Sem teste, o informado, ou hoje.
    current_period_end: fimDoTeste ?? lido.data.primeiro_vencimento ?? hoje,
    grace_days: lido.data.grace_days ?? 7,
    suspended_by_billing: false,
    canceled_at: null,
    created_by: guarda.user.id,
    updated_at: new Date().toISOString(),
  };

  const escrita = existente
    ? guarda.db
        .from("billing_subscriptions")
        .update(linha)
        .eq("organization_id", orgId)
        .eq("id", existente.id as string)
    : guarda.db.from("billing_subscriptions").insert(linha);
  const { data, error } = await escrita.select(COLUNAS_DA_ASSINATURA).single();
  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", "Esta organização já tem assinatura.", 409, { requestId });
    }
    return respostaDoErroDeCobranca(error, requestId, "criar a assinatura");
  }

  await audit({
    action: "cobranca.assinatura_criada",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    organizationId: orgId,
    resourceType: "billing_subscription",
    resourceId: data.id as string,
    requestId,
    metadata: {
      plan_id: linha.plan_id,
      status: linha.status,
      trial_ends_at: linha.trial_ends_at,
      current_period_end: linha.current_period_end,
      reaproveitou_cancelada: Boolean(existente),
    },
  });
  return ok(data, { requestId, status: 201 });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id: orgId } = await ctx.params;
  const supportDenied = await requireSupportWrite(orgId);
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const lido = alterarSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }
  if (!z.string().uuid().safeParse(orgId).success) {
    return fail("not_found", "Assinatura não encontrada.", 404, { requestId });
  }

  const { data: atual, error: erroAtual } = await guarda.db
    .from("billing_subscriptions")
    .select("id, status")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroAtual) return respostaDoErroDeCobranca(erroAtual, requestId, "ler a assinatura");
  if (!atual) return fail("not_found", "Assinatura não encontrada.", 404, { requestId });
  if (atual.status === "canceled") {
    return fail("state_conflict", "Assinatura cancelada. Crie uma nova.", 409, { requestId });
  }

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: agora };
  if (lido.data.plan_id) {
    const { data: plano } = await guarda.db
      .from("billing_plans")
      .select("id, is_active")
      .eq("id", lido.data.plan_id)
      .maybeSingle();
    if (!plano || !plano.is_active) {
      return fail("validation_failed", "Plano inexistente ou desativado.", 422, { requestId });
    }
    patch.plan_id = lido.data.plan_id;
  }
  if (lido.data.grace_days !== undefined) patch.grace_days = lido.data.grace_days;
  if (lido.data.cancelar) {
    patch.status = "canceled";
    patch.canceled_at = agora;
  }

  const { data, error } = await guarda.db
    .from("billing_subscriptions")
    .update(patch)
    .eq("organization_id", orgId)
    .eq("id", atual.id as string)
    .select(COLUNAS_DA_ASSINATURA)
    .single();
  if (error) return respostaDoErroDeCobranca(error, requestId, "alterar a assinatura");

  await audit({
    action: lido.data.cancelar ? "cobranca.assinatura_status_alterado" : "cobranca.assinatura_alterada",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    organizationId: orgId,
    resourceType: "billing_subscription",
    resourceId: atual.id as string,
    requestId,
    metadata: lido.data.cancelar
      ? { de: atual.status, para: "canceled" }
      : { campos: lido.data },
  });

  // Carência mudou: a suspensão pode ter passado a valer (ou deixado de valer) hoje mesmo.
  if (!lido.data.cancelar) await reavaliar(orgId, requestId, guarda.user.id);
  return ok(data, { requestId });
}
