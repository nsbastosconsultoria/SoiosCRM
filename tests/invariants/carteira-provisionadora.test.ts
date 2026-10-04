/**
 * Carteira de empresas — módulo opcional via ADR-0002 (migration 0902, spec 21).
 *
 * O molde cobre forma (D4) e efeito: provisionar cria exatamente as seis tabelas, protegidas,
 * e o núcleo fica intocado. `protecaoPropria` em todas porque a RLS é por OPERAÇÃO (leitura da
 * organização, escrita por papel, contexto que herda a visibilidade da conversa) e é ligada
 * dentro da própria função — `fn_proteger_tabelas_de_organizacao()` só enxerga tabela com RLS
 * desligada, então nenhuma delas ganha a policy ampla, nem deveria.
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

moldeDeProvisionadora({
  modulo: "carteira",
  tabelas: [
    "carteira_grupos",
    "carteira_perfis",
    "carteira_vinculos",
    "carteira_responsaveis",
    "carteira_contexto_conversa",
    "carteira_eventos",
  ],
  protecaoPropria: [
    "carteira_grupos",
    "carteira_perfis",
    "carteira_vinculos",
    "carteira_responsaveis",
    "carteira_contexto_conversa",
    "carteira_eventos",
  ],
});
