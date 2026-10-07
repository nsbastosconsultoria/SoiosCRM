/**
 * O VIGIA DA IMPLANTAÇÃO — cron diário (spec 23 §5.5). A regra mora em `lib/implantacao/vigia.ts`.
 *
 * Uma vez por dia (`docker/scheduler/entrypoint.sh`), de manhã no horário de Brasília: prazo de
 * implantação é em dias, e um aviso por dia, logo cedo, é o que a equipe consegue tratar.
 *
 * Instalação sem o módulo: a tabela não existe, o vigia responde `modulo_instalado: false` e
 * nada mais. Rodada sem efeito NÃO audita (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`);
 * a que avisou, audita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { rodarVigia } from "@/lib/implantacao/vigia";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const r = await rodarVigia(createAdminClient(), new Date(), requestId);
    if (r.avisos > 0) {
      await audit({
        action: "implantacao.atraso_avisado",
        resourceType: "implantacoes",
        requestId,
        metadata: { ...r },
      });
    }
    return ok(r, { requestId });
  } catch (e) {
    logger.error("[implantacao-watcher] rodada falhou", {
      error: e instanceof Error ? e.message : String(e),
      requestId,
    });
    return fail("internal_error", "Falha ao varrer as implantações.", 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
