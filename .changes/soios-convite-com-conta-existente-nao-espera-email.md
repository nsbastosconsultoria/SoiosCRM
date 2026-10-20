---
impacto: nada_mudou
secao: corrigido
titulo: Quem já tem conta e abre um convite não fica mais esperando um e-mail de confirmação que nunca chega
---

Com a confirmação de e-mail ligada no Supabase, cadastrar pelo link de convite um e-mail que já tinha conta confirmada mostrava "Enviamos um link de confirmação", mas nenhum e-mail era enviado: o provedor responde sucesso sem criar conta nem mandar nada. Agora a tela reconhece esse caso e leva a pessoa a entrar com a conta que já tem e aceitar o convite. O pedido de cadastro também volta a ficar registrado na auditoria, que antes era recusada pelo banco nesse caso. Sem convite, a resposta continua a mesma de um cadastro novo, para não revelar quais e-mails têm conta.
