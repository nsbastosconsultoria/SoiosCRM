/**
 * OS MÓDULOS DO SOIOS NÃO VAZAM ENTRE ORGANIZAÇÕES — por JWT, com linha REAL do vizinho.
 *
 * É a prova comportamental que `PROVA_DE_MODULO`
 * (`adr-0002-d8-varreduras-com-os-modulos-instalados.test.ts`) aponta para cada tabela de
 * `carteira`, `protocolos` e `implantacao`. A varredura de lá prova o CATÁLOGO (RLS ligada,
 * `anon` fora); este arquivo prova o COMPORTAMENTO: o membro da organização A lê zero linhas
 * da organização B em toda tabela dos três módulos.
 *
 * A semente da organização B passa pelos mesmos caminhos do produto sempre que existe um
 * (`fn_carteira_definir_contexto`, `fn_implantacao_iniciar`, os gatilhos de linha do tempo),
 * e o primeiro caso confere que TODA tabela recebeu linha do vizinho: sem ela, a contagem
 * cross-org seria 0 = 0 por ausência de dado, e o verde não provaria nada.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, GOV_AGENT_A, GOV_ORG, seedGov, sql } from "./gov-helpers";

const ORG_B = "cccccccc-9911-4000-8000-0000000000b0";
const USUARIO_B = "cccccccc-9911-4000-8000-0000000000b1";
const SESSAO_B = "cccccccc-9911-4000-8000-0000000000b2";
const CONTATO_B = "cccccccc-9911-4000-8000-0000000000b3";
const CONVERSA_B = "cccccccc-9911-4000-8000-0000000000b4";
const EMPRESA_B = "cccccccc-9911-4000-8000-0000000000b5";
const PESSOA_B = "cccccccc-9911-4000-8000-0000000000b6";
const VINCULO_B = "cccccccc-9911-4000-8000-0000000000b7";
const GRUPO_B = "cccccccc-9911-4000-8000-0000000000b8";
const CATEGORIA_B = "cccccccc-9911-4000-8000-0000000000c1";
const PROTOCOLO_B = "cccccccc-9911-4000-8000-0000000000c2";
const MODELO_B = "cccccccc-9911-4000-8000-0000000000d1";

/** As tabelas dos três módulos, como as provisionadoras as criam. */
const TABELAS = [
  "carteira_grupos",
  "carteira_perfis",
  "carteira_vinculo_detalhes",
  "carteira_responsaveis",
  "carteira_contexto_conversa",
  "carteira_eventos",
  "protocolo_categorias",
  "protocolo_politicas_sla",
  "protocolo_area_membros",
  "protocolo_feriados",
  "protocolo_contadores",
  "protocolos",
  "protocolo_eventos",
  "protocolo_marcos_sla",
  "implantacao_modelos",
  "implantacao_modelo_itens",
  "implantacoes",
  "implantacao_itens",
  "implantacao_eventos",
] as const;

function booleano(resultado: string): boolean {
  const t = resultado.trim().toLowerCase();
  return t === "t" || t === "true";
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_carteira_provisionar();
    select public.fn_protocolos_provisionar();
    select public.fn_implantacao_provisionar();

    insert into auth.users (id, email) values ('${USUARIO_B}', 'soios-isolamento-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'soios-isolamento-b', 'Soios Isolamento B', 'Soios B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USUARIO_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    do $semente$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO_B}', '${ORG_B}', 'soios-isolamento-b', '\\x00'::bytea);
    exception when unique_violation then null; end $semente$;
    insert into public.people (id, organization_id, full_name)
      values ('${PESSOA_B}', '${ORG_B}', 'Pessoa da Org B') on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, person_id)
      values ('${CONTATO_B}', '${ORG_B}', 'Contato da Org B', '${PESSOA_B}') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA_B}', '${ORG_B}', '${CONTATO_B}', '${SESSAO_B}', 'open') on conflict do nothing;
    insert into public.companies (id, organization_id, legal_name)
      values ('${EMPRESA_B}', '${ORG_B}', 'Empresa da Org B Ltda') on conflict (id) do nothing;
    insert into public.company_people (id, organization_id, company_id, person_id)
      values ('${VINCULO_B}', '${ORG_B}', '${EMPRESA_B}', '${PESSOA_B}') on conflict (id) do nothing;

    -- carteira: o detalhe do vínculo cria o perfil e a linha do tempo (gatilhos do módulo).
    insert into public.carteira_grupos (id, organization_id, nome)
      values ('${GRUPO_B}', '${ORG_B}', 'Grupo da Org B') on conflict do nothing;
    insert into public.carteira_vinculo_detalhes (company_people_id, organization_id, papel)
      values ('${VINCULO_B}', '${ORG_B}', 'socio') on conflict do nothing;
    insert into public.carteira_responsaveis (organization_id, company_id, area, user_id)
      values ('${ORG_B}', '${EMPRESA_B}', 'fiscal', '${USUARIO_B}');
    select public.fn_carteira_definir_contexto('${ORG_B}', '${CONVERSA_B}', '${EMPRESA_B}', 'agente', null);

    -- protocolos: o número nasce pelo gatilho, que mantém o contador da organização.
    insert into public.protocolo_categorias (id, organization_id, parent_id, nome, slug, area)
      values ('${CATEGORIA_B}', '${ORG_B}', null, 'Fiscal', 'fiscal', 'fiscal') on conflict do nothing;
    insert into public.protocolo_politicas_sla (organization_id, prioridade, primeira_resposta_min, resolucao_min)
      values ('${ORG_B}', 'P3', 240, 2880);
    insert into public.protocolo_area_membros (organization_id, area, user_id)
      values ('${ORG_B}', 'fiscal', '${USUARIO_B}') on conflict do nothing;
    insert into public.protocolo_feriados (organization_id, data, descricao)
      values ('${ORG_B}', '2026-11-20', 'Consciência Negra') on conflict do nothing;
    insert into public.protocolos (id, organization_id, categoria_id, titulo, descricao, prioridade, area, origem, contact_id)
      values ('${PROTOCOLO_B}', '${ORG_B}', '${CATEGORIA_B}', 'Guia do DAS', 'Cliente da org B pediu a guia',
              'P3', 'fiscal', 'humano', '${CONTATO_B}')
      on conflict do nothing;
    insert into public.protocolo_eventos (organization_id, protocolo_id, tipo, texto, ator_kind)
      values ('${ORG_B}', '${PROTOCOLO_B}', 'nota', 'Nota da org B', 'sistema');
    insert into public.protocolo_marcos_sla (protocolo_id, organization_id, relogio, marco)
      values ('${PROTOCOLO_B}', '${ORG_B}', 'primeira_resposta', 80) on conflict do nothing;

    -- implantação: iniciar copia os itens do modelo e registra o evento.
    insert into public.implantacao_modelos (id, organization_id, nome, padrao)
      values ('${MODELO_B}', '${ORG_B}', 'Modelo da Org B', true) on conflict do nothing;
    insert into public.implantacao_modelo_itens (organization_id, modelo_id, grupo, titulo, prazo_dias)
      values ('${ORG_B}', '${MODELO_B}', 'Acessos', 'Certificado digital', 10);
    select public.fn_implantacao_iniciar('${ORG_B}', '${EMPRESA_B}', '${MODELO_B}', 'manual', null,
                                         '${USUARIO_B}', '${USUARIO_B}');
  `);
});

describe("módulos do Soios × organização vizinha", () => {
  it("CONTROLE: toda tabela dos três módulos tem linha da organização B — sem isto o resto é 0 = 0", () => {
    const vazias = TABELAS.filter(
      (t) => Number(sql(`select count(*) from public.${t} where organization_id = '${ORG_B}';`)) === 0,
    );
    expect(vazias, "tabelas sem linha do vizinho: a contagem cross-org nelas não provaria nada").toEqual([]);
  });

  it.each(TABELAS)("%s: o membro da organização A não lê nada da organização B", (tabela) => {
    const podeLer = booleano(sql(`select has_table_privilege('authenticated', 'public.${tabela}', 'select');`));
    if (podeLer) {
      expect(
        countAs(GOV_AGENT_A, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`),
        `${tabela}: linha da organização B atravessou a RLS`,
      ).toBe(0);
      // E o filtro não é o WHERE: sem ele, A conta só o que é dela.
      const daPropria = Number(sql(`select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`));
      expect(countAs(GOV_AGENT_A, `select count(*) from public.${tabela};`)).toBe(daPropria);
    } else {
      expect(
        erroDe(`
          set role authenticated;
          select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
          select count(*) from public.${tabela};
        `),
        `${tabela}: authenticated leu tabela que deveria estar fechada`,
      ).toMatch(/permission denied/i);
    }
  });

  it("controle positivo: o membro da organização B lê o protocolo dela", () => {
    expect(
      countAs(USUARIO_B, `select count(*) from public.protocolos where id = '${PROTOCOLO_B}';`),
    ).toBe(1);
  });
});
