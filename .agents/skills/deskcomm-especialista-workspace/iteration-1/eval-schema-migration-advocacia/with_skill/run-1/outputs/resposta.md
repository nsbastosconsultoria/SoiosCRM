## Briefing pré-implementação: campos de processo jurídico (número do processo, área do direito, prazo processual) em leads

### O que muda
Nada no schema. Os três campos que o escritório pediu — número do processo (texto), área do
direito (trabalhista/cível/criminal) e prazo processual (data) — cabem inteiros no mecanismo de
**custom fields declarativos por pipeline** que o CRM já tem pronto: `crm_pipelines.settings.fields`
(definição) + `crm_leads.custom_fields` (valor). Não há migration, não há coluna nova, não há
deploy. É configuração feita por um admin/manager do tenant, pela tela **Configurações → Funis**
(`/app/settings/tenant/pipelines`), que já é uma porta existente na navegação
(`lib/navigation/catalogo.ts:358`).

### Doutrina aplicável (o que foi lido, não o que foi lembrado)
- **`CLAUDE.md` — Modelagem:** *"`custom_fields jsonb` com schema declarativo em
  `pipeline.settings.fields`; Zod construído dinamicamente"* — é literalmente o mecanismo desenhado
  para este caso: dado específico de nicho, sem mexer no schema físico.
- **`CLAUDE.md` — Doutrina DIRC** (antes de adicionar campo: Duplicar/Integrar/Referenciar/Calcular).
  Nenhuma das quatro perguntas indica FK, ponteiro ou valor computável — é dado genuinamente novo do
  domínio jurídico. Só que a doutrina de Modelagem já resolveu essa classe de problema com o jsonb
  declarativo em vez de coluna física: se cada nicho (clínica, imobiliária, jurídico, e-commerce)
  ganhasse colunas próprias em `crm_leads`, a tabela cresceria sem limite para todo mundo, inclusive
  quem não é escritório de advocacia — o oposto do "núcleo genérico" que o produto exige.
- **`docs/doctrine/extensoes.md` — princípio-raiz:** *"Se nenhuma organização desta instalação ativar
  isto, a operação comum continua inteira?"* — aqui nem chega a ser uma decisão núcleo×extensão,
  porque não há capacidade nova sendo ligada: é o admin do tenant usando uma capacidade do núcleo que
  já existe para todo mundo (custom fields por pipeline). Ver seção 5 abaixo para o caso em que isso
  mudaria.
- **`CLAUDE.md` — Doutrina de Migrations & Banco:** não se aplica a este pedido (nenhuma mudança de
  schema) — citada aqui só para descartá-la explicitamente, porque é o reflexo natural diante de
  "adicionar campo ao CRM" e é exatamente o reflexo que este mecanismo existe para evitar.

### Estado atual relevante
`docs/current-state.md` é retrato de `789dfa6` (2026-07-29) e se declara não-mantido — não usei
nenhum número de lá sem confirmar contra o código vivo. Confirmado direto no código de hoje:

- `lib/schemas/settings.ts:149-173` — `customFieldSchema`: `{ key (regex `^[a-z][a-z0-9_]*$`, max
  40), label (max 80), type: text|textarea|number|date|select|multiselect|boolean|email|phone|url,
  required?, options?: [{value,label}] }`. `type: "select"` com `options` fixas é exatamente o que
  "área do direito" precisa.
- `pipelineConfigPatchSchema.fields` (linha 184): `z.array(customFieldSchema).max(50)` — teto de
  **50** campos por pipeline no código atual.
- Tela: `app/app/settings/tenant/pipelines/_client.tsx` — deriva os tipos de campo do próprio Zod
  (`TIPOS_DE_CAMPO = customFieldSchema.shape.type.options`), tem botão "Adicionar campo", bloqueia
  acima de 50, e salva via server action `app/actions/settings/updatePipelineConfig.ts` (exige papel
  ≥ `admin`, valida com `pipelineConfigPatchSchema`, faz merge em `settings.fields`).
- Renderização no lead: `components/contacts/CustomFieldsEditor.tsx` (switch por `f.type`) consumido
  por `components/kanban/LeadFieldsForm.tsx`, que só mostra a seção "Campos do funil" quando há
  campos definidos — aparece automaticamente assim que o pipeline ganhar as 3 definições.
- **Divergência doc × código que vale registrar, não corrigir aqui:** `docs/prd/02-prd-customer-360.md`
  (§3.6, C4) descreve um limite de 30 campos ativos e um erro `422 field_value_not_in_options` quando
  o valor gravado não está nas `options` do schema. O código hoje permite **50** (`lib/schemas/
  settings.ts:184`, acima do PRD) e **não** encontrei enforcement server-side de `options` no valor —
  `lib/schemas/leads.ts` valida `custom_fields` como `z.record(z.string(), z.unknown())`, então uma
  chamada direta à API (bearer/integração) pode gravar `area_direito: "qualquer coisa"` sem passar
  pela UI que restringe a `select`. Não bloqueia este pedido, mas é relevante para dado de
  compliance jurídico: sinalizar ao escritório que a garantia de "só uma das 3 opções" hoje é só de
  UI, não de banco.

### Padrões a seguir
Formato de definição a cadastrar em `settings.fields` do pipeline do escritório (pela tela, não por
SQL):

```json
{ "key": "numero_processo", "label": "Número do processo", "type": "text", "required": false }
{ "key": "area_direito", "label": "Área do direito", "type": "select", "options": [
    { "value": "trabalhista", "label": "Trabalhista" },
    { "value": "civel", "label": "Cível" },
    { "value": "criminal", "label": "Criminal" }
] }
{ "key": "prazo_processual", "label": "Prazo processual", "type": "date" }
```

`key` segue o regex de `customFieldSchema` (minúsculo, começa com letra, só `[a-z0-9_]`) — os três
acima já respeitam isso. Não há schema local extra para criar; a tela de Configurações → Funis é a
única superfície a usar.

**Bônus dentro do que já existe (não obrigatório para o pedido, mas relevante):** por ser `type:
"date"`, `prazo_processual` pode alimentar o gatilho de automação por data de funil já pronto —
`lib/automation/gatilho-de-data-do-funil.ts` + cron `app/api/v1/cron/lead-date-field-due/route.ts` —
para lembrar N dias antes do prazo vencer, sem código novo.

### Núcleo, extensão, ambos ou infraestrutura
Não é mudança de comportamento da plataforma — é configuração de tenant usando uma capacidade de
núcleo já genérica e já distribuída (custom fields declarativos por pipeline existem para qualquer
nicho, não só jurídico). Respondendo à pergunta de `extensoes.md`: se nenhuma organização "ativar"
isto, a operação comum não é afetada, porque isto não é um toggle de plataforma — é um dado que só
este tenant grava no próprio `settings.fields`. Não há item de DoD 18 a declarar porque não há PR.

Isso muda se o pedido crescer para um destes dois casos, e cada um tem destino diferente:
- **Quer reforço server-side** (validar `options` no banco/API, permitir busca/filtro de lead por
  custom field na listagem, unicidade de `numero_processo` na organização) — é melhoria **genérica**
  do mecanismo de custom fields, serve a todo nicho, então é **núcleo**, não extensão específica de
  jurídico.
- **Quer um "pacote pronto" de nicho jurídico** para outras instalações de escritórios de advocacia
  reaproveitarem (campos + vocabulário + pipeline pré-configurado) — aí o caminho é a skill
  `deskcomm-cliente-novo` (pacote de nicho) ou, se for para distribuição via catálogo,
  `deskcomm-extensao` — nenhuma das duas foi carregada aqui porque o pedido do usuário, como posto,
  é de um único tenant configurando o próprio CRM, não um pacote a redistribuir.

### Riscos de compatibilidade self-host/open-source
- **Nenhum de schema/kit:** zero migration, zero apêndice em `baseline.sql`, zero linha em
  `MANIFEST.md`, zero env var, zero mudança em `Dockerfile`/compose. Quem já instalou não precisa
  rodar `update.sh` nem nada — a configuração é feita em runtime pela própria tela.
- **Nenhum de navegação:** a tela já é uma porta cadastrada (`lib/navigation/catalogo.ts:358`), não é
  tela nova — DoD 14 não se aplica.
- **Escopo é por pipeline, não por organização:** `settings.fields` mora em `crm_pipelines`, uma
  linha por funil. Se o escritório tiver mais de um funil (ex.: um por vara/área), os 3 campos
  precisam ser cadastrados em CADA pipeline onde devem aparecer — não é automático entre funis.
- **Integridade de dado sem enforcement de banco:** como registrado acima, `area_direito` aceita
  qualquer string via API direta, não só as 3 opções — risco relevante para dado usado em processo
  jurídico (relatório, automação) se alguma integração gravar valor fora do vocabulário.
- **RLS/multi-tenancy:** não muda — `crm_pipelines` e `crm_leads` já são tabelas tenant-aware com RLS
  aplicada; os valores ficam dentro de uma coluna jsonb de uma tabela já isolada, não há tabela nova
  para testar isolamento.

### Plano de implementação
1. Confirmar que quem vai configurar tem papel `admin` (ou `manager`, que `04-prd-pipeline-attendance.md`
   também cita para criação de pipeline/campos) na organização do escritório — `updatePipelineConfig`
   exige isso no servidor.
2. Abrir **Configurações → Funis** (`/app/settings/tenant/pipelines`) e selecionar o pipeline do
   escritório (repetir por pipeline, se houver mais de um que deva ter os campos).
3. "Adicionar campo" três vezes e preencher: `numero_processo` (Texto), `area_direito` (Seleção, com
   as 3 opções trabalhista/cível/criminal), `prazo_processual` (Data).
4. Salvar — a server action valida com `pipelineConfigPatchSchema` e persiste em
   `crm_pipelines.settings.fields`; nenhum código roda além do já existente.
5. Abrir um lead desse pipeline e confirmar visualmente que a seção "Campos do funil" mostra os três
   campos novos e aceita valor (prova pela tela, com dado de teste — não curl, conforme a Doutrina de
   QA Visual do `CLAUDE.md`, ainda que seja configuração e não código).
6. Se fizer sentido para a operação, configurar o gatilho de automação por data usando
   `prazo_processual` (opcional, mecanismo já existente, não requer este PR).
7. Nada disso gera commit/PR — é dado de configuração de tenant. Se depois o pedido evoluir para
   "todo escritório de advocacia que instalar o DeskcommCRM deveria começar com isso pronto", aí sim
   vira trabalho de código e a skill certa para montar esse pacote é `deskcomm-cliente-novo` (ou
   `deskcomm-extensao`, se for para publicar no catálogo) — não uma migration em `crm_leads`.
