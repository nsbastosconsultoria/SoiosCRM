/**
 * PATCH /api/v1/honorarios/parcelas/[id] — COMO PAGAR a parcela (migration 0485).
 *
 * O agente financeiro de um escritório (a Sofia) precisa responder "me manda o boleto" com o que o
 * escritório OFICIALMENTE disponibilizou, e a parcela só tinha vencimento, valor e status. Este
 * campo é texto que o escritório cola — link do boleto, Pix copia-e-cola ou linha digitável —,
 * sem gateway: o módulo continua só descrevendo o contrato.
 *
 * Só esta coluna é editável aqui. Quem decide QUEM pode é a RLS da 0480: `manager`, e parcela
 * PAGA não se edita (a policy de UPDATE a filtra). Por isso "0 linhas" é resposta de negócio —
 * não existe, é de outra organização ou já foi paga —, nunca um 500.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MODULO_NAO_INSTALADO =
  "O módulo de honorários não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

/** O app novo subiu antes de o módulo ser reaplicado: a coluna ainda não existe. */
const COLUNA_AUSENTE =
  "Esta instalação ainda não recebeu o campo de como pagar a parcela. Peça ao administrador " +
  "para rodar a atualização da instalação.";

const TAMANHO_MAXIMO_DA_INSTRUCAO = 1000;

const bodySchema = z.object({
  // Vazio (ou só espaços) apaga: é "não há instrução", não "instrução em branco" — o mesmo
  // `between 1 and 1000` do CHECK da 0485.
  instrucao_pagamento: z
    .string()
    .max(TAMANHO_MAXIMO_DA_INSTRUCAO, "Use no máximo 1000 caracteres.")
    .nullable()
    .transform((v) => (v === null || v.trim() === "" ? null : v.trim())),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "honorarios_parcelas" });
  if (!authz.ok) return authz.response;
  const { id: parcelaId } = await ctx.params;
  if (!z.string().uuid().safeParse(parcelaId).success) {
    return fail("validation_failed", "Parcela inválida.", 422, { requestId });
  }

  const lido = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const instrucao = lido.data.instrucao_pagamento;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("honorarios_parcelas")
    .update({ instrucao_pagamento: instrucao })
    .eq("id", parcelaId)
    .eq("organization_id", authz.org.orgId)
    .select("id, contrato_id, numero, instrucao_pagamento")
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return fail("module_not_installed", MODULO_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "42703") {
      return fail("module_outdated", COLUNA_AUSENTE, 409, { requestId });
    }
    if (error.code === "23514") {
      return fail("validation_failed", "Use no máximo 1000 caracteres.", 422, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail(
      "not_found",
      "Parcela não encontrada, de outra organização ou já paga — parcela paga não muda.",
      404,
      { requestId },
    );
  }

  await audit({
    action: "honorarios.parcela_instrucao_alterada",
    resourceType: "honorarios_parcela",
    resourceId: data.id,
    requestId,
    metadata: {
      contrato_id: data.contrato_id,
      numero: data.numero,
      tem_instrucao: instrucao !== null,
      tamanho: instrucao?.length ?? 0,
    },
  });

  return ok(data, { requestId });
}
