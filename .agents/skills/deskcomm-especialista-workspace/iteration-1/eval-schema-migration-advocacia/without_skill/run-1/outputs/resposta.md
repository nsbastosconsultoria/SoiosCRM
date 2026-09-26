# Número do processo, área do direito e prazo processual — como adicionar certo

## Resposta curta

**Não crie migration, não mexa no `baseline.sql`, não adicione coluna em `crm_leads`.** Esses três campos são dado de um nicho específico (escritório de advocacia), e o CRM já tem o mecanismo certo para isso, pronto e sem precisar de código novo: **campos personalizados por pipeline** (`crm_pipelines.settings.fields`, schema declarativo, validado por Zod). É configuração feita pelo admin da organização, pela tela, e não afeta nenhuma outra instalação — porque nenhuma linha de schema muda.

## Por que não é coluna nova (a doutrina DIRC + doutrina de extensões)

Antes de adicionar campo, o `CLAUDE.md` manda perguntar **D-I-R-C** (Duplicar / Integrar / Referenciar / Calcular). Aqui a resposta é: é dado genuinamente novo, não vem de FK, não é ponteiro, não é calculável — então **algum lugar tem que guardar isso**. A pergunta que decide o *onde* é a da doutrina de extensões: **"se nenhuma organização ativar isto, a operação comum continua inteira?"** Para número de processo / área do direito / prazo processual, a resposta é obviamente sim — nenhuma clínica, imobiliária ou loja precisa desses campos. Isso descarta de cara alterar o núcleo (`crm_leads` como tabela, migration, `baseline.sql`): mudar schema central para atender um nicho é exatamente o anti-pattern que a doutrina quer evitar, e é o motivo de o produto já ter construído a saída declarativa.

O ponto de extensibilidade do CRM para "esse tenant/nicho precisa de campos que nenhum outro precisa" já existe em produção: `crm_pipelines.settings.fields`, um array validado por `customFieldSchema` (`lib/schemas/settings.ts`):

```ts
export const customFieldSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/i, "Use letras, números e underscore"),
  label: z.string().min(1).max(80),
  type: z.enum([
    "text", "textarea", "number", "date", "select",
    "multiselect", "boolean", "email", "phone", "url",
  ]),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
});
```

Isso é exatamente a instrução do `CLAUDE.md` em "Modelagem": *"`custom_fields jsonb` com schema declarativo em `pipeline.settings.fields`; Zod construído dinamicamente"*. O valor de cada lead fica em `crm_leads.custom_fields` (jsonb), lido de forma central por `lib/leads/campos-do-funil.ts` (`camposDoFunil()`), nunca por leitura de path solto — o que evita o anti-pattern nº 6 da lista ("jsonb lock-in: UI lê path direto sem schema central").

## O que fazer, na prática

1. **Configurações › Pipelines** (`/app/settings/tenant/pipelines`), no pipeline usado pelo escritório → seção de campos personalizados. Adicionar três campos:

   | key | label | type | notas |
   |---|---|---|---|
   | `numero_processo` | Número do processo | `text` | free text; o schema atual não tem máscara/regex por campo, então não valida formato CNJ automaticamente — se isso vier a importar, é evolução do `customFieldSchema`, não deste caso |
   | `area_direito` | Área do direito | `select` | `options`: `trabalhista` / `civel` / `criminal` (value técnico) com label "Trabalhista" / "Cível" / "Criminal" |
   | `prazo_processual` | Prazo processual | `date` | tipo `date` já é o que o motor de automação sabe interpretar (próximo item) |

   Isso grava em `crm_pipelines.settings.fields`, valida pelo mesmo Zod (`pipelineConfigPatchSchema`, máx. 50 campos) que já protege a rota hoje. Zero migration, zero deploy, zero risco pra quem já instalou — porque nenhuma linha de schema mudou, só uma linha de configuração daquele tenant.

2. **Prazo processual como alerta, não só como dado parado.** O produto já tem um gatilho de automação pronto para "campo de data do funil vencendo": `GATILHO_DE_DATA_DO_FUNIL` (`lib/automation/gatilho-de-data-do-funil.ts`, evento `lead.date_field_due`), varrido pelo cron `app/api/v1/cron/lead-date-field-due/route.ts`. Ele já resolve:
   - fuso da organização (dispara na hora local certa, não em UTC);
   - "N dias antes" de qualquer campo tipo `date` do `custom_fields` (aqui, `dias` positivo antes do prazo);
   - só varre organizações que **têm regra ativa** desse gatilho (não paga custo pra quem não usa);
   - trava idempotente por (regra, negócio) — não dispara duas vezes.

   Ou seja: depois de criar o campo `prazo_processual`, basta o escritório criar uma **regra de automação** apontando `pipeline_id` + `campo: "prazo_processual"` + `dias: N` (ex.: avisar 5 dias antes do prazo fatal) e plugar a ação (mensagem no WhatsApp do responsável, mover o card, etiqueta). Isso não é feature nova — é o mesmo caminho já usado para "avise X dias antes do casamento" em outro nicho. Não precisa escrever nenhum código.

3. **Área do direito** como `select` já dá filtro, agrupamento e Kanban coerentes sem esforço — e como é campo declarado centralmente (não string solta), relatório e board leem do mesmo lugar.

4. Se quiser, o pipeline também aceita **vocabulário customizado** (`pipeline.settings.vocabulary`) — dá pra renomear "lead"/"negócio" para "Caso" ou "Processo" na tela do escritório, do mesmo jeito que o e-commerce renomeia lead→Cliente. Não é obrigatório, mas fica mais natural para quem usa.

## Quando isso deixaria de bastar (e o que fazer se acontecer)

Custom field em `jsonb` é a escolha certa **até virar hot path** — a mesma régua que o `CLAUDE.md` usa para `tags text[]` ("promove pra coluna gerada apenas quando vira hot path"). Sinais de que isso mudaria:

- Precisar de **unicidade** de número de processo por organização (hoje nada impede dois leads com o mesmo `numero_processo`, porque é jsonb sem constraint).
- Precisar de **índice/performance** em filtro ou relatório sobre milhares de leads por `numero_processo` ou `area_direito` (hoje não há índice em `custom_fields->>campo` — é varredura, e o próprio cron de data documenta isso como limite não medido em base grande).
- Precisar de **validação forte de formato** (máscara CNJ `NNNNNNN-DD.AAAA.J.TR.OOOO`), que o `customFieldSchema` atual não suporta por campo.

Se algum desses aparecer de verdade, aí sim é caso de migration — e nesse momento a doutrina de migrations do `CLAUDE.md` se aplica inteira, não pela metade:

1. Arquivo em `supabase/migrations/` com o próximo `NNNN` tirado por `pnpm checar:colisao-de-migration` (nunca pelo último arquivo listado).
2. `add column if not exists`, idempotente, portável em `psql` puro (sem `BEGIN/COMMIT`, sem temp table fora de transação).
3. Se virar `unique (organization_id, numero_processo)`: **deduplicar os dados existentes antes** de criar a constraint — senão o `update.sh` de quem já tem dois processos "iguais" quebra ao atualizar.
4. Backfill dos valores que já estão em `custom_fields->>'numero_processo'` para a coluna nova, genérico (não hardcode de tenant).
5. Apêndice idempotente correspondente em `supabase/baseline.sql` (é o que o `install.sh`/`update.sh` do self-host realmente aplica — sem isso, quem já instalou nunca recebe a mudança).
6. Linha no `supabase/migrations/MANIFEST.md`.
7. Validar num Postgres descartável: `install` fresh (`ON_ERROR_STOP=1`) e `update` num banco com dados, os dois passando.
8. Regenerar `lib/database.types.ts`.
9. RLS: como a coluna nasce dentro de `crm_leads`, que já é tenant-aware, a policy `tenant_isolation_crm_leads_all` já cobre — não precisa de policy nova, mas vale rodar `pnpm test:db` (schema/RLS não é coberto por `pnpm test:unit`).

Mas para o pedido de hoje — três campos de um escritório de advocacia — isso é over-engineering. **A resposta certa é configurar, não migrar.**

## Resumo

- Use **campos personalizados do pipeline** (`Configurações › Pipelines`): `numero_processo` (text), `area_direito` (select: trabalhista/civel/criminal), `prazo_processual` (date). Feito pela tela, pelo admin da organização, sem PR, sem migration, sem tocar em nenhum outro tenant.
- **Prazo processual já pode virar alerta automático** via o gatilho de automação existente para campos de data do funil (`lead.date_field_due`) — só criar a regra.
- Só promova a colunas reais de schema (com migration + apêndice no `baseline.sql` + MANIFEST) se e quando precisar de unicidade, índice para escala ou validação de formato forte — e aí seguindo a doutrina de migrations inteira, com backfill dos dados que já estão em `custom_fields`.
