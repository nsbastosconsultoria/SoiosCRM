/**
 * Implantação de clientes (migration 0907, spec 23) — as regras que moram no banco.
 *
 *   - iniciar leva a empresa a `em_implantacao`, copia os itens com prazo e responsável pela área
 *     da carteira, e é idempotente;
 *   - a TRAVA: concluir com obrigatório aberto é recusado — pela função e por UPDATE direto;
 *   - itens: tabela de transições, evidência exigida, dispensa só com motivo, compromisso imutável;
 *   - concluir leva a carteira a `ativo` (com `cliente_desde`) e congela os itens;
 *   - cancelar exige motivo e pode inativar; empresa inativa não começa implantação;
 *   - a sessão só lê implantações e itens.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

const EMPRESA = "cccccccc-9907-4000-8000-00000000e001";
const EMPRESA_CANCELA = "cccccccc-9907-4000-8000-00000000e002";
const EMPRESA_ATIVA = "cccccccc-9907-4000-8000-00000000e003";
const EMPRESA_INATIVA = "cccccccc-9907-4000-8000-00000000e004";
const MODELO = "cccccccc-9907-4000-8000-00000000a001";
const ITEM_OBRIGATORIO = "cccccccc-9907-4000-8000-00000000b001"; // fiscal, exige evidência, 10 dias
const ITEM_DISPENSAVEL = "cccccccc-9907-4000-8000-00000000b002"; // obrigatório, sem área
const ITEM_OPCIONAL = "cccccccc-9907-4000-8000-00000000b003"; // opcional, 30 dias

function um(script: string): string {
  return lastLine(sql(script));
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function iniciar(empresa: string): { implantacao_id: string; criada: boolean } {
  return JSON.parse(
    um(`select public.fn_implantacao_iniciar('${GOV_ORG}', '${empresa}', '${MODELO}', 'manual', null, '${GOV_MANAGER}', '${GOV_MANAGER}');`),
  );
}

function estadoNaCarteira(empresa: string): string {
  return um(`select estado from public.carteira_perfis where company_id = '${empresa}';`);
}

function itemDe(implantacao: string, titulo: string): string {
  return um(`select id from public.implantacao_itens where implantacao_id = '${implantacao}' and titulo = '${titulo}';`);
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_carteira_provisionar();
    select public.fn_implantacao_provisionar();
    insert into public.companies (id, organization_id, legal_name) values
      ('${EMPRESA}', '${GOV_ORG}', 'Implantacao Ltda'),
      ('${EMPRESA_CANCELA}', '${GOV_ORG}', 'Cancela Ltda'),
      ('${EMPRESA_ATIVA}', '${GOV_ORG}', 'Ja Ativa Ltda'),
      ('${EMPRESA_INATIVA}', '${GOV_ORG}', 'Inativa Ltda')
      on conflict (id) do nothing;
    select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_ATIVA}', 'ativo', null);
    select public.fn_carteira_transicionar('${GOV_ORG}', '${EMPRESA_INATIVA}', 'inativo', null);
    insert into public.carteira_responsaveis (organization_id, company_id, area, user_id)
      values ('${GOV_ORG}', '${EMPRESA}', 'fiscal', '${GOV_AGENT_A}');
    insert into public.implantacao_modelos (id, organization_id, nome, padrao)
      values ('${MODELO}', '${GOV_ORG}', 'Contabilidade 0907', true) on conflict do nothing;
    insert into public.implantacao_modelo_itens
      (id, organization_id, modelo_id, grupo, titulo, posicao, obrigatorio, vez_de, area, prazo_dias, exige_evidencia)
    values
      ('${ITEM_OBRIGATORIO}', '${GOV_ORG}', '${MODELO}', 'Acessos', 'Certificado digital', 1, true, 'cliente', 'fiscal', 10, true),
      ('${ITEM_DISPENSAVEL}', '${GOV_ORG}', '${MODELO}', 'Folha', 'Dados de folha', 2, true, 'cliente', null, 15, false),
      ('${ITEM_OPCIONAL}', '${GOV_ORG}', '${MODELO}', 'Conclusão', 'Reunião de boas-vindas', 3, false, 'escritorio', null, 30, false)
    on conflict do nothing;
  `);
});

describe("iniciar", () => {
  it("leva a empresa a em_implantacao, copia os itens com prazo no fuso e responsável pela área", () => {
    const r = iniciar(EMPRESA);
    expect(r.criada).toBe(true);
    expect(estadoNaCarteira(EMPRESA)).toBe("em_implantacao");

    expect(um(`select count(*) from public.implantacao_itens where implantacao_id = '${r.implantacao_id}';`)).toBe("3");
    const certificado = itemDe(r.implantacao_id, "Certificado digital");
    expect(um(`select responsavel_user_id from public.implantacao_itens where id = '${certificado}';`)).toBe(GOV_AGENT_A);
    // Sem área (ou sem responsável na área): o responsável da implantação.
    expect(um(`select responsavel_user_id from public.implantacao_itens where id = '${itemDe(r.implantacao_id, "Dados de folha")}';`)).toBe(
      GOV_MANAGER,
    );
    expect(
      um(`select (prazo = (now() at time zone 'America/Sao_Paulo')::date + 10)::text from public.implantacao_itens where id = '${certificado}';`),
    ).toBe("true");
    expect(
      um(`select (prevista_para = (now() at time zone 'America/Sao_Paulo')::date + 30)::text from public.implantacoes where id = '${r.implantacao_id}';`),
    ).toBe("true");
    expect(um(`select estado_carteira_no_inicio from public.implantacoes where id = '${r.implantacao_id}';`)).toBe("prospect");
  });

  it("é idempotente: a segunda chamada devolve a implantação em andamento", () => {
    const primeira = iniciar(EMPRESA);
    const segunda = iniciar(EMPRESA);
    expect(segunda).toMatchObject({ implantacao_id: primeira.implantacao_id, criada: false });
  });

  it("empresa ativa pode ter implantação e continua ativa (serviço novo)", () => {
    expect(iniciar(EMPRESA_ATIVA).criada).toBe(true);
    expect(estadoNaCarteira(EMPRESA_ATIVA)).toBe("ativo");
  });

  it("empresa inativa não começa implantação", () => {
    expect(
      erroDe(`select public.fn_implantacao_iniciar('${GOV_ORG}', '${EMPRESA_INATIVA}', '${MODELO}', 'manual', null, null, null);`),
    ).toContain("implantacao_estado_da_empresa_nao_permite");
  });
});

describe("itens", () => {
  it("concluir item que exige evidência sem evidência é recusado; com evidência, aceito", () => {
    const { implantacao_id } = iniciar(EMPRESA);
    const certificado = itemDe(implantacao_id, "Certificado digital");
    expect(erroDe(`update public.implantacao_itens set estado = 'concluido' where id = '${certificado}';`)).toContain(
      "implantacao_item_exige_evidencia",
    );
    sql(`update public.implantacao_itens set estado = 'concluido', evidencia = 'A1 recebido em 06/10', alterado_por = '${GOV_AGENT_A}' where id = '${certificado}';`);
    expect(um(`select concluido_por from public.implantacao_itens where id = '${certificado}';`)).toBe(GOV_AGENT_A);
    // Apagar a evidência de um concluído reabriria a trava pela porta dos fundos.
    expect(erroDe(`update public.implantacao_itens set evidencia = null where id = '${certificado}';`)).toContain(
      "implantacao_item_exige_evidencia",
    );
  });

  it("dispensar exige motivo; transição fora da tabela é recusada; o compromisso não muda", () => {
    const { implantacao_id } = iniciar(EMPRESA);
    const folha = itemDe(implantacao_id, "Dados de folha");
    expect(erroDe(`update public.implantacao_itens set estado = 'dispensado' where id = '${folha}';`)).toContain(
      "implantacao_itens_dispensa_com_motivo",
    );
    expect(erroDe(`update public.implantacao_itens set obrigatorio = false where id = '${folha}';`)).toContain(
      "implantacao_item_campo_imutavel",
    );
    sql(`update public.implantacao_itens set estado = 'aguardando_cliente' where id = '${folha}';`);
    expect(erroDe(`update public.implantacao_itens set estado = 'pendente' where id = '${folha}';`)).toContain(
      "implantacao_item_transicao_invalida",
    );
  });
});

describe("a trava da ativação", () => {
  it("concluir com obrigatório aberto é recusado — pela função e por UPDATE direto do service role", () => {
    const { implantacao_id } = iniciar(EMPRESA);
    const folha = itemDe(implantacao_id, "Dados de folha");
    expect(um(`select estado from public.implantacao_itens where id = '${folha}';`)).not.toBe("dispensado");

    expect(erroDe(`select public.fn_implantacao_concluir('${GOV_ORG}', '${implantacao_id}', '${GOV_MANAGER}');`)).toContain(
      "implantacao_obrigatorios_abertos",
    );
    expect(erroDe(`update public.implantacoes set estado = 'concluida' where id = '${implantacao_id}';`)).toContain(
      "implantacao_obrigatorios_abertos",
    );
    expect(estadoNaCarteira(EMPRESA)).toBe("em_implantacao");
  });

  it("com os obrigatórios concluídos ou dispensados, concluir ativa o cliente e congela os itens", () => {
    const { implantacao_id } = iniciar(EMPRESA);
    const folha = itemDe(implantacao_id, "Dados de folha");
    sql(`update public.implantacao_itens set estado = 'dispensado', motivo_dispensa = 'Empresa sem funcionários' where id = '${folha}';`);

    // O item opcional pode ficar aberto: só os obrigatórios travam.
    const r = JSON.parse(um(`select public.fn_implantacao_concluir('${GOV_ORG}', '${implantacao_id}', '${GOV_MANAGER}');`));
    expect(r.ativou).toBe(true);
    expect(estadoNaCarteira(EMPRESA)).toBe("ativo");
    expect(um(`select (cliente_desde is not null)::text from public.carteira_perfis where company_id = '${EMPRESA}';`)).toBe("true");

    const opcional = itemDe(implantacao_id, "Reunião de boas-vindas");
    expect(erroDe(`update public.implantacao_itens set estado = 'concluido' where id = '${opcional}';`)).toContain(
      "implantacao_encerrada",
    );
    expect(erroDe(`update public.implantacoes set estado = 'cancelada', motivo_cancelamento = 'x' where id = '${implantacao_id}';`)).toContain(
      "implantacao_encerrada",
    );
    expect(
      um(`select string_agg(tipo, ',' order by created_at) from public.implantacao_eventos where implantacao_id = '${implantacao_id}' and item_id is null;`),
    ).toBe("iniciada,concluida");
  });
});

describe("cancelar", () => {
  it("exige motivo; com inativar, a empresa vai para inativo", () => {
    const { implantacao_id } = iniciar(EMPRESA_CANCELA);
    expect(erroDe(`select public.fn_implantacao_cancelar('${GOV_ORG}', '${implantacao_id}', '  ', true, null);`)).toContain(
      "implantacao_cancelamento_sem_motivo",
    );
    const r = JSON.parse(um(`select public.fn_implantacao_cancelar('${GOV_ORG}', '${implantacao_id}', 'Cliente desistiu', true, '${GOV_MANAGER}');`));
    expect(r.inativou).toBe(true);
    expect(estadoNaCarteira(EMPRESA_CANCELA)).toBe("inativo");
    expect(um(`select estado from public.implantacoes where id = '${implantacao_id}';`)).toBe("cancelada");
  });
});

describe("a sessão só lê", () => {
  it("o agente lê os itens e não escreve neles nem nas implantações", () => {
    const { implantacao_id } = iniciar(EMPRESA_ATIVA);
    expect(
      Number(
        lastLine(
          sql(`set role authenticated;
               select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
               select count(*) from public.implantacao_itens where implantacao_id = '${implantacao_id}';`),
        ),
      ),
    ).toBe(3);
    const recusou = (dml: string) => {
      try {
        return writeCountAs(GOV_AGENT_A, dml) === 0;
      } catch (err) {
        return ((err as { stderr?: string }).stderr ?? "").includes("permission denied");
      }
    };
    expect(recusou(`update public.implantacao_itens set observacao = 'x' where implantacao_id = '${implantacao_id}'`)).toBe(true);
    expect(recusou(`update public.implantacoes set prevista_para = current_date where id = '${implantacao_id}'`)).toBe(true);
  });
});
