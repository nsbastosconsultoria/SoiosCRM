/**
 * Implantação de clientes — módulo opcional via ADR-0002 (migration 0907, spec 23).
 *
 * Primeiro a dependência: sem a carteira, a provisionadora recusa (`implantacao_exige_carteira`)
 * e não deixa tabela pela metade. Depois o molde de sempre, com a carteira já provisionada (o
 * setupFile dá um banco novo por arquivo, sem nenhum módulo). `protecaoPropria` em todas: a RLS é
 * por operação (configuração escrita pelo `admin`, implantações e itens só lidos pela sessão).
 */
import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

const TABELAS = [
  "implantacao_modelos",
  "implantacao_modelo_itens",
  "implantacoes",
  "implantacao_itens",
  "implantacao_eventos",
];

describe("a implantação depende da carteira", () => {
  it("sem a carteira, provisionar recusa e não cria tabela nenhuma; com ela, provisiona", () => {
    let erro = "";
    try {
      sql("select public.fn_implantacao_provisionar();");
    } catch (e) {
      erro = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(erro).toContain("implantacao_exige_carteira");
    expect(sql("select to_regclass('public.implantacoes') is null;").trim().split("\n").pop()).toBe("t");

    // Daqui em diante o molde mede a provisionadora com a dependência satisfeita.
    sql("select public.fn_carteira_provisionar();");
  });
});

moldeDeProvisionadora({
  modulo: "implantacao",
  tabelas: TABELAS,
  protecaoPropria: TABELAS,
});
