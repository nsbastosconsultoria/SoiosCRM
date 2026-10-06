/**
 * POST /api/v1/protocolos/:id/cliente — a equipe fala com o cliente pela ficha, e a IA leva a
 * mensagem (spec 22 §6). `agent`. Corpo: `{ acao: "pedir_informacao" | "avisar_resolvido", texto }`.
 *
 * A regra mora em `lib/protocolos/falar-com-cliente.ts`: abre um caso curto ligado ao protocolo,
 * já respondido, enfileira o `case_reply_turn` (tudo numa transação `pg`) e muda o estado do
 * protocolo. Recusas: 409 `conversa_com_pessoa` (handoff — responda pela inbox), 409
 * `conversa_com_chamado_aberto`, 409 `protocolo_transicao_invalida`, 422 `protocolo_sem_conversa`.
 */
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { traduzir } from "@/lib/i18n/dicionario";
import { falarComCliente, falarComClienteSchema } from "@/lib/protocolos/falar-com-cliente";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  let pool: ReturnType<typeof getRequestPool>;
  try {
    pool = getRequestPool();
  } catch {
    return fail("unavailable", t("Falar com o cliente pela IA está indisponível nesta instalação."), 503, { requestId });
  }
  try {
    const id = idDoCaminho((await ctx.params).id, requestId);
    const entrada = await corpoValidado(req, falarComClienteSchema, requestId);
    const r = await falarComCliente(
      pool,
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, role: authz.org.role },
      id,
      entrada,
    );
    return ok(r, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
