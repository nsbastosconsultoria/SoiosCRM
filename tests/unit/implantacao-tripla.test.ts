/**
 * Módulo implantacao (spec 23, migration 0907) — a tripla migration + baseline + MANIFEST, e a
 * dependência da carteira declarada nos dois lugares que a explicam (catálogo e provisionadora).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CATALOGO_DE_MODULOS } from "@/lib/modulos/catalogo";

const RAIZ = process.cwd();
const DIR_MIGRACOES = path.join(RAIZ, "supabase", "migrations");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase", "baseline.sql"), "utf8");
const MANIFEST = fs.readFileSync(path.join(DIR_MIGRACOES, "MANIFEST.md"), "utf8");

const ARQUIVO = fs.readdirSync(DIR_MIGRACOES).find((f) => /^\d{14}_0907_implantacao_modulo\.sql$/.test(f));
const MIGRACAO = ARQUIVO ? fs.readFileSync(path.join(DIR_MIGRACOES, ARQUIVO), "utf8") : "";

const FUNCOES = [
  "fn_implantacao_provisionar",
  "fn_implantacao_config_antes_de_gravar",
  "fn_implantacao_antes_de_gravar",
  "fn_implantacao_item_antes_de_gravar",
  "fn_implantacao_evento",
  "fn_implantacao_item_evento",
  "fn_implantacao_iniciar",
  "fn_implantacao_concluir",
  "fn_implantacao_cancelar",
] as const;

const TABELAS = [
  "implantacao_modelos",
  "implantacao_modelo_itens",
  "implantacoes",
  "implantacao_itens",
  "implantacao_eventos",
] as const;

/** Da linha `create or replace function public.<nome>(` até o fim do corpo (`$f$;` ou `$$;`). */
function definicao(sql: string, nome: string): string {
  const inicio = sql.lastIndexOf(`create or replace function public.${nome}(`);
  if (inicio < 0) return "";
  const delimitador = nome.endsWith("_provisionar") ? "\n$f$;" : "\n$$;";
  const fim = sql.indexOf(delimitador, inicio);
  return fim < 0 ? "" : sql.slice(inicio, fim + delimitador.length);
}

describe("módulo implantacao — tripla", () => {
  it("a migration 0907 existe com o nome canônico", () => {
    expect(ARQUIVO, "supabase/migrations/<timestamp>_0907_implantacao_modulo.sql não encontrada").toBeTruthy();
  });

  for (const nome of FUNCOES) {
    it(`${nome}: o MESMO corpo na migration e na ÚLTIMA definição do baseline`, () => {
      const naMigracao = definicao(MIGRACAO, nome);
      expect(naMigracao, `${nome} não está na migration`).not.toBe("");
      expect(definicao(BASELINE, nome)).toBe(naMigracao);
    });
  }

  it("as tabelas do módulo nascem DENTRO da provisionadora, nunca no corpo do baseline", () => {
    const corpo = definicao(BASELINE, "fn_implantacao_provisionar");
    const fora = BASELINE.replace(corpo, "");
    for (const tabela of TABELAS) {
      expect(corpo).toContain(`create table if not exists public.${tabela} (`);
      expect(fora, `${tabela} criada fora da provisionadora`).not.toContain(`create table if not exists public.${tabela} (`);
    }
  });

  it("o bloco entra ANTES da VARREDURA anon (depois dela nenhuma função é criada)", () => {
    const bloco = BASELINE.indexOf("(migration 0907) ----");
    const varredura = BASELINE.indexOf("-- ---- VARREDURA anon:");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(varredura);
  });

  it("toda função do módulo revoga EXECUTE de public e anon nas duas origens", () => {
    for (const origem of [MIGRACAO, BASELINE]) {
      for (const nome of FUNCOES) {
        expect(origem, `${nome} sem revoke`).toMatch(
          new RegExp(`revoke execute on function public\\.${nome}\\([^)]*\\) from public, anon`),
        );
      }
    }
  });

  it("nenhuma função do módulo declara %rowtype de tabela do módulo (D7)", () => {
    expect(MIGRACAO).not.toMatch(/public\.implantac[a-z_]*%rowtype/i);
  });

  it("o MANIFEST registra a 0907", () => {
    expect(MANIFEST).toMatch(/\| `\d{14}` \| `0907_implantacao_modulo` \|/);
  });

  it("a dependência da carteira está no catálogo e na provisionadora", () => {
    const modulo = CATALOGO_DE_MODULOS.find((m) => m.slug === "implantacao");
    expect(modulo?.requer).toEqual(["carteira"]);
    expect(definicao(MIGRACAO, "fn_implantacao_provisionar")).toContain("to_regclass('public.carteira_perfis') is null");
  });

  it("todo `requer` do catálogo aponta para um módulo que existe no catálogo", () => {
    const slugs = new Set(CATALOGO_DE_MODULOS.map((m) => m.slug));
    for (const m of CATALOGO_DE_MODULOS) for (const r of m.requer ?? []) expect(slugs.has(r), `${m.slug} requer ${r}`).toBe(true);
  });
});
