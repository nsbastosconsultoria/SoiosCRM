/**
 * APLICA a regra da cobrança a uma organização — o lado com I/O de `estado.ts`.
 *
 * Um só caminho para os três momentos em que a situação de uma assinatura pode mudar: a rodada
 * diária do cron `cobranca-watcher`, e as rotas de `/admin/cobranca` que lançam, dão baixa ou
 * cancelam uma fatura. Assim "paguei e continuo bloqueado até amanhã" não existe: a baixa
 * reativa na mesma requisição.
 *
 * Service role, então TODA consulta filtra `organization_id` (CLAUDE.md, anti-pattern 10). O
 * `orgId` vem de quem chama — do laço do cron sobre as assinaturas, ou da fatura que a rota do
 * administrador da plataforma leu —, nunca de corpo de requisição.
 *
 * Suspender é o MESMO `organizations.status = 'suspended'` da suspensão manual, com o mesmo
 * `tenant.suspended` na auditoria e no `event_log`: quem consome esse evento não precisa saber
 * de cobrança. Os `update` da organização são condicionados ao status de antes
 * (`eq("status", "active")` / `eq("status", "suspended")`): se alguém suspendeu ou reativou à
 * mão entre a leitura e a escrita, a cobrança não passa por cima.
 */
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";
import { FUSO_PADRAO } from "@/lib/tempo/fusos";

import {
  decidirCobranca,
  hojeNoFuso,
  type DecisaoDeCobranca,
  type FaturaFatos,
  type StatusDaAssinatura,
} from "./estado";

export interface ResultadoDaAplicacao {
  /** Houve assinatura para avaliar. */
  readonly avaliada: boolean;
  /** Algo mudou no banco (fatura, assinatura ou organização). */
  readonly efeito: boolean;
  /** A organização foi suspensa / reativada NESTA chamada (não só decidido — escrito). */
  readonly suspendeu: boolean;
  readonly reativou: boolean;
  readonly decisao: DecisaoDeCobranca | null;
}

const SEM_ASSINATURA: ResultadoDaAplicacao = {
  avaliada: false,
  efeito: false,
  suspendeu: false,
  reativou: false,
  decisao: null,
};

type ClienteAdmin = ReturnType<typeof createAdminClient>;

export async function aplicarCobranca(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  opcoes: { agora?: Date; requestId?: string; atorUserId?: string } = {},
): Promise<ResultadoDaAplicacao> {
  const agora = opcoes.agora ?? new Date();
  const hoje = hojeNoFuso(agora, FUSO_PADRAO);

  const { data: assinatura, error: erroAssinatura } = await admin
    .from("billing_subscriptions")
    .select("id, status, trial_ends_at, grace_days, suspended_by_billing")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroAssinatura) throw erroAssinatura;
  if (!assinatura) return SEM_ASSINATURA;

  const { data: faturas, error: erroFaturas } = await admin
    .from("billing_invoices")
    .select("id, due_date, status")
    .eq("organization_id", orgId)
    .eq("subscription_id", assinatura.id)
    .in("status", ["open", "overdue"]);
  if (erroFaturas) throw erroFaturas;

  const { data: org, error: erroOrg } = await admin
    .from("organizations")
    .select("id, status")
    .eq("id", orgId)
    .maybeSingle();
  if (erroOrg) throw erroOrg;
  if (!org) return SEM_ASSINATURA;

  const decisao = decidirCobranca(
    {
      status: assinatura.status as StatusDaAssinatura,
      trialEndsAt: (assinatura.trial_ends_at as string | null) ?? null,
      graceDays: assinatura.grace_days as number,
      suspensaPorCobranca: assinatura.suspended_by_billing as boolean,
    },
    ((faturas ?? []) as Array<{ id: string; due_date: string; status: string }>).map(
      (f): FaturaFatos => ({ id: f.id, dueDate: f.due_date, status: f.status as FaturaFatos["status"] }),
    ),
    org.status === "active",
    hoje,
  );

  let efeito = false;
  const agoraIso = agora.toISOString();

  if (decisao.faturasQueVenceram.length > 0) {
    const { data: vencidas, error } = await admin
      .from("billing_invoices")
      .update({ status: "overdue", updated_at: agoraIso })
      .eq("organization_id", orgId)
      .eq("status", "open")
      .in("id", decisao.faturasQueVenceram as string[])
      .select("id");
    if (error) throw error;
    if ((vencidas ?? []).length > 0) {
      efeito = true;
      await audit({
        action: "cobranca.fatura_vencida",
        organizationId: orgId,
        resourceType: "billing_invoice",
        requestId: opcoes.requestId,
        bypassedRls: true,
        metadata: { faturas: (vencidas ?? []).map((v) => v.id), hoje },
      });
    }
  }

  let suspendeuAgora = false;
  if (decisao.suspender) {
    const motivo =
      `Falta de pagamento: fatura com vencimento em ${decisao.faturaMaisAntigaEmAtraso?.dueDate} ` +
      `está ${decisao.diasDeAtraso} dias em atraso (cobrança automática).`;
    const { data: suspensa, error } = await admin
      .from("organizations")
      .update({
        status: "suspended",
        suspended_at: agoraIso,
        suspended_reason: motivo,
        suspended_by: null,
        updated_at: agoraIso,
      })
      .eq("id", orgId)
      .eq("status", "active")
      .select("id");
    if (error) throw error;
    suspendeuAgora = (suspensa ?? []).length > 0;
    if (suspendeuAgora) {
      efeito = true;
      await registrarEventoDaOrganizacao(admin, orgId, "tenant.suspended", {
        origem: "cobranca",
        motivo,
        fatura_id: decisao.faturaMaisAntigaEmAtraso?.id ?? null,
        dias_de_atraso: decisao.diasDeAtraso,
      }, opcoes);
    }
  }

  let reativouAgora = false;
  if (decisao.reativar) {
    const { data: reativada, error } = await admin
      .from("organizations")
      .update({
        status: "active",
        suspended_at: null,
        suspended_reason: null,
        suspended_by: null,
        updated_at: agoraIso,
      })
      .eq("id", orgId)
      .eq("status", "suspended")
      .select("id");
    if (error) throw error;
    reativouAgora = (reativada ?? []).length > 0;
    if (reativouAgora) {
      efeito = true;
      await registrarEventoDaOrganizacao(admin, orgId, "tenant.reactivated", {
        origem: "cobranca",
      }, opcoes);
    }
  }

  // A marca "foi a cobrança que suspendeu" só nasce quando a suspensão aconteceu AGORA, e só
  // morre quando a reativação aconteceu — ou quando a organização já não está suspensa (alguém
  // reativou à mão, e a marca velha religaria por conta própria uma suspensão futura manual).
  const marcaDepois = suspendeuAgora
    ? true
    : reativouAgora || org.status === "active"
      ? false
      : (assinatura.suspended_by_billing as boolean);

  if (decisao.novoStatus !== assinatura.status || marcaDepois !== assinatura.suspended_by_billing) {
    const { error } = await admin
      .from("billing_subscriptions")
      .update({
        status: decisao.novoStatus,
        suspended_by_billing: marcaDepois,
        updated_at: agoraIso,
      })
      .eq("organization_id", orgId)
      .eq("id", assinatura.id);
    if (error) throw error;
    efeito = true;
    if (decisao.novoStatus !== assinatura.status) {
      await audit({
        action: "cobranca.assinatura_status_alterado",
        organizationId: orgId,
        resourceType: "billing_subscription",
        resourceId: assinatura.id as string,
        requestId: opcoes.requestId,
        bypassedRls: true,
        metadata: { de: assinatura.status, para: decisao.novoStatus, dias_de_atraso: decisao.diasDeAtraso },
      });
    }
  }

  return { avaliada: true, efeito, suspendeu: suspendeuAgora, reativou: reativouAgora, decisao };
}

async function registrarEventoDaOrganizacao(
  admin: ClienteAdmin,
  orgId: string,
  evento: "tenant.suspended" | "tenant.reactivated",
  metadata: Record<string, unknown>,
  opcoes: { requestId?: string; atorUserId?: string },
): Promise<void> {
  await audit({
    action: evento,
    organizationId: orgId,
    actorUserId: opcoes.atorUserId,
    resourceType: "organization",
    resourceId: orgId,
    requestId: opcoes.requestId,
    bypassedRls: true,
    metadata: { tenant_id: orgId, ...metadata },
  });
  const { error } = await admin.from("event_log").insert({
    organization_id: orgId,
    entity_kind: "organization",
    entity_id: orgId,
    event_type: evento,
    payload: { tenant_id: orgId, ...metadata },
  });
  // O evento é para consumidores a jusante; a suspensão já aconteceu e já foi auditada.
  if (error) logger.warn("[cobranca] event_log não gravou", { evento, orgId, error: error.message });
}
