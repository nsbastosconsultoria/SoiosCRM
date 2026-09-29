import { describe, expect, it } from "vitest";

import {
  decidirCobranca,
  diasEntre,
  hojeNoFuso,
  somarMeses,
  type AssinaturaFatos,
  type FaturaFatos,
} from "./estado";

const EM_DIA: AssinaturaFatos = {
  status: "active",
  trialEndsAt: null,
  graceDays: 7,
  suspensaPorCobranca: false,
};

const fatura = (id: string, dueDate: string, status: FaturaFatos["status"] = "open"): FaturaFatos => ({
  id,
  dueDate,
  status,
});

describe("vencimento e carência (7 dias, decisão de 2026-09-29)", () => {
  it("no dia do vencimento a fatura ainda não venceu", () => {
    const d = decidirCobranca(EM_DIA, [fatura("f1", "2026-10-10")], true, "2026-10-10");
    expect(d.faturasQueVenceram).toEqual([]);
    expect(d.novoStatus).toBe("active");
  });

  it("no dia seguinte vira atraso: past_due, sem suspender", () => {
    const d = decidirCobranca(EM_DIA, [fatura("f1", "2026-10-10")], true, "2026-10-11");
    expect(d.faturasQueVenceram).toEqual(["f1"]);
    expect(d.novoStatus).toBe("past_due");
    expect(d.suspender).toBe(false);
    expect(d.diasDeAtraso).toBe(1);
  });

  it("7 dias de atraso ainda é carência", () => {
    const d = decidirCobranca(EM_DIA, [fatura("f1", "2026-10-10", "overdue")], true, "2026-10-17");
    expect(d.novoStatus).toBe("past_due");
    expect(d.suspender).toBe(false);
  });

  it("⭐ no 8º dia de atraso suspende", () => {
    const d = decidirCobranca(EM_DIA, [fatura("f1", "2026-10-10", "overdue")], true, "2026-10-18");
    expect(d.novoStatus).toBe("suspended");
    expect(d.suspender).toBe(true);
    expect(d.faturaMaisAntigaEmAtraso).toEqual({ id: "f1", dueDate: "2026-10-10" });
  });

  it("a carência conta da fatura em atraso MAIS ANTIGA", () => {
    const d = decidirCobranca(
      EM_DIA,
      [fatura("nova", "2026-11-10", "overdue"), fatura("velha", "2026-10-10", "overdue")],
      true,
      "2026-11-12",
    );
    expect(d.faturaMaisAntigaEmAtraso?.id).toBe("velha");
    expect(d.suspender).toBe(true);
  });

  it("fatura paga ou cancelada não conta como atraso", () => {
    const d = decidirCobranca(
      EM_DIA,
      [fatura("p", "2026-10-10", "paid"), fatura("c", "2026-10-10", "canceled")],
      true,
      "2026-12-01",
    );
    expect(d.novoStatus).toBe("active");
    expect(d.suspender).toBe(false);
  });
});

describe("suspender e reativar só o que é da cobrança", () => {
  it("⭐ organização já suspensa À MÃO não é marcada como suspensa pela cobrança", () => {
    const d = decidirCobranca(EM_DIA, [fatura("f1", "2026-10-10", "overdue")], false, "2026-10-30");
    expect(d.novoStatus).toBe("suspended");
    expect(d.suspender).toBe(false);
  });

  it("pagou a fatura: reativa a organização que a cobrança suspendeu", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "suspended", suspensaPorCobranca: true },
      [fatura("f1", "2026-10-10", "paid")],
      false,
      "2026-10-30",
    );
    expect(d.novoStatus).toBe("active");
    expect(d.reativar).toBe(true);
  });

  it("⭐ não reativa a organização que alguém suspendeu à mão", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "suspended", suspensaPorCobranca: false },
      [fatura("f1", "2026-10-10", "paid")],
      false,
      "2026-10-30",
    );
    expect(d.novoStatus).toBe("active");
    expect(d.reativar).toBe(false);
  });

  it("ainda com outra fatura em atraso, não reativa", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "suspended", suspensaPorCobranca: true },
      [fatura("paga", "2026-10-10", "paid"), fatura("outra", "2026-10-15", "overdue")],
      false,
      "2026-10-30",
    );
    expect(d.reativar).toBe(false);
    expect(d.novoStatus).toBe("suspended");
  });
});

describe("teste grátis e casos terminais", () => {
  it("em teste enquanto hoje é antes do fim do teste", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "trialing", trialEndsAt: "2026-10-15" },
      [],
      true,
      "2026-10-14",
    );
    expect(d.novoStatus).toBe("trialing");
  });

  it("no dia em que o teste acaba, a assinatura fica ativa", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "trialing", trialEndsAt: "2026-10-15" },
      [],
      true,
      "2026-10-15",
    );
    expect(d.novoStatus).toBe("active");
  });

  it("assinatura cancelada não muda, nem com fatura muito atrasada", () => {
    const d = decidirCobranca(
      { ...EM_DIA, status: "canceled" },
      [fatura("f1", "2026-01-10", "overdue")],
      true,
      "2026-10-30",
    );
    expect(d.novoStatus).toBe("canceled");
    expect(d.suspender).toBe(false);
  });

  it("⭐ na dúvida não suspende: carência inválida ou data ilegível", () => {
    expect(
      decidirCobranca({ ...EM_DIA, graceDays: Number.NaN }, [fatura("f1", "2026-01-10", "overdue")], true, "2026-10-30")
        .suspender,
    ).toBe(false);
    expect(decidirCobranca(EM_DIA, [fatura("f1", "10/01/2026", "overdue")], true, "2026-10-30").suspender).toBe(false);
    expect(decidirCobranca(EM_DIA, [fatura("f1", "2026-01-10", "overdue")], true, "ontem").suspender).toBe(false);
  });
});

describe("datas civis", () => {
  it("dias entre datas atravessa mês e ano", () => {
    expect(diasEntre("2026-12-30", "2027-01-02")).toBe(3);
    expect(diasEntre("2026-10-10", "2026-10-10")).toBe(0);
  });

  it("somar meses prende no último dia do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-10-10", 12)).toBe("2027-10-10");
  });

  it("hoje é o dia civil do fuso, não o do UTC", () => {
    // 01:30 UTC de 11/10 ainda é 10/10 em São Paulo (UTC-3).
    expect(hojeNoFuso(new Date("2026-10-11T01:30:00Z"), "America/Sao_Paulo")).toBe("2026-10-10");
  });
});
