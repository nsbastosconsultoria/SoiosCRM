/**
 * O vocabulário TypeScript dos protocolos é o MESMO da migration 0904 — os CHECKs e a tabela de
 * transições do gatilho. A tela oferece só os botões da tabela daqui; se ela divergisse do
 * gatilho, a tela ofereceria um botão que o banco recusa (ou esconderia um que ele aceita).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PRIORIDADES } from "@/lib/protocolos/prioridade";
import {
  DISTRIBUICOES,
  ESTADOS_DO_PROTOCOLO,
  ORIGENS_DO_PROTOCOLO,
  TRANSICOES_DO_PROTOCOLO,
} from "@/lib/protocolos/vocabulario";

const DIR = path.join(process.cwd(), "supabase", "migrations");
const SQL = fs.readFileSync(path.join(DIR, fs.readdirSync(DIR).find((f) => /_0904_protocolos_modulo\.sql$/.test(f))!), "utf8");

function valoresDoCheck(coluna: string): string[] {
  const m = new RegExp(`check \\(${coluna} in \\(([^)]*)\\)\\)`, "s").exec(SQL);
  expect(m, `CHECK de ${coluna} não encontrado na 0904`).not.toBeNull();
  return [...m![1]!.matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]!);
}

describe("vocabulário dos protocolos = migration 0904", () => {
  it("estado", () => expect(valoresDoCheck("estado")).toEqual([...ESTADOS_DO_PROTOCOLO]));
  it("origem", () => expect(valoresDoCheck("origem")).toEqual([...ORIGENS_DO_PROTOCOLO]));
  it("distribuição", () => expect(valoresDoCheck("distribuido_por")).toEqual([...DISTRIBUICOES]));
  it("prioridade", () => expect(valoresDoCheck("prioridade")).toEqual([...PRIORIDADES]));

  it("a tabela de transições da tela é a do gatilho fn_protocolo_antes_de_gravar", () => {
    const corpo = SQL.slice(SQL.indexOf("v_permitidas := case old.estado"), SQL.indexOf("end;", SQL.indexOf("v_permitidas := case old.estado")));
    const doGatilho: Record<string, string[]> = {};
    for (const m of corpo.matchAll(/when '([a-z_]+)'\s+then array\[([^\]]*)\]/g)) {
      doGatilho[m[1]!] = [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
    const daTela = Object.fromEntries(
      Object.entries(TRANSICOES_DO_PROTOCOLO)
        .filter(([, para]) => para.length > 0) // finais caem no `else` do gatilho
        .map(([de, para]) => [de, [...para]]),
    );
    expect(doGatilho).toEqual(daTela);
  });
});
