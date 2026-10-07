/**
 * POST /api/v1/carteira/empresas/:id/estado — muda o estado do relacionamento (spec 21 §4.2).
 *
 * `manager`. A tabela de transições mora em `fn_carteira_transicionar` (migration 0902), que só
 * o service role executa: a rota autentica e passa a organização do cookie e o usuário como
 * ator. Transição fora da tabela → 409 `carteira_transicao_invalida`; a mesma transição duas
 * vezes → 200 com `alterado: false`, sem auditar.
 *
 * Com o módulo implantacao (spec 23 Q2): ir para `ativo` com implantação em andamento e item
 * obrigatório aberto é atalho por fora da trava — só `admin`, e só com
 * `confirmar_implantacao_aberta: true`. Sem a confirmação, 409 `implantacao_em_andamento` com a
 * contagem; gestor, 403 `implantacao_em_andamento_exige_admin`.
 */
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { obrigatoriosAbertosDaEmpresa } from "@/lib/implantacao/servico";
import { corpoValidado, ctxFromAuthz, handleRouteError, idDoCaminho, requestIdOf } from "@/lib/api/rota-de-modulo";
import { transicaoSchema } from "@/lib/carteira/schemas";
import { transicionar } from "@/lib/carteira/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const companyId = idDoCaminho((await ctx.params).id, requestId);
    const { estado, confirmar_implantacao_aberta } = await corpoValidado(req, transicaoSchema, requestId);
    const admin = createAdminClient();
    if (estado === "ativo") {
      const pendente = await obrigatoriosAbertosDaEmpresa(admin, authz.org.orgId, companyId);
      if (pendente && pendente.abertos > 0) {
        if (!roleAtLeast(authz.org.role, "admin")) {
          return fail(
            "implantacao_em_andamento_exige_admin",
            `A implantação desta empresa ainda tem ${pendente.abertos} item(ns) obrigatório(s) aberto(s). Conclua a implantação, ou peça a um administrador.`,
            403,
            { requestId },
          );
        }
        if (!confirmar_implantacao_aberta) {
          return fail(
            "implantacao_em_andamento",
            `A implantação desta empresa ainda tem ${pendente.abertos} item(ns) obrigatório(s) aberto(s). Confirme para ativar mesmo assim.`,
            409,
            { requestId, details: { abertos: pendente.abertos, implantacao_id: pendente.implantacao_id } },
          );
        }
      }
    }
    const resultado = await transicionar(
      admin,
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      companyId,
      estado,
    );
    return ok(resultado, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
