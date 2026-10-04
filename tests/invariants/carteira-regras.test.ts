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
 *   - o vínculo é o do NÚCLEO (contato → pessoa → company_people): o módulo só detalha, não
 *     atravessa organização nem pelo service_role, e vínculo sem detalhe vale como ativo;
 *   - a IA só aponta o contexto para empresa com vínculo ATIVO do contato; o humano, para
 *     qualquer empresa da organização; trocar fecha o período e o passado não se move;
 *   - quem não enxerga a conversa não enxerga o contexto dela;
 *   - a linha do tempo é append-only para os três papéis do PostgREST.
 */
const ORG_B = "cccccccc-9902-4000-8000-0000000000b0";
const PESSOA_ORG_B = "cccccccc-9902-4000-8000-0000000000b2";
const EMPRESA_A = "cccccccc-9902-4000-8000-00000000c001";
const EMPRESA_B = "cccccccc-9902-4000-8000-00000000c002";
const EMPRESA_SEM_VINCULO = "cccccccc-9902-4000-8000-00000000c003";
const EMPRESA_REATIVADA = "cccccccc-9902-4000-8000-00000000c004";
const EMPRESA_SO_NUCLEO = "cccccccc-9902-4000-8000-00000000c005";
const EMPRESA_OUTRA_ORG = "cccccccc-9902-4000-8000-00000000c0b0";
const PESSOA_1 = "cccccccc-9902-4000-8000-00000000e001";
const PESSOA_2 = "cccccccc-9902-4000-8000-00000000e002";
const PESSOA_PROBE = "cccccccc-9902-4000-8000-00000000e004";
const CP_1A = "cccccccc-9902-4000-8000-00000000f01a";
const CP_1B = "cccccccc-9902-4000-8000-00000000f01b";
const CP_1C = "cccccccc-9902-4000-8000-00000000f01c";
const CP_2A = "cccccccc-9902-4000-8000-00000000f02a";
const CP_PROBE_B = "cccccccc-9902-4000-8000-00000000f04b";
const CP_ORG_B = "cccccccc-9902-4000-8000-00000000f0b0";

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

function definirPelaIa(conversa: string, empresa: string): string {
  return `select public.fn_carteira_definir_contexto('${GOV_ORG}', '${conversa}', '${empresa}', 'agente', null);`;
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_carteira_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'carteira-regras-b', 'Carteira Regras B', 'Cart B')
      on conflict (id) do nothing;
    insert into public.companies (id, organization_id, legal_name) values
      ('${EMPRESA_A}', '${GOV_ORG}', 'Empresa A Ltda'),
      ('${EMPRESA_B}', '${GOV_ORG}', 'Empresa B Ltda'),
      ('${EMPRESA_SEM_VINCULO}', '${GOV_ORG}', 'Empresa Sem Vinculo Ltda'),
      ('${EMPRESA_REATIVADA}', '${GOV_ORG}', 'Empresa Reativada Ltda'),
      ('${EMPRESA_SO_NUCLEO}', '${GOV_ORG}', 'Empresa So Nucleo Ltda'),
      ('${EMPRESA_OUTRA_ORG}', '${ORG_B}', 'Empresa da Org B Ltda')
      on conflict (id) do nothing;
    insert into public.people (id, organization_id, full_name) values
      ('${PESSOA_1}', '${GOV_ORG}', 'Pessoa Um'),
      ('${PESSOA_2}', '${GOV_ORG}', 'Pessoa Dois'),
      ('${PESSOA_PROBE}', '${GOV_ORG}', 'Pessoa Probe'),
      ('${PESSOA_ORG_B}', '${ORG_B}', 'Pessoa da Org B')
      on conflict (id) do nothing;
    update public.contacts set person_id = '${PESSOA_1}' where id = '${GOV_CONTACT_1}';
    update public.contacts set person_id = '${PESSOA_2}' where id = '${GOV_CONTACT_2}';
    update public.contacts set person_id = '${PESSOA_PROBE}' where id = '${GOV_CONTACT_PROBE}';

    -- O vínculo é do NÚCLEO. A pessoa 1 (contato 1) representa A, B e C; a pessoa 2, só A.
    insert into public.company_people (id, organization_id, company_id, person_id) values
      ('${CP_1A}', '${GOV_ORG}', '${EMPRESA_A}', '${PESSOA_1}'),
      ('${CP_1B}', '${GOV_ORG}', '${EMPRESA_B}', '${PESSOA_1}'),
      ('${CP_1C}', '${GOV_ORG}', '${EMPRESA_SO_NUCLEO}', '${PESSOA_1}'),
      ('${CP_2A}', '${GOV_ORG}', '${EMPRESA_A}', '${PESSOA_2}'),
      ('${CP_PROBE_B}', '${GOV_ORG}', '${EMPRESA_B}', '${PESSOA_PROBE}'),
      ('${CP_ORG_B}', '${ORG_B}', '${EMPRESA_OUTRA_ORG}', '${PESSOA_ORG_B}')
      on conflict (id) do nothing;

    -- O módulo detalha dois deles; C fica só no núcleo, de propósito.
    insert into public.carteira_vinculo_detalhes (company_people_id, organization_id, papel) values
      ('${CP_1A}', '${GOV_ORG}', 'socio'),
      ('${CP_2A}', '${GOV_ORG}', 'rh')
      on conflict do nothing;
  `);
});

describe("o perfil nasce no primeiro vínculo detalhado, como prospect", () => {
  it("detalhar cria o perfil e registra perfil_criado + vinculo_criado na linha do tempo", () => {
    expect(estadoDe(EMPRESA_A)).toBe("prospect");
    expect(
      um(`select count(*) from public.carteira_eventos
           where company_id = '${EMPRESA_A}' and tipo in ('perfil_criado', 'vinculo_criado');`),
    ).toBe("3");
  });

  it("o evento de vínculo aponta a PESSOA do company_people, sem copiar nada para o detalhe", () => {
    expect(
      um(`select person_id::text from public.carteira_eventos
           where company_id = '${EMPRESA_A}' and tipo = 'vinculo_criado' and novo ->> 'papel' = 'rh';`),
    ).toBe(PESSOA_2);
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

describe("detalhe do vínculo: não atravessa organização e não se apaga", () => {
  it("⭐ nem o dono do banco detalha um company_people de outra organização (gatilho, não RLS)", () => {
    expect(
      erroDe(`insert into public.carteira_vinculo_detalhes (company_people_id, organization_id, papel)
              values ('${CP_ORG_B}', '${GOV_ORG}', 'socio');`),
    ).toContain("carteira_vinculo_de_outra_organizacao");
  });

  it("viewer não detalha; agent detalha (a inbox é agent+)", () => {
    expect(
      recusada(
        GOV_VIEWER,
        `insert into public.carteira_vinculo_detalhes (company_people_id, organization_id, papel)
         values ('${CP_PROBE_B}', '${GOV_ORG}', 'fiscal')`,
      ),
    ).toBe(true);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.carteira_vinculo_detalhes (company_people_id, organization_id, papel)
         values ('${CP_1B}', '${GOV_ORG}', 'financeiro')`,
      ),
    ).toBe(1);
  });

  it("⭐ ninguém apaga detalhe pela sessão — nem o manager (desativa-se)", () => {
    expect(
      recusada(GOV_MANAGER, `delete from public.carteira_vinculo_detalhes where company_people_id = '${CP_2A}'`),
    ).toBe(true);
    expect(
      um(`select count(*) from public.carteira_vinculo_detalhes where company_people_id = '${CP_2A}';`),
    ).toBe("1");
  });

  it("o detalhe não troca de vínculo (seria reescrever quem representava a empresa)", () => {
    expect(
      erroDe(`update public.carteira_vinculo_detalhes set company_people_id = '${CP_1C}'
               where company_people_id = '${CP_2A}';`),
    ).toContain("carteira_vinculo_imutavel");
  });

  it("apagar o vínculo no núcleo leva o detalhe junto (cascata), sem órfão", () => {
    sql(`
      insert into public.company_people (id, organization_id, company_id, person_id)
        values ('cccccccc-9902-4000-8000-00000000f099', '${GOV_ORG}', '${EMPRESA_REATIVADA}', '${PESSOA_2}')
        on conflict (id) do nothing;
      insert into public.carteira_vinculo_detalhes (company_people_id, organization_id)
        values ('cccccccc-9902-4000-8000-00000000f099', '${GOV_ORG}') on conflict do nothing;
      delete from public.company_people where id = 'cccccccc-9902-4000-8000-00000000f099';
    `);
    expect(
      um(`select count(*) from public.carteira_vinculo_detalhes
           where company_people_id = 'cccccccc-9902-4000-8000-00000000f099';`),
    ).toBe("0");
  });
});

describe("contexto da conversa", () => {
  it("a IA não aponta para empresa sem vínculo do contato", () => {
    expect(erroDe(definirPelaIa(GOV_CONV_UNASSIGNED, EMPRESA_SEM_VINCULO))).toContain(
      "carteira_contato_sem_vinculo_com_a_empresa",
    );
  });

  it("a IA aponta para empresa vinculada; repetir não abre outro período", () => {
    sql(definirPelaIa(GOV_CONV_UNASSIGNED, EMPRESA_A));
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_A);
    expect(
      um(`select (public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}',
                 '${EMPRESA_A}', 'agente', null) ->> 'alterado');`),
    ).toBe("false");
    expect(
      um(`select count(*) from public.carteira_contexto_conversa where conversation_id = '${GOV_CONV_UNASSIGNED}';`),
    ).toBe("1");
  });

  it("vínculo só do núcleo, sem detalhe, vale como ativo", () => {
    sql(definirPelaIa(GOV_CONV_UNASSIGNED, EMPRESA_SO_NUCLEO));
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_SO_NUCLEO);
  });

  it("trocar fecha o período anterior, abre outro, e o passado continua lá", () => {
    sql(`select public.fn_carteira_definir_contexto('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', '${EMPRESA_B}', 'cliente_informou', null);`);
    expect(contextoCorrente(GOV_CONV_UNASSIGNED)).toBe(EMPRESA_B);
    expect(
      um(`select count(*) from public.carteira_contexto_conversa
           where conversation_id = '${GOV_CONV_UNASSIGNED}' and company_id = '${EMPRESA_A}' and fim is not null;`),
    ).toBe("1");
  });

  it("vínculo desativado no detalhe tira a empresa do alcance da IA", () => {
    sql(`update public.carteira_vinculo_detalhes set ativo = false where company_people_id = '${CP_1A}';`);
    expect(erroDe(definirPelaIa(GOV_CONV_UNASSIGNED, EMPRESA_A))).toContain(
      "carteira_contato_sem_vinculo_com_a_empresa",
    );
    sql(`update public.carteira_vinculo_detalhes set ativo = true where company_people_id = '${CP_1A}';`);
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
    sql(definirPelaIa(GOV_CONV_AGENT_B, EMPRESA_A));
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
    it(`⭐ ${papel} não reescreve, não apaga e não insere evento`, () => {
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
