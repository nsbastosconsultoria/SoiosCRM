# Spec 21 — Módulo `carteira` (empresas atendidas, vínculos e contexto da conversa)

> **Status:** rascunho para revisão do dono. Pré-implementação — nada deste documento existe no código.
> **Destino (DoD 18):** **ambos**. O módulo é opcional (ADR-0002); o núcleo ganha **um** ponto de
> extensão no roteador (§7), cujo consumidor real é este módulo.
> **Origem:** implantação de um escritório de contabilidade com **um único número de WhatsApp**
> (modelo `modelo-escritorio-contabilidade-soioscrm-v3-jornada-completa.md`, §§ 10, 22, 23, 34, 35).
> O módulo é **genérico**: serve a qualquer operação B2B que atende empresas recorrentes
> (contabilidade, agência, TI gerenciada, despachante, consultoria). O vocabulário contábil entra
> por modelo de nicho (§10), nunca no schema.
> **Spec irmã:** [`22-spec-modulo-protocolos.md`](22-spec-modulo-protocolos.md), que depende desta.

---

## 1. Problema

Com um número só, a primeira mensagem de qualquer pessoa cai no mesmo lugar, e o sistema precisa
responder duas perguntas antes de qualquer outra coisa: **quem escreve já é cliente?** e **de qual
empresa ele está falando?** Hoje o produto não consegue responder nenhuma das duas.

Medido na `main` @ `2d8e92a11` (v1.65.3):

| Fato | Onde |
|---|---|
| O contato do WhatsApp (`contacts`) é **pessoa física**; liga-se a uma pessoa B2B por `contacts.person_id` | `baseline.sql`, `contacts` + migration 0239 (`add column if not exists person_id`) |
| A empresa existe (`companies`, com CNPJ normalizado e único por organização, enriquecimento pela BrasilAPI) | `baseline.sql`, `companies` + `companies_org_normalized_cnpj_uidx`; `lib/crm-b2b/` |
| A pessoa liga-se a várias empresas por `company_people` (N:N, com cargo, departamento, decisor e principal). **O caminho contato → pessoa → empresas já existe no núcleo** | `baseline.sql`, `company_people`; `lib/crm-b2b/people-handler.ts` (`contacts.person_linked`) |
| A empresa não tem estado de relacionamento (prospect, ativo, suspenso…), grupo, matriz/filial nem responsáveis por área | — |
| A conversa não tem empresa ativa (`conversations` tem `current_demanda_id`, `active_ai_agent_id`, `active_intent`, nenhum `company_id`) | `baseline.sql`, `conversations` + apêndices |
| O roteador decide pela **intenção da última mensagem** (com sticky e fallback); não consulta relacionamento | `lib/agent-engine/agent/resolve-turn-agent.ts`, `lib/ai/decisao/roteador.ts` |

Consequências na operação: um cliente ativo que escreve "quanto custa abrir outra empresa?" vai
para o Comercial e recebe diagnóstico de lead; um caso aberto pelo Atendimento não sabe a que CNPJ
pertence; um contato que representa três empresas obriga a equipe a perguntar tudo de novo.

## 2. O que esta spec entrega, e o que não entrega

| Entrega | Não entrega (e por quê) |
|---|---|
| O que falta ao vínculo do núcleo para o atendimento: papel em vocabulário fechado, áreas que a pessoa recebe, desativar sem apagar | Um segundo vínculo contato × empresa — o núcleo já tem (§4.4) |
| **Perfil de relacionamento** da empresa: estado do ciclo de vida, cliente desde, grupo, matriz/filial | Campos fiscais especializados como colunas (regime, faturamento) — vão em `atributos` com schema declarativo (§4.3) |
| **Grupo empresarial** | Consolidação financeira do grupo — fora do escopo |
| **Carteira interna**: responsável por empresa **por área** | Permissão por empresa (sigilo entre carteiras) — Q3 |
| **Empresa ativa da conversa**, com histórico de troca | Mover histórico entre empresas — proibido por desenho (§6.3) |
| **Ponto de extensão no roteador**: regra de relacionamento antes da classificação (§7) | Roteamento por área dentro do Atendimento — é fila/carteira (spec 22) |
| Ferramentas do agente (§8), API, tela, auditoria, LGPD | Onboarding/implantação (prospect → ativo por checklist) — módulo `implantacao`, spec futura; aqui a transição é manual ou pela API |

## 3. Princípio de reuso (DIRC)

| Peça existente | Papel aqui | DIRC |
|---|---|---|
| `companies` (núcleo) | **A** empresa. O módulo nunca cria outra tabela de empresa | Integrar (FK) |
| `companies_org_normalized_cnpj_uidx` | Deduplicação por CNPJ já resolvida pelo núcleo | Integrar |
| `lib/crm-b2b/enrich.ts` (BrasilAPI) | Preencher razão social, CNAE, situação ao cadastrar por CNPJ | Integrar |
| `contacts` (núcleo) | **A** pessoa que escreve | Integrar (FK) |
| `contacts.person_id` + `people` + `company_people` (núcleo, 0239) | **O** vínculo de quem escreve com as empresas. O módulo só detalha | Integrar (FK 1:1) |
| `conversations.current_demanda_id` | Molde de "contexto corrente" já usado na conversa | Referenciar o padrão |
| `crm_leads` | A oportunidade comercial continua sendo o lead; o perfil não duplica funil | Referenciar |
| `api_audit_log` + `lib/audit/actions.ts` | Auditoria de toda mutação | Integrar |
| `event_log` | Eventos para quem consome (roteador, protocolos, métricas) | Integrar |
| Mecanismo de módulo (ADR-0002; migrations 0325/0340; exemplo `honorarios`, 0480) | Provisionadora, instalação, reaplicação, LGPD por `to_regclass` | Integrar |

**Código realmente novo:** 1 provisionadora com 6 tabelas, 1 ponto de extensão no roteador,
5 ferramentas de agente, rotas `/api/v1/carteira/*`, 1 tela com 3 abas, eventos e auditoria.

## 4. Modelo de dados (corpo de `fn_carteira_provisionar()`)

Todas as tabelas: `organization_id uuid not null references public.organizations(id) on delete
cascade`, `created_at`, `updated_at`, `text` + CHECK (nunca enum), RLS por operação aplicada pela
própria função antes de `fn_proteger_modulo_provisionado()` (molde da 0480).

### 4.1 `carteira_grupos` — grupo empresarial

```text
id uuid pk
organization_id
nome text not null (não vazio)
descricao text
responsavel_user_id uuid → auth.users (set null)
ativo boolean not null default true
unique (organization_id, nome)
```

### 4.2 `carteira_perfis` — o relacionamento com a empresa (1:1 com `companies`)

```text
company_id uuid pk → companies(id) on delete cascade
organization_id
estado text not null default 'prospect'
  check in ('prospect','em_qualificacao','proposta','em_implantacao','ativo','suspenso','em_distrato','inativo')
cliente_desde date                         -- preenchido na 1ª entrada em 'ativo'; nunca regravado
grupo_id uuid → carteira_grupos (set null)
tipo_estabelecimento text check in ('matriz','filial') null
matriz_company_id uuid → companies (set null)
atributos jsonb not null default '{}'      -- validado por schema declarativo (§4.3)
estado_alterado_em timestamptz not null default now()
estado_alterado_por uuid → auth.users (set null)
check (tipo_estabelecimento = 'filial' or matriz_company_id is null)
check (matriz_company_id is null or matriz_company_id <> company_id)
```

- **Por que tabela 1:1 e não colunas em `companies`:** a provisionadora não pode escrever no núcleo
  (ADR-0002, D4; `tests/invariants/provisionadora-de-modulo.test.ts` reprova DML/DDL fora do módulo).
- **Matriz e filial ficam em empresas distintas**, cada uma com o seu CNPJ. Caso, conversa e
  documento continuam presos ao CNPJ certo (modelo §22.6).
- **Prospect vira cliente no mesmo registro** (modelo §22.3): só `estado` muda. Não há "converter".
- Empresa sem perfil é tratada como `desconhecido` pelo resolvedor (§7); o perfil nasce no primeiro
  vínculo ou na primeira edição pela tela.

**Transições permitidas** (função `fn_carteira_transicionar`, a única escrita de `estado`):

| De | Para |
|---|---|
| `prospect` | `em_qualificacao`, `proposta`, `em_implantacao`, `ativo`¹, `inativo` |
| `em_qualificacao` | `prospect`, `proposta`, `em_implantacao`, `inativo` |
| `proposta` | `em_qualificacao`, `em_implantacao`, `inativo` |
| `em_implantacao` | `ativo`, `inativo` |
| `ativo` | `suspenso`, `em_distrato`, `inativo` |
| `suspenso` | `ativo`, `em_distrato`, `inativo` |
| `em_distrato` | `ativo`, `inativo` |
| `inativo` | `prospect` (reativação; `cliente_desde` preservado) |

¹ `prospect → ativo` existe para carregar a carteira de quem já é cliente há anos — exigir o
funil inteiro para cadastrar um cliente antigo seria mentir sobre como ele chegou.

Toda transição grava `carteira_eventos` (§4.6) por gatilho, e a rota audita
`carteira.estado_alterado`. Transição fora da tabela → `409 carteira_transicao_invalida`.
Implementado na migration 0902; `authenticated` e `service_role` não têm UPDATE em `estado`,
`cliente_desde` e `estado_alterado_*` (privilégio de coluna).

### 4.3 Atributos por nicho — `organizations.settings.carteira.atributos`

Mesmo padrão de `pipeline.settings.fields` (CLAUDE.md, Modelagem): schema declarativo por
organização, Zod construído dinamicamente, UI lê pelo schema central, nunca por path direto
(anti-pattern 6). O modelo de nicho "contabilidade" (§10) semeia:

`regime_tributario` (select), `quantidade_funcionarios` (number), `faturamento_faixa` (select),
`volume_notas` (select), `atividade_principal` (text). CNAE, porte, situação cadastral e natureza
jurídica **já estão em `companies`** — não duplicar (DIRC).

### 4.4 O vínculo é o do núcleo; `carteira_vinculo_detalhes` só detalha

> **Correção de 2026-10-04.** A primeira versão desta spec dizia que `people` não se ligava a
> `contacts` e criava `carteira_vinculos` (contato × empresa). Era falso: `contacts.person_id` e
> `company_people` (migration 0239) já fazem contato → pessoa → empresas, N:N. Uma segunda tabela
> para o mesmo fato seria duas fontes de verdade (anti-pattern 2). Decisão do dono: reusar o núcleo.

O vínculo "quem escreve representa a empresa X" é **contato → `contacts.person_id` → `company_people`**.
Cargo, departamento, decisor e principal ficam lá. O módulo acrescenta, 1:1 com `company_people`:

```text
company_people_id uuid pk → company_people(id) on delete cascade
organization_id
papel text not null default 'outro' check in ('socio','administrador','financeiro','rh','fiscal','procurador','funcionario','contador_externo','outro')
areas text[] not null default '{}'         -- áreas que esta pessoa recebe (§4.5.1); vazio = todas
ativo boolean not null default true        -- desativar sem apagar
origem text not null check in ('manual','agente','importacao','api')
```

- **Vínculo sem detalhe vale como ativo**: o que alguém ligou pela tela de Pessoas conta para a carteira.
- Desativar (`ativo=false`) e não apagar: a conversa antiga continua apontando para a empresa certa.
  Apagar o `company_people` no núcleo (papel `manager`, regra do núcleo) leva o detalhe por cascata.
- Criar o vínculo segue as regras do núcleo: `company_people` exige `manager`+ para inserir e
  `agent`+ para editar (0239). Contato sem pessoa ganha uma pessoa nova na primeira ligação
  (nome do contato, ou o telefone se não houver nome).
- A junção de contatos (`fn_mesclar_contatos`) não reponta `contacts.person_id` (é FK que SAI de
  `contacts`): se o contato absorvido tinha pessoa e o principal não, o vínculo não segue. É regra
  do núcleo, registrada aqui como risco conhecido (Q5).

### 4.5 `carteira_responsaveis` — carteira interna por área

```text
id uuid pk
organization_id
company_id uuid not null → companies(id) on delete cascade
area text not null                       -- slug do vocabulário de áreas da organização (§4.5.1)
user_id uuid not null                    -- FK composta (organization_id, user_id) → user_organizations, como channel_routing_responsibles
principal boolean not null default true
vigencia_inicio date not null default current_date
vigencia_fim date
check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
partial unique (organization_id, company_id, area) where principal and vigencia_fim is null
```

#### 4.5.1 Vocabulário de áreas — `organizations.settings.atendimento.areas` (compartilhado)

Lista de `{ slug, rotulo }` por organização, em `lib/atendimento/areas.ts`. Genérico no schema; o
modelo "contabilidade" semeia `relacionamento, contabil, fiscal, dp, societario, tributario,
financeiro`. A spec 22 usa **o mesmo vocabulário** para a fila do protocolo: uma só fonte de
verdade das áreas. A chave é neutra (`atendimento`, não `carteira`) porque os protocolos funcionam
sem a carteira instalada (decisão do dono, 2026-10-04). Membros e líder de cada área são id de
usuário e não moram neste jsonb: vivem em tabela com chave estrangeira, no módulo protocolos.

### 4.6 `carteira_contexto_conversa` + `carteira_eventos`

```text
carteira_contexto_conversa                 -- uma linha por PERÍODO de contexto (append-only)
id uuid pk
organization_id
conversation_id uuid not null → conversations(id) on delete cascade
company_id uuid → companies(id) on delete set null
definido_por text not null check in ('automatico_unico_vinculo','agente','humano','cliente_informou')
definido_por_user_id uuid
inicio timestamptz not null default now()
fim timestamptz                            -- null = contexto corrente
partial unique (conversation_id) where fim is null
```

```text
carteira_eventos                           -- timeline append-only do módulo
id, organization_id, company_id, contact_id null, conversation_id null,
tipo text not null (vocabulário fechado em TS + CHECK),
anterior jsonb, novo jsonb, ator_kind text check in ('humano','ia','sistema'), ator_user_id uuid,
correlation_id uuid, created_at
```

**Por que não uma coluna `conversations.company_id`:** a provisionadora não altera o núcleo (D4), e
a troca de empresa precisa de histórico (modelo §23.6: "alterar o contexto apenas para eventos
futuros"). Um período fechado nunca é reaberto; trocar a empresa fecha o período corrente e abre outro.
O caso/protocolo grava o `company_id` **no momento da abertura** (spec 22) — por isso trocar o contexto
depois nunca move um caso de empresa.

Append-only: sem policy de UPDATE/DELETE para `authenticated`; `revoke update, delete, truncate`
de `anon, authenticated, service_role` em `carteira_eventos` (lição da migration 0258). Em
`carteira_contexto_conversa`, a única escrita além do INSERT é o fechamento (`fim`), feito por
`fn_carteira_definir_contexto` (`security definer`, `revoke ... from public, anon`).

## 5. Identificação na entrada (resolvedor)

`lib/carteira/resolver.ts` — função pura de leitura, chamada pelo roteador (§7) e pelas ferramentas:

```text
resolverRelacionamento(orgId, contactId) → {
  situacao: 'cliente_ativo' | 'cliente_inativo' | 'prospect' | 'desconhecido',
  empresas: [{ company_id, nome, cnpj_mascarado, estado, papel }],   -- só vínculos ativos
  contexto_corrente: company_id | null
}
```

Regras (modelo §23):

1. Telefone localiza o **contato** (o núcleo já faz isso na ingestão); o contato **nunca** identifica
   sozinho a empresa quando há mais de um vínculo.
2. `cliente_ativo` ⇔ ao menos um vínculo ativo com empresa em `ativo`, `suspenso`, `em_distrato` ou
   `em_implantacao` (quem está em implantação já é cliente para o atendimento).
3. **Um** vínculo ativo com empresa cliente e nenhum contexto corrente ⇒ o resolvedor **propõe** o
   contexto automático; quem grava é `fn_carteira_definir_contexto` com
   `definido_por='automatico_unico_vinculo'`.
4. **Vários** vínculos ⇒ sem contexto automático. O agente pergunta qual empresa (§8), salvo se
   inferir com segurança pelo CNPJ ou nome citado — e, nesse caso, grava `definido_por='agente'`.
5. Sem vínculo ⇒ `desconhecido` (contato novo) ou `prospect` (vínculo só com empresa prospect).
6. **Falha aberta:** qualquer erro de leitura (tabela ausente porque o módulo não está instalado,
   `42P01`/`PGRST205`, banco lento) devolve `desconhecido` e registra `log.warn`. Um lead real está
   esperando resposta; o resolvedor nunca pode silenciar o turno — mesma regra de robustez de
   `resolve-turn-agent.ts` (cabeçalho, "o router é estritamente aditivo").

## 6. Regras de negócio

1. **Nunca criar empresa fictícia** porque chegou uma mensagem (modelo §23.2). Empresa nasce por
   CNPJ informado, cadastro humano, importação ou ferramenta explícita do agente (§8).
2. **Deduplicação antes de criar** (modelo §22.8): CNPJ normalizado exato (o índice único do núcleo já
   impede duplicar); sem CNPJ, busca por nome normalizado na organização e devolve candidatos —
   **nunca** sobrescreve dado conflitante em silêncio; o conflito vira pendência na tela.
3. **Troca de empresa no meio do chat** fecha o período e abre outro; nada do passado é movido.
4. **Cross-sell** (modelo §35-F): cliente ativo que pede serviço novo gera **lead novo** ligado à
   mesma empresa (`crm_lead_links`), sem rebaixar o `estado` do perfil.
5. **Ganho de oportunidade** (lead em etapa `won` de um funil marcado como "comercial da carteira",
   `organizations.settings.carteira.funil_comercial_id`) leva o perfil a `em_implantacao` — consumidor
   do evento de etapa já existente. `ativo` é decisão humana (ou do futuro módulo `implantacao`).

## 7. Núcleo: regra de relacionamento no roteador (ponto de extensão)

**Mudança em `lib/agent-engine/agent/resolve-turn-agent.ts` e `ai_routers.config`.**

```jsonc
// ai_routers.config (jsonb já existente; chave nova, opcional)
"relacionamento": {
  "cliente_ativo": "<intent_name do membro>",  // ex.: "atendimento"
  "cliente_inativo": null,                     // null = segue a classificação normal
  "prospect": null,
  "desconhecido": null,
  "permite_reclassificar": true                // §7.2
}
```

### 7.1 Ordem de decisão nova (implementada no PR-B)

```text
campanha (degrau 0 de antes) → roteador ativo?
0. config.relacionamento E a situação do contato tem membro?
     a conversa já saiu desse membro por reclassificação (sticky em OUTRO agente)? ─► regras de sempre
     sem mensagem (follow-up) ou permite_reclassificar=false ─► membro da situação ('relationship')
     classificador: outra intenção, confiança ≥ mínima ─► membro dela ('relationship_overridden')
     senão ─► membro da situação ('relationship')
1..7. regras atuais (sticky → classificação → fallback → genérico), inalteradas
```

Aponta pelo **nome da intenção** (`intent_name`, único por roteador), não pelo id do membro: salvar
os membros regrava as linhas e troca os ids, e a regra apontaria para um membro que não existe mais.

**Por que "já saiu por reclassificação" desliga a regra:** depois de "quero abrir outra empresa" o
cliente está no Comercial; a resposta seguinte ("é no ramo de marketing") não tem intenção clara, e
sem essa exceção a regra o devolveria ao Atendimento no meio da conversa comercial. Volta ao
Atendimento quando o classificador reconhecer essa intenção, como em qualquer troca de assunto.

**Roteiro de atendimento:** a regra decide todo turno de quem é cliente; quando devolve o agente que
já atendia (o sticky), é continuação e não recomeça o roteiro (`flowPointerId` nulo), como o sticky.

### 7.2 Reclassificação controlada

Com `permite_reclassificar=true` (padrão), um cliente ativo que expressa outra intenção com
confiança `>= min_confidence` vai para o membro dela, com outcome `relationship_overridden`. Com
`false`, cliente ativo vai sempre ao membro do relacionamento, e o classificador nem roda.

### 7.3 Contrato e robustez

- O núcleo recebe o resolvedor por injeção (`ResolveTurnAgentDeps.resolverRelacionamento`); o
  padrão é `situacaoDaConversa` (`lib/carteira/resolvedor.ts`, sobre `pg`). Resolvedor que falha
  (módulo desinstalado, banco lento) vira `desconhecido` com `log.warn`; sem membro para
  `desconhecido`, é o roteamento de antes.
- Roteador sem `config.relacionamento` não chama o resolvedor: zero custo para quem não usa.
- `ai_router_decisions.outcome` ganha `relationship` e `relationship_overridden` (migration 0903,
  núcleo). O PATCH do roteador valida a forma de `config.relacionamento` (Zod estrito).
- A tela do roteador ganha o card "Quem já é cliente" (`app/app/ai/routers/[id]/_relacionamento.tsx`),
  só com o módulo instalado, que oferece só intenções já salvas.
- Uma leitura por turno, antes do classificador; sem reclassificação permitida, o classificador
  nem roda (custo zero de LLM quando o relacionamento decide).
- O Jev não é consultado no caminho da regra 0 (ele só observa o classificador de sempre).

## 8. Ferramentas do agente (catálogo MCP, `modulo: "carteira"`)

Padrão de `lib/mcp/tools/catalogo/honorarios.ts`: somem do agente e da tela de capacidades com o
módulo desligado (`deModuloDesligado`); lançam erro explicativo se a tabela não existir.

| Tool | Categoria | Risco | Pacotes | O que faz | Estado |
|---|---|---|---|---|---|
| `crm_carteira_empresas_do_contato` | read | seguro | `atender` | Empresas da pessoa da conversa (nome, 4 últimos dígitos do CNPJ, estado, papel), a situação e a empresa corrente | PR-B |
| `crm_carteira_definir_empresa_da_conversa` | write | atenção | `atender` | Define a empresa da conversa; o banco só aceita empresa ligada à pessoa | PR-B |
| `crm_carteira_buscar_empresa` | read | seguro | `atender` | Busca na carteira por nome ou dígitos do CNPJ; devolve candidatas, nunca cria | PR-B |
| `crm_carteira_cadastrar_prospect` | write | — | `vender` | Cria empresa prospect + vínculo | **adiada**: falta a medição de folga do pacote `vender` (abaixo) |
| `crm_carteira_vincular_contato` | write | crítica | — | Liga a pessoa a uma empresa CLIENTE | **adiada** (Q4): o caminho é o humano, pela ficha da carteira |

`crm_carteira_definir_empresa_da_conversa` entra em `ESCRITA_QUE_E_TRABALHO_DE_ATENDENTE`
(`tests/unit/capacidade-alcancavel-pelo-agente.test.ts`) com a paridade da rota
`POST /carteira/conversas/:id/contexto`, que exige `agent`.

**Pacote `vender`:** o comentário de `honorarios.ts` registra que `vender` já consome quase toda a
folga do teto de capacidades (`pacote-reserva-vaga-da-critica.test.ts`). Antes de pôr duas tools em
`vender`, medir a folga; se faltar vaga, ficam só em `atender` e o Comercial recebe
`crm_carteira_cadastrar_prospect` como capacidade avulsa.

**Segurança das tools:** nenhuma devolve CNPJ completo, CPF, e-mail ou telefone de **outro** contato
da empresa ao modelo — só o que o próprio contato já informou (mesmo princípio de
`crm_list_team_members`, que não devolve nome/e-mail ao modelo).

## 9. API e tela

**API** (`/api/v1/carteira/…`, wrappers `ok()/fail()`, Zod estrito, `requireRole`,
`requireSupportWrite` antes do efeito, auditoria em toda mutação; regra de negócio em
`lib/carteira/servico.ts`, erro do banco traduzido em `lib/carteira/erros.ts`). Implementado no PR-A2:

```text
GET    /carteira/empresas?estado=&q=&limit=          viewer   -- lista (perfil + empresa)
POST   /carteira/empresas                            manager  -- põe na carteira (cria pelo CNPJ se preciso; estado_inicial prospect|ativo)
GET    /carteira/empresas/:company_id                viewer   -- ficha: perfil, empresa, pessoas (núcleo), detalhes, responsáveis, linha do tempo, áreas
PATCH  /carteira/empresas/:company_id                manager  -- grupo, matriz/filial, atributos (estado NÃO)
POST   /carteira/empresas/:company_id/estado         manager  -- transição (§4.2), via fn_carteira_transicionar
POST   /carteira/empresas/:company_id/vinculos       manager  -- liga contato (pessoa → company_people → detalhe)
PATCH  /carteira/vinculos/:company_people_id         agent    -- papel, áreas, ativo (cria o detalhe se faltar)
POST   /carteira/empresas/:company_id/responsaveis   manager  -- define o principal da área (encerra o anterior)
POST   /carteira/responsaveis/:id/encerrar           manager  -- encerra a vigência
GET/POST /carteira/grupos                            viewer / manager
```

Criar vínculo é `manager` (e não `agent`, como dizia a versão anterior desta seção) porque inserir em
`company_people` é `manager`+ na RLS do núcleo (0239); editar o detalhe é `agent`, o mesmo degrau
de editar `company_people`. No PR-B: `GET/POST /carteira/conversas/:conversation_id/contexto` (`viewer` / `agent`), com
o seletor de empresa no cabeçalho da conversa (`components/inbox/EmpresaDaConversa.tsx`). Fora desta versão: `Idempotency-Key` nos POSTs (a carteira repete a
operação com o mesmo efeito — `upsert`, "mesma pessoa de novo não muda nada"), filtros por grupo e
responsável na lista.

**Tela** `app/app/carteira/` (porta em `lib/navigation/catalogo.ts`, grupo CRM; some com o módulo
desligado): lista de empresas com filtro por estado/grupo/responsável; ficha com abas
**Relacionamento** (estado + linha do tempo de `carteira_eventos`), **Contatos** (vínculos) e
**Responsáveis** (por área). Na **inbox**, o cabeçalho da conversa mostra a empresa ativa com troca
em um clique, e os vínculos do contato no painel lateral.

## 10. Modelo de nicho "contabilidade"

Semente aplicada por ação explícita do administrador da organização (nunca automática): as áreas
de §4.5.1, os atributos de §4.3, o roteador com `relacionamento.cliente_ativo = Atendimento` e as
categorias da spec 22. Mora em `lib/carteira/modelos/contabilidade.ts`, ao lado de um modelo
`generico` (áreas: `relacionamento, operacao, financeiro`). Novo nicho = novo arquivo, sem migration.

## 11. Eventos, auditoria, LGPD

- **`event_log`:** `carteira.estado_alterado`, `carteira.vinculo_criado`, `carteira.vinculo_desativado`,
  `carteira.contexto_alterado`, `carteira.responsavel_alterado` — **entram junto com o primeiro
  consumidor**, nunca antes: o drain deixa evento sem handler `pending` para sempre (anti-pattern 3;
  nota da 0155 no MANIFEST). A migration 0902 não emite nenhum; a linha do tempo até lá é
  `carteira_eventos`, escrita por gatilho.
- **Auditoria** (`lib/audit/actions.ts`, no fim do array): `carteira.empresa_adicionada`,
  `carteira.perfil_atualizado`, `carteira.estado_alterado`, `carteira.vinculo_criado`,
  `carteira.vinculo_atualizado`, `carteira.responsavel_definido`, `carteira.responsavel_encerrado`,
  `carteira.grupo_criado` (PR-A2); `carteira.contexto_alterado` entra com a troca de contexto na inbox (PR-B).
- **LGPD (ADR-0002, D8):** nenhuma coluna do módulo é texto livre sobre a pessoa (papel, áreas,
  estado, ids, datas), e os gatilhos montam `carteira_eventos.anterior/novo` campo a campo, nunca
  com `to_jsonb(new)`. Por isso o módulo **não declara seção** em `modulo_secoes_lgpd` — mesma
  decisão da 0480. Vínculos e períodos de contexto sobrevivem à anonimização do contato (são
  operação, como `crm_leads.stage_id`). **Export:** a pessoa e as empresas a que ela está ligada já
  saem na seção `b2b` do export do núcleo (`lib/lgpd/export-collector.ts`, `people` +
  `company_people`), porque o vínculo é o do núcleo. O módulo não acrescenta seção.

## 12. Testes

- **Invariantes (`tests/invariants/`, `pnpm test:db`):**
  `carteira-provisionadora.test.ts` (forma da provisionadora, sem parâmetro, só `service_role`,
  RLS ligada, isolamento entre 2 organizações em toda tabela — molde de `honorarios-provisionadora`);
  transições de estado inválidas recusadas; append-only de `carteira_eventos` para os três papéis;
  um só contexto corrente por conversa; merge de contato reponta vínculos; cascata LGPD alcança o
  módulo e **pula sem erro** onde ele não está instalado.
- **Unit:** resolvedor (as 6 regras de §5, inclusive falha aberta); `resolve-turn-agent` com a regra
  0 (cliente ativo, reclassificação, módulo ausente = comportamento atual byte a byte nos testes
  existentes); tools com módulo desligado somem do catálogo.
- **E2E / prova em par (DoD 12):** cenários B, C, D e F do modelo §35 pela inbox, com o par
  (tela pelo agente + tool chamada direto) concordando.

## 13. Perguntas abertas (decisão do dono)

| # | Pergunta | Recomendação |
|---|---|---|
| Q1 | ~~Ligar `people` a `contacts` em vez de criar `carteira_vinculos`?~~ | **Resolvida (2026-10-04):** o núcleo já liga (`contacts.person_id`, 0239). Reusar o núcleo; o módulo só detalha (§4.4) |
| Q2 | Estado `em_implantacao` conta como cliente no roteador? | Sim (regra 2 de §5): quem acabou de contratar não pode voltar ao Comercial |
| Q3 | Sigilo por carteira (atendente vê só as empresas da própria carteira)? | Fora desta spec; `user_pipeline_access` também não está no MVP. Avisar o escritório |
| Q4 | `crm_carteira_vincular_contato` deve existir para a IA? | Sim, mas crítica e desligada por padrão; o caminho normal é o humano vincular pela inbox |
| Q5 | A junção de contatos deve levar `contacts.person_id` do absorvido quando o principal não tem pessoa? | Sim, mas é mudança do NÚCLEO (`fn_mesclar_contatos`), em PR próprio; até lá, religar pela tela |

## 14. Sistema vivo (DoD 13) e Definition of Done

- **Entrada:** inbox (vínculo/contexto), tela da carteira, tools do agente, importação, API.
- **Saída:** roteador (§7), protocolos (spec 22), métricas por empresa/grupo/responsável.
- **Laço de retorno (invariante 7):** cada decisão `relationship` grava `ai_router_decisions`;
  correção humana de contexto (`definido_por='humano'` substituindo `'agente'` ou `'automatico…'`)
  é contada e exibida na ficha como "contexto corrigido" — a taxa alta aponta vínculos errados.
- **Anti-morte:** empresa `ativo` sem nenhum responsável principal gera aviso na Central
  (`agent_inbox_items`), pelo watcher da spec 22.
- **Fragmento `.changes/`:** `capacidade_nova`.
- Entram juntos: migration da provisionadora + apêndice do baseline + linha no MANIFEST;
  `CATALOGO_DE_MODULOS` ganha `carteira`; `lib/database.types.ts` regenerado.
