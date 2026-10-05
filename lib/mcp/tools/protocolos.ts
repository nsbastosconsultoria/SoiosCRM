/**
 * Capacidades de PROTOCOLOS — módulo opcional (spec 22 §8, ADR-0002).
 *
 * O assistente registra o pedido do cliente como protocolo, consulta os protocolos dele e
 * acrescenta informação a um aberto. A abertura é a MESMA função da tela (`abrirProtocolo`):
 * categoria, competência, deduplicação, prioridade, distribuição e prazo não têm segundo caminho.
 *
 * ═══ O QUE NUNCA VOLTA AO MODELO ═══
 *   - prazo de SLA (nem `*_vence_em`): é compromisso INTERNO da equipe, e o assistente não pode
 *     prometer ao cliente o que o escritório não aprovou (modelo do escritório, §7);
 *   - quem é o responsável (nome, e-mail): mesmo princípio de `crm_list_team_members`.
 * O cliente recebe o NÚMERO do protocolo e o estado em palavras — o que ele pode cobrar depois.
 *
 * ═══ PASSAGEM PARA HUMANO NÃO DEPENDE DO MODELO LEMBRAR ═══
 * Categoria marcada "passa para humano" (notificação, intimação, fiscalização) dispara o handoff
 * canônico DENTRO da abertura, pelo mesmo handler de `crm_request_human_handoff`. A spec 15
 * registra o risco central de um agente: dizer que vai chamar alguém e não chamar.
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente.
 */
import { z } from "zod";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { PRIORIDADES } from "@/lib/protocolos/prioridade";
import { resumoSchema } from "@/lib/protocolos/schemas";
import { abrirProtocolo, mudarEstado, numeroDoProtocolo } from "@/lib/protocolos/servico";
import { ESTADOS_ABERTOS, type EstadoDoProtocolo } from "@/lib/protocolos/vocabulario";

import { crmRequestHumanHandoff } from "./handoff";
import type { McpContext, McpToolDefinition } from "../types";

const MODULO_NAO_INSTALADO_HINT =
  "o módulo Protocolos não está instalado nesta instalação (peça ao administrador para instalar em " +
  "Modo administrador › Módulos) — esta capacidade não deveria estar ligada em nenhum agente enquanto isso";

/** Reabrir um resolvido pelo que o cliente acrescentou só dentro desta janela (spec 22 §10.4). */
const JANELA_DE_REABERTURA_DIAS = 7;

function ausente(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function ctxDoServico(ctx: McpContext): HandlerCtx {
  return { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId } as HandlerCtx;
}

/** Erro do serviço (ApiError) vira mensagem que ENSINA o modelo — nunca um 500 cru. */
function relancar(prefixo: string, e: unknown): never {
  if (e instanceof ApiError) {
    if (e.code === "module_not_installed") throw new Error(`${prefixo}: ${MODULO_NAO_INSTALADO_HINT}`);
    throw new Error(`${prefixo}: ${e.message}`);
  }
  throw e;
}

/** O estado como o CLIENTE entende — sem jargão interno de fila. */
export function estadoEmPalavras(estado: EstadoDoProtocolo): string {
  switch (estado) {
    case "novo":
    case "triagem":
      return "recebido, aguardando alguém da equipe pegar";
    case "atribuido":
    case "reaberto":
      return "com uma pessoa da equipe";
    case "em_atendimento":
      return "em andamento";
    case "aguardando_cliente":
      return "aguardando uma informação do cliente";
    case "aguardando_terceiro":
      return "aguardando um órgão ou terceiro";
    case "aguardando_interno":
      return "em andamento com a equipe";
    case "resolvido":
      return "resolvido";
    case "fechado":
      return "encerrado";
    case "cancelado":
      return "cancelado";
  }
}

// ---------------------------------------------------------------------------
// categorias
// ---------------------------------------------------------------------------

export const crmProtocoloCategorias: McpToolDefinition<Record<string, never>> = {
  name: "crm_protocolo_categorias",
  description:
    "Lista as categorias de protocolo ativas desta organização, cada uma com as subcategorias, " +
    "`quando_usar` e se pede competência (mês/ano, AAAA-MM). Consulte ANTES de abrir um protocolo " +
    "e escolha pelo `quando_usar` — nunca invente uma categoria.",
  inputSchema: {},
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (_input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("protocolo_categorias")
      .select("id, parent_id, nome, descricao_para_ia, exige_competencia, posicao")
      .eq("organization_id", ctx.organizationId)
      .eq("ativa", true)
      .order("posicao")
      .order("nome");
    if (error) {
      if (ausente(error)) throw new Error(`protocolo_categorias_falhou: ${MODULO_NAO_INSTALADO_HINT}`);
      throw new Error(`protocolo_categorias_falhou: ${error.message}`);
    }
    type Linha = { id: string; parent_id: string | null; nome: string; descricao_para_ia: string | null; exige_competencia: boolean };
    const linhas = (data ?? []) as Linha[];
    return {
      categorias: linhas
        .filter((c) => c.parent_id === null)
        .map((c) => ({
          categoria_id: c.id,
          nome: c.nome,
          quando_usar: c.descricao_para_ia,
          pede_competencia: c.exige_competencia,
          subcategorias: linhas
            .filter((s) => s.parent_id === c.id)
            .map((s) => ({ subcategoria_id: s.id, nome: s.nome, pede_competencia: s.exige_competencia || c.exige_competencia })),
        })),
    };
  },
};

// ---------------------------------------------------------------------------
// abrir
// ---------------------------------------------------------------------------

const abrirInputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
  categoria_id: z.string().uuid().describe("De crm_protocolo_categorias."),
  subcategoria_id: z.string().uuid().optional().describe("De crm_protocolo_categorias, se houver uma que caiba."),
  competencia: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .describe("Mês de referência AAAA-MM, quando a categoria pede (ex.: a guia de setembro de 2026 = 2026-09)."),
  titulo: z.string().trim().min(3).max(200).describe("Uma linha, objetiva: o que o cliente pediu."),
  descricao: z.string().trim().min(3).max(5000).describe("O pedido, com o que o cliente disse e o que já foi coletado."),
  resumo: resumoSchema.describe("O resumo para a equipe não precisar reler a conversa."),
  urgencia_declarada: z.string().trim().max(300).optional().describe("O que o CLIENTE disse sobre urgência, nas palavras dele."),
  prazo_cliente: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Data AAAA-MM-DD que o cliente informou como prazo (ex.: a guia vence dia 20)."),
  prioridade_sugerida: z
    .enum(PRIORIDADES)
    .optional()
    .describe("Só se a situação for MAIS urgente do que a categoria indica; a regra nunca deixa a prioridade baixar."),
  prioridade_motivo: z.string().trim().max(300).optional().describe("Por que sugeriu subir a prioridade."),
};

export const crmProtocoloAbrir: McpToolDefinition<typeof abrirInputShape> = {
  name: "crm_protocolo_abrir",
  description:
    "Registra o pedido do cliente como PROTOCOLO para a equipe trabalhar, com categoria, " +
    "competência e um resumo. Use quando o cliente pede algo que a equipe precisa fazer (guia, " +
    "documento, admissão, certidão…) ou quando trouxer notificação ou intimação. Antes: confira a " +
    "categoria em crm_protocolo_categorias e, se a pessoa representa mais de uma empresa, confirme " +
    "de qual empresa é o pedido. Devolve o `numero` do protocolo — diga ao cliente esse número e " +
    "que a equipe vai cuidar. NUNCA prometa prazo de conclusão: ele não vem nesta resposta de " +
    "propósito. Se `ja_existia` for true, o pedido já tinha protocolo aberto e a informação nova " +
    "entrou nele: diga o número que já existia. Se `passou_para_pessoa` for true, uma pessoa da " +
    "equipe assume a conversa agora — avise o cliente e não continue o atendimento.",
  inputSchema: abrirInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    let r;
    try {
      r = await abrirProtocolo(
        null,
        ctx.supabase,
        ctxDoServico(ctx),
        { userId: null, kind: "ia" },
        "agente",
        {
          conversation_id: input.conversation_id,
          categoria_id: input.categoria_id,
          subcategoria_id: input.subcategoria_id ?? null,
          competencia: input.competencia ?? null,
          titulo: input.titulo,
          descricao: input.descricao,
          resumo: input.resumo,
          urgencia_declarada: input.urgencia_declarada ?? null,
          prazo_cliente: input.prazo_cliente ?? null,
          prioridade_sugerida: input.prioridade_sugerida ?? null,
          prioridade_motivo: input.prioridade_motivo ?? null,
        },
      );
    } catch (e) {
      relancar("protocolo_abrir_falhou", e);
    }

    let passouParaPessoa = false;
    if (r.exige_handoff && !r.deduplicado) {
      await crmRequestHumanHandoff.handler(
        {
          conversation_id: input.conversation_id,
          reason: `Protocolo ${r.numero}: a categoria pede que uma pessoa assuma`,
          urgency: "high",
          cliente_quer: input.titulo.slice(0, 300),
          o_que_tentei: [{ o_que: `Registrei o protocolo ${r.numero}`, desfecho: "a categoria exige atendimento de uma pessoa" }],
        },
        ctx,
      );
      passouParaPessoa = true;
    }

    const estado = (r.protocolo as { estado: EstadoDoProtocolo }).estado;
    return {
      numero: r.numero,
      ja_existia: r.deduplicado,
      situacao: estadoEmPalavras(estado),
      passou_para_pessoa: passouParaPessoa,
    };
  },
};

// ---------------------------------------------------------------------------
// consultar
// ---------------------------------------------------------------------------

const consultarInputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
};

export const crmProtocoloConsultar: McpToolDefinition<typeof consultarInputShape> = {
  name: "crm_protocolo_consultar",
  description:
    "Mostra os protocolos do cliente desta conversa — os abertos e os dos últimos 30 dias — com " +
    "número, título e a situação em palavras. Use quando o cliente perguntar \"e o meu pedido?\". " +
    "Não traz prazo de conclusão nem quem está cuidando: se o cliente pedir previsão, diga que a " +
    "equipe vai retornar, sem inventar data.",
  inputSchema: consultarInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  motivoDoVazio: (r) => ((r as { protocolos?: unknown[] }).protocolos?.length === 0 ? "cliente_sem_protocolo" : null),
  handler: async (input, ctx) => {
    const { data: conversa } = await ctx.supabase
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.conversation_id)
      .maybeSingle();
    if (!conversa) throw new Error("protocolo_consultar_falhou: conversa não encontrada nesta organização");

    const desde = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data, error } = await ctx.supabase
      .from("protocolos")
      .select("id, ano, numero, titulo, estado, aberto_em")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", (conversa as { contact_id: string }).contact_id)
      .or(`estado.in.(${ESTADOS_ABERTOS.join(",")}),aberto_em.gte.${desde}`)
      .order("aberto_em", { ascending: false })
      .limit(10);
    if (error) {
      if (ausente(error)) throw new Error(`protocolo_consultar_falhou: ${MODULO_NAO_INSTALADO_HINT}`);
      throw new Error(`protocolo_consultar_falhou: ${error.message}`);
    }
    type Linha = { ano: number; numero: number; titulo: string; estado: EstadoDoProtocolo; aberto_em: string };
    return {
      protocolos: ((data ?? []) as Linha[]).map((p) => ({
        numero: numeroDoProtocolo(p),
        titulo: p.titulo,
        situacao: estadoEmPalavras(p.estado),
        aberto_em: p.aberto_em.slice(0, 10),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// complementar
// ---------------------------------------------------------------------------

const complementarInputShape = {
  conversation_id: z.string().uuid().describe("A conversa em curso."),
  numero: z
    .string()
    .regex(/^\d{4}-\d{6}$/)
    .describe("O número do protocolo, como crm_protocolo_consultar devolveu (ex.: 2026-000123)."),
  texto: z.string().trim().min(3).max(5000).describe("O que o cliente acrescentou ao pedido."),
};

export const crmProtocoloComplementar: McpToolDefinition<typeof complementarInputShape> = {
  name: "crm_protocolo_complementar",
  description:
    "Acrescenta a um protocolo DESTE cliente o que ele informou depois (um documento, um dado, uma " +
    "correção), para a equipe ver na ficha. Se o protocolo estava resolvido há poucos dias, ele é " +
    "reaberto. Use em vez de abrir outro protocolo para o mesmo pedido. Protocolo encerrado há mais " +
    "tempo não reabre: nesse caso abra um novo.",
  inputSchema: complementarInputShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: conversa } = await ctx.supabase
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.conversation_id)
      .maybeSingle();
    if (!conversa) throw new Error("protocolo_complementar_falhou: conversa não encontrada nesta organização");

    const [ano, numero] = input.numero.split("-").map(Number);
    const { data: protocolo, error } = await ctx.supabase
      .from("protocolos")
      .select("id, ano, numero, estado, resolvido_em")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", (conversa as { contact_id: string }).contact_id)
      .eq("ano", ano!)
      .eq("numero", numero!)
      .maybeSingle();
    if (error) {
      if (ausente(error)) throw new Error(`protocolo_complementar_falhou: ${MODULO_NAO_INSTALADO_HINT}`);
      throw new Error(`protocolo_complementar_falhou: ${error.message}`);
    }
    if (!protocolo) {
      throw new Error(
        "protocolo_complementar_falhou: este cliente não tem protocolo com esse número. Confira o número com crm_protocolo_consultar.",
      );
    }
    const p = protocolo as { id: string; ano: number; numero: number; estado: EstadoDoProtocolo; resolvido_em: string | null };

    let reaberto = false;
    if (p.estado === "resolvido") {
      const dias = p.resolvido_em ? (Date.now() - Date.parse(p.resolvido_em)) / (24 * 3600_000) : Infinity;
      if (dias > JANELA_DE_REABERTURA_DIAS) {
        throw new Error("protocolo_complementar_falhou: este protocolo foi resolvido há mais tempo. Abra um protocolo novo.");
      }
      try {
        await mudarEstado(ctx.supabase, ctxDoServico(ctx), { userId: null, kind: "ia" }, p.id, "reaberto");
      } catch (e) {
        relancar("protocolo_complementar_falhou", e);
      }
      reaberto = true;
    } else if (!ESTADOS_ABERTOS.includes(p.estado)) {
      throw new Error("protocolo_complementar_falhou: este protocolo está encerrado. Abra um protocolo novo.");
    }

    const { error: erroEvento } = await ctx.supabase.rpc("fn_protocolo_registrar_evento", {
      p_org: ctx.organizationId,
      p_protocolo: p.id,
      p_tipo: "complemento_do_cliente",
      p_texto: input.texto,
      p_ator: null,
      p_ator_kind: "ia",
      p_novo: null,
    });
    if (erroEvento) throw new Error(`protocolo_complementar_falhou: ${erroEvento.message}`);
    return { numero: numeroDoProtocolo(p), reaberto };
  },
};
