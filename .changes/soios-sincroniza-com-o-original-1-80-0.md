---
impacto: exige_acao
secao: alterado
titulo: O SoiosCRM passa a incluir o DeskcommCRM 1.80.0 e a seguir a numeração de versões do original
---

O fork foi sincronizado com o DeskcommCRM até a versão 1.80.0. Todas as novidades do original entre a 1.65.0 e a 1.80.0 passam a valer aqui; as notas de cada uma estão neste CHANGELOG, que agora é o do original. Os módulos próprios do Soios (Carteira de empresas, Protocolos, Implantação de clientes, o "como pagar" das parcelas de honorários) continuam iguais.

As versões que o fork publicou com numeração própria (1.65.0 a 1.67.0) não são as do original com o mesmo número. As notas delas estão em `docs/soios/versoes-proprias-1.65-1.67.md`.

A cobrança dos tenants do fork (módulo "Cobrança dos tenants", com faturas lançadas à mão) foi substituída pela cobrança do original (planos, assinaturas, teste grátis e pagamento pelo Asaas), na mesma tela Modo administrador › Cobrança. O módulo antigo sai da lista de módulos instaláveis.

Outras mudanças que vêm junto:

- **Protocolos** passa a ficar em CRM › Ver tudo em CRM, ao lado de Carteira de empresas e Implantação de clientes. Antes ficava no grupo Atendimento.
- **LGPD:** anonimizar um contato agora apaga também o antes e o depois dos eventos da carteira ligados a ele. O tipo do evento, quem fez e a data continuam na linha do tempo.
- **Agente de IA:** as ferramentas de carteira e de protocolo seguem disponíveis durante a conversa, e cada uma só alcança registros do contato com quem o agente está falando.

## Requer atenção

Leia as seções "Requer atenção" do original entre a 1.65.0 e a 1.80.0 antes de rodar `bash update.sh`. Duas valem para quase todo mundo:

- 1.78.0: quem conectou a assinatura do ChatGPT precisa conectar de novo em IA › Credenciais.
- 1.79.0: só para quem alargou à mão a restrição de origem dos pedidos para gravar Tray, Loja Integrada ou WooCommerce.

Se você instalou o módulo "Cobrança dos tenants" do fork e lançou faturas nele: as tabelas `billing_plans`, `billing_subscriptions` e `billing_invoices` continuam no banco, mas nenhuma tela as lê. Recadastre os planos na cobrança nova antes de depender dela. Uma empresa suspensa por falta de pagamento pelo módulo antigo continua suspensa até ser reativada à mão.
