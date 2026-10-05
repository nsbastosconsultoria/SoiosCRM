import { describe, expect, it } from "vitest";

import { situacaoDosEstados } from "./resolvedor";

describe("situação de relacionamento a partir dos estados das empresas do contato", () => {
  it("sem empresa ligada → desconhecido", () => {
    expect(situacaoDosEstados([])).toBe("desconhecido");
  });

  it("qualquer empresa cliente (inclusive em implantação, suspensa ou em distrato) → cliente ativo", () => {
    for (const estado of ["ativo", "em_implantacao", "suspenso", "em_distrato"] as const) {
      expect(situacaoDosEstados(["prospect", estado]), estado).toBe("cliente_ativo");
    }
  });

  it("só ex-cliente → cliente inativo; ex-cliente que também é prospect de outra → inativo", () => {
    expect(situacaoDosEstados(["inativo"])).toBe("cliente_inativo");
    expect(situacaoDosEstados(["inativo", "proposta"])).toBe("cliente_inativo");
  });

  it("só empresas em negociação → prospect", () => {
    expect(situacaoDosEstados(["prospect", "em_qualificacao", "proposta"])).toBe("prospect");
  });
});
