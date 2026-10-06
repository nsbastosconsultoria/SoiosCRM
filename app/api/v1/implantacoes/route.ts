/**
 * GET/POST /api/v1/implantacoes — a lista de implantações e o início (spec 23 §8).
 *
 * GET (`viewer`): em andamento por padrão, com as visões `minhas`, `atrasadas` e
 * `aguardando_cliente`; com `company_id`, todas as da empresa (o cartão da carteira). POST
 * (`manager`): inicia — sem `modelo_id`, o modelo padrão. Já havendo uma em andamento para a
 * empresa, devolve ela (`criada: false`, 200 em vez de 201).
 *
 * Módulo opcional: antes de instalado, 409 `module_not_installed`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { iniciarSchema } from "@/lib/implantacao/schemas";
import { iniciarImplantacao, listarImplantacoes } from "@/lib/implantacao/servico";
import { ESTADOS_DA_IMPLANTACAO } from "@/lib/implantacao/vocabulario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const filtrosSchema = z.object({
  estado: z.enum(ESTADOS_DA_IMPLANTACAO).optional(),
  visao: z.enum(["todas", "minhas", "atrasadas", "aguardando_cliente"]).default("todas"),
  company_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const lido = filtrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    const f = lido.success ? lido.data : filtrosSchema.parse({});
    const linhas = await listarImplantacoes(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, {
      estado: f.estado,
      visao: f.visao,
      company_id: f.company_id,
      limite: f.limit,
    });
    return ok(linhas, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "implantacao" });
  if (!authz.ok) return authz.response;
  try {
    const entrada = await corpoValidado(req, iniciarSchema, requestId);
    const r = await iniciarImplantacao(createAdminClient(), ctxFromAuthz(authz, requestId), { userId: authz.user.id, role: authz.org.role }, entrada);
    return ok(r, { requestId, status: r.criada ? 201 : 200 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
