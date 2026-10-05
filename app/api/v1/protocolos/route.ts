/**
 * GET/POST /api/v1/protocolos — a fila de protocolos e a abertura (spec 22 §5, §12).
 *
 * GET (`viewer`): visões `minha`, `fila`, `vencendo` e `todos`, pela sessão (a RLS recorta a
 * organização). POST (`agent`): abre — ou, se já houver um aberto para o mesmo pedido da mesma
 * empresa, acrescenta a informação nele (`deduplicado: true`, 200 em vez de 201).
 *
 * Módulo opcional: antes de instalado, 409 `module_not_installed`.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { corpoValidado, ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/api/rota-de-modulo";
import { PRIORIDADES } from "@/lib/protocolos/prioridade";
import { abrirSchema } from "@/lib/protocolos/schemas";
import { abrirProtocolo, listarProtocolos } from "@/lib/protocolos/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const filtrosSchema = z.object({
  visao: z.enum(["minha", "fila", "vencendo", "todos"]).default("minha"),
  area: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
  prioridade: z.enum(PRIORIDADES).optional(),
  company_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const authz = await requireRole("viewer", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;

  try {
    const lido = filtrosSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    const f = lido.success ? lido.data : filtrosSchema.parse({});
    const protocolos = await listarProtocolos(await createClient(), ctxFromAuthz(authz, requestId), authz.user.id, {
      visao: f.visao,
      area: f.area,
      prioridade: f.prioridade,
      company_id: f.company_id,
      limite: f.limit,
    });
    return ok(protocolos, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("agent", { requestId, resource: "protocolos" });
  if (!authz.ok) return authz.response;

  try {
    const entrada = await corpoValidado(req, abrirSchema, requestId);
    const r = await abrirProtocolo(
      await createClient(),
      createAdminClient(),
      ctxFromAuthz(authz, requestId),
      { userId: authz.user.id, kind: "humano", role: authz.org.role },
      "humano",
      entrada,
    );
    return ok(r, { requestId, status: r.deduplicado ? 200 : 201 });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
