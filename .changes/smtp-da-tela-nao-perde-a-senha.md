---
impacto: nada_mudou
secao: corrigido
titulo: Salvar o servidor de e-mail não apaga mais a senha, e limpar a tela volta ao arquivo
---

Em **Modo administrador › E-mail**, quando os dados do servidor vinham do arquivo de instalação,
a tela dizia "Já existe uma senha gravada. Deixe em branco para mantê-la" — mas salvar sem digitar
a senha gravava a configuração sem senha, e a partir daí todo e-mail da instalação falhava na
autenticação. Agora a senha do arquivo é guardada junto.

Apagar os campos da tela também volta a usar o arquivo de instalação, como a tela promete; antes a
instalação ficava sem e-mail. E o botão "Salvar" não mostra mais "Salvando…" enquanto quem espera
é o "Testar conexão".

Quem já salvou a tela nessa situação: digite a senha de novo em **E-mail** e salve.
