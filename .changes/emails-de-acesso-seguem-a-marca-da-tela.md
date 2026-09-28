---
impacto: nada_mudou
secao: corrigido
titulo: Os e-mails de confirmação de conta e de nova senha passam a usar a marca salva na tela
---

Na instalação com Supabase na nuvem, o e-mail de confirmação de conta e o de redefinir senha
chegavam com o nome do produto ("Confirme seu e-mail — DeskcommCRM") mesmo depois de a marca ter
sido trocada em **Modo administrador › Marca**: o `marca-emails.sh`, que grava esses dois e-mails
no Supabase, lia só o `.env`, e o `.env` quase nunca é atualizado depois da instalação.

Agora ele lê primeiro a marca salva na tela e só usa o `.env` quando o banco não responde ou não
tem marca salva. A próxima atualização já grava os e-mails com a marca certa; para aplicar antes
disso, rode `bash hostgator-setup-kit/marca-emails.sh` com `SUPABASE_ACCESS_TOKEN` exportado.
