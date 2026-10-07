-- 0908 — A Central recebe o aviso do módulo implantacao (spec 23 §5.5, §11.2).
--
-- Um tipo novo em `agent_inbox_items.kind`, com `ref_kind = 'implantacao'`:
--
--   implantacao_atrasada — uma implantação em andamento tem item vencido e ainda aberto. Escrito
--                          pelo vigia diário `implantacao-watcher`, um por implantação enquanto
--                          houver um aberto (deduplicado pelo ref_id).
--
-- NÚCLEO, não módulo: o CHECK é do núcleo, e a provisionadora não pode tocá-lo (ADR-0002, D4).
-- Numa instalação sem o módulo, nenhum aviso desses nasce, e o CHECK mais largo não muda nada.
--
-- Forward-fix com a lista COMPLETA, igual ao bloco único do baseline (o
-- `kind-check-migration-x-baseline` reprova migration que encolhe o vocabulário). Só acrescenta:
-- nenhuma linha existente viola o CHECK novo.
--
-- O texto do aviso leva o nome da empresa (pessoa jurídica) e as contagens por de quem é a vez —
-- nunca observação nem evidência dos itens.

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
    'implantacao_atrasada',
    'other'
  ));
