import { describe, expect, it } from "vitest";

import { AREAS_CONTABILIDADE, AREAS_PADRAO, SLUG_DE_AREA, areasDaOrganizacao } from "./areas";

describe("áreas da organização", () => {
  it("sem configuração, vale o modelo genérico", () => {
    expect(areasDaOrganizacao({})).toBe(AREAS_PADRAO);
    expect(areasDaOrganizacao(null)).toBe(AREAS_PADRAO);
  });

  it("configuração válida é usada como está", () => {
    const areas = [{ slug: "fiscal", rotulo: "Fiscal" }];
    expect(areasDaOrganizacao({ atendimento: { areas } })).toEqual(areas);
  });

  it("configuração torta falha ABERTA para o padrão (nunca tela sem área)", () => {
    for (const ruim of [
      [],
      [{ slug: "Com Espaco", rotulo: "x" }],
      [{ slug: "fiscal", rotulo: "" }],
      [
        { slug: "fiscal", rotulo: "A" },
        { slug: "fiscal", rotulo: "B" },
      ],
      "fiscal",
    ]) {
      expect(areasDaOrganizacao({ atendimento: { areas: ruim } })).toBe(AREAS_PADRAO);
    }
  });

  it("os slugs dos modelos passam no CHECK do banco", () => {
    for (const a of [...AREAS_PADRAO, ...AREAS_CONTABILIDADE]) {
      expect(SLUG_DE_AREA.test(a.slug), a.slug).toBe(true);
    }
  });
});
