# DeskcommCRM — Workflow de Construção

Ordem definida pelo Rafael: **PRD → Regras de Negócio → Specs → Epics → Stories → Plano com Tasks**.

---

## Fase 0 — Brainstorming (em andamento)

- [x] Entender demanda e confirmar com o usuário
- [x] Decidir tenancy model (multi-tenant clássico desde dia 1)
- [x] Decidir escopo MVP (Opção B — com IA core)
- [x] Decidir integração e-commerce (Nuvemshop only)
- [x] Decidir perfil do primeiro tenant (PME médio)
- [x] Ler material de referência da Aula CRM Nichado WAHA
- [x] Decidir adoção da arquitetura de referência (integral, opção A)
- [x] Criar skeleton de docs do projeto
- [x] Preservar síntese da referência em `docs/research/`

## Fase 1 — PRD-Mestre + sub-PRDs

- [x] Escrever PRD-Mestre (`docs/prd/00-prd-master.md`) — visão, problema, escopo, stakeholders, métricas, restrições — **v0.1 escrito, em revisão pelo Rafael**
- [x] Sub-PRD 01: Plataforma Base (auth, multi-tenant, RBAC, audit, LGPD framework) — **v0.1 escrito**
- [x] Sub-PRD 02: Customer 360° + Identity Resolution determinística — **v0.1 escrito**
- [x] Sub-PRD 03: Canal WhatsApp (WAHA + anti-banimento + janela 24h + multi-atendente) — **v0.1 escrito**
- [x] Sub-PRD 04: Pipeline Kanban + Atendimento + Tickets + Handoff — **v0.1 escrito**
- [x] Sub-PRD 05: IA Conversacional (chatbot + RAG por tenant + sentiment detection) — **v0.1 escrito**
- [x] Sub-PRD 06: Integração Nuvemshop + LGPD webhooks — **v0.1 escrito**
- [x] Revisão final do PRD-Mestre + sub-PRDs — **spot-check de consistência cross-doc passou**

## Fase 2 — Regras de Negócio

- [x] Regras de tenancy e isolamento (T-01 a T-08) — em `docs/business-rules/00-business-rules-catalog.md`
- [x] Regras LGPD (L-01 a L-10) — idem
- [x] Regras WhatsApp (W-01 a W-12) — idem
- [x] Regras de pipeline (P-01 a P-08) — idem
- [x] Regras de atendimento (AT-01 a AT-08) — idem
- [x] Regras de IA (IA-01 a IA-11) — idem
- [x] Regras de billing/uso (B-01 a B-05) — idem

## Fase 3 — Specs Técnicas — **COMPLETA (8 specs, ~60k palavras)**

- [x] Spec 01 Plataforma Base (auth, RLS templates, audit, LGPD framework, API conventions)
- [x] Spec 02 Customer 360 + Identity Resolution
- [x] Spec 03 WhatsApp via WAHA Plus
- [x] Spec 04 Pipeline Kanban + Atendimento (UI 3 colunas)
- [x] Spec 05 IA + RAG + Sentiment + Handoff
- [x] Spec 06 Nuvemshop + LGPD
- [x] Spec 07 Event Log + Workers + Crons (transversal)
- [x] Spec 08 Deploy + Observability (transversal)
- [x] 15 diagramas Mermaid em `docs/research/architecture-diagrams.md`

## Fase 3.5 — Design System + Screen Flow (extra) — **COMPLETA**

- [x] Showcase navegável `/design` com 5 paletas + 4 tipografias + 3 densidades + componentes + motion
- [x] Direção locked: **Sage + Atkinson Hyperlegible + Aerada + Phosphor**
- [x] Tokens materializados em `tailwind.config.ts` + `app/globals.css` + `app/layout.tsx`
- [x] `<ThemeProvider>` com light/dark/system + persistência localStorage
- [x] shadcn components reescritos pra Sage (button/card/input/textarea/badge)
- [x] Documentação em `docs/design-system/` (11 arquivos, ~10.4k palavras)
- [x] Screen flow em `docs/design-system/screen-flow/` (9 arquivos, ~13.8k palavras)
- [x] 94 telas inventariadas + 5 jornadas + 8 clickflows + 9 state machines

## Fase 4 — Epics

> **Nota de 2026-09-22:** este checklist parou no plano em cascata original. O projeto
> não seguiu Epics→Stories→Tasks como unidade de execução — migrou pra fluxo contínuo
> de PRs (1400+ mesclados) logo depois da Fase 3.5. Os 7 épicos abaixo **existem em
> produção**, verificado por grep no código nesta data, não por reabertura de plano:

- [x] Epic E1: Plataforma Base — auth/RBAC/audit/LGPD, doutrina completa em `CLAUDE.md`
- [x] Epic E2: Conexão WhatsApp + Inbox Live — WAHA Plus, anti-banimento, `lib/opt-out/`
- [x] Epic E3: Customer 360° + Identity Resolution — `app/app/contacts/`, ver `docs/business-rules/00-business-rules-catalog.md`
- [x] Epic E4: Pipeline Kanban + Atendimento Humano — `crm_pipelines`/`crm_stages` desde a `00001_initial_schema.sql`; governança de atendimento (atribuição, fila, escopo) fechada à parte no épico G1–G6 (`plan/progress.md`, `loop/checkpoints/G6.approved`)
- [x] Epic E5: IA Conversacional + Handoff — `ai_dispatch_mode`, MCP tools de governança, handoff v2 (mesmo épico G1–G6)
- [x] Epic E6: Integração Nuvemshop + LGPD — `app/actions/integrations/{connect,disconnect}Nuvemshop.ts` (63 arquivos tocam Nuvemshop)
- [x] Epic E7: Hardening + Observability + Deploy — Sentry, doutrina de packaging (`docs/doctrine/packaging.md`), CI com 5 checks obrigatórios (`verify, build-and-size, invariants, e2e, imagens-ok`)

## Fase 5 — Stories

> Superado pelo fluxo real: não há backlog de stories com AC/estimativa. O que faz esse
> papel hoje é o PR individual (descrição + testes) e, pra escopos maiores, um HANDOFF
> dedicado na raiz do repo (`HANDOFF-*.md`) ou um loop de fases como o gov-loop
> (`plan/phases.md` + `plan/progress.md`, específico do épico de governança).

- [x] ~~Detalhar stories de cada epic com ACs~~ — substituído por PR-a-PR
- [x] ~~Estimativas relativas (T-shirt sizing)~~ — não adotado; sem estimativa formal
- [x] ~~Priorizar por Now/Next/Later~~ — priorização é ad-hoc por PR/issue no GitHub

## Fase 6 — Plano de Tasks

> Superado: não há cronograma nem marcos fixos. O rastreamento de "o que mudou e para
> quem importa" é feito por `.changes/*.md` (fragmentos por PR, ver
> `docs/doctrine/versionamento.md`) e consolidado no `CHANGELOG.md` a cada corte de
> release — não por um plano de tasks sequenciado com dependências.

- [x] ~~Quebrar stories em tasks técnicas~~ — cada PR já nasce como unidade técnica
- [x] ~~Sequenciar com dependências explícitas~~ — dependência é resolvida por review, não por plano
- [x] ~~Cronograma e marcos~~ — não há; releases saem por corte (`release.yml`), não por data

**Para saber o estado real do produto hoje**, não confie neste arquivo nem em
`docs/current-state.md` (ele mesmo se declara desatualizado) — meça na fonte:
`CHANGELOG.md` (topo), `git log --oneline -20`, e os 5 checks obrigatórios de CI.
