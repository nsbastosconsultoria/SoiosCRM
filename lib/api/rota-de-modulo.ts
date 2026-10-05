/**
 * O que toda rota de módulo (`/api/v1/carteira/*`, `/api/v1/protocolos/*`) repete: ler o corpo pelo
 * Zod e conferir o id do caminho. `ctxFromAuthz`/`handleRouteError` são os do CRM B2B — a mesma
 * forma de contexto e de erro, porque a carteira chama os handlers de empresa de lá.
 */
import { z, type ZodType } from "zod";

import { ApiError } from "@/lib/api/types";

export { ctxFromAuthz, handleRouteError, requestIdOf } from "@/lib/crm-b2b/route-helpers";

export async function corpoValidado<T>(req: Request, schema: ZodType<T>, requestId: string): Promise<T> {
  const bruto: unknown = await req.json().catch(() => undefined);
  const lido = schema.safeParse(bruto ?? {});
  if (!lido.success) {
    throw new ApiError(
      422,
      "validation_failed",
      { issues: lido.error.issues },
      requestId,
      lido.error.issues[0]?.message ?? "Dados inválidos.",
    );
  }
  return lido.data;
}

const uuid = z.string().uuid();

/** Um id de caminho que não é uuid é 404, não 500 do Postgres (22P02). */
export function idDoCaminho(valor: string, requestId: string): string {
  if (!uuid.safeParse(valor).success) {
    throw new ApiError(404, "not_found", undefined, requestId, "Não encontrado.");
  }
  return valor;
}
