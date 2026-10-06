-- 0906 — Caso humano aberto pela ficha de um protocolo (spec 22 §6).
--
-- A equipe fala com o cliente a partir da ficha do protocolo ("pedir informação" ou "avisar que
-- resolveu"), e quem leva a mensagem é a IA, pelo mesmo laço dos casos humanos (spec 15): a ação
-- abre um caso CURTO, já respondido, e enfileira o `case_reply_turn`. O caso nasce com
-- `source = 'protocolo'` — nem a IA abriu (`agent`) nem a trava anti-promessa (`guardrail_autofallback`).
--
-- Por que caso sob demanda, e não um caso aberto durante toda a vida do protocolo: o motor só
-- permite UM caso aberto por conversa, e um caso aberto desliga a trava anti-promessa. Um
-- protocolo vive dias; prender um caso por ele bloquearia os outros chamados daquela conversa.
-- Decisão do dono do produto em 05/10/2026.
--
-- NÚCLEO, não módulo: o CHECK é do núcleo (ADR-0002, D4). Numa instalação sem protocolos nenhum
-- caso nasce com esta origem, e o CHECK mais largo não muda nada. Reaplicável: `drop constraint
-- if exists` + `add`; só ACRESCENTA um valor, então nenhuma linha existente viola o CHECK novo.

alter table public.agent_cases
  drop constraint if exists agent_cases_source_check;

alter table public.agent_cases
  add constraint agent_cases_source_check
  check (source in ('agent', 'guardrail_autofallback', 'protocolo'));
