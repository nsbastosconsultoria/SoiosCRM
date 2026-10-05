---
impacto: capacidade_nova
secao: adicionado
titulo: Protocolos — falar com o cliente pela ficha, com a IA levando a mensagem
---

Com o módulo **Protocolos** instalado, a ficha do protocolo ganha **Falar com o cliente**:

- **Pedir informação ao cliente:** a IA leva a pergunta pela conversa, e o protocolo fica
  aguardando o cliente, com o prazo pausado. Quando o cliente responde, a resposta aparece na linha
  do tempo do protocolo e o prazo volta a correr sozinho.
- **Avisar que resolveu:** a IA avisa o cliente, e o protocolo passa para resolvido.

A ação não aparece para protocolos sem conversa. Ela é recusada quando a conversa está com uma
pessoa da equipe (nesse caso, responda pela inbox) ou quando já existe um chamado aberto na
conversa. Para a resposta do cliente voltar ao protocolo, o agente precisa estar com a capacidade
de chamados ligada.

Inclui uma atualização no banco que permite registrar casos abertos a partir de um protocolo. Ela
não muda nada para quem não usa protocolos.
