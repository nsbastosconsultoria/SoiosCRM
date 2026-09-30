---
impacto: nada_mudou
secao: corrigido
titulo: Resumo do turno com formato inválido não faz mais o agente refazer o atendimento
---

Depois de responder ao cliente, o agente faz uma segunda chamada ao modelo para gravar o resumo da
conversa (compromissos, objeções e próxima ação). Com alguns modelos da OpenAI, esse resumo às vezes
vinha com o formato quebrado, e o sistema refazia o turno inteiro: outra chamada de IA paga para uma
resposta que o cliente já tinha recebido.

Agora o resumo é lido de forma mais tolerante (texto em volta, dois blocos, vírgula sobrando). Se
ainda assim vier ilegível, só o resumo é pedido de novo, uma vez. Na segunda falha, o atendimento
segue com a memória anterior da conversa, sem refazer o turno e sem gasto extra.
