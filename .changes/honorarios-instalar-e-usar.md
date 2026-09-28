---
impacto: capacidade_nova
secao: adicionado
titulo: Módulo opcional de Honorários para escritórios de advocacia
---

Contribuição de @nsbastosconsultoria (#1578). Um módulo opcional, **desligado por padrão**:
contrato de honorários de cada caso (fixo, êxito ou misto), calendário de parcelas, e o agente de
IA sabendo responder sobre os dois.

**Instalar.** Quem administra a instalação vai em **Módulos**, no menu do painel da instalação, e
instala "Honorários" com um clique. As tabelas do módulo só nascem nessa hora (ADR-0002): quem não
instala não carrega tabela nenhuma, não vê porta no menu e o agente não ganha capacidade nova.

**Usar.** A tela **Análise › Honorários** registra o contrato e as parcelas. Pagar uma parcela lança
o valor no caixa da empresa, na conta escolhida, junto com o resto do dinheiro que entra. Um clique
duplo em "Pagar" lança uma vez só, e a conta tem de ser da própria empresa.
Toda a equipe vê os contratos; criar, alterar e apagar é de gerente ou administrador, e uma
parcela paga não se apaga, nem o contrato que a tem.

**A IA.** O assistente ganha "Ver o contrato de honorários" e "Ver as parcelas", para confirmar o
modelo de cobrança e o status de pagamento em vez de estimar um número.

**LGPD.** O pedido de acesso do titular traz os contratos e as parcelas dos casos dele. Os
contratos não guardam dado pessoal (só valores e o vínculo com o caso), então a anonimização não
tem o que apagar neles.
