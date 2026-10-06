# Spec 23 — Módulo `implantacao` (onboarding de cliente: checklist, pendências e ativação)

> **Status:** rascunho para revisão do dono. Pré-implementação — nada deste documento existe no código.
> **Destino (DoD 18):** **ambos**. O módulo é opcional (ADR-0002); o núcleo ganha três pontos
> pequenos: dependência entre módulos no catálogo (§11.1), um tipo novo de aviso na Central (§11.2)
> e um consumidor do evento `lead.won` já existente (§11.3).
> **Origem:** modelo `modelo-escritorio-contabilidade-soioscrm-v3-jornada-completa.md`, §§ 24.8, 25,
> 34 (critério 4), 35-A e 36-4. **Genérico**: serve a qualquer operação em que o cliente passa por
> uma implantação antes de ser atendido de rotina (contabilidade, TI gerenciada, agência, SaaS B2B,
> assessoria). Os itens vêm de modelo de nicho e da configuração da organização, nunca do schema.
> **Depende de:** módulo `carteira` ([spec 21](21-spec-modulo-carteira.md)) — é ele que guarda o
> estado do relacionamento (`em_implantacao` → `ativo`) que esta spec controla. **Usa, quando
> instalado:** o módulo `protocolos` ([spec 22](22-spec-modulo-protocolos.md)), só para as áreas.
>
> **Por que "implantação" e não "onboarding":** a spec 21 já reservou o nome `implantacao` (tabela
> de entrega, §2) e o estado `em_implantacao`. Na tela, "Implantação de clientes"; "onboarding" fica
> como sinônimo na busca (⌘K).

---

## 1. Problema

Fechado o contrato, o escritório precisa reunir uma lista longa antes de atender o cliente de
rotina: contrato assinado, certificado digital, procurações, regime tributário, dados de folha,
saldos da contabilidade anterior, acessos. Parte depende do escritório, parte do cliente, parte de
terceiros (o contador anterior, a prefeitura). Hoje isso vive em planilha, e três coisas se perdem:

1. **O que falta, e de quem.** Ninguém vê, numa tela, que a empresa X está parada há 12 dias
   esperando a procuração que o cliente não mandou.
2. **Quando a empresa vira cliente de verdade.** A carteira (spec 21) tem o estado `em_implantacao`,
   mas a passagem para `ativo` é um clique manual sem critério — o modelo pede que ela só aconteça
   com os itens obrigatórios concluídos ou formalmente dispensados (§25.3).
3. **O elo com a venda.** O negócio ganho no funil não leva a empresa a lugar nenhum. A spec 21
   (§6, regra 5) previu essa passagem e ela **não foi implementada** (nenhum código lê
   `settings.carteira.funil_comercial_id`).

| Peça existente | Por que não basta |
|---|---|
| `crm_tasks` (0210) | Tarefa interna solta, 4 estados (`pending`…`cancelled`). Não sabe de quem é a vez (escritório, cliente, terceiro), não tem "aguardando", "bloqueado", "dispensado com motivo", evidência, obrigatoriedade nem modelo. Alargar o CHECK de `status` mudaria a tela de tarefas de toda instalação — e a tarefa de lembrete pessoal não é item de checklist de cliente |
| `protocolos` (spec 22) | Demanda que **o cliente** abre, com SLA. Implantação é trabalho que **o escritório** conduz, com uma lista conhecida de antemão e um fim (a ativação) |
| `carteira_perfis.estado` | Diz **que** a empresa está em implantação, não **o que** falta |

## 2. O que esta spec entrega, e o que não entrega

| Entrega | Não entrega (e por quê) |
|---|---|
| Modelos de implantação configuráveis (itens, grupos, obrigatoriedade, de quem é a vez, área, prazo relativo) e o modelo de nicho "Escritório de contabilidade" com os 15 itens do §25.1 | Envio de documento pelo cliente num portal — não há portal; o cliente manda pelo WhatsApp e a equipe registra |
| Uma implantação por empresa, com itens copiados do modelo (mudar o modelo não mexe nas que estão andando) | Cobrança automática e recorrente do cliente — é o módulo de rotinas (modelo §12), spec futura, que vai consumir os itens `aguardando_cliente` daqui |
| Item com 7 estados (§25.2), responsável, prazo, observação, evidência e dispensa com motivo | Upload de arquivo como evidência na v1 — Q4 |
| **Ativação com trava**: a empresa só vai a `ativo` pela implantação quando todos os obrigatórios estão concluídos ou dispensados | Mudar o critério de "cliente ativo" do roteador — continua o da spec 21 (`em_implantacao` já conta como cliente para o atendimento) |
| Início manual (ficha da carteira) e automático (negócio ganho no funil comercial configurado) | Contrato e assinatura eletrônica — o item "Contrato" só registra que foi feito |
| Aviso diário na Central de itens vencidos, um por implantação | Relatório financeiro da implantação |
| Ferramenta de leitura para a IA: "o que ainda falta eu mandar?" | Escrita pela IA na v1 — Q5 |

## 3. Princípio de reuso

| Necessidade | Peça que já existe | Como esta spec usa |
|---|---|---|
| Empresa e estado do relacionamento | `companies` + `carteira_perfis` (spec 21) | Integrar: `implantacoes.company_id`; a ativação chama `fn_carteira_transicionar`, a ÚNICA escrita do estado |
| Áreas (fiscal, DP…) | `settings.atendimento.areas` (`lib/atendimento/areas.ts`) | Referenciar: `area` do item é slug dessa lista |
| Quem é da equipe | `user_organizations` | FK composta, como as filas da spec 22 |
| Negócio ganho | evento `lead.won` no `event_log` (consumido hoje por `lib/conversoes/envio.handler.ts`) | Consumidor novo, mesmo registry (§11.3) |
| Aviso à equipe | `agent_inbox_items` (Central) | Kind novo `implantacao_atrasada` (§11.2) |
| Linha do tempo append-only, RLS por operação, provisionadora | padrão das 0902/0904 | Mesmo molde |

## 4. Modelo de dados (corpo de `fn_implantacao_provisionar()`)

Todas as tabelas com `organization_id`, RLS por operação (molde 0480/0904), `create policy` em duas
linhas (#1906), nascendo só quando o administrador instala o módulo.

### 4.1 Modelos (configuração, escrita pelo `admin`)

```sql
implantacao_modelos (
  id uuid pk, organization_id uuid not null,
  nome text not null check (char_length(btrim(nome)) between 1 and 80),
  padrao boolean not null default false,          -- o usado no início automático (um por org: índice parcial)
  ativo boolean not null default true,
  created_at, updated_at
)

implantacao_modelo_itens (
  id uuid pk, organization_id uuid not null,
  modelo_id uuid not null,                        -- FK composta (organization_id, modelo_id)
  grupo text not null,                            -- "Cadastro", "Fiscal", "Folha"… (agrupa na tela)
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  orientacao text check (char_length(orientacao) <= 1000),   -- o que conta como pronto
  posicao integer not null default 0,
  obrigatorio boolean not null default true,
  vez_de text not null default 'escritorio' check (vez_de in ('escritorio', 'cliente', 'terceiro')),
  area text check (area ~ '^[a-z][a-z0-9_]{1,40}$'),         -- quem do escritório cuida
  prazo_dias integer check (prazo_dias between 0 and 365),    -- relativo ao início; nulo = sem prazo
  exige_evidencia boolean not null default false
)
```

### 4.2 `implantacoes`

```sql
implantacoes (
  id uuid pk, organization_id uuid not null,
  company_id uuid not null,                       -- FK (organization_id, company_id) → carteira_perfis
  modelo_id uuid,                                 -- de onde veio; nulo se o modelo foi apagado
  estado text not null default 'em_andamento'
    check (estado in ('em_andamento', 'concluida', 'cancelada')),
  origem text not null check (origem in ('manual', 'negocio_ganho')),
  lead_id uuid,                                   -- o negócio ganho, quando origem = negocio_ganho
  responsavel_user_id uuid,                       -- quem conduz (FK composta user_organizations)
  iniciada_em timestamptz not null default now(),
  prevista_para date,                             -- maior prazo dos itens, calculado no início
  concluida_em timestamptz, cancelada_em timestamptz,
  motivo_cancelamento text check (char_length(motivo_cancelamento) <= 300),
  revision integer not null default 0
)
-- uma implantação EM ANDAMENTO por empresa:
create unique index … on implantacoes (organization_id, company_id) where estado = 'em_andamento';
```

### 4.3 `implantacao_itens` (cópia do modelo no início)

```sql
implantacao_itens (
  id uuid pk, organization_id uuid not null, implantacao_id uuid not null,
  grupo, titulo, orientacao, posicao, obrigatorio, vez_de, area, exige_evidencia,   -- copiados
  prazo date,                                     -- iniciada_em + prazo_dias, no fuso da org
  estado text not null default 'pendente' check (estado in (
    'pendente', 'em_andamento', 'aguardando_cliente', 'aguardando_terceiro',
    'bloqueado', 'concluido', 'dispensado')),
  responsavel_user_id uuid,                       -- padrão: o responsável da área na carteira
  observacao text check (char_length(observacao) <= 2000),
  evidencia text check (char_length(evidencia) <= 2000),     -- "recebido por e-mail em 03/10", nº do protocolo da prefeitura…
  motivo_dispensa text check (char_length(motivo_dispensa) <= 300),
  concluido_em timestamptz, concluido_por uuid,
  revision integer not null default 0,
  check ((estado = 'dispensado') = (motivo_dispensa is not null))
)
```

Por que **copiar** os itens em vez de apontar para o modelo: o modelo muda (o escritório acrescenta
"eSocial" em março), e uma implantação começada em fevereiro não pode ganhar nem perder item no meio.
O item da implantação é o compromisso daquele cliente.

### 4.4 `implantacao_eventos` (append-only para os três papéis)

Linha do tempo campo a campo, escrita por gatilho AFTER (molde `protocolo_eventos`): item mudou de
estado, de responsável, de prazo; implantação iniciada, concluída, cancelada.

### 4.5 Quem escreve

- **Configuração** (`modelos`, `modelo_itens`): `admin` pela RLS.
- **Implantação e itens:** só pelas funções do módulo (`security definer`, só `service_role`),
  chamadas pela API com o papel conferido. `authenticated` só lê. Motivo: a **ativação** precisa ser
  atômica com a checagem dos obrigatórios — escrita direta pelo PostgREST deixaria marcar a empresa
  ativa com item pendente.
- Funções: `fn_implantacao_iniciar`, `fn_implantacao_item_alterar`, `fn_implantacao_concluir`,
  `fn_implantacao_cancelar`.

## 5. Regras

### 5.1 Início

1. **Manual:** na ficha da empresa na carteira, botão **Iniciar implantação** (gestor), escolhendo o
   modelo. Empresa em `prospect`, `em_qualificacao` ou `proposta` vai para `em_implantacao`
   (por `fn_carteira_transicionar`, na mesma transação). Empresa já `ativo` pode iniciar uma
   implantação sem mudar de estado — é o caso do cliente que contrata um serviço novo (Q3).
2. **Negócio ganho:** com `settings.implantacao.funil_comercial_id` apontando para um funil, o
   evento `lead.won` de um lead daquele funil, **ligado a uma empresa** (`crm_lead_links` para
   `companies`), inicia a implantação com o modelo padrão (`origem = 'negocio_ganho'`). Isto cumpre a
   regra 5 do §6 da spec 21, que ficou sem código. Lead sem empresa ligada: nada acontece e o
   consumidor registra o motivo (a empresa nasce por CNPJ, nunca inventada — spec 21 §6.1).
3. Uma em andamento por empresa (índice parcial). Iniciar de novo devolve a existente.
4. Responsável de cada item no início: o responsável da empresa **na área do item**
   (`carteira_responsaveis`); sem área ou sem responsável, o responsável da implantação.

### 5.2 Item

| De | Para |
|---|---|
| `pendente` | `em_andamento`, `aguardando_cliente`, `aguardando_terceiro`, `bloqueado`, `concluido`, `dispensado` |
| `em_andamento` | `pendente`, `aguardando_cliente`, `aguardando_terceiro`, `bloqueado`, `concluido`, `dispensado` |
| `aguardando_cliente` / `aguardando_terceiro` / `bloqueado` | `em_andamento`, `concluido`, `dispensado` |
| `concluido` | `em_andamento` (reabrir, com motivo na observação) |
| `dispensado` | `pendente` (gestor) |

- **Concluir** item com `exige_evidencia` exige `evidencia` preenchida.
- **Dispensar** exige motivo e papel **gestor** — é a "dispensa formal" do §25.3.
- Implantação `concluida` ou `cancelada` congela os itens.

### 5.3 Ativação (o coração da spec)

- **Concluir a implantação** (gestor) só é aceito quando **todos** os itens obrigatórios estão
  `concluido` ou `dispensado`. A recusa diz quais faltam.
- Na mesma transação: implantação → `concluida` e, se a empresa está em `em_implantacao`, carteira →
  `ativo` por `fn_carteira_transicionar` (que grava `cliente_desde` na primeira vez).
- Ativar **automaticamente** quando o último obrigatório fecha, ou exigir o clique? Q1 — a
  recomendação é o clique, porque o item opcional ainda aberto pode importar e a ativação muda o que
  o roteador faz com o cliente.
- A trava vale pela implantação. O clique manual de estado na carteira (spec 21) continua existindo
  para quem não usa o módulo; com o módulo instalado, `em_implantacao → ativo` pela carteira fica
  **só para admin** e pede confirmação ("há uma implantação em andamento com N itens obrigatórios
  abertos") — Q2.

### 5.4 Cancelamento

Gestor, com motivo. A empresa em `em_implantacao` volta para o estado que tinha antes de começar
(guardado no evento de início) ou vai para `inativo`, à escolha de quem cancela.

### 5.5 Prazos e avisos

- Prazo do item = início + `prazo_dias`, em dias corridos (Q6: úteis, pelo expediente dos protocolos,
  se instalado).
- **Vigia diário** (`app/api/v1/cron/implantacao-watcher`, 1×/dia no `scheduler`, 08:00 do fuso):
  para cada implantação em andamento com item vencido e não concluído/dispensado, **um** aviso
  `implantacao_atrasada` na Central, deduplicado enquanto houver um aberto para a mesma implantação.
  Texto: empresa (nome fantasia), quantos itens vencidos e de quem é a vez — sem observação nem
  evidência. Audita só quando avisou.
- Item `aguardando_cliente` há mais de N dias sem mudança não gera mensagem ao cliente na v1 (é o
  módulo de rotinas); aparece destacado na tela.

## 6. Modelo de nicho "Escritório de contabilidade" (§25.1)

| Grupo | Item | Vez de | Área | Prazo (dias) | Obrigatório | Evidência |
|---|---|---|---|---:|:-:|:-:|
| Contrato | Contrato assinado | cliente | relacionamento | 3 | ✓ | ✓ |
| Cadastro | Cadastro completo da empresa | escritório | relacionamento | 5 | ✓ | |
| Cadastro | Contatos e responsáveis do cliente | cliente | relacionamento | 5 | ✓ | |
| Societário | Documentos societários | cliente | societario | 10 | ✓ | ✓ |
| Fiscal | Regime tributário confirmado | escritório | fiscal | 10 | ✓ | |
| Acessos | Certificado digital | cliente | fiscal | 10 | ✓ | ✓ |
| Acessos | Procurações (e-CAC, prefeitura, estado) | cliente | fiscal | 15 | ✓ | ✓ |
| Folha | Dados de folha | cliente | dp | 15 | | |
| Fiscal | Dados fiscais | cliente | fiscal | 15 | ✓ | |
| Contábil | Saldos e contabilidade anterior | terceiro | contabil | 30 | ✓ | ✓ |
| Acessos | Acessos e integrações | cliente | relacionamento | 15 | | |
| Carteira | Carteira interna definida | escritório | relacionamento | 5 | ✓ | |
| Comunicação | Canais de comunicação | escritório | relacionamento | 5 | ✓ | |
| Comunicação | Regras de envio (quem recebe guias, folha…) | cliente | relacionamento | 10 | ✓ | |
| Conclusão | Reunião de boas-vindas / conclusão | escritório | relacionamento | 30 | | |

"Folha" opcional porque há empresa sem funcionário; "Carteira interna definida" é marcado pela
equipe quando os responsáveis por área estão na carteira. Modelo **Genérico**: Contrato, Cadastro,
Acessos, Treinamento, Conclusão. Aplicar um modelo só **cria** — não apaga nem sobrescreve (mesma
regra do modelo de categorias da spec 22).

## 7. Ferramenta do agente (catálogo MCP, `modulo: "implantacao"`)

| Tool | Categoria | Risco | Pacotes | O que faz |
|---|---|---|---|---|
| `crm_implantacao_pendencias_do_cliente` | read | seguro | `atender` | Para a empresa do contexto da conversa (carteira): os itens com `vez_de = 'cliente'` ainda abertos — só **título** e **orientação**, nunca observação, evidência, responsável nem prazo interno |

Responde "o que ainda falta eu mandar?". Ao receber o documento pelo WhatsApp, o assistente **não**
marca o item (Q5): diz que a equipe vai conferir. A equipe vê a mensagem na inbox e atualiza a ficha.

## 8. API e telas

- `GET/POST /api/v1/implantacoes` (lista por estado/responsável/atrasadas; iniciar — gestor).
- `GET /api/v1/implantacoes/:id`; `POST …/concluir` (gestor); `POST …/cancelar` (gestor).
- `PATCH /api/v1/implantacoes/:id/itens/:item` (estado, responsável, prazo, observação, evidência —
  `agent`; dispensar e reabrir dispensado — gestor).
- `GET/PUT /api/v1/implantacao/config` (modelos — admin); `POST …/config/modelo` (aplicar nicho).
- **Telas:**
  - **Implantação de clientes** (`/app/implantacoes`, grupo CRM, sem sidebar pelo teto de 15):
    lista com empresa, progresso dos obrigatórios (7/11), itens vencidos, de quem é a vez agora,
    responsável, dias desde o início. Filtros: minhas, atrasadas, aguardando o cliente.
  - **Ficha** (`/app/implantacoes/:id`): itens por grupo, cada um com estado, responsável, prazo,
    observação e evidência; botão **Concluir implantação** desabilitado com a lista do que falta.
  - **Ficha da carteira** ganha o cartão da implantação (progresso + link) e **Iniciar implantação**.
  - **Configurações › Implantação** (`/app/settings/tenant/implantacao`, admin): modelos e itens,
    **Começar por um modelo**, funil comercial do início automático.
- i18n `es` para todo texto, como nos outros módulos.

## 9. Eventos, auditoria, métricas, LGPD

- **Auditoria:** `implantacao.iniciada`, `implantacao.item_alterado`, `implantacao.concluida`,
  `implantacao.cancelada`, `implantacao.config_alterada`, `implantacao.atraso_avisado` (cron).
- **`event_log`:** nenhum evento novo até haver consumidor (o módulo de rotinas será o primeiro).
- **Métricas** (tela da lista): tempo médio até a ativação; itens que mais atrasam; implantações
  paradas há mais de N dias.
- **LGPD (D8):** `observacao` e `evidencia` são texto livre e podem falar da pessoa. O módulo registra
  seções em `modulo_secoes_lgpd` (esses campos viram nulo na anonimização do titular), como a 0904.

## 10. Testes

- **Invariantes (banco):** provisionadora no molde D4; RLS por operação; a ativação é recusada com
  obrigatório aberto e aceita com todos concluídos/dispensados; dispensar exige motivo; concluir com
  `exige_evidencia` exige evidência; uma em andamento por empresa; a carteira vai a `ativo` na mesma
  transação; itens congelados depois de concluída.
- **Unitários:** transições do item (tabela TS ↔ gatilho); cálculo de prazo no fuso; responsável
  padrão por área; consumidor de `lead.won` (lead sem empresa, funil errado, já em andamento);
  vigia (um aviso por implantação, deduplicado, sem texto livre).
- **E2E pela tela (DoD 12):** iniciar pela carteira → concluir itens → botão de ativação liberado →
  empresa `ativo` na carteira.

## 11. Pontos no núcleo

### 11.1 Dependência entre módulos

O catálogo de módulos (`lib/instalacao/modulos.ts`) não tem hoje como dizer "este módulo precisa de
outro". Acrescenta `requer?: ModuloOpcional[]`: a tela de módulos mostra "Requer: Carteira de
empresas" e desabilita **Instalar** sem ele; desinstalar a carteira com a implantação instalada é
recusado com a explicação. A provisionadora também recusa (`implantacao_exige_carteira`) — a régua
mora no banco, a tela só explica.

### 11.2 Aviso na Central

`agent_inbox_items.kind` ganha `implantacao_atrasada` (`ref_kind = 'implantacao'`, destino
`/app/implantacoes/:id`), pela tripla migration + baseline + MANIFEST, como a 0905.

### 11.3 Consumidor de `lead.won`

Handler novo no registry de eventos, ativo só com o módulo instalado e o funil configurado. Não
altera o evento nem os consumidores existentes.

## 12. Decisões para o dono

| # | Pergunta | Recomendação |
|---|---|---|
| Q1 | Concluir a implantação (e ativar o cliente) é automático quando o último obrigatório fecha, ou exige o clique do gestor? | **Clique**, com o botão liberado e destacado |
| Q2 | Com o módulo instalado, a carteira ainda permite `em_implantacao → ativo` sem passar pela implantação? | **Só admin, com aviso** do que está aberto |
| Q3 | Cliente já ativo pode ter implantação (serviço novo contratado)? | **Sim**, sem mudar o estado da carteira |
| Q4 | Evidência é só texto na v1, ou já com anexo de arquivo? | **Texto** na v1; anexo depois, reaproveitando o Storage |
| Q5 | A IA pode marcar um item como recebido quando o cliente manda o documento? | **Não** na v1 — só lê as pendências; a equipe confere |
| Q6 | Prazo do item em dias corridos ou úteis? | **Corridos** na v1 (simples e previsível para o cliente) |
| Q7 | Início automático pelo negócio ganho entra já na v1? | **Sim** — fecha a lacuna da spec 21 e é o cenário E2E-A do modelo |

## 13. Sistema vivo (DoD 13)

- **Entrada:** carteira (manual) e `lead.won` (automático). **Saída:** carteira `ativo`, que muda o
  roteador (spec 21 §7) e a fila dos protocolos (responsável por área).
- **Tela e porta:** `/app/implantacoes` no catálogo de navegação (grupo CRM), cartão na ficha da
  carteira, configuração em Configurações.
- **Anti-morte:** o vigia diário avisa item vencido; a lista destaca implantação parada.
- **Laço de retorno:** métricas de tempo até a ativação e itens que mais atrasam mostram qual item
  do modelo está mal dimensionado — o escritório ajusta o prazo ou a obrigatoriedade no modelo.
- **Mapa vivo:** peça nova em `docs/architecture/` com as arestas carteira ↔ implantação ↔ Central ↔
  funil.

## 14. Ordem de implementação sugerida (PRs)

1. **PR-A — schema:** provisionadora 09xx (tabelas, gatilhos, funções, RLS, LGPD) + `requer` no
   catálogo de módulos + invariantes.
2. **PR-B — serviço, API e telas:** lista, ficha, cartão na carteira, configuração, modelos de nicho,
   i18n.
3. **PR-C — automações:** consumidor de `lead.won`, vigia diário + kind da Central, ferramenta da IA.
