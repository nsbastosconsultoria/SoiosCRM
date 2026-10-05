-- 0905 — A Central recebe os avisos do módulo protocolos (spec 22 §10.5, §11).
--
-- Dois tipos novos em `agent_inbox_items.kind`, ambos apontando para `ref_kind = 'protocolo'`:
--
--   protocolo_sla       — o prazo de primeira resposta ou de resolução de um protocolo chegou a
--                         80%, 100% ou 120%. Escrito pelo vigia `protocolos-sla-watcher`, uma vez
--                         por marco (a PK de `protocolo_marcos_sla` é a trava contra repetir).
--   protocolo_sem_dono  — um protocolo está na fila de uma área que não tem ninguém para pegar
--                         (nem membro, nem líder): ele não anda sem que alguém configure a fila.
--
-- NÚCLEO, não módulo: o CHECK é do núcleo, e a provisionadora não pode tocá-lo (ADR-0002, D4).
-- Numa instalação sem protocolos, nenhum aviso desses nasce, e o CHECK mais largo não muda nada.
--
-- Forward-fix com a lista COMPLETA, igual ao bloco único do baseline (o
-- `kind-check-migration-x-baseline` reprova migration que encolhe o vocabulário — foi assim que a
-- 0129 apagou três valores). Só acrescenta: nenhuma linha existente viola o CHECK novo.
--
-- O texto dos avisos não carrega dado sobre a pessoa (número, categoria e prazo — nunca o título
-- nem a descrição do protocolo), então a cascata de LGPD que resolve avisos do titular não
-- precisa alcançá-los.

alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required',
    'appointment_recovery_review',
    'qr_rescan',
    'routing_unassigned',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'voice_call_missed',
    'case_stale',
    'aviso_de_caso_nao_entregue',
    'followup_sem_agente',
    'canal_mudo_sem_numero',
    'proposal_expired_notice',
    'proposal_acceptance_rate_drop',
    'proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'protocolo_sla',
    'protocolo_sem_dono',
    'other'
  ));
