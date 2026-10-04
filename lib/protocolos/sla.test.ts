import { describe, expect, it } from "vitest";

import { expedienteDaOrganizacao, minutosUteisEntre, somarMinutosUteis, type Expediente } from "./sla";

/** Seg–sex, 08:00–18:00, São Paulo (UTC−3, sem horário de verão desde 2019). */
const COMERCIAL: Expediente = { fuso: "America/Sao_Paulo", dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };

/** "2026-10-05 09:00" em São Paulo → Date. */
function sp(data: string, hora: string): Date {
  return new Date(`${data}T${hora}:00-03:00`);
}

function iso(d: Date): string {
  return d.toISOString();
}

describe("somarMinutosUteis", () => {
  it("dentro do mesmo dia: segunda 09:00 + 2h = 11:00", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-05", "09:00"), 120, COMERCIAL))).toBe(iso(sp("2026-10-05", "11:00")));
  });

  it("vira o dia: segunda 17:00 + 2h = terça 09:00", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-05", "17:00"), 120, COMERCIAL))).toBe(iso(sp("2026-10-06", "09:00")));
  });

  it("aberto fora do expediente começa a contar na abertura: domingo 22:00 + 1h = segunda 09:00", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-04", "22:00"), 60, COMERCIAL))).toBe(iso(sp("2026-10-05", "09:00")));
  });

  it("pula o fim de semana: sexta 17:00 + 2h = segunda 09:00", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-09", "17:00"), 120, COMERCIAL))).toBe(iso(sp("2026-10-12", "09:00")));
  });

  it("pula feriado: segunda 12/10 é feriado, sexta 17:00 + 2h = terça 09:00", () => {
    const feriados = new Set(["2026-10-12"]);
    expect(iso(somarMinutosUteis(sp("2026-10-09", "17:00"), 120, COMERCIAL, feriados))).toBe(
      iso(sp("2026-10-13", "09:00")),
    );
  });

  it("vence exatamente no fechamento quando o prazo cabe inteiro no dia", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-05", "16:00"), 120, COMERCIAL))).toBe(iso(sp("2026-10-05", "18:00")));
  });

  it("sem expediente: relógio corrido", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-09", "17:00"), 120, null))).toBe(iso(sp("2026-10-09", "19:00")));
  });

  it("vários dias: 3 dias úteis de 10h = 30h começando segunda 08:00 vencem quarta 18:00", () => {
    expect(iso(somarMinutosUteis(sp("2026-10-05", "08:00"), 30 * 60, COMERCIAL))).toBe(iso(sp("2026-10-07", "18:00")));
  });
});

describe("minutosUteisEntre", () => {
  it("conta só o expediente: sexta 17:00 → segunda 09:00 = 2h", () => {
    expect(minutosUteisEntre(sp("2026-10-09", "17:00"), sp("2026-10-12", "09:00"), COMERCIAL)).toBe(120);
  });

  it("é o inverso de somarMinutosUteis", () => {
    const inicio = sp("2026-10-07", "15:30");
    const fim = somarMinutosUteis(inicio, 7 * 60, COMERCIAL);
    expect(minutosUteisEntre(inicio, fim, COMERCIAL)).toBe(7 * 60);
  });

  it("intervalo invertido ou vazio é zero", () => {
    expect(minutosUteisEntre(sp("2026-10-05", "10:00"), sp("2026-10-05", "09:00"), COMERCIAL)).toBe(0);
  });

  it("sem expediente: tempo corrido", () => {
    expect(minutosUteisEntre(sp("2026-10-09", "17:00"), sp("2026-10-12", "09:00"), null)).toBe(64 * 60);
  });
});

describe("expedienteDaOrganizacao — falha aberta", () => {
  it("lê o expediente válido", () => {
    expect(expedienteDaOrganizacao({ protocolos: { expediente: COMERCIAL } })).toEqual(COMERCIAL);
  });

  it("expediente torto vira null (relógio corrido), nunca um SLA que não vence", () => {
    for (const ruim of [
      undefined,
      { ...COMERCIAL, fim: "07:00" },
      { ...COMERCIAL, fuso: "Marte/Olympus" },
      { ...COMERCIAL, dias: [] },
      { ...COMERCIAL, inicio: "8h" },
    ]) {
      expect(expedienteDaOrganizacao({ protocolos: { expediente: ruim } })).toBeNull();
    }
  });
});
