---
impacto: exige_acao
secao: alterado
titulo: O SoiosCRM passa a incluir o DeskcommCRM 1.85.0
---

O fork foi sincronizado com o DeskcommCRM até a versão 1.85.0. Todas as novidades do original entre a 1.81.0 e a 1.85.0 passam a valer aqui; as notas de cada uma estão neste CHANGELOG. Os módulos próprios do Soios (Carteira de empresas, Protocolos, Implantação de clientes, o "como pagar" das parcelas de honorários) continuam iguais.

A 1.81.0 que o fork publicou em 14/10 não é a 1.81.0 do original: ela era o DeskcommCRM 1.80.0 com os módulos do Soios. A nota dela está em `docs/soios/versoes-proprias-1.65-1.67.md`.

A partir desta versão o fork usa uma numeração que não colide com a do original: a versão do original em que o fork está, com a correção a partir de 100. Esta é a 1.85.100; as próximas em cima do 1.85 serão 1.85.101, 1.85.102, e depois de sincronizar com o 1.86.0, 1.86.100. Detalhes em `docs/soios/numeracao-de-versoes.md`.

## Requer atenção

Leia as seções "Requer atenção" do original entre a 1.81.0 e a 1.85.0 antes de rodar `bash update.sh`. As que valem para mais gente:

- 1.81.0: pedido de dados LGPD que chega pela Nuvemshop passa a esperar a aprovação de um administrador em Organização › LGPD; e, com mais de um número na organização, escolha o canal do lembrete em Configurações › Tipos de agendamento.
- 1.83.0: com "Atendentes podem mexer na agenda dos colegas" desligada, o atendente deixa de ver e mexer na agenda e nas tarefas dos colegas.
- 1.84.0: com a cobrança ligada e planos oferecidos, defina um plano padrão em Painel › Cobrança › Planos (**Usar no cadastro**), senão o cadastro pelo Google some e o cadastro sem plano é recusado.
- 1.85.0: quem usa o provedor de IA personalizado com teto de gasto em modo de bloqueio deve conferir o teto, porque essas chamadas passam a ser contadas pelo preço do catálogo.
