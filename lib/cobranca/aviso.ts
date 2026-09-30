/**
 * O AVISO DE COBRANÇA para o tenant: a faixa de `/app` durante a carência e o quadro da tela de
 * conta suspensa. Só leitura, e NUNCA lança — roda no layout de `/app`, e um throw ali é 500 em
 * todas as telas por causa de um aviso.
 *
 * Instalação sem o módulo `cobranca` (o caso comum): a tabela não existe, e o PostgREST responde
 * `PGRST205` pelo cache de schema — sem tocar em tabela — e o aviso é `null`.
 *
 * ⚠️ SEM MEMO DE "MÓDULO AUSENTE", DE PROPÓSITO. A versão anterior lembrava a ausência por alguns
 * minutos no processo, e a instalação não conseguia apagar a lembrança: a rota que instala
 * (`app/api/v1/modulos/instalar`) e o layout de `/app` rodam em camadas diferentes do Next, cada
 * uma com a sua cópia do módulo. Medido pela `tests/e2e/cobranca-dos-tenants.spec.ts`: o dono
 * visitava `/app` antes de instalar, e a empresa em atraso ficava sem faixa depois.
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

export async function avisoDeCobranca(
  db: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
): Promise<AvisoDeCobranca | null> {
  try {
    const { data: assinatura, error } = await db
      .from("billing_subscriptions")
      .select("status, grace_days, suspended_by_billing")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) {
      if (!moduloDeCobrancaAusente(error)) logger.warn("[cobranca] aviso: leitura da assinatura falhou", { orgId, codigo: error.code });
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
