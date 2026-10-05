/**
 * MÓDULO PROTOCOLOS — a tripla e o catálogo, lidos do TEXTO (migration 0904, spec 22).
 *
 * Os invariantes (`tests/invariants/protocolos-*.test.ts`) medem o banco aplicado; este arquivo é a
 * catraca barata que roda antes de custar um Postgres: o kit self-host aplica SÓ o baseline, então
 * uma função que existe na migration e não no apêndice não chega a quem instalou — e uma que
 * diverge entre os dois faz o cliente rodar outro código que o CI provou.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CATALOGO_DE_MODULOS } from "@/lib/modulos/catalogo";

const RAIZ = process.cwd();
const DIR_MIGRACOES = path.join(RAIZ, "supabase", "migrations");
const BASELINE = fs.readFileSync(path.join(RAIZ, "supabase", "baseline.sql"), "utf8");
const MANIFEST = fs.readFileSync(path.join(DIR_MIGRACOES, "MANIFEST.md"), "utf8");

const ARQUIVO = fs.readdirSync(DIR_MIGRACOES).find((f) => /^\d{14}_0904_protocolos_modulo\.sql$/.test(f));
const MIGRACAO = ARQUIVO ? fs.readFileSync(path.join(DIR_MIGRACOES, ARQUIVO), "utf8") : "";

const FUNCOES = [
  "fn_protocolos_provisionar",
  "fn_protocolo_categoria_coerente",
  "fn_protocolo_antes_de_gravar",
  "fn_protocolo_evento",
  "fn_protocolo_registrar_evento",
] as const;

/** Da linha `create or replace function public.<nome>(` até o fim do corpo (`$f$;` ou `$$;`). */
function definicao(sql: string, nome: string): string {
  const inicio = sql.lastIndexOf(`create or replace function public.${nome}(`);
  if (inicio < 0) return "";
  const delimitador = nome.endsWith("_provisionar") ? "\n$f$;" : "\n$$;";
  const fim = sql.indexOf(delimitador, inicio);
  return fim < 0 ? "" : sql.slice(inicio, fim + delimitador.length);
}

describe("módulo protocolos — tripla", () => {
  it("a migration 0904 existe com o nome canônico", () => {
    expect(ARQUIVO, "supabase/migrations/<timestamp>_0904_protocolos_modulo.sql não encontrada").toBeTruthy();
  });

  for (const nome of FUNCOES) {
    it(`${nome}: o MESMO corpo na migration e na ÚLTIMA definição do baseline`, () => {
      const naMigracao = definicao(MIGRACAO, nome);
      expect(naMigracao, `${nome} não está na migration`).not.toBe("");
      // `lastIndexOf`: no baseline vale a última definição (CLAUDE.md, migrations item 10).
      expect(definicao(BASELINE, nome)).toBe(naMigracao);
    });
  }

  it("as tabelas do módulo nascem DENTRO da provisionadora, nunca no corpo do baseline", () => {
    const corpo = definicao(BASELINE, "fn_protocolos_provisionar");
    const fora = BASELINE.replace(corpo, "");
    for (const tabela of [
      "protocolo_categorias",
      "protocolo_politicas_sla",
      "protocolo_area_membros",
      "protocolo_feriados",
      "protocolo_contadores",
      "protocolos",
      "protocolo_eventos",
      "protocolo_marcos_sla",
    ]) {
      expect(corpo).toContain(`create table if not exists public.${tabela} (`);
      expect(fora, `${tabela} criada fora da provisionadora`).not.toContain(
        `create table if not exists public.${tabela} (`,
      );
    }
  });

  it("o bloco entra ANTES da VARREDURA anon (depois dela nenhuma função é criada)", () => {
    const bloco = BASELINE.indexOf("(migration 0904) ----");
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
    expect(MIGRACAO).not.toMatch(/public\.protocolo[a-z_]*%rowtype/i);
  });

  it("o MANIFEST registra a 0904", () => {
    expect(MANIFEST).toMatch(/\| `\d{14}` \| `0904_protocolos_modulo` \|/);
  });

  it("as duas seções de LGPD estão na migration e no baseline (D8)", () => {
    for (const origem of [MIGRACAO, BASELINE]) {
      expect(origem).toContain("('protocolos', 'protocolos',");
      expect(origem).toContain("('protocolos', 'protocolo_eventos',");
    }
  });

  it("o módulo aparece na vitrine de instalação", () => {
    expect(CATALOGO_DE_MODULOS.map((m) => m.slug)).toContain("protocolos");
  });
});
