---
impacto: capacidade_nova
secao: adicionado
titulo: Confirmação de conta e nova senha saem pelo servidor de e-mail da instalação
---

Na instalação com Supabase na nuvem, os e-mails de confirmação de conta e de redefinir senha
saíam pelo remetente embutido do Supabase ("Supabase Auth", com limite baixo de envio) ou pelo
que alguém tivesse configurado à mão no painel do Supabase — trocar o servidor em
**Modo administrador › E-mail** mudava convites e avisos de LGPD, mas nunca esses dois e-mails.

Agora o `marca-emails.sh`, que o `update.sh` já roda a cada atualização, grava no Supabase o mesmo
servidor de e-mail da tela, com o seu remetente. Sem servidor configurado, nada muda. Para aplicar
antes da próxima atualização: `bash hostgator-setup-kit/marca-emails.sh` com
`SUPABASE_ACCESS_TOKEN` exportado.

No Supabase próprio, apagar os campos da tela de E-mail passa a voltar ao servidor do arquivo de
instalação, como o resto do sistema; antes os e-mails de acesso ficavam sem servidor.
