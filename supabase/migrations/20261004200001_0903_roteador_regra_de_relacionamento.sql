-- 0903 — O roteador registra a decisão da regra de relacionamento (spec 21 §7).
--
-- A regra 0 do roteador (`lib/agent-engine/agent/resolve-turn-agent.ts`) decide QUEM atende pelo
-- relacionamento do contato antes de classificar a mensagem — com um número só, cliente ativo vai
-- para quem atende cliente. Ela tem dois desfechos novos, e o turno grava cada decisão do
-- roteador em `ai_router_decisions` (a telemetria que a tela de Evolução lê):
--
--   relationship             — o relacionamento decidiu;
--   relationship_overridden  — o cliente pediu outra coisa com clareza (o cross-sell) e foi para
--                              o membro dessa intenção.
--
-- Sem esta migration, o INSERT desses desfechos morre no CHECK, a decisão some da telemetria e o
-- turno só registra um `warn` ("decisão do router não gravada").
--
-- NÚCLEO, não módulo: `ai_router_decisions` é do núcleo, e a provisionadora da carteira não pode
-- mexer em tabela de fora dela (ADR-0002, D4). A regra 0 só roda quando o roteador declara
-- `config.relacionamento`, o que a tela só oferece com o módulo instalado — então numa instalação
-- sem a carteira os dois valores novos nunca aparecem, e o CHECK mais largo não muda nada.
--
-- Reaplicável: `drop constraint if exists` + `add`. Só ACRESCENTA valores; toda linha que
-- passava no CHECK antigo passa no novo, então não há dado a corrigir antes.

alter table public.ai_router_decisions
  drop constraint if exists ai_router_decisions_outcome_check;
alter table public.ai_router_decisions
  add constraint ai_router_decisions_outcome_check
  check (outcome in ('classified', 'sticky', 'reclassified', 'fallback', 'no_match', 'classifier_failed',
                     'relationship', 'relationship_overridden'));
