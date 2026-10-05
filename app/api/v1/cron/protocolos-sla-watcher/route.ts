/**
 * O VIGIA DE PRAZO DOS PROTOCOLOS — cron (spec 22 §10.5). A regra mora em `lib/protocolos/vigia.ts`.
 *
 * A cada 5 minutos (`docker/scheduler/entrypoint.sh`): um P1 com prazo de 1 hora não pode esperar
 * a varredura de hora em hora do `case-stale-watcher` para ser lembrado — o aviso de 80% chegaria
 * depois do vencimento.
 *
 * Instalação sem o módulo protocolos: a tabela não existe, o vigia responde `modulo_instalado:
 * false` e nada mais — não é erro, é o estado de quem não usa. Rodada sem efeito NÃO audita
 * (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`); a que avisou, audita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { rodarVigia } from "@/lib/protocolos/vigia";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const r = await rodarVigia(createAdminClient(), new Date(), requestId);
    if (r.avisos > 0 || r.sem_dono > 0 || r.marcos_registrados > 0) {
      await audit({
        action: "protocolos.sla_avisado",
        resourceType: "protocolos",
        requestId,
        metadata: { ...r },
      });
    }
    return ok(r, { requestId });
  } catch (e) {
    logger.error("[protocolos-sla-watcher] rodada falhou", {
      error: e instanceof Error ? e.message : String(e),
      requestId,
    });
    return fail("internal_error", "Falha ao varrer os prazos dos protocolos.", 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
