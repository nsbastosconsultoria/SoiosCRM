import { describe, expect, it } from "vitest";

import { baixaPrioridade, decidirPrioridade, diasUteisAte, maisUrgente, regrasDePrazoDaOrganizacao } from "./prioridade";

const HOJE = "2026-10-05"; // segunda

describe("decidirPrioridade", () => {
  it("sem prazo nem IA: o padrão da categoria, com a subcategoria sobrepondo", () => {
    expect(decidirPrioridade({ padraoDaCategoria: "P3", hoje: HOJE })).toEqual({ prioridade: "P3", origem: "regra" });
    expect(decidirPrioridade({ padraoDaCategoria: "P3", padraoDaSubcategoria: "P2", hoje: HOJE }).prioridade).toBe("P2");
  });

  it("prazo do cliente hoje ou vencido ⇒ P1 (a guia vence hoje)", () => {
    expect(decidirPrioridade({ padraoDaCategoria: "P3", prazoCliente: HOJE, hoje: HOJE }).prioridade).toBe("P1");
    expect(decidirPrioridade({ padraoDaCategoria: "P4", prazoCliente: "2026-10-01", hoje: HOJE }).prioridade).toBe("P1");
  });

  it("prazo em até 2 dias úteis ⇒ P2; além disso, o padrão", () => {
    expect(decidirPrioridade({ padraoDaCategoria: "P3", prazoCliente: "2026-10-07", hoje: HOJE }).prioridade).toBe("P2");
    expect(decidirPrioridade({ padraoDaCategoria: "P3", prazoCliente: "2026-10-09", hoje: HOJE }).prioridade).toBe("P3");
  });

  it("o fim de semana não conta como dia útil: sexta → segunda é 1 dia útil", () => {
    expect(diasUteisAte("2026-10-09", "2026-10-12", null)).toBe(1);
    expect(decidirPrioridade({ padraoDaCategoria: "P3", prazoCliente: "2026-10-12", hoje: "2026-10-09" }).prioridade).toBe(
      "P2",
    );
  });

  it("a IA só SOBE a prioridade, e então a origem é ia", () => {
    expect(decidirPrioridade({ padraoDaCategoria: "P3", hoje: HOJE, sugestaoDaIa: "P1" })).toEqual({
      prioridade: "P1",
      origem: "ia",
    });
    expect(decidirPrioridade({ padraoDaCategoria: "P2", hoje: HOJE, sugestaoDaIa: "P4" })).toEqual({
      prioridade: "P2",
      origem: "regra",
    });
  });

  it("a IA não desce abaixo da regra de prazo", () => {
    expect(decidirPrioridade({ padraoDaCategoria: "P3", prazoCliente: HOJE, hoje: HOJE, sugestaoDaIa: "P3" }).prioridade).toBe(
      "P1",
    );
  });
});

describe("apoio", () => {
  it("maisUrgente e baixaPrioridade", () => {
    expect(maisUrgente("P2", "P3")).toBe("P2");
    expect(baixaPrioridade("P2", "P3")).toBe(true);
    expect(baixaPrioridade("P3", "P1")).toBe(false);
  });

  it("regras de prazo configuráveis, com padrão 2 e falha aberta", () => {
    expect(regrasDePrazoDaOrganizacao({}).diasUteisParaP2).toBe(2);
    expect(regrasDePrazoDaOrganizacao({ protocolos: { regras_de_prazo: { dias_uteis_para_p2: 5 } } }).diasUteisParaP2).toBe(5);
    expect(regrasDePrazoDaOrganizacao({ protocolos: { regras_de_prazo: { dias_uteis_para_p2: -1 } } }).diasUteisParaP2).toBe(2);
  });
});
