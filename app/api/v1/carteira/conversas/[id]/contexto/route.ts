/**
 * GET/POST /api/v1/carteira/conversas/:id/contexto — de qual empresa é a conversa (spec 21 §4.6).
 *
 * GET (`viewer`): as empresas da pessoa da conversa e a empresa corrente, pela sessão — quem não
 * enxerga a conversa recebe 404.
 * POST (`agent`): a pessoa da tela troca a empresa (ou limpa, com `company_id: null`). Atendente
 * aponta qualquer empresa da organização; o assistente, pela ferramenta, só as ligadas à pessoa.
 * Trocar fecha o período anterior e abre outro: nada do que já foi tratado muda de empresa.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/carteira/rota";
import { contextoSchema } from "@/lib/carteira/schemas";
import { contextoDaConversa, definirContextoPelaTela } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const conversationId = idDoCaminho((await ctx.params).id, requestId);
    const contexto = await contextoDaConversa(await createClient(), ctxFromAuthz(authz, requestId), conversationId);
    return ok(contexto, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const conversationId = idDoCaminho((await ctx.params).id, requestId);
    const { company_id } = await corpoValidado(req, contextoSchema, requestId);
    const resultado = await definirContextoPelaTela(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      conversationId,
      company_id,
    );
    return ok(resultado, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
