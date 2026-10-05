/**
 * Quem escreve já é cliente? — o resolvedor de relacionamento da carteira (spec 21 §5).
 *
 * Lido UMA vez por turno pelo roteador (regra 0, `resolve-turn-agent.ts`), antes do classificador.
 * O caminho é o do núcleo: conversa → contato → `contacts.person_id` → `company_people`, e de cada
 * empresa ligada o estado em `carteira_perfis`. Vínculo desativado no detalhe do módulo não conta;
 * vínculo sem detalhe conta (vale como ativo — spec 21 §4.4).
 *
 * FALHA ABERTA, SEMPRE — mas no CHAMADOR: esta leitura deixa o erro subir (tabela ausente porque
 * o módulo foi desinstalado, banco lento…), e a regra 0 do roteador o registra em `log.warn` e
 * segue com `desconhecido`, que sem membro configurado é exatamente o roteamento de antes. Um
 * cliente real está esperando resposta; o resolvedor nunca pode calar o turno, e a falha nunca
 * pode sumir sem rastro.
 */
import type pg from "pg";

import type { EstadoDaCarteira } from "./vocabulario";

export const SITUACOES_DE_RELACIONAMENTO = [
  "cliente_ativo",
  "cliente_inativo",
  "prospect",
  "desconhecido",
] as const;
export type SituacaoDeRelacionamento = (typeof SITUACOES_DE_RELACIONAMENTO)[number];

/**
 * Quem acabou de contratar (`em_implantacao`) já é cliente para o atendimento (spec 21 Q2), e
 * quem está suspenso ou em distrato continua sendo atendido como cliente até sair.
 */
const ESTADOS_DE_CLIENTE: ReadonlySet<EstadoDaCarteira> = new Set([
  "em_implantacao",
  "ativo",
  "suspenso",
  "em_distrato",
]);

/** A regra pura, sobre os estados das empresas ligadas ao contato. */
export function situacaoDosEstados(estados: readonly EstadoDaCarteira[]): SituacaoDeRelacionamento {
  if (estados.some((e) => ESTADOS_DE_CLIENTE.has(e))) return "cliente_ativo";
  if (estados.includes("inativo")) return "cliente_inativo";
  if (estados.length > 0) return "prospect";
  return "desconhecido";
}

export interface ResolvedorDeRelacionamento {
  (db: pg.Pool, organizationId: string, conversationId: string): Promise<SituacaoDeRelacionamento>;
}

/** A leitura de verdade, sobre `pg` (o motor do agente não usa o PostgREST). */
export const situacaoDaConversa: ResolvedorDeRelacionamento = async (db, organizationId, conversationId) => {
  const { rows } = await db.query<{ estado: EstadoDaCarteira }>(
      `select p.estado
         from conversations cv
         join contacts ct
           on ct.id = cv.contact_id and ct.organization_id = cv.organization_id
         join company_people cp
           on cp.person_id = ct.person_id and cp.organization_id = cv.organization_id
         left join carteira_vinculo_detalhes d on d.company_people_id = cp.id
         join carteira_perfis p
           on p.company_id = cp.company_id and p.organization_id = cv.organization_id
        where cv.organization_id = $1
          and cv.id = $2
          and coalesce(d.ativo, true)`,
    [organizationId, conversationId],
  );
  return situacaoDosEstados(rows.map((r) => r.estado));
};
