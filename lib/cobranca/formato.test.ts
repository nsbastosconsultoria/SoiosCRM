import { describe, expect, it } from "vitest";

import { formatarData, valorParaCentavos } from "./formato";

describe("valorParaCentavos", () => {
  it.each([
    ["99,90", 9990],
    ["1.234,56", 123456],
    ["R$ 150", 15000],
    ["150.5", 15050],
    ["150.50", 15050],
    ["1.500", 150000],
    ["0", 0],
  ])("%s → %i", (texto, cents) => {
    expect(valorParaCentavos(texto)).toBe(cents);
  });

  it.each(["", "abc", "1,2,3", "-5"])("%s não se lê", (texto) => {
    expect(valorParaCentavos(texto)).toBeNull();
  });
});

describe("formatarData", () => {
  it("data civil sem fuso", () => {
    expect(formatarData("2026-10-01")).toBe("01/10/2026");
    expect(formatarData(null)).toBe("—");
  });
});
