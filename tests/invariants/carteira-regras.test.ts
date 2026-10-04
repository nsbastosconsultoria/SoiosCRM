import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONTACT_1,
  GOV_CONTACT_2,
  GOV_CONTACT_PROBE,
  GOV_CONV_AGENT_B,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * AS REGRAS DA CARTEIRA MORAM NO SCHEMA (migration 0902, spec 21).
 *
 * O molde (`carteira-provisionadora.test.ts`) prova que as tabelas nascem protegidas. Este
 * arquivo prova o COMPORTAMENTO que a spec promete e que nenhuma rota pode desfazer:
 *
 *   - o estado do relacionamento só anda pela tabela de transições, e nem a sessão nem o
 *     service_role o reescrevem direto (privilégio de COLUNA);
 *   - `cliente_desde` é gravado uma vez e sobrevive à reativação;
 *   - vínculo e contexto não atravessam organização, nem pelo service_role (gatilho BEFORE);
 *   - a IA só aponta o contexto para empresa com vínculo ATIVO do contato; o humano, para
 *     qualquer empresa da organização; trocar fecha o período e o passado não se move;
 *   - quem não enxerga a conversa não enxerga o contexto dela;
 *   - a linha do tempo é append-only para os três papéis do PostgREST;
 *   - a junção de contatos leva os vínculos junto.
 */
const ORG_B = "cccccccc-9902-4000-8000-0000000000b0";
const CONTATO_ORG_B = "cccccccc-9902-4000-8000-0000000000b1";
const EMPRESA_A = "cccccccc-9902-4000-8000-00000000c001";
const EMPRESA_B = "cccccccc-9902-4000-8000-00000000c002";
const EMPRESA_SEM_VINCULO = "cccccccc-9902-4000-8000-00000000c003";
const EMPRESA_REATIVADA = "cccccccc-9902-4000-8000-00000000c004";
const EMPRESA_OUTRA_ORG = "cccccccc-9902-4000-8000-00000000c0b0";
const CONTATO_SECUNDARIO = "cccccccc-9902-4000-8000-00000000d001";

/** A escrita foi RECUSADA — por RLS (0 linhas) ou por privilégio (42501). */
function recusada(usuario: string, dml: string): boolean {
  try {
    return writeCountAs(usuario, dml) === 0;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (stderr.includes("permission denied")) return true;
    throw err;
  }
}

/** Roda como `postgres` e devolve a mensagem de erro do banco, ou `null` se passou. */
function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function um(script: string): string {
  return lastLine(sql(script));
}

function estadoDe(empresa: string): string {
  return um(`select estado from public.carteira_perfis where company_id = '${empresa}';`);
}

function contextoCorrente(conversa: string): string {
  return um(`select coalesce(company_id::text, 'nenhuma') from public.carteira_contexto_conversa
              where conversation_id = '${conversa}' and fim is null;`);
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_carteira_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'carteira-regras-b', 'Carteira Regras B', 'Cart B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_ORG_B}', '${ORG_B}', 'Contato da org B'),
      ('${CONTATO_SECUNDARIO}', '${GOV_ORG}', 'Contato duplicado')
      on conflict (id) do nothing;
    insert into public.companies (id, organization_id, legal_name) values
      ('${EMPRESA_A}', '${GOV_ORG}', 'Empresa A Ltda'),
      ('${EMPRESA_B}', '${GOV_ORG}', 'Empresa B Ltda'),
      ('${EMPRESA_SEM_VINCULO}', '${GOV_ORG}', 'Empresa Sem Vinculo Ltda'),
      ('${EMPRESA_REATIVADA}', '${GOV_ORG}', 'Empresa Reativada Ltda'),
      ('${EMPRESA_OUTRA_ORG}', '${ORG_B}', 'Empresa da Org B Ltda')
      on conflict (id) do nothing;

    -- O contato 1 representa duas empresas; o contato 2, uma.
    insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel, principal) values
      ('${GOV_ORG}', '${GOV_CONTACT_1}', '${EMPRESA_A}', 'socio', true),
      ('${GOV_ORG}', '${GOV_CONTACT_1}', '${EMPRESA_B}', 'financeiro', false),
      ('${GOV_ORG}', '${GOV_CONTACT_2}', '${EMPRESA_A}', 'rh', false)
      on conflict do nothing;
  `);
});

describe("o perfil nasce no primeiro vínculo, como prospect", () => {
  it("vincular cria o perfil e registra perfil_criado + vinculo_criado na linha do tempo", () => {
    expect(estadoDe(EMPRESA_A)).toBe("prospect");
    expect(
      um(`select count(*) from public.carteira_eventos
           where company_id = '${EMPRESA_A}' and tipo in ('perfil_criado', 'vinculo_criado');`),
    ).toBe("3");
  });
});

describe("estado do relacionamento: só pela tabela de transições", () => {
  it("prospect → ativo grava cliente_desde e o evento estado_alterado com o ator", () => {
    sql(`select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_A}', 'ativo', '${GOV_MANAGER}');`);
    expect(estadoDe(EMPRESA_A)).toBe("ativo");
    expect(
      um(`select (cliente_desde = current_date)::text from public.carteira_perfis where company_id = '${EMPRESA_A}';`),
    ).toBe("true");
    expect(
      um(`select ator_user_id::text from public.carteira_eventos
           where company_id = '${EMPRESA_A}' and tipo = 'estado_alterado' order by created_at desc limit 1;`),
    ).toBe(GOV_MANAGER);
  });

  it("transição fora da tabela é recusada e o estado não muda (ativo → proposta)", () => {
    expect(
      erroDe(`select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_A}', 'proposta', null);`),
    ).toContain("carteira_transicao_invalida");
    expect(estadoDe(EMPRESA_A)).toBe("ativo");
  });

  it("mesma transição duas vezes não muda nada nem duplica o evento", () => {
    const antes = um(`select count(*) from public.carteira_eventos where company_id = '${EMPRESA_A}';`);
    expect(
      um(`select (public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_A}', 'ativo', null) ->> 'alterado');`),
    ).toBe("false");
    expect(um(`select count(*) from public.carteira_eventos where company_id = '${EMPRESA_A}';`)).toBe(antes);
  });

  it("cliente_desde sobrevive à saída e à reativação (ativo → inativo → prospect → ativo)", () => {
    sql(`
      select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_REATIVADA}', 'ativo', null);
      update public.carteira_perfis set cliente_desde = date '2019-03-01'
       where company_id = '${EMPRESA_REATIVADA}';
      select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_REATIVADA}', 'inativo', null);
      select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_REATIVADA}', 'prospect', null);
      select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_REATIVADA}', 'ativo', null);
    `);
    expect(
      um(`select cliente_desde::text from public.carteira_perfis where company_id = '${EMPRESA_REATIVADA}';`),
    ).toBe("2019-03-01");
  });

  it("empresa de OUTRA organização não transiciona pela org errada", () => {
    expect(
      erroDe(`select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_OUTRA_ORG}', 'ativo', null);`),
    ).toContain("carteira_empresa_nao_encontrada");
  });

  it("⭐ nem o manager pela sessão reescreve o estado (privilégio de coluna)", () => {
    expect(
      recusada(GOV_MANAGER, `update public.carteira_perfis set estado = 'inativo' where company_id = '${EMPRESA_A}'`),
    ).toBe(true);
    expect(estadoDe(EMPRESA_A)).toBe("ativo");
  });

  it("⭐ nem o service_role reescreve estado ou cliente_desde direto", () => {
    expect(
      erroDe(`set role service_role;
              update public.carteira_perfis set estado = 'inativo' where company_id = '${EMPRESA_A}';`),
    ).toContain("permission denied");
    expect(
      erroDe(`set role service_role;
              update public.carteira_perfis set cliente_desde = null where company_id = '${EMPRESA_A}';`),
    ).toContain("permission denied");
  });

  it("controle positivo: o manager edita os atributos do perfil, e isso vira perfil_atualizado", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.carteira_perfis set atributos = '{"regime_tributario":"simples"}'::jsonb where company_id = '${EMPRESA_A}'`,
      ),
    ).toBe(1);
    expect(
      um(`select count(*) from public.carteira_eventos
           where company_id = '${EMPRESA_A}' and tipo = 'perfil_atualizado';`),
    ).toBe("1");
  });

  it("agent e viewer não editam o perfil", () => {
    for (const usuario of [GOV_AGENT_A, GOV_VIEWER]) {
      expect(
        recusada(usuario, `update public.carteira_perfis set atributos = '{}'::jsonb where company_id = '${EMPRESA_A}'`),
      ).toBe(true);
    }
  });
});

describe("vínculos: não atravessam organização e não se apagam", () => {
  it("⭐ nem o dono do banco liga contato a empresa de outra organização (gatilho, não RLS)", () => {
    expect(
      erroDe(`insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel)
              values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${EMPRESA_OUTRA_ORG}', 'socio');`),
    ).toContain("carteira_empresa_de_outra_organizacao");
    expect(
      erroDe(`insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel)
              values ('${GOV_ORG}', '${CONTATO_ORG_B}', '${EMPRESA_A}', 'socio');`),
    ).toContain("carteira_contato_de_outra_organizacao");
  });

  it("agent vincula (a inbox é agent+); viewer não", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel)
         values ('${GOV_ORG}', '${GOV_CONTACT_PROBE}', '${EMPRESA_B}', 'fiscal')`,
      ),
    ).toBe(1);
    expect(
      recusada(
        GOV_VIEWER,
        `insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel)
         values ('${GOV_ORG}', '${GOV_CONTACT_2}', '${EMPRESA_B}', 'fiscal')`,
      ),
    ).toBe(true);
  });

  it("⭐ ninguém apaga vínculo pela sessão — nem o manager (desativa-se)", () => {
    expect(
      recusada(GOV_MANAGER, `delete from public.carteira_vinculos where contact_id = '${GOV_CONTACT_2}'`),
    ).toBe(true);
    expect(
      um(`select count(*) from public.carteira_vinculos where contact_id = '${GOV_CONTACT_2}';`),
    ).toBe("1");
  });

  it("um só contato principal ATIVO por empresa", () => {
    expect(
      erroDe(`update public.carteira_vinculos set principal = true
               where contact_id = '${GOV_CONTACT_2}' and company_id = '${EMPRESA_A}';`),
    ).toContain("carteira_vinculos_um_principal_idx");
  });
});

describe("contexto da conversa", () => {
  it("a IA não aponta para empresa sem vínculo ativo do contato", () => {
    expect(
      erroDe(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}',
                '${EMPRESA_SEM_VINCULO}', 'agente', null);`),
    ).toContain("carteira_contato_sem_vinculo_com_a_empresa");
  });

  it("a IA aponta para empresa vinculada; repetir não abre outro período", () => {
    sql(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${EMPRESA_A}', 'agente', null);`);
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_A);
    expect(
      um(`select (public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}',
                 '${EMPRESA_A}', 'agente', null) ->> 'alterado');`),
    ).toBe("false");
    expect(
      um(`select count(*) from public.carteira_contexto_conversa where conversation_id = '${GOV_CONV_UNASSIGNED}';`),
    ).toBe("1");
  });

  it("trocar fecha o período anterior, abre outro, e o passado continua lá", () => {
    sql(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${EMPRESA_B}', 'cliente_informou', null);`);
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_B);
    expect(
      um(`select count(*) from public.carteira_contexto_conversa
           where conversation_id = '${GOV_CONV_UNASSIGNED}' and company_id = '${EMPRESA_A}' and fim is not null;`),
    ).toBe("1");
  });

  it("o humano aponta para qualquer empresa da organização, mesmo sem vínculo", () => {
    sql(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}',
           '${EMPRESA_SEM_VINCULO}', 'humano', '${GOV_MANAGER}');`);
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_SEM_VINCULO);
  });

  it("nem o humano aponta para empresa de outra organização", () => {
    expect(
      erroDe(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}',
                '${EMPRESA_OUTRA_ORG}', 'humano', '${GOV_MANAGER}');`),
    ).toContain("carteira_empresa_nao_encontrada");
  });

  it("⭐ a sessão não escreve contexto direto — só a função", () => {
    expect(
      recusada(
        GOV_MANAGER,
        `insert into public.carteira_contexto_conversa (organization_id, conversation_id, company_id, definido_por)
         values ('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${EMPRESA_A}', 'humano')`,
      ),
    ).toBe(true);
  });

  it("quem não enxerga a conversa não enxerga o contexto dela", () => {
    sql(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${EMPRESA_A}', 'agente', null);`);
    const consulta = `select count(*) from public.carteira_contexto_conversa where conversation_id = '${GOV_CONV_AGENT_B}';`;
    // controle positivo: o dono da conversa vê
    expect(countAs(GOV_AGENT_B, consulta)).toBe(1);
    // conversa atribuída a outro atendente fica fora da visão de quem não é dono
    // (visibility_mode padrão `own_and_unassigned`, spec 13 §3.5)
    expect(countAs(GOV_AGENT_A, consulta)).toBe(0);
  });
});

describe("linha do tempo append-only", () => {
  for (const papel of ["authenticated", "service_role"] as const) {
    it(`⭐ ${papel} não reescreve nem apaga evento`, () => {
      expect(erroDe(`set role ${papel}; update public.carteira_eventos set tipo = 'perfil_criado';`)).toContain(
        "permission denied",
      );
      expect(erroDe(`set role ${papel}; delete from public.carteira_eventos;`)).toContain("permission denied");
      expect(
        erroDe(`set role ${papel};
                insert into public.carteira_eventos (organization_id, tipo, ator_kind)
                values ('${GOV_ORG}', 'perfil_criado', 'sistema');`),
      ).toContain("permission denied");
    });
  }

  it("controle positivo: membro da organização lê a linha do tempo", () => {
    expect(
      countAs(GOV_VIEWER, `select count(*) from public.carteira_eventos where company_id = '${EMPRESA_A}';`),
    ).toBeGreaterThan(0);
  });
});

describe("junção de contatos", () => {
  it("fn_mesclar_contatos leva o vínculo do contato absorvido para o principal", () => {
    sql(`
      insert into public.carteira_vinculos (organization_id, contact_id, company_id, papel)
      values ('${GOV_ORG}', '${CONTATO_SECUNDARIO}', '${EMPRESA_SEM_VINCULO}', 'outro')
      on conflict do nothing;
      select public.fn_mesclar_contatos('${GOV_ORG}', '${GOV_CONTACT_2}', array['${CONTATO_SECUNDARIO}']::uuid[]);
    `);
    expect(
      um(`select count(*) from public.carteira_vinculos
           where contact_id = '${GOV_CONTACT_2}' and company_id = '${EMPRESA_SEM_VINCULO}';`),
    ).toBe("1");
  });
});
