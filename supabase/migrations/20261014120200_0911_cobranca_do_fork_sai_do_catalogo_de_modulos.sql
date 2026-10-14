-- manifest: Sincronização com o original (DeskcommCRM 1.80.0): sai a provisionadora `fn_cobranca_provisionar` da Fase 1 do fork (0493) e o registro `cobranca` em `modulos_instalados`; a cobrança passa a ser a do original. As tabelas `billing_*` e os dados delas ficam.
-- 0911 — a cobrança do fork deixa de ser módulo instalável.
--
-- ── O defeito ────────────────────────────────────────────────────────────────
-- O merge do original 1.80.0 trocou a cobrança dos tenants do fork (Fase 1,
-- faturas lançadas à mão, tabelas `billing_*`) pela do original (`cobranca_*`,
-- Asaas, ligada por linha em `platform_config`). A 0493 ficou, só com a função,
-- e isso não é inerte:
--
--  - `fn_modulo_instalar` aceita todo slug cuja `fn_<slug>_provisionar()`
--    existe, então `cobranca` seguia instalável pela tela de módulos, criando
--    tabelas que nenhuma tela lê;
--  - as varreduras da ADR-0002 D8 provisionam toda `fn_*_provisionar()` e
--    acusavam as tabelas `billing_*` sem prova de RLS nem seção de LGPD.
--
-- ── A correção ───────────────────────────────────────────────────────────────
-- Sai a função e sai o registro `cobranca` de `modulos_instalados`, NESTA
-- ordem de efeito: sem apagar o registro, a `fn_reaplicar_modulos_instalados`
-- do próximo `update.sh` acharia o slug sem provisionadora, suspenderia o
-- módulo e a `fn_conferir_modulos_instalados` pararia a atualização.
--
-- As tabelas `billing_plans`, `billing_subscriptions` e `billing_invoices` NÃO
-- são apagadas: guardam o que a instalação lançou na Fase 1 (nota da release em
-- `.changes/soios-sincroniza-com-o-original-1-80-0.md`). Idempotente.

delete from public.modulos_instalados where modulo = 'cobranca';

drop function if exists public.fn_cobranca_provisionar();

-- A única constraint NOMEADA da 0493 sai junto: a tabela não tem mais tela que grave nela, e
-- a régua tests/unit/check-do-baseline-nao-diverge-da-cadeia.test.ts exige que o que a cadeia
-- nomeia ou chegue ao baseline ou saia da cadeia. `if exists` nos dois níveis: onde o módulo
-- nunca foi instalado, a tabela não existe.
alter table if exists public.billing_invoices drop constraint if exists billing_invoices_paga_tem_data;
