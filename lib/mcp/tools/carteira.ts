/**
 * Capacidades da CARTEIRA DE EMPRESAS — módulo opcional (spec 21 §8, ADR-0002).
 *
 * O assistente precisa saber, numa conversa, QUEM está escrevendo do ponto de vista das empresas:
 * de quais empresas a pessoa faz parte, se elas são clientes, e de qual delas a conversa trata.
 * Com um número só, essa é a diferença entre "preciso da guia" ir para o CNPJ certo ou para o
 * errado.
 *
 * O vínculo é o do NÚCLEO (contato → pessoa → company_people); o módulo acrescenta o estado do
 * relacionamento e o contexto da conversa. Nenhuma tool aqui CRIA empresa nem vínculo: o
 * assistente lê, procura e aponta; ligar alguém a uma empresa cliente é decisão de gente (spec
 * 21 Q4).
 *
 * O que NUNCA volta ao modelo: CNPJ inteiro, e-mail ou telefone de outra pessoa da empresa. O CNPJ
 * sai só pelos 4 últimos dígitos — o bastante para o cliente confirmar ("é a de final 0190?"),
 * sem entregar o número a quem escreve de um telefone novo.
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente.
 */
import { z } from "zod";

import { situacaoDosEstados } from "@/lib/carteira/resolvedor";
import type { EstadoDaCarteira } from "@/lib/carteira/vocabulario";

import type { McpToolDefinition } from "../types";

const MODULO_NAO_INSTALADO_HINT =
  "o módulo Carteira de empresas não está instalado nesta instalação (peça ao administrador para " +
  "instalar em Modo administrador › Módulos) — esta capacidade não deveria estar ligada em nenhum " +
  "agente enquanto isso";

function moduloAusente(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function falha(prefixo: string, error: { code?: string; message?: string }): never {
  if (moduloAusente(error)) throw new Error(`${prefixo}: ${MODULO_NAO_INSTALADO_HINT}`);
  throw new Error(`${prefixo}: ${error.message ?? "erro do banco"}`);
}

/** Os 4 últimos dígitos do CNPJ normalizado — nunca o número inteiro. */
export function finalDoCnpj(normalizado: string | null): string | null {
  return normalizado && normalizado.length >= 4 ? normalizado.slice(-4) : null;
}

type EmpresaDaPessoa = {
  company_id: string;
  nome: string;
  cnpj_final: string | null;
  estado: EstadoDaCarteira | null;
  papel: string | null;
};

// ---------------------------------------------------------------------------
// empresas de quem está na conversa
// ---------------------------------------------------------------------------

const empresasInputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
};

export const crmCarteiraEmpresasDoContato: McpToolDefinition<typeof empresasInputShape> = {
  name: "crm_carteira_empresas_do_contato",
  description:
    "Mostra de quais empresas a pessoa desta conversa faz parte, se cada uma é cliente (`estado`: " +
    "ativo, em_implantacao, suspenso… ou prospect), o papel dela (sócio, financeiro, RH…) e de qual " +
    "empresa a conversa trata agora (`empresa_da_conversa`). Use no começo de um pedido de cliente. " +
    "Se houver MAIS DE UMA empresa e `empresa_da_conversa` for null, pergunte ao cliente qual é " +
    "antes de registrar qualquer pedido — nunca escolha por ele. `cnpj_final` são os 4 últimos " +
    "dígitos, para confirmar com o cliente; não peça nem repita o CNPJ inteiro. Lista vazia quer " +
    "dizer que a pessoa não está ligada a nenhuma empresa no cadastro: não afirme que ela não é " +
    "cliente — diga que a equipe vai confirmar.",
  inputSchema: empresasInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  motivoDoVazio: (resultado) =>
    (resultado as { empresas?: unknown[] }).empresas?.length === 0 ? "contato_sem_empresa" : null,
  handler: async (input, ctx) => {
    const { data: conversa, error: erroConversa } = await ctx.supabase
      .from("conversations")
      .select("id, contact_id, contacts!inner(person_id)")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.conversation_id)
      .maybeSingle();
    if (erroConversa) falha("carteira_empresas_falhou", erroConversa);
    if (!conversa) throw new Error("carteira_empresas_falhou: conversa não encontrada nesta organização");

    const contato = (conversa as unknown as { contacts: { person_id: string | null } | null }).contacts;
    const personId = contato?.person_id ?? null;

    const { data: contexto, error: erroContexto } = await ctx.supabase
      .from("carteira_contexto_conversa")
      .select("company_id")
      .eq("organization_id", ctx.organizationId)
      .eq("conversation_id", input.conversation_id)
      .is("fim", null)
      .maybeSingle();
    if (erroContexto) falha("carteira_empresas_falhou", erroContexto);
    const empresaDaConversa = (contexto as { company_id: string | null } | null)?.company_id ?? null;

    if (personId === null) {
      return { situacao: "desconhecido", empresas: [], empresa_da_conversa: empresaDaConversa };
    }

    const { data: vinculos, error: erroVinculos } = await ctx.supabase
      .from("company_people")
      .select(
        "id, company_id, companies!inner(legal_name, trade_name, normalized_cnpj), carteira_vinculo_detalhes(papel, ativo)",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("person_id", personId)
      .limit(50);
    if (erroVinculos) falha("carteira_empresas_falhou", erroVinculos);

    type Linha = {
      company_id: string;
      companies: { legal_name: string | null; trade_name: string | null; normalized_cnpj: string | null };
      carteira_vinculo_detalhes: { papel: string; ativo: boolean } | Array<{ papel: string; ativo: boolean }> | null;
    };
    const linhas = ((vinculos ?? []) as unknown as Linha[]).filter((l) => {
      const d = Array.isArray(l.carteira_vinculo_detalhes) ? l.carteira_vinculo_detalhes[0] : l.carteira_vinculo_detalhes;
      return d?.ativo ?? true;
    });

    const ids = linhas.map((l) => l.company_id);
    const { data: perfis, error: erroPerfis } =
      ids.length === 0
        ? { data: [], error: null }
        : await ctx.supabase
            .from("carteira_perfis")
            .select("company_id, estado")
            .eq("organization_id", ctx.organizationId)
            .in("company_id", ids);
    if (erroPerfis) falha("carteira_empresas_falhou", erroPerfis);
    const estadoDe = new Map(
      ((perfis ?? []) as Array<{ company_id: string; estado: EstadoDaCarteira }>).map((p) => [p.company_id, p.estado]),
    );

    const empresas: EmpresaDaPessoa[] = linhas.map((l) => {
      const d = Array.isArray(l.carteira_vinculo_detalhes) ? l.carteira_vinculo_detalhes[0] : l.carteira_vinculo_detalhes;
      return {
        company_id: l.company_id,
        nome: l.companies.trade_name || l.companies.legal_name || "Empresa sem nome",
        cnpj_final: finalDoCnpj(l.companies.normalized_cnpj),
        estado: estadoDe.get(l.company_id) ?? null,
        papel: d?.papel ?? null,
      };
    });

    return {
      situacao: situacaoDosEstados(
        empresas.map((e) => e.estado).filter((e): e is EstadoDaCarteira => e !== null),
      ),
      empresas,
      empresa_da_conversa: empresaDaConversa,
    };
  },
};

// ---------------------------------------------------------------------------
// apontar a empresa da conversa
// ---------------------------------------------------------------------------

const definirInputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
  company_id: z
    .string()
    .uuid()
    .describe("A empresa de que a conversa trata, entre as devolvidas por crm_carteira_empresas_do_contato."),
  como: z
    .enum(["cliente_informou", "agente"])
    .default("cliente_informou")
    .describe(
      "`cliente_informou` quando o cliente disse qual é a empresa; `agente` quando você deduziu com " +
        "segurança (ex.: a pessoa só tem uma empresa, ou citou o nome ou o final do CNPJ).",
    ),
};

export const crmCarteiraDefinirEmpresaDaConversa: McpToolDefinition<typeof definirInputShape> = {
  name: "crm_carteira_definir_empresa_da_conversa",
  description:
    "Registra de qual empresa esta conversa trata a partir de agora. Use depois que o cliente " +
    "disser a empresa, ou quando ele só tem uma. Só aceita empresa a que a pessoa da conversa está " +
    "ligada: outra empresa é recusada — nesse caso diga que a equipe vai confirmar o cadastro. " +
    "Trocar de empresa no meio da conversa é normal (o cliente cuida de mais de uma): chame de " +
    "novo com a outra; o que já foi tratado continua na empresa anterior.",
  inputSchema: definirInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.rpc("fn_carteira_definir_contexto", {
      p_org: ctx.organizationId,
      p_conversation: input.conversation_id,
      p_company: input.company_id,
      p_definido_por: input.como,
      p_user: null,
    });
    if (error) {
      if (error.message === "carteira_contato_sem_vinculo_com_a_empresa") {
        throw new Error(
          "carteira_definir_falhou: a pessoa desta conversa não está ligada a essa empresa no cadastro. " +
            "Não insista nem escolha outra: diga que a equipe vai confirmar o cadastro da empresa.",
        );
      }
      falha("carteira_definir_falhou", error);
    }
    const r = data as { alterado: boolean; company_id: string };
    return { empresa_da_conversa: r.company_id, alterado: r.alterado };
  },
};

// ---------------------------------------------------------------------------
// procurar uma empresa da carteira
// ---------------------------------------------------------------------------

const buscarInputShape = {
  termo: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .describe("Nome da empresa (ou parte) ou os dígitos do CNPJ que o cliente informou."),
};

export const crmCarteiraBuscarEmpresa: McpToolDefinition<typeof buscarInputShape> = {
  name: "crm_carteira_buscar_empresa",
  description:
    "Procura empresas da carteira desta organização pelo nome ou pelos dígitos do CNPJ que o " +
    "cliente informou. Devolve até 5 candidatas com nome, `cnpj_final` e `estado`. Serve para " +
    "reconhecer a empresa que o cliente citou — NÃO prova que quem escreve representa essa empresa, " +
    "e não cria nada. Se a empresa não estiver entre as da pessoa (crm_carteira_empresas_do_contato), " +
    "não trate o pedido como dela: diga que a equipe vai confirmar.",
  inputSchema: buscarInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  motivoDoVazio: (resultado) =>
    (resultado as { empresas?: unknown[] }).empresas?.length === 0 ? "empresa_nao_encontrada" : null,
  handler: async (input, ctx) => {
    const termo = input.termo.replace(/[%,()]/g, " ").trim();
    const digitos = termo.replace(/\D/g, "");
    const filtros = [`legal_name.ilike.%${termo}%`, `trade_name.ilike.%${termo}%`];
    if (digitos.length >= 4) filtros.push(`normalized_cnpj.ilike.%${digitos}%`);

    const { data, error } = await ctx.supabase
      .from("carteira_perfis")
      .select("company_id, estado, empresa:companies!carteira_perfis_company_id_fkey!inner(legal_name, trade_name, normalized_cnpj)")
      .eq("organization_id", ctx.organizationId)
      .or(filtros.join(","), { referencedTable: "empresa" })
      .limit(5);
    if (error) falha("carteira_buscar_falhou", error);

    type Linha = {
      company_id: string;
      estado: EstadoDaCarteira;
      empresa: { legal_name: string | null; trade_name: string | null; normalized_cnpj: string | null };
    };
    return {
      empresas: ((data ?? []) as unknown as Linha[]).map((l) => ({
        company_id: l.company_id,
        nome: l.empresa.trade_name || l.empresa.legal_name || "Empresa sem nome",
        cnpj_final: finalDoCnpj(l.empresa.normalized_cnpj),
        estado: l.estado,
      })),
    };
  },
};
