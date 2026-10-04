/**
 * Capacidades da carteira — o que o assistente vê e o que ele NUNCA vê.
 *
 * O banco falso responde por tabela, numa fila, e registra os filtros. O que se prova: toda
 * leitura filtra a organização; o CNPJ sai só pelos 4 últimos dígitos; vínculo desativado não
 * aparece; pessoa sem cadastro devolve lista vazia (e o motivo do vazio), não erro; a definição do
 * contexto vai pela função do banco com a organização do contexto; e a recusa "sem vínculo" volta
 * como instrução de não insistir.
 */
import { describe, expect, it, vi } from "vitest";

import {
  crmCarteiraBuscarEmpresa,
  crmCarteiraDefinirEmpresaDaConversa,
  crmCarteiraEmpresasDoContato,
  finalDoCnpj,
} from "./carteira";
import type { McpContext } from "../types";

const ORG = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "55555555-5555-4555-8555-555555555555";
const EMPRESA = "33333333-3333-4333-8333-333333333333";

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };

function ctxDe(respostas: Record<string, Resposta[]>, rpc = vi.fn()) {
  const filtros: Array<[string, string, unknown]> = [];
  const from = (tabela: string) => {
    const resolver = () => Promise.resolve((respostas[tabela] ?? []).shift() ?? { data: null, error: null });
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([tabela, c, v]), q),
      is: () => q,
      in: () => q,
      or: () => q,
      limit: () => resolver(),
      maybeSingle: () => resolver(),
      then: (ok: (r: Resposta) => unknown) => resolver().then(ok),
    };
    return q;
  };
  const ctx = {
    organizationId: ORG,
    role: "agent",
    actor: { type: "ai_agent", id: "run-1", agent_id: "agent-1" },
    apiTokenId: "t",
    requestId: "r",
    supabase: { from, rpc } as never,
  } as unknown as McpContext;
  return { ctx, filtros, rpc };
}

describe("finalDoCnpj", () => {
  it("devolve só os 4 últimos dígitos", () => {
    expect(finalDoCnpj("12345678000190")).toBe("0190");
    expect(finalDoCnpj(null)).toBeNull();
  });
});

describe("crm_carteira_empresas_do_contato", () => {
  it("lista as empresas da pessoa com o estado, filtrando a organização, sem CNPJ inteiro", async () => {
    const { ctx, filtros } = ctxDe({
      conversations: [{ data: { id: CONVERSA, contact_id: "c1", contacts: { person_id: "p1" } }, error: null }],
      carteira_contexto_conversa: [{ data: null, error: null }],
      company_people: [
        {
          data: [
            {
              company_id: EMPRESA,
              companies: { legal_name: "Padaria Ltda", trade_name: "Padaria Sol", normalized_cnpj: "12345678000190" },
              carteira_vinculo_detalhes: { papel: "socio", ativo: true },
            },
            {
              company_id: "desativada",
              companies: { legal_name: "Antiga Ltda", trade_name: null, normalized_cnpj: "99999999000199" },
              carteira_vinculo_detalhes: [{ papel: "rh", ativo: false }],
            },
          ],
          error: null,
        },
      ],
      carteira_perfis: [{ data: [{ company_id: EMPRESA, estado: "ativo" }], error: null }],
    });

    const r = (await crmCarteiraEmpresasDoContato.handler({ conversation_id: CONVERSA }, ctx)) as {
      situacao: string;
      empresas: Array<Record<string, unknown>>;
      empresa_da_conversa: string | null;
    };

    expect(r.situacao).toBe("cliente_ativo");
    expect(r.empresas).toEqual([
      { company_id: EMPRESA, nome: "Padaria Sol", cnpj_final: "0190", estado: "ativo", papel: "socio" },
    ]);
    expect(JSON.stringify(r)).not.toContain("12345678000190");
    for (const tabela of ["conversations", "carteira_contexto_conversa", "company_people", "carteira_perfis"]) {
      expect(filtros, tabela).toContainEqual([tabela, "organization_id", ORG]);
    }
  });

  it("pessoa sem cadastro: lista vazia com o motivo, nunca erro", async () => {
    const { ctx } = ctxDe({
      conversations: [{ data: { id: CONVERSA, contact_id: "c1", contacts: { person_id: null } }, error: null }],
      carteira_contexto_conversa: [{ data: null, error: null }],
    });
    const r = await crmCarteiraEmpresasDoContato.handler({ conversation_id: CONVERSA }, ctx);
    expect(r).toEqual({ situacao: "desconhecido", empresas: [], empresa_da_conversa: null });
    expect(crmCarteiraEmpresasDoContato.motivoDoVazio?.(r)).toBe("contato_sem_empresa");
  });

  it("módulo não instalado: erro que aponta a causa", async () => {
    const { ctx } = ctxDe({
      conversations: [{ data: { id: CONVERSA, contact_id: "c1", contacts: { person_id: "p1" } }, error: null }],
      carteira_contexto_conversa: [{ data: null, error: { code: "PGRST205", message: "not found" } }],
    });
    await expect(crmCarteiraEmpresasDoContato.handler({ conversation_id: CONVERSA }, ctx)).rejects.toThrow(
      /não está instalado/,
    );
  });
});

describe("crm_carteira_definir_empresa_da_conversa", () => {
  it("chama a função do banco com a organização do contexto — nunca de argumento", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { alterado: true, company_id: EMPRESA }, error: null });
    const { ctx } = ctxDe({}, rpc);
    const r = await crmCarteiraDefinirEmpresaDaConversa.handler(
      { conversation_id: CONVERSA, company_id: EMPRESA, como: "cliente_informou" },
      ctx,
    );
    expect(rpc).toHaveBeenCalledWith("fn_carteira_definir_contexto", {
      p_org: ORG,
      p_conversation: CONVERSA,
      p_company: EMPRESA,
      p_definido_por: "cliente_informou",
      p_user: null,
    });
    expect(r).toEqual({ empresa_da_conversa: EMPRESA, alterado: true });
  });

  it("empresa a que a pessoa não está ligada: a recusa ensina a não insistir", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "carteira_contato_sem_vinculo_com_a_empresa" },
    });
    const { ctx } = ctxDe({}, rpc);
    await expect(
      crmCarteiraDefinirEmpresaDaConversa.handler(
        { conversation_id: CONVERSA, company_id: EMPRESA, como: "agente" },
        ctx,
      ),
    ).rejects.toThrow(/equipe vai confirmar/);
  });
});

describe("crm_carteira_buscar_empresa", () => {
  it("devolve candidatas com final do CNPJ e estado, filtrando a organização", async () => {
    const { ctx, filtros } = ctxDe({
      carteira_perfis: [
        {
          data: [
            {
              company_id: EMPRESA,
              estado: "prospect",
              empresa: { legal_name: "Mercado Bom Ltda", trade_name: null, normalized_cnpj: "11222333000144" },
            },
          ],
          error: null,
        },
      ],
    });
    const r = await crmCarteiraBuscarEmpresa.handler({ termo: "Mercado" }, ctx);
    expect(r).toEqual({
      empresas: [{ company_id: EMPRESA, nome: "Mercado Bom Ltda", cnpj_final: "0144", estado: "prospect" }],
    });
    expect(filtros).toContainEqual(["carteira_perfis", "organization_id", ORG]);
  });
});
