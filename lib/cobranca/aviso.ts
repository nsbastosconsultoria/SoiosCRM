/**
 * O AVISO DE COBRANÇA para o tenant: a faixa de `/app` durante a carência e o quadro da tela de
 * conta suspensa. Só leitura, e NUNCA lança — roda no layout de `/app`, e um throw ali é 500 em
 * todas as telas por causa de um aviso.
 *
 * Instalação sem o módulo `cobranca` (o caso comum): a tabela não existe. A resposta é lembrada
 * por alguns minutos no PROCESSO, para o layout não pagar uma ida ao banco em toda tela só para
 * ouvir de novo que o módulo não está lá. Instalar o módulo passa a valer em até esse tempo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { FUSO_PADRAO } from "@/lib/tempo/fusos";

import { diasEntre, hojeNoFuso, somarDias } from "./estado";
import { moduloDeCobrancaAusente } from "./modulo";

export interface AvisoDeCobranca {
  readonly situacao: "past_due" | "suspended";
  /** Vencimento da fatura em atraso mais antiga. */
  readonly vencimento: string;
  readonly diasDeAtraso: number;
  /** O primeiro dia em que a suspensão acontece, se nada for pago (só em `past_due`). */
  readonly suspendeEm: string | null;
  readonly valorCents: number;
  readonly moeda: string;
  /** Como pagar — o texto que o administrador da plataforma colou na fatura. */
  readonly instrucao: string | null;
}

const MEMO_DO_MODULO_AUSENTE_MS = 5 * 60_000;
let moduloAusenteAte = 0;

/** Só para os testes: esquece o que o processo lembrou. */
export function esquecerMemoDoAviso(): void {
  moduloAusenteAte = 0;
}

export async function avisoDeCobranca(
  db: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
): Promise<AvisoDeCobranca | null> {
  if (Date.now() < moduloAusenteAte) return null;
  try {
    const { data: assinatura, error } = await db
      .from("billing_subscriptions")
      .select("status, grace_days, suspended_by_billing")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) {
      if (moduloDeCobrancaAusente(error)) moduloAusenteAte = Date.now() + MEMO_DO_MODULO_AUSENTE_MS;
      else logger.warn("[cobranca] aviso: leitura da assinatura falhou", { orgId, codigo: error.code });
      return null;
    }
    if (!assinatura) return null;
    const situacao = assinatura.status as string;
    // Suspensa à mão não é assunto de cobrança: o quadro de fatura só aparece quando foi ela.
    if (situacao !== "past_due" && !(situacao === "suspended" && assinatura.suspended_by_billing)) {
      return null;
    }

    const { data: faturas, error: erroFaturas } = await db
      .from("billing_invoices")
      .select("due_date, amount_cents, currency, instrucao_pagamento")
      .eq("organization_id", orgId)
      .in("status", ["open", "overdue"])
      .order("due_date", { ascending: true })
      .limit(1);
    if (erroFaturas) {
      logger.warn("[cobranca] aviso: leitura das faturas falhou", { orgId, codigo: erroFaturas.code });
      return null;
    }
    const fatura = faturas?.[0];
    if (!fatura) return null;

    const vencimento = fatura.due_date as string;
    const hoje = hojeNoFuso(agora, FUSO_PADRAO);
    const carencia = assinatura.grace_days as number;
    return {
      situacao: situacao as AvisoDeCobranca["situacao"],
      vencimento,
      diasDeAtraso: Math.max(0, diasEntre(vencimento, hoje) ?? 0),
      // Carência 7, vencimento dia 10: dias 11 a 17 são aviso, dia 18 suspende (estado.ts).
      suspendeEm: situacao === "past_due" ? somarDias(vencimento, carencia + 1) : null,
      valorCents: fatura.amount_cents as number,
      moeda: fatura.currency as string,
      instrucao: (fatura.instrucao_pagamento as string | null) ?? null,
    };
  } catch (erro) {
    logger.warn("[cobranca] aviso: falhou", {
      orgId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
