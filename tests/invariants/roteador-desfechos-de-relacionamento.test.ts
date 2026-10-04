import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * A TELEMETRIA DO ROTEADOR ACEITA OS DESFECHOS DA REGRA 0 (migration 0903, spec 21 §7).
 *
 * O turno grava cada decisão do roteador em `ai_router_decisions`. Sem a 0903, o INSERT de
 * `relationship` e `relationship_overridden` morria no CHECK: o turno seguia (o insert é
 * fire-and-forget), mas a decisão sumia da tela de Evolução. Controle negativo: valor inventado
 * continua recusado — o CHECK ficou mais largo, não deixou de existir.
 */
function insereDesfecho(outcome: string): string | null {
  try {
    sql(`insert into public.ai_router_decisions (organization_id, outcome) values ('${GOV_ORG}', '${outcome}');`);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

beforeAll(() => {
  seedGov();
});

describe("ai_router_decisions.outcome", () => {
  for (const outcome of ["relationship", "relationship_overridden", "classified", "sticky"]) {
    it(`aceita '${outcome}'`, () => {
      expect(insereDesfecho(outcome)).toBeNull();
    });
  }

  it("continua recusando valor fora do vocabulário", () => {
    expect(insereDesfecho("palpite")).toContain("ai_router_decisions_outcome_check");
  });

  it("o CHECK existe com o nome que a migration usa (drop if exists + add é reaplicável)", () => {
    expect(
      lastLine(
        sql(`select count(*) from pg_constraint
              where conrelid = 'public.ai_router_decisions'::regclass
                and conname = 'ai_router_decisions_outcome_check';`),
      ),
    ).toBe("1");
  });
});
