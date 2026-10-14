-- manifest: Sincronização com o original (DeskcommCRM 1.80.0): `carteira_eventos` declara a seção de LGPD em `modulo_secoes_lgpd` — a anonimização do contato passa a apagar o antes/depois dos eventos da carteira ligados a ele, como já fazia com `protocolo_eventos`.
-- 0912 — a linha do tempo da carteira entra na anonimização do contato.
--
-- ── O defeito ────────────────────────────────────────────────────────────────
-- `carteira_eventos` tem FK direta para `contacts` e guarda, em `anterior` e
-- `novo`, a fotografia do perfil, do vínculo ou do responsável antes e depois
-- de cada mudança — dado sobre a pessoa. A tabela nasce na provisionadora do
-- módulo (ADR-0002), fora do alcance da cascata do núcleo, e não declarava a
-- seção: anonimizar o contato deixava esse histórico legível. A varredura da
-- D8 (`tests/invariants/lgpd-modulo-nao-declarado.test.ts`) passou a cobrá-lo
-- quando o original 1.80.0 trouxe a provisão de verdade dos módulos.
--
-- ── A correção ───────────────────────────────────────────────────────────────
-- A mesma forma de `protocolo_eventos`: `fn_lgpd_redigir_secoes_de_modulo`
-- (0485) alcança a seção por `to_regclass` e pula sem erro onde o módulo não
-- está instalado. `tipo`, `ator_*` e `created_at` ficam: a linha do tempo
-- segue fechando, sem o conteúdo. Idempotente (`on conflict do update`).

insert into public.modulo_secoes_lgpd (modulo, tabela, ligacao, colunas, colunas_rotulo)
values
  ('carteira', 'carteira_eventos',
   'organization_id = $1 and contact_id = $2',
   array['anterior', 'novo'],
   array[]::text[])
on conflict (modulo, tabela) do update
  set ligacao = excluded.ligacao,
      colunas = excluded.colunas,
      colunas_rotulo = excluded.colunas_rotulo;
