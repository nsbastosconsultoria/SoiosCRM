/**
 * Planos da cobrança dos tenants (módulo `cobranca`, migration 0486).
 *
 * GET  — o catálogo de planos da instalação.
 * POST — cria um plano. Só o administrador da plataforma (guarda + RLS da provisionadora).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  COLUNAS_DO_PLANO,
  guardaDaCobranca,
  primeiraMensagem,
  respostaDoErroDeCobranca,
} from "@/lib/cobranca/rota";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao plano").max(120),
  price_cents: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
  interval_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).default(1),
  trial_days: z.number().int().min(0).max(365).default(0),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const { data, error } = await guarda.db
    .from("billing_plans")
    .select(COLUNAS_DO_PLANO)
    .order("is_active", { ascending: false })
    .order("name");
  if (error) return respostaDoErroDeCobranca(error, requestId, "listar os planos");
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const guarda = await guardaDaCobranca(requestId);
  if (!guarda.ok) return guarda.response;

  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", primeiraMensagem(lido.error.issues), 422, { requestId });
  }

  const { data, error } = await guarda.db
    .from("billing_plans")
    .insert(lido.data)
    .select(COLUNAS_DO_PLANO)
    .single();
  if (error) return respostaDoErroDeCobranca(error, requestId, "criar o plano");

  await audit({
    action: "cobranca.plano_criado",
    actorUserId: guarda.user.id,
    actingAsPlatformAdmin: true,
    resourceType: "billing_plan",
    resourceId: data.id as string,
    requestId,
    metadata: { ...lido.data },
  });
  return ok(data, { requestId, status: 201 });
}
