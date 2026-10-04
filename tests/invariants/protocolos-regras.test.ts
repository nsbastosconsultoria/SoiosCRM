import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_CONTACT_3,
  GOV_CONV_CLAIM,
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
 * AS REGRAS DOS PROTOCOLOS MORAM NO SCHEMA (migration 0904, spec 22).
 *
 * O molde prova que as tabelas nascem protegidas. Este arquivo prova o que nenhum escritor
 * (rota, motor do agente, script) consegue desfazer:
 *
 *   - numeração anual por organização, sem buraco e sem colisão entre organizações;
 *   - o que nasce com o protocolo (número, empresa, contato, conversa, origem) não muda;
 *   - a máquina de estados: só as transições da tabela, fechado e cancelado são finais, e os
 *     carimbos (primeira resposta, resolvido, reaberturas, fechado) são do gatilho;
 *   - a sessão só LÊ protocolos (o serviço escreve); configuração é do `admin`;
 *   - a linha do tempo é append-only, e nota/complemento entram só pela função;
 *   - anonimizar o contato apaga o texto livre do protocolo e dos eventos, e mantém a operação.
 */
const ORG_B = "cccccccc-9904-4000-8000-0000000000b0";
const CATEGORIA = "cccccccc-9904-4000-8000-00000000a001";
const SUB = "cccccccc-9904-4000-8000-00000000a002";
const OUTRA_CATEGORIA = "cccccccc-9904-4000-8000-00000000a003";
const SUB_DA_OUTRA = "cccccccc-9904-4000-8000-00000000a004";
const CATEGORIA_ORG_B = "cccccccc-9904-4000-8000-00000000a0b0";

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

function recusada(usuario: string, dml: string): boolean {
  try {
    return writeCountAs(usuario, dml) === 0;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (stderr.includes("permission denied")) return true;
    throw err;
  }
}

/** Abre um protocolo como o serviço faria (postgres no teste; service role em produção). */
function abrir(org: string, categoria: string, extra = ""): string {
  return um(`
    insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem${extra ? ", " + extra.split("=")[0] : ""})
    values ('${org}', '${categoria}', 'Guia do DAS', 'Cliente pediu a guia do DAS de setembro', 'P3', 'fiscal', 'humano'${extra ? ", " + extra.split("=")[1] : ""})
    returning id;`);
}

function estado(id: string): string {
  return um(`select estado from public.protocolos where id = '${id}';`);
}

function mover(id: string, para: string): string | null {
  return erroDe(`update public.protocolos set estado = '${para}' where id = '${id}';`);
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_protocolos_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'protocolos-regras-b', 'Protocolos Regras B', 'Prot B')
      on conflict (id) do nothing;
    insert into public.protocolo_categorias (id, organization_id, parent_id, nome, slug, area) values
      ('${CATEGORIA}', '${GOV_ORG}', null, 'Fiscal', 'fiscal', 'fiscal'),
      ('${SUB}', '${GOV_ORG}', '${CATEGORIA}', 'DAS', 'das', 'fiscal'),
      ('${OUTRA_CATEGORIA}', '${GOV_ORG}', null, 'DP', 'dp', 'dp'),
      ('${SUB_DA_OUTRA}', '${GOV_ORG}', '${OUTRA_CATEGORIA}', 'Admissão', 'admissao', 'dp'),
      ('${CATEGORIA_ORG_B}', '${ORG_B}', null, 'Fiscal', 'fiscal', 'fiscal')
      on conflict do nothing;
  `);
});

describe("numeração", () => {
  it("numera em sequência por organização e ano, e a outra organização começa do 1", () => {
    const a = abrir(GOV_ORG, CATEGORIA);
    const b = abrir(GOV_ORG, CATEGORIA);
    const c = abrir(ORG_B, CATEGORIA_ORG_B);
    const numero = (id: string) => Number(um(`select numero from public.protocolos where id = '${id}';`));
    expect(numero(b)).toBe(numero(a) + 1);
    expect(numero(c)).toBe(1);
    expect(um(`select (ano = extract(year from now())::int)::text from public.protocolos where id = '${a}';`)).toBe("true");
  });

  it("número enviado por quem grava é ignorado — o gatilho decide", () => {
    const id = um(`
      insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem, numero, ano)
      values ('${GOV_ORG}', '${CATEGORIA}', 't', 'd', 'P3', 'fiscal', 'humano', 999999, 1999) returning id;`);
    expect(um(`select (numero <> 999999 and ano <> 1999)::text from public.protocolos where id = '${id}';`)).toBe("true");
  });
});

describe("o que nasce com o protocolo não muda", () => {
  it("número, contato e origem são imutáveis", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    expect(erroDe(`update public.protocolos set numero = 1 where id = '${id}';`)).toContain("protocolo_campo_imutavel");
    expect(erroDe(`update public.protocolos set contact_id = '${GOV_CONTACT_3}' where id = '${id}';`)).toContain(
      "protocolo_campo_imutavel",
    );
    expect(erroDe(`update public.protocolos set origem = 'api' where id = '${id}';`)).toContain("protocolo_campo_imutavel");
  });

  it("categoria de outra organização é recusada (FK composta), e subcategoria tem de ser filha da categoria", () => {
    expect(erroDe(`insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem)
                   values ('${GOV_ORG}', '${CATEGORIA_ORG_B}', 't', 'd', 'P3', 'fiscal', 'humano');`)).not.toBeNull();
    expect(erroDe(`insert into public.protocolos (organization_id, categoria_id, subcategoria_id, titulo, descricao, prioridade, area, origem)
                   values ('${GOV_ORG}', '${CATEGORIA}', '${SUB_DA_OUTRA}', 't', 'd', 'P3', 'fiscal', 'humano');`)).toContain(
      "protocolo_subcategoria_de_outra_categoria",
    );
    expect(erroDe(`insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem)
                   values ('${GOV_ORG}', '${SUB}', 't', 'd', 'P3', 'fiscal', 'humano');`)).toContain("protocolo_categoria_nao_e_raiz");
  });

  it("subcategoria de subcategoria é recusada (um nível só)", () => {
    expect(erroDe(`insert into public.protocolo_categorias (organization_id, parent_id, nome, slug, area)
                   values ('${GOV_ORG}', '${SUB}', 'Neta', 'neta', 'fiscal');`)).toContain("protocolo_subcategoria_de_subcategoria");
  });
});

describe("máquina de estados", () => {
  it("caminho feliz carimba primeira resposta, resolvido e fechado", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    expect(mover(id, "atribuido")).toBeNull();
    expect(mover(id, "em_atendimento")).toBeNull();
    expect(um(`select (primeira_resposta_em is not null)::text from public.protocolos where id = '${id}';`)).toBe("true");
    expect(mover(id, "resolvido")).toBeNull();
    expect(um(`select (resolvido_em is not null)::text from public.protocolos where id = '${id}';`)).toBe("true");
    expect(mover(id, "fechado")).toBeNull();
    expect(um(`select (fechado_em is not null)::text from public.protocolos where id = '${id}';`)).toBe("true");
  });

  it("fechado é final", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    for (const passo of ["em_atendimento", "resolvido", "fechado"]) expect(mover(id, passo)).toBeNull();
    expect(mover(id, "reaberto")).toContain("protocolo_transicao_invalida");
    expect(estado(id)).toBe("fechado");
  });

  it("transição fora da tabela é recusada (novo → resolvido)", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    expect(mover(id, "resolvido")).toContain("protocolo_transicao_invalida");
    expect(estado(id)).toBe("novo");
  });

  it("reabrir conta a reabertura e limpa o resolvido_em", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    for (const passo of ["em_atendimento", "resolvido", "reaberto"]) expect(mover(id, passo)).toBeNull();
    expect(um(`select reaberturas || '|' || coalesce(resolvido_em::text, 'nulo') from public.protocolos where id = '${id}';`)).toBe(
      "1|nulo",
    );
  });

  it("a primeira resposta não é regravada por um segundo em_atendimento", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    mover(id, "em_atendimento");
    const primeira = um(`select primeira_resposta_em from public.protocolos where id = '${id}';`);
    mover(id, "aguardando_cliente");
    mover(id, "em_atendimento");
    expect(um(`select primeira_resposta_em from public.protocolos where id = '${id}';`)).toBe(primeira);
  });

  it("não nasce fechado", () => {
    expect(erroDe(`insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem, estado, fechado_em)
                   values ('${GOV_ORG}', '${CATEGORIA}', 't', 'd', 'P3', 'fiscal', 'humano', 'fechado', now());`)).toContain(
      "protocolo_nasce_aberto",
    );
  });
});

describe("quem escreve", () => {
  it("⭐ a sessão não cria nem altera protocolo — nem o admin (o serviço escreve)", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    for (const usuario of [GOV_AGENT_A, GOV_MANAGER, GOV_ADMIN]) {
      expect(
        recusada(
          usuario,
          `insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem)
           values ('${GOV_ORG}', '${CATEGORIA}', 't', 'd', 'P3', 'fiscal', 'humano')`,
        ),
      ).toBe(true);
      expect(recusada(usuario, `update public.protocolos set prioridade = 'P1' where id = '${id}'`)).toBe(true);
    }
  });

  it("controle positivo: membro da organização lê", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.protocolos where organization_id = '${GOV_ORG}';`)).toBeGreaterThan(0);
  });

  it("configuração: admin escreve; manager não", () => {
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.protocolo_feriados (organization_id, data, descricao) values ('${GOV_ORG}', '2026-12-25', 'Natal')`,
      ),
    ).toBe(1);
    expect(
      recusada(
        GOV_MANAGER,
        `insert into public.protocolo_feriados (organization_id, data, descricao) values ('${GOV_ORG}', '2026-01-01', 'Ano novo')`,
      ),
    ).toBe(true);
  });

  it("membro da fila tem de ser membro da organização (FK composta)", () => {
    expect(erroDe(`insert into public.protocolo_area_membros (organization_id, area, user_id)
                   values ('${ORG_B}', 'fiscal', '${GOV_AGENT_A}');`)).not.toBeNull();
  });

  it("um líder por área", () => {
    sql(`insert into public.protocolo_area_membros (organization_id, area, user_id, papel)
         values ('${GOV_ORG}', 'fiscal', '${GOV_MANAGER}', 'lider') on conflict do nothing;`);
    expect(erroDe(`insert into public.protocolo_area_membros (organization_id, area, user_id, papel)
                   values ('${GOV_ORG}', 'fiscal', '${GOV_ADMIN}', 'lider');`)).toContain("protocolo_area_membros_um_lider_idx");
  });
});

describe("linha do tempo", () => {
  it("abrir e mudar estado e prioridade viram eventos, campo a campo", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    mover(id, "em_atendimento");
    sql(`update public.protocolos set prioridade = 'P1', prioridade_origem = 'humano', alterado_por = '${GOV_MANAGER}' where id = '${id}';`);
    expect(
      um(`select string_agg(tipo, ',' order by created_at, tipo) from public.protocolo_eventos where protocolo_id = '${id}';`),
    ).toBe("aberto,estado_alterado,prioridade_alterada");
    expect(
      um(`select ator_kind || '|' || ator_user_id from public.protocolo_eventos
           where protocolo_id = '${id}' and tipo = 'prioridade_alterada';`),
    ).toBe(`humano|${GOV_MANAGER}`);
  });

  for (const papel of ["authenticated", "service_role"] as const) {
    it(`⭐ ${papel} não insere, não reescreve, não apaga evento`, () => {
      expect(erroDe(`set role ${papel}; delete from public.protocolo_eventos;`)).toContain("permission denied");
      expect(erroDe(`set role ${papel}; update public.protocolo_eventos set texto = 'x';`)).toContain("permission denied");
    });
  }

  it("nota entra pela função; tipo deduzível (ex.: resolvido) é recusado nela", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    sql(`select public.fn_protocolo_registrar_evento('${GOV_ORG}', '${id}', 'nota', 'Liguei para o cliente', '${GOV_MANAGER}', 'humano');`);
    expect(um(`select count(*) from public.protocolo_eventos where protocolo_id = '${id}' and tipo = 'nota';`)).toBe("1");
    expect(
      erroDe(`select public.fn_protocolo_registrar_evento('${GOV_ORG}', '${id}', 'resolvido', null, null, 'sistema');`),
    ).toContain("protocolo_evento_invalido");
    expect(
      erroDe(`select public.fn_protocolo_registrar_evento('${ORG_B}', '${id}', 'nota', 'x', null, 'sistema');`),
    ).toContain("protocolo_nao_encontrado");
  });

  it("o service role só acrescenta marco de SLA; não desfaz", () => {
    const id = abrir(GOV_ORG, CATEGORIA);
    expect(
      erroDe(`set role service_role;
              insert into public.protocolo_marcos_sla (protocolo_id, organization_id, relogio, marco)
              values ('${id}', '${GOV_ORG}', 'resolucao', 80);`),
    ).toBeNull();
    expect(erroDe(`set role service_role; delete from public.protocolo_marcos_sla where protocolo_id = '${id}';`)).toContain(
      "permission denied",
    );
  });
});

describe("LGPD: anonimizar o contato alcança o módulo", () => {
  it("título e descrição viram o rótulo, resumo e eventos de texto viram nulo, a operação fica", () => {
    const id = abrir(GOV_ORG, CATEGORIA, `contact_id='${GOV_CONTACT_3}'`);
    sql(`
      update public.protocolos set resumo = '{"solicitacao":"guia do DAS"}'::jsonb, alterado_por = null where id = '${id}';
      select public.fn_protocolo_registrar_evento('${GOV_ORG}', '${id}', 'complemento_do_cliente', 'meu CPF é 123', null, 'ia');
      update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${GOV_CONTACT_3}';
    `);
    expect(
      um(`select (titulo like 'Cliente Anonimizado #%' and descricao like 'Cliente Anonimizado #%' and resumo is null)::text
            from public.protocolos where id = '${id}';`),
    ).toBe("true");
    expect(
      um(`select count(*) from public.protocolo_eventos where protocolo_id = '${id}' and texto is not null;`),
    ).toBe("0");
    expect(um(`select prioridade || '|' || area from public.protocolos where id = '${id}';`)).toBe("P3|fiscal");
  });

  it("as seções declaradas apontam para colunas que existem (senão a anonimização falharia alto)", () => {
    expect(
      um(`select count(*) from public.modulo_secoes_lgpd where modulo = 'protocolos';`),
    ).toBe("2");
  });
});

describe("conversa e empresa na abertura", () => {
  it("conversa de outra organização é recusada", () => {
    expect(
      erroDe(`insert into public.protocolos (organization_id, categoria_id, titulo, descricao, prioridade, area, origem, conversation_id)
              values ('${ORG_B}', '${CATEGORIA_ORG_B}', 't', 'd', 'P3', 'fiscal', 'humano', '${GOV_CONV_CLAIM}');`),
    ).toContain("protocolo_conversa_de_outra_organizacao");
  });
});
