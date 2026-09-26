# Pipeline para escritório de advocacia — como montar hoje

Fui conferir o que o produto realmente suporta (não a spec antiga) antes de responder, porque há
divergência entre os dois. O que segue é o que o código faz agora.

## O ponto de partida: você já tem um pipeline, e é nele que você vai mexer

Todo tenant novo nasce com **exatamente um** `crm_pipeline`, semeado automaticamente por um trigger
de banco (`trg_seed_default_pipeline_for_org` → `fn_seed_default_pipeline_for_org`) assim que a
organização é criada — com etapas de e-commerce ("Carrinho abandonado", "Aguardando pagamento",
"Pago", "Em separação"...). Não existe onboarding que pergunte "qual o seu nicho" e monte um pipeline
jurídico do zero. Então o caminho realista — e o único hoje coberto de ponta a ponta pela tela — é
**transformar esse pipeline no seu**, não criar um segundo do zero.

Isso é feito em **Configurações › (sua organização) › Pipelines** (`/app/settings/tenant/pipelines`).
A tela é dividida em três blocos, nessa ordem: Etapas → Mapeamento do agente → Vocabulário/campos.

## 1. Trocar as etapas (colunas do quadro)

Na seção "Etapas deste funil" você pode, direto na tela, sem tocar em banco:

- **Renomear** cada coluna (clique no nome, edita, Enter/blur confirma).
- **Criar** colunas novas com "Acrescentar etapa ao fim".
- **Reordenar** com as setas ↑/↓ de cada linha.
- **Arquivar** uma coluna que não serve mais (é a única forma de "remover" — a FK
  `crm_leads_stage_id_fkey` é `ON DELETE RESTRICT`, então o histórico nunca é apagado, só a coluna
  sai do quadro). Se a etapa tiver negócios parados nela, a tela pergunta para onde eles vão antes de
  deixar arquivar.
- Marcar **qual coluna é a de fechamento** (`is_won`) e **qual é a de perda** (`is_lost`) — exatamente
  uma de cada por pipeline; marcar uma nova desmarca a anterior, com confirmação explícita.

Para o seu caso, um roteiro possível:

1. Arquive as colunas de e-commerce ("Carrinho abandonado", "Aguardando pagamento", "Pago", "Em
   separação", "Enviado", "Entregue", "Pós-venda", "Cancelado"). Numa instalação recém-criada não há
   negócio nenhum parado nelas, então arquivar é direto.
2. Crie, na ordem que fizer sentido para o seu funil: **"Consulta agendada"**, **"Consulta
   realizada"**, **"Proposta enviada"**, **"Contrato assinado"**, e alguma etapa de recusa/desistência
   (ex.: **"Não avançou"**).
3. Marque **"Contrato assinado"** como a etapa de fechamento e **"Não avançou"** (ou o nome que você
   escolher) como a de perda.
4. Em "Motivos de perda", liste as razões específicas do seu funil (ex.: "Não retornou contato,
   Proposta recusada, Escolheu outro escritório, Fora da área de atuação") — isso alimenta o
   seletor que aparece quando um caso é perdido e os relatórios de motivo de perda.

Se você tiver um agente de IA atuando nesse pipeline, ainda na mesma tela há a seção **Mapeamento do
agente**, que liga cada etapa nova a um passo do fluxo do assistente (para onde ele move o card
automaticamente em cada momento do atendimento). Vale revisar depois de renomear/arquivar etapas,
porque arquivar uma etapa que o agente usava desliga esse vínculo em silêncio (a tela avisa isso na
hora de arquivar).

## 2. Trocar o vocabulário para "cliente"/"caso"

Mais abaixo, no bloco "Vocabulário e campos" (visível só para `admin`+ — a leitura das etapas é
`manager`+, mas vocabulário e custom fields exigem `admin` de propósito, porque mudam como a empresa
inteira chama as coisas), há quatro campos livres:

- **Lead** → digite `Cliente`
- **Deal** → digite `Caso`
- **Won** → digite algo como `Ganho` ou `Contrato assinado`
- **Lost** → digite `Perdido` (ou o termo que preferir)

Isso grava em `crm_pipelines.vocabulary` (jsonb) e propaga sozinho para: o quadro Kanban, o dossiê do
negócio, os relatórios de atividade (`lib/reports/atividades.ts`), a ferramenta MCP
`crm_list_pipelines` (que expõe o vocabulário a qualquer integração) e — o ponto mais importante para
IA — os prompts de agente, via os tokens `{{vocabulary.lead}}`, `{{vocabulary.deal}}`,
`{{vocabulary.won}}`, `{{vocabulary.lost}}` (`lib/ai/render-system-prompt.ts`,
`lib/ai/guardrails-schema.ts`). Se o prompt do seu agente usa esses tokens em vez de escrever "lead"
literalmente no texto, ele passa a falar "cliente"/"caso" sem precisar editar o prompt. Se o prompt
tiver a palavra "lead" ou "negócio" escrita à mão, vale trocar por esses tokens ou reescrever
manualmente — o vocabulário do pipeline não reescreve texto livre do prompt, só os pontos que citam o
token.

## 3. Campos específicos do caso jurídico

Logo abaixo, "Campos do lead neste funil" deixa criar até 50 campos por pipeline
(`key`, `label`, `type`, opcional `required`, opcional `options` para select/multiselect). Eles
aparecem no dossiê do negócio e podem ser preenchidos por follow-up automático. Para um escritório,
sugestões:

- `area_direito` — select (Cível, Trabalhista, Tributário, Família, Criminal, ...)
- `numero_processo` — text
- `data_audiencia` — date
- `urgencia` — select ou boolean
- `origem_indicacao` — text

## O que a tela NÃO faz hoje: criar um segundo pipeline do zero

Se a ideia é **manter** o pipeline atual (por exemplo, se o escritório também atende outra frente de
negócio) e abrir um **pipeline separado** só para os casos jurídicos, isso esbarra numa lacuna real do
produto: existe um endpoint de API que cria pipeline novo com etapas —
`POST /api/v1/pipelines` (`app/api/v1/pipelines/route.ts`, exige role `manager`+, recebe `name` +
`description` opcional e semeia 4 etapas genéricas: "Novo", "Em andamento", "Ganho", "Perdido") — mas
**nenhuma tela do produto chama esse endpoint**. O próprio código documenta isso: quando a lista de
pipelines está vazia, a tela de Configurações mostra a mensagem "Criar o funil é feito por quem
instalou o sistema, direto no banco" (`app/app/settings/tenant/pipelines/_client.tsx`). Ou seja, hoje
não há botão "Novo pipeline" em lugar nenhum da interface, nem ferramenta MCP de escrita para isso (a
`crm_list_pipelines` do MCP só lê).

Na prática, para um segundo pipeline você tem duas opções, nenhuma passando pela tela:

1. Alguém com sessão de `manager`+ chama `POST /api/v1/pipelines` diretamente (ex.: via `fetch` no
   devtools do navegador logado, já que a rota não está na lista de rotas com bearer habilitado —
   `lib/auth/public-paths.ts` não a lista — então só cookie de sessão funciona hoje, não
   `Authorization: Bearer dsk_...`). Depois de criado, o pipeline novo aparece automaticamente na
   mesma tela de Configurações (ela lista todos os pipelines não arquivados da organização), e você
   configura etapas/vocabulário/campos exatamente como descrito acima.
2. Tratar isso como melhoria de produto: a capacidade de backend e a tela de edição já existem prontas
   para múltiplos pipelines — falta só o botão "Criar pipeline" na tela de Configurações chamando o
   `POST` que já existe. É um PR pequeno e autocontido (sem migration, sem mudança de schema), e seria
   o caminho correto para não deixar toda futura instalação dependendo de alguém rodar `fetch` à mão.

**Minha recomendação:** a menos que você realmente precise separar duas operações de negócio dentro do
mesmo tenant, reaproveite o único pipeline que já existe (passo 1-3 acima) — é 100% suportado pela
tela, não exige acesso técnico nenhum, e é o caminho testado do produto.
