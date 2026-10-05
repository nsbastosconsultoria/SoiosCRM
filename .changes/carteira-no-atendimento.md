---
impacto: capacidade_nova
secao: adicionado
titulo: Carteira de empresas no atendimento — roteador, assistente e caixa de entrada
---

Com o módulo **Carteira de empresas** instalado, o atendimento passa a saber quem já é cliente.

- **Roteador:** o novo quadro **Quem já é cliente** manda o cliente ativo direto para a intenção
  escolhida, em geral o atendimento, mesmo que a mensagem pareça comercial. Se o cliente pedir outra
  coisa com clareza, como abrir outra empresa, ele segue para a intenção pedida. Dá para desligar
  esse desvio. Sem o quadro preenchido, o roteador funciona como antes.
- **Assistente de IA:** três capacidades novas no pacote de atendimento. Ver as empresas de quem
  está na conversa, registrar de qual empresa é a conversa e procurar uma empresa da carteira pelo
  nome ou pelo CNPJ. O assistente só registra empresas ligadas à pessoa no cadastro, e o CNPJ
  aparece para ele só pelos 4 últimos dígitos.
- **Caixa de entrada:** o cabeçalho da conversa mostra de qual empresa ela trata, com troca num
  clique e um atalho para a ficha da empresa. Trocar a empresa vale daqui para frente: o que já foi
  tratado não muda de empresa.

Inclui uma atualização no banco que permite registrar essas decisões do roteador. Ela não muda nada
para quem não usa a carteira.
