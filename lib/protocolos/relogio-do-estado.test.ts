import { describe, expect, it } from "vitest";

import { mudancasDoRelogio } from "./relogio-do-estado";
import type { Expediente } from "./sla";

const COMERCIAL: Expediente = { fuso: "America/Sao_Paulo", dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };
const POLITICA = { em_horario_util: true, pausa_aguardando_cliente: true, pausa_aguardando_terceiro: false };
const CAL = { expediente: COMERCIAL, feriados: new Set<string>() };
const sp = (d: string, h: string) => new Date(`${d}T${h}:00-03:00`);

describe("mudancasDoRelogio", () => {
  it("entrar em aguardando o cliente pausa, quando a política manda", () => {
    const agora = sp("2026-10-06", "10:00");
    expect(
      mudancasDoRelogio({ pausado_desde: null, pausa_acumulada_min: 0, resolucao_vence_em: null }, POLITICA, CAL, "aguardando_cliente", agora),
    ).toEqual({ pausado_desde: agora.toISOString() });
  });

  it("aguardando terceiro não pausa quando a política não manda", () => {
    expect(
      mudancasDoRelogio({ pausado_desde: null, pausa_acumulada_min: 0, resolucao_vence_em: null }, POLITICA, CAL, "aguardando_terceiro", new Date()),
    ).toEqual({});
  });

  it("sair da pausa soma as horas ÚTEIS pausadas ao prazo e à pausa acumulada", () => {
    const r = mudancasDoRelogio(
      {
        pausado_desde: sp("2026-10-06", "10:00").toISOString(),
        pausa_acumulada_min: 30,
        resolucao_vence_em: sp("2026-10-07", "10:00").toISOString(),
      },
      POLITICA,
      CAL,
      "em_atendimento",
      sp("2026-10-06", "12:00"),
    );
    expect(r).toEqual({
      pausado_desde: null,
      pausa_acumulada: "150 minutes",
      resolucao_vence_em: sp("2026-10-07", "12:00").toISOString(),
    });
  });

  it("pausa que atravessa a noite só conta o expediente", () => {
    const r = mudancasDoRelogio(
      {
        pausado_desde: sp("2026-10-06", "17:00").toISOString(),
        pausa_acumulada_min: 0,
        resolucao_vence_em: sp("2026-10-08", "10:00").toISOString(),
      },
      POLITICA,
      CAL,
      "em_atendimento",
      sp("2026-10-07", "09:00"),
    );
    expect(r.pausa_acumulada).toBe("120 minutes");
  });
});
