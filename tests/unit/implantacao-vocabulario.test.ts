/**
 * O vocabulário TypeScript da implantação é o MESMO da migration 0907 — os CHECKs e a tabela de
 * transições do gatilho do item. Se divergissem, a tela ofereceria um botão que o banco recusa
 * (ou esconderia um que ele aceita).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ESTADOS_DA_IMPLANTACAO,
  ESTADOS_DO_ITEM,
  ORIGENS_DA_IMPLANTACAO,
  TRANSICOES_DO_ITEM,
  VEZ_DE,
} from "@/lib/implantacao/vocabulario";

const DIR = path.join(process.cwd(), "supabase", "migrations");
const SQL = fs.readFileSync(path.join(DIR, fs.readdirSync(DIR).find((f) => /_0907_implantacao_modulo\.sql$/.test(f))!), "utf8");

/** O trecho de uma tabela, do `create table` até o `);` que a fecha. */
function tabela(nome: string): string {
  const i = SQL.indexOf(`create table if not exists public.${nome} (`);
  expect(i, `tabela ${nome} não encontrada na 0907`).toBeGreaterThan(-1);
  return SQL.slice(i, SQL.indexOf("\n  );", i));
}

function valoresDoCheck(trecho: string, coluna: string): string[] {
  // O trecho é de UMA tabela, então o CHECK da coluna é único nele (pode quebrar de linha).
  const m = new RegExp(`check \\(${coluna} in \\(([^)]*)\\)\\)`, "s").exec(trecho);
  expect(m, `CHECK de ${coluna} não encontrado`).not.toBeNull();
  return [...m![1]!.matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]!);
}

describe("vocabulário da implantação = migration 0907", () => {
  it("estado da implantação", () =>
    expect(valoresDoCheck(tabela("implantacoes"), "estado")).toEqual([...ESTADOS_DA_IMPLANTACAO]));
  it("origem", () => expect(valoresDoCheck(tabela("implantacoes"), "origem")).toEqual([...ORIGENS_DA_IMPLANTACAO]));
  it("estado do item", () => expect(valoresDoCheck(tabela("implantacao_itens"), "estado")).toEqual([...ESTADOS_DO_ITEM]));
  it("de quem é a vez (modelo e item)", () => {
    expect(valoresDoCheck(tabela("implantacao_modelo_itens"), "vez_de")).toEqual([...VEZ_DE]);
    expect(valoresDoCheck(tabela("implantacao_itens"), "vez_de")).toEqual([...VEZ_DE]);
  });

  it("a tabela de transições da tela é a do gatilho fn_implantacao_item_antes_de_gravar", () => {
    const inicioDaFuncao = SQL.indexOf("create or replace function public.fn_implantacao_item_antes_de_gravar()");
    const inicio = SQL.indexOf("v_permitidas := case old.estado", inicioDaFuncao);
    const corpo = SQL.slice(inicio, SQL.indexOf("end;", inicio));
    const doGatilho: Record<string, string[]> = {};
    for (const m of corpo.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) {
      doGatilho[m[1]!] = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
    expect(doGatilho).toEqual(Object.fromEntries(Object.entries(TRANSICOES_DO_ITEM).map(([de, para]) => [de, [...para]])));
  });
});
