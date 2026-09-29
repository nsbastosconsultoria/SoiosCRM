import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * COMO PAGAR A PARCELA (migration 0485).
 *
 * A coluna `instrucao_pagamento` entra pela própria `fn_honorarios_provisionar()`, e é isso que
 * precisa ser provado no banco, não no texto: (1) instalação nova já nasce com ela; (2) quem
 * instalou o módulo ANTES recebe a coluna quando a atualização reaplica a provisionadora; (3) a
 * RLS da 0480 continua sendo a régua — `manager` escreve em parcela pendente, parcela paga não
 * muda, `agent` não escreve; (4) o teto de 1000 caracteres é do banco, não só da rota.
 */
const CONTRATO = "cccccccc-9999-4000-8000-00000000e001";
const PENDENTE = "cccccccc-9999-4000-8000-00000000e011";
const PAGA = "cccccccc-9999-4000-8000-00000000e012";

function instrucaoDa(parcela: string): string {
  return lastLine(
    sql(
      `select coalesce(instrucao_pagamento, '<null>') from public.honorarios_parcelas where id = '${parcela}';`,
    ),
  );
}

function colunaExiste(): boolean {
  return (
    lastLine(
      sql(`select exists(select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'honorarios_parcelas'
               and column_name = 'instrucao_pagamento')::text;`),
    ) === "true"
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_honorarios_provisionar();
    insert into public.honorarios_contratos (id, organization_id, modelo, valor_fixo_cents) values
      ('${CONTRATO}', '${GOV_ORG}', 'fixo', 300000) on conflict (id) do nothing;
    insert into public.honorarios_parcelas (id, organization_id, contrato_id, numero, vencimento, valor_cents, status) values
      ('${PENDENTE}', '${GOV_ORG}', '${CONTRATO}', 1, '2026-10-01', 100000, 'pendente'),
      ('${PAGA}', '${GOV_ORG}', '${CONTRATO}', 2, '2026-11-01', 100000, 'pago')
      on conflict (id) do nothing;
  `);
});

describe("a coluna nasce pela provisionadora", () => {
  it("instalação provisionada tem a coluna", () => {
    expect(colunaExiste()).toBe(true);
  });

  it("⭐ módulo instalado ANTES da 0485: a reaplicação da atualização devolve a coluna", () => {
    // Simula o banco de quem instalou honorários antes desta migration.
    sql(`alter table public.honorarios_parcelas drop column if exists instrucao_pagamento;`);
    expect(colunaExiste()).toBe(false);

    sql(`select public.fn_honorarios_provisionar();`);

    expect(colunaExiste()).toBe(true);
    // Idempotente: rodar de novo não falha nem duplica a constraint.
    sql(`select public.fn_honorarios_provisionar();`);
    expect(
      Number(
        lastLine(
          sql(`select count(*) from pg_constraint
                where conrelid = 'public.honorarios_parcelas'::regclass
                  and conname = 'honorarios_parcelas_instrucao_pagamento_tamanho';`),
        ),
      ),
    ).toBe(1);
  });
});

describe("a RLS da 0480 continua sendo a régua", () => {
  it("manager informa como pagar numa parcela pendente", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.honorarios_parcelas set instrucao_pagamento = 'https://boleto.exemplo/1' where id = '${PENDENTE}'`,
      ),
    ).toBe(1);
    expect(instrucaoDa(PENDENTE)).toBe("https://boleto.exemplo/1");
  });

  it("⭐ parcela paga não muda, nem para receber instrução", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.honorarios_parcelas set instrucao_pagamento = 'x' where id = '${PAGA}'`,
      ),
    ).toBe(0);
    expect(instrucaoDa(PAGA)).toBe("<null>");
  });

  it("⭐ agent não escreve a instrução (é o que o assistente lê, não o que ele define)", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.honorarios_parcelas set instrucao_pagamento = 'pix-falso' where id = '${PENDENTE}'`,
      ),
    ).toBe(0);
    expect(instrucaoDa(PENDENTE)).toBe("https://boleto.exemplo/1");
  });
});

describe("o teto é do banco", () => {
  it("mais de 1000 caracteres é recusado pelo CHECK, e texto vazio também", () => {
    for (const valor of [`repeat('x', 1001)`, `''`]) {
      // `raise notice` vai para o stderr, que o helper não lê: a função devolve o desfecho.
      const desfecho = lastLine(
        sql(`
          create function pg_temp.tenta(v text) returns text language plpgsql as $f$
          begin
            update public.honorarios_parcelas set instrucao_pagamento = v where id = '${PENDENTE}';
            return 'gravou';
          exception when check_violation then return 'recusou';
          end $f$;
          select pg_temp.tenta(${valor});
        `),
      );
      expect(desfecho).toBe("recusou");
    }
    expect(instrucaoDa(PENDENTE)).toBe("https://boleto.exemplo/1");
  });
});
