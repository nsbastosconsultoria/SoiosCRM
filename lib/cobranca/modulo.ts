/**
 * O módulo `cobranca` não está instalado nesta instalação?
 *
 * As tabelas nascem por `fn_cobranca_provisionar()` (ADR-0002): numa instalação que nunca ligou o
 * módulo, elas não existem, e a consulta volta com `42P01` (Postgres) ou `PGRST205` (o PostgREST
 * não achou a tabela no cache de schema). Isso não é falha — é o estado comum de quem não cobra
 * ninguém.
 */
export function moduloDeCobrancaAusente(erro: { code?: string | null } | null | undefined): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}
