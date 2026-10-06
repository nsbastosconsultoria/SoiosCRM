import "server-only";

import { z } from "zod";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { SQL_ERRORS } from "@/lib/extensions/erros-do-banco";
import { ExtensionServiceError } from "@/lib/extensions/http";

import { CATALOGO_DE_MODULOS, moduloDoCatalogo } from "./catalogo";

const operationRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.string(),
  actor_id: z.string().uuid().nullable(),
  name: z.string().nullable(),
  result: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
});

const appliedSchema = z.object({ applied_now: z.boolean() });

export interface ModuloInstaladoView {
  modulo: string;
  estado: "ativo" | "suspenso";
  instalado_em: string;
  reaplicado_em: string | null;
  motivo_suspensao: string | null;
}

export interface ModuloInstalarResultado {
  operationId: string;
  appliedNow: boolean;
}

/** Mesmo mapeamento de código de erro do banco → mensagem pública que as extensões usam: os dois
 * mecanismos passam pelo mesmo livro de recibos (`extension_operations`) e pelas mesmas funções
 * `fn_extensions_*` por baixo, então os códigos `extension_*` são os que `fn_modulo_instalar`
 * também levanta. */
function dbFailure(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const known = error.code === "P0001" && error.message ? SQL_ERRORS[error.message] : undefined;
  if (known && error.message) {
    throw new ExtensionServiceError(error.message, known.message, known.status);
  }
  logger.warn("[modulos] falha do banco sem código conhecido", {
    db_code: error.code ?? null,
    detail: (error.message ?? "").slice(0, 200),
  });
  throw new ExtensionServiceError(
    "upstream_unavailable",
    "Não foi possível confirmar o resultado. Consulte o histórico antes de repetir o pedido.",
    503,
  );
}

/**
 * Os módulos de que este depende precisam estar instalados e ATIVOS (spec 23 §11.1). A
 * provisionadora também recusa no banco; aqui a recusa chega antes, com o nome do que falta, em
 * vez do erro técnico de dentro da instalação.
 */
async function exigirModulosRequeridos(admin: ReturnType<typeof createAdminClient>, modulo: string): Promise<void> {
  const requer = moduloDoCatalogo(modulo)?.requer ?? [];
  if (requer.length === 0) return;
  const { data, error } = await admin
    .from("modulos_instalados")
    .select("modulo")
    .in("modulo", [...requer])
    .eq("estado", "ativo");
  dbFailure(error);
  const ativos = new Set(((data ?? []) as Array<{ modulo: string }>).map((m) => m.modulo));
  const faltam = requer.filter((r) => !ativos.has(r));
  if (faltam.length > 0) {
    throw requerOutro(faltam);
  }
}

function requerOutro(faltam: readonly string[]): ExtensionServiceError {
  const nomes = faltam.map((r) => moduloDoCatalogo(r)?.nome ?? r).join(", ");
  return new ExtensionServiceError(
    "modulo_requer_outro",
    `Instale antes: ${nomes}. Este módulo depende dele para funcionar.`,
    409,
  );
}

/** O catálogo (vitrine) cruzado com o que já está instalado nesta instância. */
export async function listarModulos(): Promise<{
  disponiveis: typeof CATALOGO_DE_MODULOS;
  instalados: ModuloInstaladoView[];
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("modulos_instalados")
    .select("modulo, estado, instalado_em, reaplicado_em, motivo_suspensao")
    .order("modulo", { ascending: true });
  dbFailure(error);
  return { disponiveis: CATALOGO_DE_MODULOS, instalados: (data ?? []) as ModuloInstaladoView[] };
}

/**
 * Instala um módulo NA INSTÂNCIA (ADR-0002, D3) — nunca numa organização. Idempotente pela
 * chave de operação: repetir com a mesma chave devolve o mesmo recibo sem reexecutar.
 */
export async function instalarModulo(
  actorId: string,
  operationId: string,
  modulo: string,
): Promise<ModuloInstalarResultado> {
  if (!moduloDoCatalogo(modulo)) {
    throw new ExtensionServiceError(
      "extension_module_unknown",
      SQL_ERRORS.extension_module_unknown!.message,
      SQL_ERRORS.extension_module_unknown!.status,
    );
  }

  const admin = createAdminClient();
  await exigirModulosRequeridos(admin, modulo);
  const resultado = await admin.rpc("fn_modulo_instalar", {
    p_actor: actorId,
    p_operation: operationId,
    p_modulo: modulo,
  });
  // A provisionadora também recusa sem o módulo requerido (`<modulo>_exige_<outro>`, ex.:
  // `implantacao_exige_carteira`, 0907) — a corrida entre a conferência acima e a instalação.
  // O código não é `extension_*` (não mora em SQL_ERRORS); vira a mesma recusa explicada.
  if (resultado.error?.code === "P0001" && resultado.error.message === `${modulo}_exige_${moduloDoCatalogo(modulo)?.requer?.[0]}`) {
    throw requerOutro(moduloDoCatalogo(modulo)?.requer ?? []);
  }
  dbFailure(resultado.error);

  const receipt = operationRowSchema.parse(resultado.data);
  const applied = appliedSchema.parse(resultado.data).applied_now;

  if (applied) {
    await audit({
      action: "modulo.instalado",
      actorUserId: actorId,
      actingAsPlatformAdmin: true,
      resourceType: "modulos_instalados",
      resourceId: receipt.id,
      metadata: { modulo, operation_id: receipt.id },
    });
  }

  return { operationId: receipt.id, appliedNow: applied };
}
