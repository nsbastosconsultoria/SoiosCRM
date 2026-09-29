# Plano — cobrança dos tenants

- **Status:** Fase 1 (cobrança manual) implementada em 2026-09-29 — ver "Fase 1 — o que foi entregue"; Fase 2 aguarda a escolha do gateway
- **Data:** 2026-09-29
- **Medido em:** `main` do fork em `4d3442c6`
- **Destino (DoD 18):** módulo opcional. Se nenhuma instalação o ligar, a operação comum continua
  inteira — é exatamente o estado de hoje.

## O estado hoje

Não existe cobrança de tenants no produto. Não há integração com gateway de pagamento, fatura,
assinatura nem bloqueio por inadimplência — e isso é coerente com o `VISION.md`: o software não
vende assinatura; quem cobra os clientes é quem opera a instalação.

O campo **"Plano"** da criação de tenant (`/admin/tenants/new`, valores `standard | pro |
enterprise`) só é gravado em `organizations.settings.plan`. Nenhum código o lê: não limita recurso,
usuário nem uso.

Hoje, quem cobra os próprios clientes faz isso fora do sistema e suspende o tenant à mão.

## O que já existe e será reaproveitado

| Peça                                   | Onde                                                                                                                                                                         | Uso na cobrança                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Suspensão de tenant                    | `organizations.status = 'suspended'`; `app/api/v1/admin/tenants/[id]/suspend/route.ts` e `…/reactivate/route.ts`; `/app/*` redireciona para `app/account-suspended/page.tsx` | É o bloqueio por falta de pagamento — já audita e já emite evento          |
| Módulo opcional com tabelas (ADR-0002) | `docs/adr/0002-tabelas-de-modulo-num-banco-so.md`; `fn_modulo_instalar` + `fn_<slug>_provisionar()`; `lib/modulos/service.ts`; honorários (migration 0480) é o primeiro      | A cobrança vira o módulo `cobranca`: quem não cobra não carrega as tabelas |
| Teto de IA por organização             | `ai_budgets` + `lib/agent-engine/edge/llm/orcamento.ts`                                                                                                                      | O limite de IA do plano grava aqui, sem motor novo                         |
| Uso e custo de IA                      | `/admin/usage`; `cost_cents` nas execuções                                                                                                                                   | Base para cobrar consumo de IA no futuro                                   |
| Webhook de entrada com token           | padrão de `app/api/v1/webhooks/*/[token]` + `event_log`                                                                                                                      | Recebe os avisos de pagamento do gateway                                   |
| Segredos da instalação pela tela       | `lib/instalacao/catalogo.ts` (natureza `segredo`)                                                                                                                            | Chave de API do gateway, sem `.env`                                        |
| E-mail da instalação                   | `lib/email/config.ts` (SMTP de `/admin/email`)                                                                                                                               | Lembrete de vencimento e envio da fatura                                   |
| Campo "Plano" sem efeito               | `organizations.settings.plan`                                                                                                                                                | Substituído pela assinatura real, com migração do valor                    |

## Modelo de dados

Criado pela função provisionadora do módulo (ADR-0002), nunca no baseline para todos.

- **`billing_plans`** — da instalação, sem `organization_id`: nome, `price_cents` + `currency`
  (ISO-4217), periodicidade, `trial_days` e limites (`max_users`, `max_channels`,
  `ai_monthly_budget_cents`, módulos incluídos). RLS: só administrador da plataforma escreve.
- **`billing_subscriptions`** — tenant-aware: `organization_id`, `plan_id`, `status`
  (`trialing | active | past_due | suspended | canceled`, `text` + CHECK),
  `current_period_end`, `grace_until`, `provider`, `provider_customer_id`,
  `provider_subscription_id`.
- **`billing_invoices`** — tenant-aware: valor em `_cents`, vencimento, status
  (`open | paid | overdue | canceled`), `payment_url`, meio (Pix, boleto, cartão), `external_id`
  com `unique (provider, external_id)`.
- **`billing_events`** — caixa de entrada dos webhooks, idempotente por
  `unique (provider, external_id)` com captura de `23505`.

Toda função nova revoga as **duas** origens de `EXECUTE` (CLAUDE.md, migrations, item 9), e a
provisionadora segue o molde de `fn_honorarios_provisionar`.

## Ciclo de vida da assinatura

```
trialing ──fim do teste──▶ active ──fatura vence──▶ past_due ──fim da carência──▶ suspended
    ▲                         ▲                         │                             │
    └──── pagamento confirmado (webhook) ◀──────────────┴─────────────────────────────┘
```

- **Regra pura, sem I/O**, em `lib/cobranca/estado.ts`, no desenho de `decidirOrcamento`. Na
  dúvida, **não suspende**: suspender por engano derruba o WhatsApp de um negócio.
- **Carência configurável** (padrão proposto: 7 dias), com faixa de aviso para o tenant e
  lembretes por e-mail.
- **Suspensão** reusa o mesmo caminho da suspensão manual (auditoria e `event_log`). Os dados
  nunca são apagados.
- **Reativação** automática quando o webhook confirma o pagamento.

## Gateway de pagamento

Proposta inicial: **Asaas** — Pix, boleto e cartão com recorrência, webhooks e sandbox, pensado
para o Brasil. A integração fica atrás de uma interface `ProvedorDeCobranca` (criar cliente,
assinatura e fatura; validar webhook), para Mercado Pago ou Stripe entrarem depois sem mexer no
resto.

- **Webhook:** `POST /api/v1/webhooks/cobranca/[token]`. O token do gateway é conferido com
  `crypto.timingSafeEqual`. A rota só grava em `billing_events` e emite em `event_log`; o worker
  aplica o efeito (nunca HTTP dentro de trigger). Precisa de entrada em
  `lib/auth/public-paths.ts` e de rate limit.
- **Cron `cobranca-watcher`** (diário): faturas vencidas passam a `past_due`; carência vencida,
  a `suspended`. Antes de suspender, reconcilia com o gateway. Audita só quando houve efeito.

## Limites por plano

| Limite          | Ponto de controle                                                |
| --------------- | ---------------------------------------------------------------- |
| Usuários        | `lib/auth/issue-invite.ts` (convite)                             |
| Canais WhatsApp | criação de canal em `app/api/v1/channels`                        |
| IA por mês      | grava o teto do plano em `ai_budgets` (motor existente)          |
| Módulos         | `modulosLigados()` (`lib/instalacao/modulos.ts`) por organização |

Cada limite nasce em modo **avisar**, no mesmo desenho do `AI_BUDGET_ENFORCEMENT`
(`on | avisar | off`), e só vira bloqueio quando o administrador da instalação liga.

## Telas

- **`/admin/cobranca`** (administrador da plataforma): planos, assinaturas por tenant, faturas,
  configuração do gateway e "gerar cobrança manual". Porta em `lib/navigation/catalogo.ts`.
- **Detalhe do tenant** (`/admin/tenants/[id]`): plano, status e última fatura. O campo "Plano"
  de `/admin/tenants/new` passa a escolher um `billing_plan`.
- **`/app/settings/assinatura`** (papel `admin` do tenant): plano atual, faturas, botão "pagar"
  (link Pix/boleto) e limites em uso.
- **Faixa de aviso** em `/app` durante a carência. A página de conta suspensa ganha o link da
  fatura em aberto.

## Fases

| Fase                     | Entrega                                                                                                                                         | Valor sozinha                                                   | Tamanho estimado |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------- |
| **0. Decisões**          | Respostas da seção final                                                                                                                        | Destrava o resto                                                | —                |
| **1. Cobrança manual**   | Módulo, planos, assinaturas, faturas lançadas à mão, cron de vencimento, suspensão e reativação automáticas, `/admin/cobranca`, aviso ao tenant | Já cobra por Pix/transferência com controle e corte automáticos | ~1,5 semana      |
| **2. Gateway (Asaas)**   | Cliente e assinatura no gateway, fatura com link Pix/boleto, webhook idempotente, baixa automática                                              | Pagamento e reativação sem intervenção                          | ~1,5 semana      |
| **3. Limites por plano** | Usuários, canais, IA e módulos, em modo aviso e bloqueio                                                                                        | Planos diferenciados de verdade                                 | ~1 semana        |
| **4. Portal e e-mails**  | `/app/settings/assinatura`, lembretes de vencimento pelo SMTP da instalação, troca de plano                                                     | Autoatendimento do cliente                                      | ~1 semana        |
| **5. Cartão e extras**   | Cartão recorrente, excedente de IA a partir de `cost_cents`, cupom                                                                              | Receita por uso                                                 | a definir        |

**Prova exigida em cada fase:**

- testes unitários da regra de estado;
- invariantes com Postgres real — RLS entre 2 tenants, varredura de `security definer`,
  provisionadora idempotente;
- `pnpm test:db` (install e update);
- e2e pela tela em ambiente fresco (DoD 12);
- migration + apêndice no `baseline.sql` + linha no MANIFEST;
- fragmento em `.changes/`.

## Riscos

- **Colisão de migrations com o DeskcommCRM original.** O Soios é um fork que puxa atualizações
  do upstream. Cada migration própria disputa numeração com as de lá a cada atualização — foi o
  que renumerou honorários de 0398 para 0480. Saídas: contribuir o módulo para o original (a
  cobrança serve a qualquer revendedor; recomendado) ou manter uma faixa de números reservada no
  fork.
- **Suspensão indevida por falha de webhook.** Mitigada pela regra "na dúvida, não suspende",
  pela carência e pela reconciliação com o gateway antes de suspender.
- **Nota fiscal fica fora do escopo.** NFS-e é outra integração, com configuração fiscal por
  município (o Asaas oferece, mas como produto à parte).

## Decisões

Tomadas pelo dono em 2026-09-29, antes da Fase 1:

| # | Pergunta | Decisão |
|---|---|---|
| 2 | Carência e efeito da suspensão | **7 dias** de carência. Suspenso por falta de pagamento, o tenant perde **só as telas** — a mesma suspensão manual que já existe; WhatsApp e IA seguem atendendo o cliente final. |
| 3 | Teste grátis | **Por plano**: cada plano declara `trial_days` (pode ser 0); o primeiro vencimento cai no fim do teste. |
| 4 | Onde vive o código | **Só no fork Soios.** O custo aceito é a renumeração de migrations quando o upstream for puxado. |

Ainda em aberto, e sem efeito na Fase 1:

1. **Gateway:** Asaas, Mercado Pago ou Stripe? (Fase 2)
5. **Cobrança por uso de IA:** entra na Fase 5 ou fica só com planos fixos?

## Fase 1 — o que foi entregue

| Peça | Onde |
|---|---|
| Módulo `cobranca` (3 tabelas, RLS: só o admin da plataforma escreve; membros leem a própria) | migration `0486`, `fn_cobranca_provisionar()`, apêndice do `baseline.sql` |
| Regra de estado pura (vencimento, carência de 7 dias, suspender/reativar só o que é da cobrança) | `lib/cobranca/estado.ts` |
| Aplicação com I/O, compartilhada pelo cron e pelas rotas | `lib/cobranca/aplicar.ts` |
| Cron diário `cobranca-watcher` (06:10 UTC) | `app/api/v1/cron/cobranca-watcher/route.ts`, `docker/scheduler/entrypoint.sh` |
| API do admin da plataforma | `app/api/v1/admin/cobranca/` — planos, assinatura por tenant, faturas, baixa e cancelamento |
| Tela `/admin/cobranca` com porta no menu | `app/admin/(protected)/cobranca/`, `components/admin/AdminSidebar.tsx` |
| Faixa de carência em `/app` (papel `admin`) e fatura na tela de conta suspensa | `components/app/CobrancaEmAtrasoBanner.tsx`, `app/account-suspended/page.tsx`, `lib/cobranca/aviso.ts` |

Fora da Fase 1, como planejado: `billing_events`, gateway, limites por plano, e-mails de lembrete e
o portal do tenant (`/app/settings/assinatura`). O campo "Plano" de `/admin/tenants/new` segue sem
efeito até a Fase 3.
