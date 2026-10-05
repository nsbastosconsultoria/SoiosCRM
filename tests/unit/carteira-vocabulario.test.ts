/**
 * O vocabulário TypeScript da carteira é o MESMO dos CHECKs da migration 0902.
 *
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` não alcança colunas de módulo: ele
 * roda num banco onde o módulo não está instalado, e as tabelas não existem. Então a comparação
 * é com o TEXTO da migration — que é o que a provisionadora executa. A tabela de transições da
 * tela também: ela só decide que botões aparecem, mas um botão que o banco recusa é mentira na tela.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ESTADOS_DA_CARTEIRA,
  PAPEIS_DO_VINCULO,
  TIPOS_DE_ESTABELECIMENTO,
  TRANSICOES_DA_CARTEIRA,
} from "@/lib/carteira/vocabulario";

const DIR = path.join(process.cwd(), "supabase", "migrations");
const ARQUIVO = fs.readdirSync(DIR).find((f) => /_0902_carteira_modulo\.sql$/.test(f));
const SQL = fs.readFileSync(path.join(DIR, ARQUIVO!), "utf8");

/** Os valores do `check (<coluna> in (...))` da migration. */
function valoresDoCheck(coluna: string): string[] {
  const m = new RegExp(`check \\(${coluna} in \\(([^)]*)\\)\\)`, "s").exec(SQL);
  expect(m, `CHECK de ${coluna} não encontrado na 0902`).not.toBeNull();
  return [...m![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe("vocabulário da carteira = CHECKs da migration 0902", () => {
  it("estado", () => {
    expect(valoresDoCheck("estado")).toEqual([...ESTADOS_DA_CARTEIRA]);
  });

  it("papel do vínculo", () => {
    expect(valoresDoCheck("papel")).toEqual([...PAPEIS_DO_VINCULO]);
  });

  it("tipo de estabelecimento", () => {
    expect(valoresDoCheck("tipo_estabelecimento")).toEqual([...TIPOS_DE_ESTABELECIMENTO]);
  });

  it("a tabela de transições da tela é a de fn_carteira_transicionar", () => {
    const doBanco: Record<string, string[]> = {};
    for (const m of SQL.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) {
      doBanco[m[1]!] = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
    const daTela = Object.fromEntries(
      Object.entries(TRANSICOES_DA_CARTEIRA).map(([de, para]) => [de, [...para]]),
    );
    expect(doBanco).toEqual(daTela);
  });
});
