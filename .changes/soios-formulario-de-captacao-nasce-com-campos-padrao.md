---
impacto: capacidade_nova
secao: adicionado
titulo: Fonte de captação nova já nasce com segmento, equipe e data
---

Toda fonte de captação criada em Webhooks já vem com três perguntas além de
nome, WhatsApp e e-mail: **Segmento** (lista: Advocacia, Contabilidade, Saúde,
Imobiliária, Educação, Varejo, Serviços, Outro), **Equipe** (lista: Só eu, 2 a
5 pessoas, 6 a 20 pessoas, Mais de 20 pessoas) e **Data**. Dá para editar ou
remover cada uma na própria fonte. As fontes que já existiam não mudam.

As perguntas de formulário ganharam o tipo **Data**: o formulário gerado mostra
um calendário, e a resposta é gravada no lead como AAAA-MM-DD. Uma data enviada
como DD/MM/AAAA por outro formulário também é convertida; uma resposta que não
é data fica gravada como chegou, sem recusar o lead.
