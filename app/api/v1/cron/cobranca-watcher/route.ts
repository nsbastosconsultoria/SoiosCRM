/**
 * Cobrança dos tenants — a rodada diária (módulo `cobranca`, Fase 1).
 *
 * Para cada assinatura não cancelada, aplica a regra de `lib/cobranca/estado.ts`: fatura em
 * aberto que passou do vencimento vira `overdue`, a assinatura vai a `past_due`, e depois da
 * carência (7 dias por padrão) a organização é suspensa — o mesmo `status = 'suspended'` da
 * suspensão manual, que tira as telas e deixa WhatsApp e IA atendendo.
 *
 * Quem executa é `aplicarCobranca`, o MESMO caminho das rotas de `/admin/cobranca`. Esta rota só
 * percorre as organizações. Ela não audita: quem audita é `aplicarCobranca`, e só quando houve
 * efeito (CLAUDE.md §Audit log).
 *
 * Instalação sem o módulo: as tabelas não existem, e a resposta é `modulo_instalado: false` —
 * não é erro, é o estado de quem não cobra ninguém.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { aplicarCobranca } from "@/lib/cobranca/aplicar";
import { moduloDeCobrancaAusente } from "@/lib/cobranca/modulo";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // Varredura da instalação inteira: o cron não age em nome de tenant nenhum. O `organization_id`
  // de cada linha é a fonte confiável que `aplicarCobranca` usa para filtrar tudo o mais.
  const { data: assinaturas, error } = await admin
    .from("billing_subscriptions")
    .select("organization_id")
    .neq("status", "canceled");

  if (error) {
    if (moduloDeCobrancaAusente(error)) {
      return ok({ modulo_instalado: false, avaliadas: 0, com_efeito: 0, falharam: 0 }, { requestId });
    }
    logger.error("[cobranca-watcher] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar assinaturas.", 500, { requestId });
  }

  let avaliadas = 0;
  let comEfeito = 0;
  let suspensas = 0;
  let reativadas = 0;
  let falharam = 0;

  for (const linha of assinaturas ?? []) {
    const orgId = linha.organization_id as string;
    try {
      const r = await aplicarCobranca(admin, orgId, { requestId });
      if (r.avaliada) avaliadas += 1;
      if (r.efeito) comEfeito += 1;
      if (r.suspendeu) suspensas += 1;
      if (r.reativou) reativadas += 1;
    } catch (e) {
      // Uma organização que falha não trava as outras: a próxima rodada tenta de novo.
      falharam += 1;
      logger.error("[cobranca-watcher] organização falhou", {
        organization_id: orgId,
        error: e instanceof Error ? e.message : String(e),
        requestId,
      });
    }
  }

  return ok(
    {
      modulo_instalado: true,
      avaliadas,
      com_efeito: comEfeito,
      suspensas,
      reativadas,
      falharam,
    },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
