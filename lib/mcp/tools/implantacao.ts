/**
 * Capacidade de IMPLANTAÇÃO — módulo opcional (spec 23 §7, ADR-0002).
 *
 * Uma ferramenta, só de leitura: "o que ainda falta eu mandar?". Para a empresa da conversa (o
 * contexto da carteira), os itens da implantação em andamento que estão com o CLIENTE — título e
 * orientação, e nada mais.
 *
 * ═══ O QUE NUNCA VOLTA AO MODELO ═══
 *   - observação, evidência e motivo de dispensa (texto interno da equipe);
 *   - responsável e prazo interno (o assistente não promete data que a equipe não deu);
 *   - os itens com a equipe ou com terceiros (não são o cliente que resolve).
 *
 * O assistente NÃO marca item como recebido (spec 23 Q5): quando o cliente manda o documento, ele
 * diz que a equipe vai conferir. Service role bypassa RLS: TODA query filtra `organization_id`.
 */
import { z } from "zod";

import { ESTADOS_QUE_FECHAM } from "@/lib/implantacao/vocabulario";

import type { McpToolDefinition } from "../types";

const MODULO_NAO_INSTALADO_HINT =
  "o módulo Implantação de clientes não está instalado nesta instalação (peça ao administrador para " +
  "instalar em Modo administrador › Módulos) — esta capacidade não deveria estar ligada em nenhum agente enquanto isso";

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

const inputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
};

export const crmImplantacaoPendenciasDoCliente: McpToolDefinition<typeof inputShape> = {
  name: "crm_implantacao_pendencias_do_cliente",
  description:
    "Mostra o que ainda falta o CLIENTE entregar na implantação da empresa desta conversa (contrato, " +
    "documentos, certificado, procurações…), com o que conta como pronto em cada item. Use quando o " +
    "cliente perguntar \"o que ainda falta?\" ou \"o que preciso mandar?\". Não traz prazos nem quem " +
    "está cuidando. Quando o cliente mandar um documento, diga que a equipe vai conferir — você não " +
    "marca nada como recebido. Se a empresa da conversa não estiver definida, defina antes com " +
    "crm_carteira_definir_empresa_da_conversa.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  motivoDoVazio: (r) => {
    const x = r as { em_implantacao?: boolean; pendencias?: unknown[] };
    if (x.em_implantacao === false) return "empresa_sem_implantacao_em_andamento";
    return x.pendencias?.length === 0 ? "cliente_sem_pendencias" : null;
  },
  handler: async (input, ctx) => {
    const { data: contexto, error: erroContexto } = await ctx.supabase
      .from("carteira_contexto_conversa")
      .select("company_id")
      .eq("organization_id", ctx.organizationId)
      .eq("conversation_id", input.conversation_id)
      .is("fim", null)
      .maybeSingle();
    if (ausente(erroContexto)) {
      throw new Error(
        "implantacao_pendencias_falhou: o módulo Carteira de empresas não está instalado, e a implantação depende dele",
      );
    }
    if (erroContexto) throw new Error(`implantacao_pendencias_falhou: ${erroContexto.message}`);
    const companyId = (contexto as { company_id: string | null } | null)?.company_id;
    if (!companyId) {
      throw new Error(
        "implantacao_pendencias_falhou: a empresa desta conversa não está definida. Confirme com o cliente de qual empresa ele fala e defina com crm_carteira_definir_empresa_da_conversa.",
      );
    }

    const { data: implantacao, error } = await ctx.supabase
      .from("implantacoes")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("company_id", companyId)
      .eq("estado", "em_andamento")
      .maybeSingle();
    if (ausente(error)) throw new Error(`implantacao_pendencias_falhou: ${MODULO_NAO_INSTALADO_HINT}`);
    if (error) throw new Error(`implantacao_pendencias_falhou: ${error.message}`);
    if (!implantacao) return { em_implantacao: false, pendencias: [] };

    const { data: itens, error: erroItens } = await ctx.supabase
      .from("implantacao_itens")
      .select("titulo, orientacao, estado, posicao")
      .eq("organization_id", ctx.organizationId)
      .eq("implantacao_id", (implantacao as { id: string }).id)
      .eq("vez_de", "cliente")
      .order("posicao");
    if (erroItens) throw new Error(`implantacao_pendencias_falhou: ${erroItens.message}`);
    type Linha = { titulo: string; orientacao: string | null; estado: string };
    return {
      em_implantacao: true,
      pendencias: ((itens ?? []) as Linha[])
        .filter((i) => !(ESTADOS_QUE_FECHAM as readonly string[]).includes(i.estado))
        .map((i) => ({ item: i.titulo, o_que_conta_como_pronto: i.orientacao })),
    };
  },
};
