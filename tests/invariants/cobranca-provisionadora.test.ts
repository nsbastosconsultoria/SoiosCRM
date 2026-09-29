/**
 * Cobrança dos tenants — módulo opcional via ADR-0002 (migration 0486).
 *
 * O molde cobra forma (D4) e efeito: provisionar cria exatamente as três tabelas, com RLS ligada
 * e `anon` sem privilégio, e o núcleo fica intocado. As três são `protecaoPropria` porque a RLS
 * é por PAPEL e ligada dentro da função — escrita só do administrador da plataforma —, e
 * `billing_plans` nem tem `organization_id` (o catálogo é da instalação).
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "cobranca",
  tabelas: ["billing_plans", "billing_subscriptions", "billing_invoices"],
  protecaoPropria: ["billing_plans", "billing_subscriptions", "billing_invoices"],
});
