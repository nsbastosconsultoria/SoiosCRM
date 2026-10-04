# Spec 22 — Módulo `protocolos` (demandas operacionais com categoria, prioridade, fila e SLA)

> **Status:** rascunho para revisão do dono. Pré-implementação — nada deste documento existe no código.
> **Destino (DoD 18):** **ambos**. O módulo é opcional (ADR-0002); o núcleo ganha dois pontos
> pequenos: tipos novos de aviso na Central (§11) e a ligação com o loop de Casos Humanos (§6).
> **Origem:** modelo `modelo-escritorio-contabilidade-soioscrm-v3-jornada-completa.md`, §§ 6–9,
> 26–28, 33–35. **Genérico**: serve a qualquer operação que atende demandas recorrentes de clientes
> (contabilidade, TI gerenciada, condomínio, agência, assessoria). Categorias e prazos vêm de modelo
> de nicho e da configuração da organização, nunca do schema.
> **Depende de:** nada para funcionar. **Usa, quando instalado:** o módulo `carteira`
> ([spec 21](21-spec-modulo-carteira.md)) para empresa da demanda e responsável por área.
>
> **Por que "protocolo" e não "chamado":** o produto já chama `agent_cases` de **chamado humano** na
> tela e no código (`lib/escalacao/chamados.ts`, `app/app/ai/agents/[id]/_components/PainelDoOperador.tsx`).
> Dois "chamados" diferentes na mesma tela confundiriam quem opera. "Protocolo" é o termo de
> atendimento que o cliente brasileiro já conhece ("anota o número do protocolo") e casa com a
> numeração `2026-000123`. Decisão de nome a confirmar com o dono (Q6).

---

## 1. Problema

O cliente atual pede trabalho ("preciso da guia", "vou admitir alguém amanhã", "chegou uma
intimação"). O produto tem duas peças perto disso, e nenhuma é a que a operação precisa:

| Peça existente | O que é | Por que não basta |
|---|---|---|
| `agent_cases` (spec 15) | Loop assíncrono **IA ↔ humano**: a IA delega uma tarefa e continua dona da conversa | Não tem categoria, prioridade, área, responsável, prazo, SLA nem empresa; estados pensados para o loop (`awaiting_human`, `awaiting_lead`…), não para a operação |
| `demandas` (migrations 0136–0138, 0392) | Unidade de atendimento por conversa, usada pelo Índice de Atrito (spec 17) | Mede o atrito do atendimento; não tem classificação, fila nem SLA |
| `crm_tasks` | Tarefa interna com `priority` | Não nasce do cliente, não tem relógio de SLA nem ciclo de vida de demanda |

Sem classificação e sem relógio, a equipe não sabe o que vence hoje, quem é o dono e se o prazo foi
cumprido — e a IA não tem onde registrar "guia vence hoje" de forma que alguém aja a tempo.

## 2. O que esta spec entrega, e o que não entrega

| Entrega | Não entrega (e por quê) |
|---|---|
| Protocolo com empresa, contato, conversa, categoria/subcategoria, competência, prioridade P1–P4, área, responsável, estados e histórico | Base de conhecimento e respostas automáticas — já existem (IA › Conhecimento) |
| Regras de prioridade determinísticas + sugestão da IA, com correção humana medida | Classificador treinado — a IA sugere pela ferramenta; a regra decide o piso |
| SLA com dois relógios (primeira resposta, resolução), expediente, feriados, pausas e escalonamento 80/100/120% | Calendário por área ou por cliente — um expediente por organização na v1 |
| Distribuição: responsável da carteira na área → fila da área → fallback auditado | Rodízio/carga entre membros da área — `settings.protocolos.distribuicao` nasce com `manual` e entra `round_robin` depois, sem quebrar contrato (como `settings.routing`, spec 13 §5) |
| Resumo estruturado (modelo §8) gerado na abertura | Rotinas recorrentes (documentos mensais, certidões) — módulo `rotinas`, spec futura |
| Ferramentas do agente, API, telas, métricas, auditoria, LGPD | Portal do cliente para acompanhar protocolos — fora de escopo |

## 3. Princípio de reuso (não inventar maquinaria)

| Peça existente | Papel no protocolo |
|---|---|
| `agent_cases` + `case_reply_turn` + `provide_case_update` (spec 15) | **O canal** pelo qual o humano fala com o cliente através da IA. O protocolo é o **registro operacional**; o caso é a **conversa de retaguarda** (§6) |
| Handoff canônico (`lib/agent-engine/agent/human-handoff.ts`, `bot_silenced_until`) | P1 de natureza crítica (intimação, fiscalização) aciona handoff além do protocolo (§7.3) |
| `demandas` / `conversations.current_demanda_id` | O protocolo guarda a demanda que o originou (`demanda_id`), para o Índice de Atrito continuar medindo a jornada inteira |
| `companies` (núcleo) e `carteira_*` (spec 21) | Empresa da demanda e responsável por área |
| `crm_proposal_counters` | Molde do contador anual por organização para numerar o protocolo |
| `agent_inbox_items` (Central) | Avisos de SLA e de fila sem dono |
| `event_log` + cron (`app/api/v1/cron/*`, agendado no `scheduler`) | Relógios e escalonamento; cron audita só quando há efeito (`cron-audita-so-quando-ha-efeito.test.ts`) |
| `guardrails/promise/` | A IA não promete prazo de SLA ao cliente (§8.3) |
| Mecanismo de módulo (ADR-0002) | Provisionadora, instalação, LGPD por `to_regclass` |

## 4. Modelo de dados (corpo de `fn_protocolos_provisionar()`)

Convenções iguais às da spec 21 §4: `organization_id` + cascade, `text` + CHECK, RLS por operação
aplicada pela própria função, `revision bigint` para concorrência otimista (molde de `demandas`).

### 4.1 Configuração

```text
protocolo_categorias
  id, organization_id
  parent_id uuid → protocolo_categorias (cascade)   -- null = categoria; preenchido = subcategoria (1 nível só)
  nome text not null, slug text not null
  area text not null                                -- slug de settings.atendimento.areas (lib/atendimento/areas.ts), o MESMO vocabulário da carteira
  prioridade_padrao text not null default 'P3' check in ('P1','P2','P3','P4')
  exige_competencia boolean not null default false
  exige_handoff boolean not null default false      -- ex.: notificação/intimação/fiscalização
  descricao_para_ia text                            -- quando usar; vai para a descrição da tool, nunca para o cliente
  ativa boolean not null default true, posicao int not null default 0
  unique (organization_id, parent_id, slug)
  check (parent_id is null or parent_id <> id)

protocolo_politicas_sla
  id, organization_id
  prioridade text not null check in ('P1','P2','P3','P4')
  categoria_id uuid → protocolo_categorias (cascade)  -- null = política geral da prioridade
  primeira_resposta_min int not null check (> 0)
  resolucao_min int not null check (> 0)
  em_horario_util boolean not null default true
  pausa_aguardando_cliente boolean not null default true
  pausa_aguardando_terceiro boolean not null default true
  partial unique (organization_id, prioridade) where categoria_id is null
  unique (organization_id, prioridade, categoria_id)

protocolo_area_membros                              -- quem trabalha a fila de cada área
  id, organization_id
  area text not null check (area ~ '^[a-z][a-z0-9_]{1,40}$')
  user_id uuid not null                             -- FK composta (organization_id, user_id) → user_organizations (cascade)
  papel text not null default 'membro' check in ('membro','lider')
  unique (organization_id, area, user_id)
  partial unique (organization_id, area) where papel = 'lider'

protocolo_feriados
  id, organization_id, data date not null, descricao text not null
  unique (organization_id, data)
```

**Expediente** em `organizations.settings.protocolos.expediente` (`{ fuso, dias: [1..7], inicio, fim }`),
validado por Zod. **Falha aberta como `janela-de-atendimento.ts`:** expediente inválido ou ausente ⇒
relógio corrido (24×7) + aviso na tela de configuração — nunca um SLA que não vence.

### 4.2 `protocolos`

```text
id uuid pk, organization_id
numero int not null, ano int not null              -- "2026-000123"; contador protocolo_contadores (molde crm_proposal_counters)
company_id uuid → companies (set null)             -- gravado NA ABERTURA; trocar o contexto da conversa depois não move o protocolo
contact_id uuid → contacts (set null)
conversation_id uuid → conversations (set null)
agent_case_id uuid → agent_cases (set null)        -- §6
demanda_id uuid → demandas (set null)
lead_id uuid → crm_leads (set null)
categoria_id uuid not null → protocolo_categorias (restrict)
subcategoria_id uuid → protocolo_categorias (restrict)
competencia text check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$')
titulo text not null, descricao text not null
resumo jsonb not null default '{}'                 -- resumo estruturado (§5), schema Zod central
prioridade text not null check in ('P1','P2','P3','P4')
prioridade_origem text not null check in ('regra','ia','humano')
prioridade_motivo text
urgencia_declarada text                            -- o que o CLIENTE disse; separado da prioridade operacional (modelo §27)
prazo_cliente date
area text not null
responsavel_user_id uuid                           -- FK composta → user_organizations, como channel_routing_responsibles
distribuido_por text check in ('carteira','fila','fallback','humano')
estado text not null default 'novo' check in
  ('novo','triagem','atribuido','em_atendimento','aguardando_cliente','aguardando_terceiro',
   'aguardando_interno','resolvido','fechado','cancelado','reaberto')
origem text not null check in ('agente','humano','api','automacao')
politica_sla_id uuid → protocolo_politicas_sla (set null)
aberto_em timestamptz not null default now()
primeira_resposta_vence_em timestamptz, primeira_resposta_em timestamptz
resolucao_vence_em timestamptz, resolvido_em timestamptz
pausado_desde timestamptz, pausa_acumulada interval not null default '0'
fechado_em timestamptz, motivo_encerramento text
reaberturas int not null default 0
revision bigint not null default 1
check (subcategoria_id is null or subcategoria_id <> categoria_id)
check ((fechado_em is null) = (estado not in ('fechado','cancelado')))
unique (organization_id, ano, numero)
```

Índices: `(organization_id, estado, resolucao_vence_em)` para o watcher; `(organization_id, company_id,
aberto_em desc)`; `(organization_id, responsavel_user_id, estado)`; `(organization_id, area, estado)
where responsavel_user_id is null` (a fila).

### 4.3 `protocolo_eventos` (append-only) e `protocolo_marcos_sla`

```text
protocolo_eventos
  id, organization_id, protocolo_id → protocolos (cascade)
  tipo text not null check in ('aberto','classificado','classificacao_corrigida','prioridade_alterada',
     'atribuido','transferido','estado_alterado','nota','complemento_do_cliente','sla_alerta',
     'sla_estourado','reaberto','resolvido','fechado','cancelado')
  anterior jsonb, novo jsonb, texto text
  ator_kind text not null check in ('humano','ia','sistema'), ator_user_id uuid
  correlation_id uuid, created_at

protocolo_marcos_sla                                  -- idempotência do escalonamento
  protocolo_id, relogio text check in ('primeira_resposta','resolucao'), marco smallint check in (80,100,120)
  disparado_em timestamptz not null default now()
  primary key (protocolo_id, relogio, marco)
```

Append-only como `carteira_eventos` (spec 21 §4.6): sem UPDATE/DELETE/TRUNCATE para os três papéis
do PostgREST.

## 5. Abertura e resumo estruturado

Toda abertura passa por **uma** função de domínio, `lib/protocolos/abrir.ts`, usada pela tool, pela API
e pela tela — nunca três caminhos.

1. **Empresa:** se o módulo `carteira` está instalado, usa o contexto corrente da conversa; sem
   contexto e com vários vínculos, **recusa** com erro-que-ensina ("pergunte ao cliente qual
   empresa") em vez de chutar. Sem carteira, `company_id` fica nulo.
2. **Deduplicação:** existe protocolo **aberto** da mesma empresa (ou contato), mesma subcategoria e
   mesma competência? Então **não abre outro** — registra `complemento_do_cliente` no existente e
   devolve o número dele (modelo §17: "cliente já informou → não pergunta de novo").
3. **Competência** obrigatória só quando `categoria.exige_competencia`.
4. **Prioridade** (§7), **área** (da categoria), **distribuição** (§9) e **SLA** (§10) calculados na
   mesma transação.
5. **Resumo** (modelo §8) gravado em `resumo`, validado por Zod: `solicitacao`, `prazo_informado`,
   `informacoes_coletadas[]`, `acao_esperada`, `canal`. Na tela, os campos de empresa/CNPJ/categoria
   são lidos das colunas — o resumo não duplica o que já é coluna (DIRC).
6. Emite `protocolo.aberto` no `event_log`, audita `protocolos.aberto`, grava `protocolo_eventos`.

## 6. Relação com Casos Humanos (núcleo)

O protocolo **não substitui** o loop da spec 15; ele o usa como canal.

- **IA dona da conversa (padrão):** abrir protocolo pela tool também abre um `agent_case`
  (`awaiting_human`) ligado por `agent_case_id`. A resposta do humano na ficha do protocolo vai para o
  caso, e a IA a repassa ao cliente por `case_reply_turn` — o humano não precisa ir à inbox.
- **Fonte de verdade de cada estado** (evita anti-pattern 2):

  | Ação | Quem decide | Efeito no outro |
  |---|---|---|
  | Humano pede informação ao cliente | protocolo → `aguardando_cliente` | caso → `awaiting_lead` |
  | Cliente responde, IA chama `provide_case_update` | caso → `awaiting_human` | protocolo → `em_atendimento`, evento `complemento_do_cliente` |
  | Humano resolve | protocolo → `resolvido` | caso → `resolved` (a IA avisa o cliente) |
  | Caso escalado (`escalated`) | caso | protocolo **continua**; o handoff só muda quem fala com o cliente |
  | Protocolo cancelado | protocolo | caso → `cancelled` |

- **Ponto no núcleo:** a máquina de estados do caso é `lib/agent-engine/agent/human-cases.ts`
  (transições sobre `pg`, atômicas — cabeçalho de `lib/escalacao/chamados.ts`). A sincronização
  entra **ali**, como passo opcional na mesma transação, ativo só quando `to_regclass('public.protocolos')`
  existe e há protocolo ligado. Não é um consumidor assíncrono de evento: dois donos da mesma
  transição, separados por fila, deixariam caso e protocolo divergentes entre um passo e outro.
  Sem o módulo, nada muda.
- Protocolo aberto por humano numa conversa em handoff não cria `agent_case`: quem responde é o
  atendente, pela inbox.

## 7. Prioridade

Ordem, e a mais alta vence (P1 > P2 > P3 > P4):

1. `categoria.prioridade_padrao` (subcategoria sobrepõe a categoria).
2. **Regras de prazo** (`settings.protocolos.regras_de_prazo`, semeadas pelo modelo): `prazo_cliente`
   hoje ou vencido ⇒ P1; até N dias úteis (padrão 2) ⇒ P2.
3. **Sugestão da IA** com `prioridade_motivo` obrigatório: pode **subir**, nunca descer abaixo da
   regra. Vira `prioridade_origem='ia'`.
4. **Humano** pode subir ou descer, com motivo; grava `classificacao_corrigida` ou
   `prioridade_alterada` — é a métrica "correção humana" do modelo §27.

### 7.3 Categoria que exige handoff

`categoria.exige_handoff` (ex.: notificação, intimação, fiscalização): a abertura dispara o handoff
canônico com o resumo como pacote (modelo §28), além do protocolo. A IA pausa; o protocolo segue com o
humano.

## 8. Ferramentas do agente (catálogo MCP, `modulo: "protocolos"`)

| Tool | Categoria | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_protocolo_categorias` | read | seguro | `atender` | Lista categorias e subcategorias ativas com `descricao_para_ia` e se exigem competência |
| `crm_protocolo_abrir` | write | **crítica** | — (ligar uma a uma) | Abre (ou complementa, pela deduplicação §5.2) e devolve número e estado. Crítica como a capacidade "casos" de hoje: cria trabalho para a equipe |
| `crm_protocolo_consultar` | read | seguro | `atender` | Protocolos abertos/recentes do contato ou da empresa do contexto: número, título, estado em linguagem simples |
| `crm_protocolo_complementar` | write | seguro | `atender` | Acrescenta informação do cliente a um protocolo aberto; reabre um `resolvido` dentro da janela (§10.4) |

### 8.3 O que a IA nunca recebe nem diz

- **Nenhum prazo de SLA** volta para o modelo (nem `*_vence_em`): o SLA é compromisso interno, e o
  modelo §7 proíbe informá-lo sem base aprovada. O guardrail de promessa
  (`lib/agent-engine/guardrails/promise/`) ganha o caso "prometeu prazo de resolução sem fonte".
- Nome/e-mail do responsável não vão ao modelo (mesmo princípio de `crm_list_team_members`).
- A tool devolve erro-que-ensina, nunca vazio silencioso: sem empresa definida, categoria inexistente,
  competência faltando.

## 9. Distribuição (modelo §26.7)

1. Com `carteira`: responsável principal vigente da empresa **na área** do protocolo, se for membro
   ativo da organização ⇒ `distribuido_por='carteira'`, estado `atribuido`.
2. Senão, **fila da área**: estado `triagem`, sem responsável; membros da área
   (`protocolo_area_membros`) enxergam e pegam ("assumir").
3. Fila da área sem membros ⇒ o **líder** da área (`papel = 'lider'`) ⇒ `distribuido_por='fallback'`,
   auditado. Sem líder também ⇒ o protocolo fica na fila, visível a `manager`+, com aviso na Central
   (fila sem dono é anti-morte, §17). Não há "responsável reserva" em `settings`: id de usuário em
   jsonb é chave estrangeira que o banco não confere (anti-patterns 1 e 4 — decisão de 2026-10-04).
4. Transferência humana: imediata, auditada, sem aceite (mesma decisão G1-06d da spec 13).

## 10. SLA

### 10.1 Cálculo

`lib/protocolos/sla.ts` — **funções puras**, testadas sem banco:
`somarMinutosUteis(inicio, minutos, expediente, feriados)` e `minutosUteisEntre(a, b, …)`. Com
`politica.em_horario_util=false`, minutos corridos.

- Política: a da `(prioridade, categoria)` se existir; senão a geral da prioridade; sem nenhuma ⇒
  protocolo sem SLA, e a tela de configuração mostra "P2 sem política".
- `primeira_resposta_vence_em` e `resolucao_vence_em` calculados na abertura e **recalculados** em
  mudança de prioridade (a partir da abertura, não do momento da troca) e ao sair de pausa.

### 10.2 Primeira resposta

Para o relógio no primeiro destes: transição para `em_atendimento`; mensagem **humana** enviada na
conversa ligada após a abertura (`messages` outbound de usuário, nunca da IA nem automação); resposta
do humano no caso ligado que a IA entregou ao cliente. Resposta automática da IA **não** conta.

### 10.3 Pausas

Entrar em `aguardando_cliente` / `aguardando_terceiro` (conforme a política) grava `pausado_desde`;
sair soma o intervalo **útil** em `pausa_acumulada` e empurra `resolucao_vence_em`. `aguardando_interno`
**não pausa** (é problema nosso, não do cliente).

### 10.4 Reabertura e fechamento

- `resolvido` + complemento do cliente dentro de `settings.protocolos.janela_reabertura_dias` (padrão 7)
  ⇒ `reaberto`, `reaberturas+1`, relógio de resolução retoma do ponto em que parou.
- `resolvido` há mais que a janela ⇒ `fechado` pelo watcher; mensagem nova abre protocolo novo.

### 10.5 Watcher — `app/api/v1/cron/protocolos-sla-watcher` (1×/min no `scheduler`)

Para cada relógio não pausado e não cumprido: ao cruzar 80%, 100% e 120%, insere em
`protocolo_marcos_sla` (a PK garante idempotência no replay) e só então: 80% ⇒ aviso ao responsável;
100% ⇒ responsável + líder da área (`protocolo_area_membros`, `papel = 'lider'`), evento
`sla_estourado`; 120% ⇒ papéis `manager`+. Rodada sem efeito não audita.

## 11. Pontos no núcleo

- **`agent_inbox_items.kind`** ganha `protocolo_sla` e `protocolo_sem_dono` — forward-fix do CHECK pela
  tripla migration + baseline + MANIFEST; a cascata LGPD que resolve avisos do titular passa a
  alcançar esses kinds (`ref_kind='protocolo'`), e a projeção da Central ganha o destino
  `/app/protocolos/:id`.
- **Consumidor de estado do caso** (§6).
- Nenhuma outra tabela do núcleo muda.

## 12. API e telas

**API** `/api/v1/protocolos/…` (mesmas convenções da spec 21 §9):

```text
GET    /protocolos?estado=&area=&prioridade=&responsavel=&company_id=&sla=vencendo|estourado&cursor=
POST   /protocolos                          (Idempotency-Key)
GET    /protocolos/:id                      -- com eventos
PATCH  /protocolos/:id                      -- classificação, prioridade, competência (If-Match: revision)
POST   /protocolos/:id/estado | /atribuir | /assumir | /responder | /nota
GET    /protocolos/metricas?de=&ate=&agrupar=area|categoria|prioridade|responsavel|empresa
GET/PUT /protocolos/config/categorias | /politicas | /feriados | /expediente | /areas
```

Papéis: ver e comentar `agent`+; atribuir/transferir e mudar prioridade para baixo `manager`+;
configuração `admin`.

**Telas** (portas em `lib/navigation/catalogo.ts`; somem com o módulo desligado):

- `app/app/protocolos/` — lista com visões **Minha fila**, **Fila da área**, **Vencendo** e **Todos**;
  cada linha com número, empresa, categoria, prioridade, responsável e o relógio (cor por marco).
- Ficha — resumo estruturado no topo, ações (assumir, pedir info ao cliente, responder, resolver),
  linha do tempo de `protocolo_eventos`.
- Inbox — botão "Abrir protocolo" no cabeçalho da conversa (pré-preenchido com contato e empresa do
  contexto) e lista "Protocolos desta empresa" no painel lateral.
- Configurações › Protocolos — categorias, regras de prioridade, políticas SLA, expediente, feriados,
  áreas (as de `settings.atendimento.areas`) e os membros e o líder de cada uma.

## 13. Modelo de nicho "contabilidade"

`lib/protocolos/modelos/contabilidade.ts`, aplicado por ação do administrador: as 10 categorias do
modelo §6 com subcategorias (ex.: Fiscal › DAS, ICMS, ISS, Notas, SPED; DP › Admissão, Demissão,
Férias, Folha, Pró-labore), área de cada uma, `exige_competencia` em Fiscal/DP/Contábil,
`exige_handoff` em "Notificação/Intimação/Fiscalização", `prioridade_padrao`, e **políticas SLA em
branco** — prazos são do escritório (modelo §7: "A IA nunca deve informar esses prazos…"; e quem
semeia número inventado é a mesma falha). Um modelo `generico` com 4 categorias acompanha.

## 14. Eventos, auditoria, métricas, LGPD

- **`event_log`:** `protocolo.aberto`, `protocolo.estado_alterado`, `protocolo.atribuido`,
  `protocolo.sla_alerta`, `protocolo.sla_estourado` — consumidores: watcher, Central, caso ligado,
  métricas, follow-up de satisfação (futuro, declarado aqui para não nascer órfão).
- **Auditoria:** `protocolos.aberto`, `protocolos.classificacao_corrigida`, `protocolos.prioridade_alterada`,
  `protocolos.atribuido`, `protocolos.estado_alterado`, `protocolos.config_alterada`.
- **Métricas** (modelo §15/§33), todas derivadas das colunas e eventos — nenhuma tabela de agregado
  na v1 (Calcular, do DIRC): abertos, resolvidos, backlog, por categoria/prioridade/área/responsável/
  empresa/grupo, tempo de primeira resposta e de resolução (úteis), % SLA cumprido, reaberturas,
  correção humana de classificação, protocolos abertos pela IA.
- **LGPD (ADR-0002 D8):** `titulo`, `descricao`, `resumo`, `urgencia_declarada` e
  `protocolo_eventos.texto/anterior/novo` são texto sobre a pessoa. A anonimização do contato
  (SQL dinâmico com `to_regclass`) troca esses campos por "Conteúdo anonimizado" e zera `contact_id`;
  números, datas, categoria, prioridade e relógios sobrevivem (operação). **Export** inclui
  "protocolos do titular".

## 15. Testes

- **Invariantes:** `protocolos-provisionadora.test.ts` (molde de honorários: forma, RLS por operação,
  isolamento entre 2 organizações); append-only de `protocolo_eventos`; numeração sem buraco sob
  concorrência; idempotência dos marcos; LGPD alcança e pula sem erro onde não instalado; kinds novos
  da Central casam com o vocabulário TypeScript.
- **Unit:** `sla.ts` (virada de dia, fim de semana, feriado, fuso, pausa no meio do expediente,
  expediente inválido ⇒ corrido); prioridade (regra × IA × humano); deduplicação; distribuição nas 4
  saídas; sincronização caso ↔ protocolo (tabela §6).
- **Golden adversariais** (no formato atual — tabela de candidatos da migration 0428,
  `tests/invariants/golden-candidates.test.ts`): "minha guia vence hoje" abre P1;
  "chegou uma intimação" abre + handoff; cliente com 3 empresas sem contexto ⇒ IA pergunta; IA
  **não** diz prazo de resolução; segunda mensagem sobre o mesmo DAS complementa em vez de duplicar.
- **E2E / prova em par:** cenários B, C e E do modelo §35 pela inbox e pela tela de protocolos.

## 16. Decisões do dono (2026-10-04)

| # | Pergunta | Decisão |
|---|---|---|
| Q1 | Protocolo sempre cria `agent_case` quando a IA abre? | **Sim** (§6): o humano responde pela ficha do protocolo e a IA repassa ao cliente |
| Q2 | `agent` pode baixar prioridade? | **Não**: baixar só `manager`+; subir, qualquer `agent` |
| Q3 | Expediente único por organização basta na v1? | **Sim**; calendário por área só com pedido real |
| Q4 | Satisfação (CSAT) ao fechar? | **Fora da v1**; o evento `protocolo.estado_alterado` é o gancho |
| Q5 | Numeração anual (`2026-000123`) ou contínua? | **Anual**, igual às propostas |
| Q6 | Nome do módulo | **"Protocolos"** (ver nota no topo) |
| Q7 | Vocabulário de áreas | **Um só, neutro**: `settings.atendimento.areas` (`lib/atendimento/areas.ts`), compartilhado com a carteira |
| Q8 | Membros e líder da área | **Tabela** `protocolo_area_membros` com FK, nunca jsonb; sem "responsável reserva" em `settings` |
| Q9 | Regra de prazo padrão | Prazo do cliente hoje ou vencido ⇒ P1; em até 2 dias úteis ⇒ P2; configurável em `settings.protocolos.regras_de_prazo` |

## 17. Sistema vivo (DoD 13) e Definition of Done

- **Entrada:** tool do agente, botão na inbox, tela, API, automação.
- **Saída:** Central, ficha, caso ligado (cliente informado), métricas, carteira (histórico da empresa).
- **Laço de retorno (invariante 7):** `classificacao_corrigida` e `prioridade_alterada` por humano
  alimentam a métrica de precisão da IA por categoria; categoria com correção alta aparece em
  Configurações › Protocolos com sugestão de reescrever `descricao_para_ia`.
- **Anti-morte:** fila sem membro, política SLA ausente para uma prioridade em uso, e protocolo
  `triagem` sem dono há mais de 1 h útil geram aviso na Central.
- **Fragmento `.changes/`:** `capacidade_nova`.
- Entram juntos: provisionadora + apêndice do baseline + MANIFEST; forward-fix dos kinds da Central;
  `CATALOGO_DE_MODULOS` ganha `protocolos`; cron no `scheduler` do `docker-compose.prod.yml` (DoD 15:
  chega a quem já instalou sem editar arquivo); `lib/database.types.ts` regenerado.

## 18. Ordem de implementação sugerida (PRs)

1. Spec 21 PR-A: provisionadora `carteira` + invariantes + API + tela da carteira.
2. Spec 21 PR-B: resolvedor + regra 0 do roteador + tools da carteira + contexto na inbox.
3. Spec 22 PR-C: provisionadora `protocolos` + `sla.ts` + abertura/distribuição + API + telas.
4. Spec 22 PR-D: tools + ligação com casos humanos + watcher + kinds da Central + golden.
5. Modelos de nicho "contabilidade" (ambos os módulos) + prova E2E dos cenários B–F do modelo.
