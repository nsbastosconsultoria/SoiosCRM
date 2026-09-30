# Sofia — os agentes da Soios Advocacia

Os prompts da **Sofia**, assistente única do escritório Soios Advocacia (Araguaína/TO — Direito do
Trabalho e Previdenciário/INSS). Para o cliente existe só a Sofia; por trás, quatro agentes
especializados e um roteador que escolhe qual responde a cada mensagem.

> **De onde vieram.** Estes arquivos foram escritos direto na pasta da instalação e nunca tinham
> sido commitados. Sobreviveram no snapshot `backup/pre-update-2026-09-26` (commit `b4fa3bab`),
> tirado antes da atualização para a v1.52.0, e foram trazidos para cá sem alteração de texto.
> Os agentes já estão configurados na instalação; estes arquivos são a fonte versionada deles.

| Arquivo                                                    | Papel                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`01_prompt_base_sofia.md`](01_prompt_base_sofia.md)       | Identidade, apresentação única, regras globais — vale para os quatro agentes |
| [`02_agente_recepcao.md`](02_agente_recepcao.md)           | Triagem: área, fatos essenciais, urgência, se já é cliente                   |
| [`03_agente_contratacao.md`](03_agente_contratacao.md)     | Da decisão de contratar à assinatura do contrato de honorários               |
| [`04_agente_cliente_ativo.md`](04_agente_cliente_ativo.md) | Andamento, documentos, audiências, perícias                                  |
| [`05_agente_financeiro.md`](05_agente_financeiro.md)       | Parcelas, vencimentos, boletos e comprovantes — sem autonomia para negociar  |
| [`06_orquestrador_sofia.md`](06_orquestrador_sofia.md)     | Qual agente responde, handoff interno, pendências, quando chamar humano      |

## Como cada peça se liga ao CRM

| Peça da Sofia                              | No CRM                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Os quatro agentes                          | **IA › Agentes**, um por arquivo `02`–`05`, cada um com o `01` no começo do prompt. **Publique** cada um (ver a nota sobre termos jurídicos abaixo).                                                                                                                                                                                                                                                                                                   |
| Orquestrador                               | **IA › Roteadores**: uma intenção por agente, com as regras do `06` como descrição de cada intenção. O classificador roda a cada mensagem com o histórico curto e **mantém o agente atual** quando o assunto não muda — é o "evitar trocas desnecessárias" do `06`. Configure um agente reserva (Recepção).                                                                                                                                            |
| "Humano" do orquestrador                   | Handoff do próprio agente e a **Central de Casos** (`docs/specs/15-spec-casos-humanos.md`).                                                                                                                                                                                                                                                                                                                                                            |
| Apresentação única, contexto entre agentes | O histórico da conversa é um só para todos os agentes do roteador; a regra "não se apresentar de novo" é cumprida pelo prompt. Não existe variável de estado `sofia_ja_se_apresentou` — o agente a infere do histórico.                                                                                                                                                                                                                                |
| Financeiro: contrato e parcelas            | Módulo **Honorários** (instalado em _Configurações da instalação › Módulos_). No agente Financeiro, marque as capacidades **"Ver o contrato de honorários do caso"** (`crm_get_honorarios_contrato`) e **"Ver as parcelas de honorários"** (`crm_list_honorarios_parcelas`).                                                                                                                                                                           |
| Financeiro: boleto, Pix ou link            | Em **Análise › Dinheiro › Honorários**, em cada parcela pendente: **"Informar como pagar"** — cole o link do boleto, o Pix copia-e-cola ou a linha digitável (migration 0492). O agente recebe esse texto em `instrucao_pagamento` e o repassa **exatamente** como está; parcela sem instrução volta `null`, e a capacidade manda dizer que o time envia — nunca inventar. É o "só forneça boleto, código, PIX ou link quando forem oficiais" do `05`. |
| Cliente Ativo: audiência e perícia         | **Agenda › Tipos de atendimento**: crie "Audiência" e "Perícia" (e a consulta inicial, uma por área). Registre cada audiência/perícia como compromisso do cliente. No agente Cliente Ativo, marque **"Ver os compromissos marcados"** (`crm_list_appointments`) — ela lista os compromissos do cliente com o **tipo**, o local e a situação. A capacidade está no pacote "Vender"; no agente de Cliente Ativo, marque-a individualmente.               |
| Cliente Ativo: número do processo, área    | Campos personalizados do contato (ou do funil), não coluna nova.                                                                                                                                                                                                                                                                                                                                                                                       |
| Recepção: consulta inicial                 | **Agenda**, com um tipo de atendimento por área (Trabalhista, Previdenciário) — o roteamento para o advogado certo é pelo tipo, não pelo nome da pessoa.                                                                                                                                                                                                                                                                                               |
| Funil                                      | Funil "Consultas" com o vocabulário jurídico (cliente / caso / contrato assinado / não avançou) — ver o pacote de nicho de advocacia no guia `deskcomm-cliente-novo` (`.agents/skills/deskcomm-cliente-novo/references/nichos.md`).                                                                                                                                                                                                                    |

### Termos jurídicos não derrubam o agente publicado

Existe um gate fixo que manda para humano toda mensagem com "advogado", "processo judicial",
"justiça" e afins (`checkG4Legal`). Ele só roda no worker **legado**, que atende apenas agente
**sem versão publicada**. Agente publicado responde pelo `agent-engine`, que não aplica esse gate —
então, para a Sofia, "quero falar com o advogado" é mensagem normal, e quem decide chamar uma
pessoa é o prompt. Um agente deixado em rascunho cai no legado, e o gate volta.

## O que ainda não existe

- **Assinatura digital do contrato** (o `03` conduz até ela): o contrato de honorários existe no
  módulo, a coleta de assinatura não.
- **Gerar boleto ou Pix pelo sistema**: a instrução de pagamento é colada pelo escritório. Gerar
  e dar baixa automática é o gateway do plano de cobrança
  (`docs/superpowers/plans/cobranca-dos-tenants.md`).
- **Estado estruturado da conversa** (`pendencias`, `intencoes_secundarias` do `06`): hoje vive no
  histórico que o agente lê, não em campos.
