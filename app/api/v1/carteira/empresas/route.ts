/**
 * GET/POST /api/v1/carteira/empresas — a carteira de empresas (spec 21 §9).
 *
 * Módulo opcional (ADR-0002): antes de instalado, as tabelas não existem e a leitura devolve
 * 409 `module_not_installed` com a mensagem de quem resolve (o administrador da instalação).
 *
 * GET é `viewer`. POST (pôr uma empresa na carteira, criando-a pelo CNPJ se preciso) é
 * `manager`, o mesmo degrau que o núcleo exige para criar empresa e a RLS da 0902 para criar
 * perfil. `estado_inicial = 'ativo'` passa pela função de transição — a única porta do estado.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { adicionarEmpresa, listarCarteira } from "@/lib/carteira/servico";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/carteira/rota";
import { empresaNovaSchema, estadoSchema } from "@/lib/carteira/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const params = req.nextUrl.searchParams;
    const estadoBruto = params.get("estado");
    const estado = estadoBruto ? estadoSchema.safeParse(estadoBruto) : null;
    const resultado = await listarCarteira(await createClient(), ctxFromAuthz(authz, requestId), {
      estado: estado?.success ? estado.data : undefined,
      q: params.get("q") ?? undefined,
      limite: Number(params.get("limit") ?? "50") || 50,
    });
    return ok(resultado.empresas, { requestId, meta: { has_more: resultado.tem_mais } });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;

  try {
    const corpo = await corpoValidado(req, empresaNovaSchema, requestId);
    const perfil = await adicionarEmpresa(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      corpo,
    );
    return ok(perfil, { requestId, status: 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
