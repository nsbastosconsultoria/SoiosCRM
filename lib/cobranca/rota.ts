/**
 * O que as rotas de `/api/v1/admin/cobranca` têm em comum: a guarda, o cliente e as respostas de
 * "módulo não instalado".
 *
 * ⚠️ AS TABELAS DA COBRANÇA SÃO LIDAS E ESCRITAS PELO CLIENTE DO USUÁRIO, NÃO PELA SERVICE ROLE.
 * A RLS da provisionadora (migration 0486) só deixa o administrador da PLATAFORMA escrever — então
 * ela é uma segunda guarda por baixo de `requirePlatformAdmin()`, e não um detalhe contornado. A
 * service role só entra em `aplicarCobranca`, que precisa suspender/reativar a organização.
 */
import type { User } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { aplicarCobranca, type ResultadoDaAplicacao } from "./aplicar";
import { moduloDeCobrancaAusente } from "./modulo";

export const MODULO_DE_COBRANCA_NAO_INSTALADO =
  "O módulo de cobrança não está instalado nesta instalação. Instale em Módulos, no menu da " +
  "administração da plataforma.";

export const COLUNAS_DO_PLANO =
  "id, name, price_cents, currency, interval_months, trial_days, is_active, created_at, updated_at";

export const COLUNAS_DA_ASSINATURA =
  "id, organization_id, plan_id, status, trial_ends_at, current_period_end, grace_days, suspended_by_billing, canceled_at, created_at, updated_at";

export const COLUNAS_DA_FATURA =
  "id, organization_id, subscription_id, amount_cents, currency, due_date, status, paid_at, payment_note, instrucao_pagamento, created_at, updated_at";

export type GuardaDaCobranca =
  | { ok: true; user: User; db: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: Response };

export async function guardaDaCobranca(requestId: string): Promise<GuardaDaCobranca> {
  try {
    const ctx = await requirePlatformAdmin();
    return { ok: true, user: ctx.user, db: await createClient() };
  } catch {
    // `requirePlatformAdmin` redireciona (lança NEXT_REDIRECT) quando não é admin da plataforma;
    // numa rota de API isso vira 403, no mesmo desenho de `admin/tenants/[id]/suspend`.
    return { ok: false, response: fail("forbidden", "Platform admin required", 403, { requestId }) };
  }
}

/** A resposta para um erro do banco numa rota da cobrança. */
export function respostaDoErroDeCobranca(
  error: { code?: string | null; message?: string },
  requestId: string,
  contexto: string,
): Response {
  if (moduloDeCobrancaAusente(error)) {
    return fail("module_not_installed", MODULO_DE_COBRANCA_NAO_INSTALADO, 409, { requestId });
  }
  if (error.code === "23503") {
    return fail("validation_failed", "Referência inválida (plano ou organização).", 422, { requestId });
  }
  if (error.code === "23514") {
    return fail("validation_failed", "Valor fora do permitido.", 422, { requestId });
  }
  return fail("internal_error", `Falha ao ${contexto}.`, 500, { requestId });
}

/** A primeira mensagem do Zod, para o 422. */
export function primeiraMensagem(issues: ReadonlyArray<{ message: string }>): string {
  return issues[0]?.message ?? "corpo inválido";
}

/**
 * Reavalia a assinatura depois de o administrador mexer nela — é o que faz "paguei" reativar na
 * mesma requisição, sem esperar o cron do dia seguinte. Falhar aqui NÃO desfaz a escrita que já
 * aconteceu: a próxima rodada do `cobranca-watcher` chega ao mesmo veredito.
 */
export async function reavaliar(
  orgId: string,
  requestId: string,
  atorUserId: string,
): Promise<ResultadoDaAplicacao | null> {
  try {
    return await aplicarCobranca(createAdminClient(), orgId, { requestId, atorUserId });
  } catch (e) {
    logger.warn("[cobranca] reavaliação falhou", {
      orgId,
      requestId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
