---
impacto: nada_mudou
secao: corrigido
titulo: Entrada, cadastro e configuração inicial passam a mostrar o nome salvo em Marca
---

As telas de entrar, criar conta, criar a organização, a configuração inicial (onboarding) e as
páginas de termos e privacidade mostravam o nome gravado no arquivo de instalação do servidor —
"DeskcommCRM" quando ele estava em branco — mesmo depois de a marca ter sido trocada em
**Modo administrador › Marca**. O resto do sistema (aba do navegador, menus, e-mails) já usava o
nome salvo na tela.

Agora todas essas telas usam o nome salvo na tela, e o arquivo de instalação só vale quando nada
foi salvo. O aviso da tela de Marca, que dizia que essas telas mudariam "na próxima atualização",
foi corrigido: nada as atualizava.
