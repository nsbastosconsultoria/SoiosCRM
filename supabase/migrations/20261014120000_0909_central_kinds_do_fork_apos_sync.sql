-- manifest: Sincronização com o original (DeskcommCRM 1.80.0): `agent_inbox_items_kind_check` reconstruída com a lista completa da 0614 do original MAIS os kinds dos módulos do fork (`protocolo_sla`, `protocolo_sem_dono` da 0905 e `implantacao_atrasada` da 0908).
-- 0909 — os kinds do fork voltam à constraint da Central depois do merge do original.
--
-- ── O defeito ────────────────────────────────────────────────────────────────
-- As migrations 0905 e 0908 do fork acrescentaram três kinds à constraint. O
-- original, sem saber delas, reconstruiu a mesma constraint três vezes depois
-- (0589, 0601, 0614), com timestamps POSTERIORES aos da 0905/0908. Num banco
-- que sobe pelas migrations em ordem, a 0614 é a última a rodar e apaga os
-- kinds do fork: o vigia de prazo dos protocolos e o da implantação passariam
-- a falhar no INSERT do aviso (23514).
--
-- Esta passa a ser a ÚLTIMA migration que reconstrói a constraint
-- (kind-check-migration-x-baseline). No baseline os kinds já estão no bloco
-- único da constraint — nada novo lá. Idempotente: drop if exists + add.

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
    -- (migration 0109, issue #129) Mensagem outbound nasce `sending` e, quando o
    -- envio nunca acontece, fica `sending` para sempre — o self-hoster vê uma
    -- mensagem eternamente "enviando", sinal de progresso para algo que não vai
    -- acontecer. O cron `recover-stuck-messages` marca `failed` e usa este kind
    -- para o defeito APARECER na Central de avisos.
    --
    -- Entra NESTA lista, e não num bloco novo no fim do arquivo: o #159 do @jmpo
    -- mostrou que reconstruir a mesma constraint em N blocos quebra o
    -- `update.sh` de todo clone que já tenha uma linha de vocabulário posterior
    -- — os blocos antigos rodam antes e falham em cadeia. Um bloco por
    -- constraint, vigiado por tests/unit/baseline-constraint-reconstruida.test.ts.
    'message_send_stuck',
    -- (migration 0129) O cliente manda foto/áudio e o agente age como se nada
    -- tivesse chegado. Acontece quando o modelo configurado não enxerga imagem,
    -- ou quando falta a chave de transcrição — e antes disto a derivação
    -- devolvia string vazia EM SILÊNCIO: nenhum erro, nenhum log, e o operador
    -- concluindo que o agente ignorou o cliente de propósito.
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    -- (migration 0111, spec 16 §3.2) O papel Operador declara promessa em aberto:
    -- o assistente prometeu algo ao cliente e o cumprimento não foi registrado.
    -- A invariante sagrada da spec é "nenhuma promessa deixa de ser cumprida", e
    -- uma promessa sem dono precisa aparecer onde o humano olha — não no log do
    -- worker. Entra NESTA lista pela mesma razão que a de cima.
    'promise_unfulfilled',
    -- (migration 0124, spec 17 §4b) Dado que o assistente ouviu na conversa e
    -- ninguém confirmou até o prazo. `info`, não `warn`: nada quebrou — uma
    -- informação não foi aproveitada, e tratar isso como falha ensinaria a
    -- ignorar os avisos que são falha de verdade. Entra NESTA lista pela mesma
    -- razão das de cima (bloco único por constraint, #159).
    'contact_proposal_expired',
    -- (migration 0159) O gasto passou do aviso que a pessoa definiu e a IA
    -- CONTINUA respondendo — `warn`, nunca `critical`, e um kind SEPARADO de
    -- `budget_exceeded`: colapsar os dois faria o alerta de "parou" perder o
    -- significado. É este kind que torna possível a condição do gate "ninguém é
    -- bloqueado sem ter sido avisado no mês" — sem ele, o salto de 79% para 101%
    -- entre duas chamadas calaria a IA sem nenhum sinal anterior.
    --
    -- Entra NESTA lista, e AQUI no fim, por duas razões distintas: bloco único
    -- por constraint (#159), e porque `tests/unit/midia-nao-lida.test.ts` procura
    -- `'midia_nao_lida'` nos primeiros 2000 caracteres a partir do `add
    -- constraint` — um valor comentado inserido ACIMA dele empurra-o para fora da
    -- janela e reprova um teste que não tem nada a ver com o kind novo (medido:
    -- offset 1532 -> 2275). Kind novo entra no fim da lista.
    'budget_warning',
    -- (migration 0181) O material que a pessoa enviou não entrou na base: falta
    -- chave de embedding, a extração do arquivo falhou, ou nenhum trecho foi
    -- gravado. Antes disto o worker devolvia `skipped` para o próprio log, o drain
    -- tratava `skipped` como sucesso, e a linha da fonte seguia dizendo `ready`.
    -- Irmão direto de `midia_nao_lida`: mesma chave, mesmo silêncio.
    'conhecimento_nao_indexado',
    -- (migration 0206, spec 18) Chamada de voz WhatsApp (WaCalls) recebida que
    -- nunca teve answered_at — o "chamou e ninguém atendeu" precisa de dono,
    -- mesma razão de midia_nao_lida/conhecimento_nao_indexado. Entra NESTA
    -- lista, não em bloco novo (#159, bloco único por constraint).
    'voice_call_missed',
    'case_stale',
    -- (migration 0292) O aviso de caso não chegou ao WhatsApp da equipe,
    -- em definitivo. Nasce com `ref_kind='agent_case'` para levar AO CASO —
    -- que continua esperando — e não a uma tela genérica. A fonte da verdade
    -- sobre "o aviso saiu?" continua sendo `entregas_de_aviso_de_caso`:
    -- qualquer membro apaga um item da Central pelo PostgREST hoje.
    'aviso_de_caso_nao_entregue',
    -- (migration 0312) O fluxo de follow-up publicado que NUNCA vai disparar:
    -- gatilho automático (silêncio, etapa, caso, falta) só cria inscrição se
    -- algum agente publicado arma o ponteiro, e sem esse vínculo os produtores
    -- saem por `pointers_armados = 0` em silêncio — `active` na tela, morto no
    -- motor. Entra NESTA lista e no FIM dela, pelas duas razões de sempre
    -- (bloco único por constraint, #159; e a janela de 2000 caracteres que
    -- `tests/unit/midia-nao-lida.test.ts` varre a partir do `add constraint`).
    'followup_sem_agente',
    -- (migration 0339, doc 11 decisão B) O canal de WhatsApp em modo de teste
    -- SEM número autorizado não responde a ninguém — e o esquecimento é o
    -- defeito: as mensagens chegam no Inbox e a IA nunca fala, então quem
    -- instalou conclui que o produto está quebrado. O cron canal-mudo-watcher
    -- abre este aviso depois de 3 dias e o FECHA quando deixa de valer.
    --
    -- Entra NESTA lista, e não num bloco novo no fim do arquivo: reconstruir a
    -- mesma constraint em N blocos quebra o `update.sh` de todo clone com
    -- vocabulário posterior (lição do #159).
    'canal_mudo_sem_numero',
    -- (migration 0464) a proposta comercial: vencimento sem decisão, queda da taxa
    -- de aceite e promessa de proposta que não virou proposta.
    'proposal_expired_notice', 'proposal_acceptance_rate_drop', 'proposal_promised_not_created',
    -- (migration 0466, D3) proposta presa em 'enviando' há mais de 5min — o
    -- mesmo padrão do 'message_send_stuck', cron próprio (proposta-travada).
    'proposta_travada',
    -- (migration 0475) a IA rascunhou uma proposta e falta confirmar o modelo
    -- sugerido (plano N1) ou falta preço de catálogo — a Central acompanha
    -- até as duas pendências sumirem, ou até a proposta ser enviada/descartada.
    'proposta_pronta_para_revisao',
    -- (migration 0501) a organização voltou de uma suspensão e há conversas que
    -- receberam mensagem enquanto ela estava parada: a IA não respondeu nem vai
    -- responder sozinha. Um item por reativação, aberto por fn_reativar_organizacao.
    'org_reativada',
    -- (migration 0500) O Jev percebeu, numa mensagem em que a regra de hoje não
    -- viu nada, um pedido para falar com uma pessoa ou para parar de receber
    -- mensagens, e a empresa escolheu "Avisar a equipe". Um kind por pedido, e
    -- não `other`: a Central dá rótulo e destino por kind, e o `other` não leva
    -- a uma conversa (lib/ai/inbox-destino.ts); e o aviso é um por CONVERSA e
    -- pedido. O Jev só abre o aviso — quem passa a conversa é a regra de hoje
    -- ou uma pessoa, e quem bloqueia é só o STOP do próprio cliente. NESTA
    -- lista pelas razões de sempre (#159; a janela do `midia-nao-lida.test.ts`).
    'jev_pedido_de_humano',
    'jev_parar_de_receber',
    -- (migration 0589, issue #2389) A pausa de uma conexão era silenciosa para
    -- todo mundo menos para quem clicou. O audit registrava `channel.disabled`
    -- / `channel.enabled`, mas audit é histórico para quem procura, não
    -- comunicação — a Central é onde a operação inteira olha. O item nasce na
    -- pausa e se resolve sozinho na retomada ou no arquivamento, com o motivo
    -- no corpo (laço do canal-mudo-watcher, só que instantâneo).
    'canal_pausado',
    -- (migration 0601) a cobrança do revendedor fala com a empresa: os avisos
    -- da régua (teste acabando, venceu, suspende em breve, suspensa) nascem sem
    -- referência, e o de 80% do teto de IA do plano nasce com ref_kind plano. Os
    -- dois abrem Configurações › Plano e cobrança, só para quem administra.
    'cobranca',
    -- (migration 0614) o admin da plataforma trocou o e-mail de login de uma
    -- pessoa da equipe: a empresa fica sabendo pela Central (sem endereço).
    'email_de_login_trocado',
    -- (migration 0905, módulo protocolos do fork Soios) prazo do protocolo em
    -- 80/100/120% e protocolo numa fila sem ninguém. ref_kind 'protocolo'.
    'protocolo_sla',
    'protocolo_sem_dono',
    -- (migration 0908, módulo implantacao do fork Soios) implantação com item
    -- vencido. ref_kind 'implantacao'.
    'implantacao_atrasada',
    'other'
  ));
