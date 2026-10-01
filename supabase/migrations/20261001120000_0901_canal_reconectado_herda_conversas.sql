-- 0901 — Reconectar o MESMO número como canal novo leva as conversas junto.
--
-- O defeito, medido numa instalação real em 30/09/2026: o WhatsApp caiu, o
-- operador excluiu o canal e conectou o mesmo número como canal novo. O canal
-- velho foi ARQUIVADO (0106) e as conversas ficaram nele. A partir daí todo
-- envio que parte da conversa — follow-up, resposta de caso, retomada — recusa
-- com "canal arquivado" (o envio nunca sai por canal arquivado, por desenho), a
-- fila esgota as tentativas e o follow-up morre com
-- `action_turn_never_completed`. Dois avisos na Central para um lead que só
-- tinha ficado em silêncio.
--
-- O conserto: quando um canal ATIVO passa a ter número (ou volta do arquivo
-- com número), as conversas 1:1 dos canais ARQUIVADOS da mesma organização,
-- com o MESMO número e o MESMO provedor, passam para ele.
--
-- O que NÃO se move, e por quê:
--   - conversa de contato que JÁ tem conversa no canal novo (o lead escreveu
--     depois da troca): fundir duas conversas reescreveria histórico, demanda e
--     revisão de atendimento de ambas. A antiga fica no canal arquivado,
--     legível, como hoje;
--   - grupo: entrar em grupo é escolha POR CANAL (`channel_session_groups`);
--   - canal de outro provedor com o mesmo número (QR × oficial): as regras de
--     envio são outras (janela de 24h, modelo aprovado);
--   - `messages.channel_session_id`: é fato histórico — por onde a mensagem
--     passou. O envio resolve o canal pela CONVERSA, nunca pela mensagem.
--
-- A fronteira de atendimento (`service_boundary`) não carrega canal, então o
-- follow-up que estava esperando segue válido e sai pelo canal novo. Rascunho
-- de resposta preso ao canal velho fica obsoleto (`reply_context_revision`
-- sobe com a troca de canal), o que é o certo.
--
-- Gatilho sem HTTP: só move linhas no mesmo banco (anti-pattern 9 não se
-- aplica). Cada conversa movida é recusada em silêncio se uma corrida criar a
-- conversa no canal novo no meio do caminho (23505 do índice
-- `uniq_conversations_1to1_per_contact_session`), em vez de derrubar o UPDATE
-- do canal que disparou o gatilho.
--
-- Backfill no fim: instalação que já passou pela troca recebe o conserto ao
-- aplicar.

create or replace function public.fn_canal_herda_conversas_do_numero(p_org uuid, p_canal uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canal public.channel_sessions;
  v_conv record;
  v_movidas integer := 0;
  v_de uuid[] := '{}';
begin
  select * into v_canal
    from public.channel_sessions
   where organization_id = p_org and id = p_canal and archived_at is null;
  if not found or v_canal.phone_number is null then
    return 0;
  end if;

  for v_conv in
    select c.id, c.channel_session_id
      from public.conversations c
      join public.channel_sessions s
        on s.organization_id = c.organization_id and s.id = c.channel_session_id
     where c.organization_id = p_org
       and not c.is_group
       and s.id <> p_canal
       and s.archived_at is not null
       and s.phone_number = v_canal.phone_number
       and s.provider = v_canal.provider
       and not exists (
         select 1 from public.conversations n
          where n.organization_id = p_org
            and n.contact_id = c.contact_id
            and n.channel_session_id = p_canal
            and not n.is_group)
     order by c.id
       for update of c skip locked
  loop
    begin
      update public.conversations
         set channel_session_id = p_canal
       where organization_id = p_org and id = v_conv.id;
      v_movidas := v_movidas + 1;
      if not (v_conv.channel_session_id = any (v_de)) then
        v_de := v_de || v_conv.channel_session_id;
      end if;
    exception when unique_violation then
      null;
    end;
  end loop;

  if v_movidas > 0 then
    insert into public.api_audit_log (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
    values (p_org, null, 'channel.conversations_inherited', 'channel_sessions', p_canal,
            jsonb_build_object('conversations', v_movidas, 'from_channel_session_ids', to_jsonb(v_de)));
  end if;

  return v_movidas;
end;
$$;
revoke execute on function public.fn_canal_herda_conversas_do_numero(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_canal_herda_conversas_do_numero(uuid, uuid) to service_role;

-- O gatilho é `security definer` porque quem grava o número é, entre outros,
-- a rota GET do canal com o cliente do USUÁRIO (`authenticated`), e a função
-- acima não é executável por ele.
create or replace function public.fn_canal_herda_conversas_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is null and new.phone_number is not null
     and (tg_op = 'INSERT'
          or old.phone_number is distinct from new.phone_number
          or old.archived_at is not null) then
    perform public.fn_canal_herda_conversas_do_numero(new.organization_id, new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_canal_herda_conversas_trg() from public, anon, authenticated;

drop trigger if exists trg_canal_herda_conversas on public.channel_sessions;
create trigger trg_canal_herda_conversas
  after insert or update of phone_number, archived_at on public.channel_sessions
  for each row execute function public.fn_canal_herda_conversas_trg();

select public.fn_canal_herda_conversas_do_numero(organization_id, id)
  from public.channel_sessions
 where archived_at is null and phone_number is not null;
