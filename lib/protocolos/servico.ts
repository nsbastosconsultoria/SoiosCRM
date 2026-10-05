/**
 * Protocolos — as operações que a API expõe (spec 22 §5, §7, §9, §10, §12).
 *
 * Dois clientes, e a diferença é a regra do módulo (migration 0904, §4.4 da spec):
 *   - `db` é a SESSÃO: só LÊ protocolos (a RLS recorta a organização) e escreve a CONFIGURAÇÃO,
 *     onde a RLS exige `admin`;
 *   - `admin` é o service role: a ÚNICA porta de escrita em `protocolos`, porque o SLA é
 *     calculado aqui (expediente, feriados, pausas) e precisa andar junto com o estado.
 * O `organization_id` vem sempre do contexto (cookie validado ou motor), nunca do corpo.
 *
 * O que o banco já garante não é repetido: número, campos imutáveis, máquina de estados,
 * organização cruzada, hierarquia de categoria. Este arquivo decide o que é negócio — prioridade,
 * distribuição, prazos, deduplicação — e traduz as recusas (`lancarErroDoProtocolo`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { AREAS_CONTABILIDADE, AREAS_PADRAO, areasDaOrganizacao, type Area } from "@/lib/atendimento/areas";
import { audit } from "@/lib/audit";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import type { createAdminClient } from "@/lib/supabase/admin";

import { lancarErroDoProtocolo, type ErroDoBanco } from "./erros";
import { MODELOS_DE_CATEGORIAS } from "./modelos";
import {
  baixaPrioridade,
  decidirPrioridade,
  regrasDePrazoDaOrganizacao,
  type Prioridade,
} from "./prioridade";
import type { EntradaDeAbertura, PatchDoProtocolo } from "./schemas";
import { expedienteDaOrganizacao, minutosUteisEntre, somarMinutosUteis, type Expediente } from "./sla";
import { ESTADOS_ABERTOS, type Distribuicao, type EstadoDoProtocolo, type OrigemDoProtocolo } from "./vocabulario";

type SB = SupabaseClient;
/**
 * O cliente de SERVIÇO, provado pelo tipo e não pelo nome: é o que escreve em `organizations`
 * (`tests/unit/escrita-em-organizations-usa-cliente-admin.test.ts` — com o cliente de sessão a
 * RLS casa zero linhas e o PostgREST devolve sucesso).
 */
type Admin = ReturnType<typeof createAdminClient>;

export const SELECT_DO_PROTOCOLO =
  "id, ano, numero, company_id, contact_id, conversation_id, agent_case_id, lead_id, categoria_id, subcategoria_id, " +
  "competencia, titulo, descricao, resumo, prioridade, prioridade_origem, prioridade_motivo, urgencia_declarada, " +
  "prazo_cliente, area, responsavel_user_id, distribuido_por, estado, origem, politica_sla_id, aberto_em, " +
  "primeira_resposta_vence_em, primeira_resposta_em, resolucao_vence_em, resolvido_em, pausado_desde, " +
  "pausa_acumulada, fechado_em, motivo_encerramento, reaberturas, revision, created_at, updated_at";

export type LinhaDoProtocolo = {
  id: string;
  ano: number;
  numero: number;
  company_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  categoria_id: string;
  subcategoria_id: string | null;
  competencia: string | null;
  prioridade: Prioridade;
  area: string;
  responsavel_user_id: string | null;
  estado: EstadoDoProtocolo;
  politica_sla_id: string | null;
  aberto_em: string;
  resolucao_vence_em: string | null;
  pausado_desde: string | null;
  pausa_acumulada: string;
  revision: number;
};

/** Quem age: uma pessoa da tela, ou o assistente (sem usuário). */
export interface Ator {
  userId: string | null;
  kind: "humano" | "ia";
  role?: Role;
}

function falha(erro: ErroDoBanco | null, ctx: HandlerCtx): void {
  if (erro) lancarErroDoProtocolo(erro, ctx.requestId);
}

function invalido(ctx: HandlerCtx, mensagem: string, codigo = "validation_failed"): never {
  throw new ApiError(422, codigo, undefined, ctx.requestId, mensagem);
}

function naoEncontrado(ctx: HandlerCtx, mensagem = "Protocolo não encontrado."): never {
  throw new ApiError(404, "not_found", undefined, ctx.requestId, mensagem);
}

/** O número que a tela e o cliente veem: "2026-000123". */
export function numeroDoProtocolo(p: { ano: number; numero: number }): string {
  return `${p.ano}-${String(p.numero).padStart(6, "0")}`;
}

// ─── calendário e política ───────────────────────────────────────────────────

export interface Calendario {
  settings: unknown;
  expediente: Expediente | null;
  feriados: ReadonlySet<string>;
}

export async function carregarCalendario(admin: SB, ctx: HandlerCtx): Promise<Calendario> {
  const [{ data: org }, { data: feriados, error }] = await Promise.all([
    admin.from("organizations").select("settings").eq("id", ctx.organization_id).maybeSingle(),
    admin.from("protocolo_feriados").select("data").eq("organization_id", ctx.organization_id),
  ]);
  falha(error, ctx);
  const settings = (org as { settings?: unknown } | null)?.settings ?? {};
  return {
    settings,
    expediente: expedienteDaOrganizacao(settings),
    feriados: new Set(((feriados ?? []) as Array<{ data: string }>).map((f) => f.data)),
  };
}

/** `AAAA-MM-DD` de hoje no fuso do expediente (sem expediente, America/Sao_Paulo). */
export function hojeNoFuso(agora: Date, expediente: Expediente | null): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: expediente?.fuso ?? "America/Sao_Paulo" }).format(agora);
}

type Politica = {
  id: string;
  primeira_resposta_min: number;
  resolucao_min: number;
  em_horario_util: boolean;
  pausa_aguardando_cliente: boolean;
  pausa_aguardando_terceiro: boolean;
};

const SELECT_DA_POLITICA =
  "id, primeira_resposta_min, resolucao_min, em_horario_util, pausa_aguardando_cliente, pausa_aguardando_terceiro";

/** A política da (prioridade, categoria); senão a geral da prioridade; senão nenhuma (sem SLA). */
async function politicaPara(
  admin: SB,
  ctx: HandlerCtx,
  prioridade: Prioridade,
  categoriaId: string,
): Promise<Politica | null> {
  const { data, error } = await admin
    .from("protocolo_politicas_sla")
    .select(`${SELECT_DA_POLITICA}, categoria_id`)
    .eq("organization_id", ctx.organization_id)
    .eq("prioridade", prioridade);
  falha(error, ctx);
  const linhas = (data ?? []) as Array<Politica & { categoria_id: string | null }>;
  return linhas.find((p) => p.categoria_id === categoriaId) ?? linhas.find((p) => p.categoria_id === null) ?? null;
}

async function politicaPorId(admin: SB, ctx: HandlerCtx, id: string | null): Promise<Politica | null> {
  if (!id) return null;
  const { data, error } = await admin
    .from("protocolo_politicas_sla")
    .select(SELECT_DA_POLITICA)
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  falha(error, ctx);
  return (data as Politica | null) ?? null;
}

function relogioDa(politica: Politica, cal: Calendario): Expediente | null {
  return politica.em_horario_util ? cal.expediente : null;
}

/** Os dois prazos de uma política, contados de `inicio`, somando a pausa já acumulada à resolução. */
export function prazosDaPolitica(
  politica: Politica | null,
  inicio: Date,
  cal: Calendario,
  pausaMin = 0,
): { primeira_resposta_vence_em: string | null; resolucao_vence_em: string | null } {
  if (!politica) return { primeira_resposta_vence_em: null, resolucao_vence_em: null };
  const relogio = relogioDa(politica, cal);
  return {
    primeira_resposta_vence_em: somarMinutosUteis(inicio, politica.primeira_resposta_min, relogio, cal.feriados).toISOString(),
    resolucao_vence_em: somarMinutosUteis(inicio, politica.resolucao_min + pausaMin, relogio, cal.feriados).toISOString(),
  };
}

/** `interval` do Postgres como o PostgREST devolve ("00:30:00", "2 days 01:15:00") → minutos. */
export function minutosDoIntervalo(intervalo: string | null | undefined): number {
  if (!intervalo) return 0;
  const dias = /(-?\d+) days?/.exec(intervalo);
  const hms = /(-?\d+):(\d{2}):(\d{2})/.exec(intervalo);
  const total =
    (dias ? Number(dias[1]) * 24 * 60 : 0) + (hms ? Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60 : 0);
  return Math.max(0, Math.round(total));
}

// ─── distribuição ────────────────────────────────────────────────────────────

/** Tabela de módulo ausente (o outro módulo não instalado) não é erro: é "não há". */
function ausente(erro: ErroDoBanco | null): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

/**
 * Quem fica com o protocolo (spec 22 §9): o responsável da empresa NA ÁREA, pela carteira (se o
 * módulo existe e a pessoa ainda é membro ativo) → a fila da área, se ela tem membros → o líder
 * da área → a fila sem dono (visível a gestor; o aviso na Central é do PR-D).
 */
export async function distribuir(
  admin: SB,
  ctx: HandlerCtx,
  area: string,
  companyId: string | null,
): Promise<{ responsavel_user_id: string | null; distribuido_por: Distribuicao }> {
  if (companyId) {
    const { data, error } = await admin
      .from("carteira_responsaveis")
      .select("user_id")
      .eq("organization_id", ctx.organization_id)
      .eq("company_id", companyId)
      .eq("area", area)
      .eq("principal", true)
      .is("vigencia_fim", null)
      .maybeSingle();
    if (error && !ausente(error)) falha(error, ctx);
    const userId = (data as { user_id: string } | null)?.user_id ?? null;
    if (userId && (await membroAtivo(admin, ctx, userId))) {
      return { responsavel_user_id: userId, distribuido_por: "carteira" };
    }
  }

  const { data: membros, error } = await admin
    .from("protocolo_area_membros")
    .select("user_id, papel")
    .eq("organization_id", ctx.organization_id)
    .eq("area", area);
  falha(error, ctx);
  const lista = (membros ?? []) as Array<{ user_id: string; papel: "membro" | "lider" }>;
  if (lista.some((m) => m.papel === "membro")) return { responsavel_user_id: null, distribuido_por: "fila" };
  const lider = lista.find((m) => m.papel === "lider");
  if (lider && (await membroAtivo(admin, ctx, lider.user_id))) {
    return { responsavel_user_id: lider.user_id, distribuido_por: "fallback" };
  }
  return { responsavel_user_id: null, distribuido_por: "fila" };
}

async function membroAtivo(admin: SB, ctx: HandlerCtx, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", ctx.organization_id)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  return data !== null;
}

// ─── abertura ────────────────────────────────────────────────────────────────

type Categoria = {
  id: string;
  parent_id: string | null;
  area: string;
  prioridade_padrao: Prioridade;
  exige_competencia: boolean;
  exige_handoff: boolean;
};

async function categoriaAtiva(admin: SB, ctx: HandlerCtx, id: string): Promise<Categoria | null> {
  const { data, error } = await admin
    .from("protocolo_categorias")
    .select("id, parent_id, area, prioridade_padrao, exige_competencia, exige_handoff")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .eq("ativa", true)
    .maybeSingle();
  falha(error, ctx);
  return (data as Categoria | null) ?? null;
}

export interface ResultadoDaAbertura {
  protocolo: Record<string, unknown>;
  numero: string;
  /** Já havia um protocolo aberto para o mesmo pedido: a informação foi acrescentada nele. */
  deduplicado: boolean;
  /** A categoria pede passagem para humano (notificação, intimação…) — quem chama a dispara. */
  exige_handoff: boolean;
}

/**
 * Abre um protocolo (spec 22 §5) — UMA função para a tela, a API e (no PR-D) a ferramenta do
 * assistente. `db` (sessão) só é usado para conferir que a pessoa da tela enxerga a conversa.
 */
export async function abrirProtocolo(
  db: SB | null,
  admin: SB,
  ctx: HandlerCtx,
  ator: Ator,
  origem: OrigemDoProtocolo,
  entrada: EntradaDeAbertura & { prioridade_sugerida?: Prioridade | null; prioridade_motivo?: string | null },
): Promise<ResultadoDaAbertura> {
  // Categoria raiz ativa, e a subcategoria filha dela.
  const categoria = await categoriaAtiva(admin, ctx, entrada.categoria_id);
  if (!categoria || categoria.parent_id !== null) invalido(ctx, "Categoria inexistente ou desativada.");
  const sub = entrada.subcategoria_id ? await categoriaAtiva(admin, ctx, entrada.subcategoria_id) : null;
  if (entrada.subcategoria_id && (!sub || sub.parent_id !== categoria.id)) {
    invalido(ctx, "Subcategoria inexistente, desativada ou de outra categoria.");
  }
  const exigeCompetencia = categoria.exige_competencia || (sub?.exige_competencia ?? false);
  if (exigeCompetencia && !entrada.competencia) {
    invalido(ctx, "Esta categoria pede a competência (AAAA-MM).", "competencia_obrigatoria");
  }

  // A conversa dá o contato; a carteira (se instalada) dá a empresa do contexto.
  let contactId = entrada.contact_id ?? null;
  let companyId = entrada.company_id ?? null;
  if (entrada.conversation_id) {
    if (db) {
      const { data: visivel } = await db
        .from("conversations")
        .select("id")
        .eq("organization_id", ctx.organization_id)
        .eq("id", entrada.conversation_id)
        .maybeSingle();
      if (!visivel) naoEncontrado(ctx, "Conversa não encontrada.");
    }
    const { data: conversa } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", entrada.conversation_id)
      .maybeSingle();
    if (!conversa) naoEncontrado(ctx, "Conversa não encontrada.");
    contactId = contactId ?? (conversa as { contact_id: string }).contact_id;
    if (!companyId) {
      const { data: contexto, error } = await admin
        .from("carteira_contexto_conversa")
        .select("company_id")
        .eq("organization_id", ctx.organization_id)
        .eq("conversation_id", entrada.conversation_id)
        .is("fim", null)
        .maybeSingle();
      if (error && !ausente(error)) falha(error, ctx);
      companyId = (contexto as { company_id: string | null } | null)?.company_id ?? null;
    }
  }

  // Deduplicação (spec 22 §5.2): mesmo pedido aberto para a mesma empresa (ou contato) não abre
  // outro — o que o cliente disse de novo vira complemento no que já existe.
  if (companyId || contactId) {
    let q = admin
      .from("protocolos")
      .select(SELECT_DO_PROTOCOLO)
      .eq("organization_id", ctx.organization_id)
      .eq("categoria_id", categoria.id)
      .in("estado", ESTADOS_ABERTOS as unknown as string[])
      .order("aberto_em", { ascending: false })
      .limit(1);
    q = companyId ? q.eq("company_id", companyId) : q.eq("contact_id", contactId!);
    q = entrada.subcategoria_id ? q.eq("subcategoria_id", entrada.subcategoria_id) : q.is("subcategoria_id", null);
    q = entrada.competencia ? q.eq("competencia", entrada.competencia) : q.is("competencia", null);
    const { data: existente, error } = await q.maybeSingle();
    falha(error, ctx);
    if (existente) {
      const p = existente as unknown as LinhaDoProtocolo & Record<string, unknown>;
      const { error: erroEvento } = await admin.rpc("fn_protocolo_registrar_evento", {
        p_org: ctx.organization_id,
        p_protocolo: p.id,
        p_tipo: "complemento_do_cliente",
        p_texto: entrada.descricao,
        p_ator: ator.userId,
        p_ator_kind: ator.kind,
        p_novo: null,
      });
      falha(erroEvento, ctx);
      return { protocolo: p, numero: numeroDoProtocolo(p), deduplicado: true, exige_handoff: false };
    }
  }

  const cal = await carregarCalendario(admin, ctx);
  const agora = new Date();
  const decidida = decidirPrioridade({
    padraoDaCategoria: categoria.prioridade_padrao,
    padraoDaSubcategoria: sub?.prioridade_padrao ?? null,
    prazoCliente: entrada.prazo_cliente ?? null,
    hoje: hojeNoFuso(agora, cal.expediente),
    sugestaoDaIa: entrada.prioridade_sugerida ?? null,
    regras: regrasDePrazoDaOrganizacao(cal.settings),
    expediente: cal.expediente,
    feriados: cal.feriados,
  });
  const area = sub?.area ?? categoria.area;
  const distribuicao = await distribuir(admin, ctx, area, companyId);
  const politica = await politicaPara(admin, ctx, decidida.prioridade, categoria.id);

  const { data, error } = await admin
    .from("protocolos")
    .insert({
      organization_id: ctx.organization_id,
      company_id: companyId,
      contact_id: contactId,
      conversation_id: entrada.conversation_id ?? null,
      lead_id: entrada.lead_id ?? null,
      categoria_id: categoria.id,
      subcategoria_id: sub?.id ?? null,
      competencia: entrada.competencia ?? null,
      titulo: entrada.titulo,
      descricao: entrada.descricao,
      resumo: entrada.resumo ?? null,
      prioridade: decidida.prioridade,
      prioridade_origem: decidida.origem,
      prioridade_motivo: decidida.origem === "ia" ? (entrada.prioridade_motivo ?? null) : null,
      urgencia_declarada: entrada.urgencia_declarada ?? null,
      prazo_cliente: entrada.prazo_cliente ?? null,
      area,
      responsavel_user_id: distribuicao.responsavel_user_id,
      distribuido_por: distribuicao.distribuido_por,
      estado: distribuicao.responsavel_user_id ? "atribuido" : "triagem",
      origem,
      politica_sla_id: politica?.id ?? null,
      aberto_em: agora.toISOString(),
      ...prazosDaPolitica(politica, agora, cal),
      alterado_por: ator.userId,
    })
    .select(SELECT_DO_PROTOCOLO)
    .single();
  falha(error, ctx);
  const protocolo = data as unknown as LinhaDoProtocolo & Record<string, unknown>;

  if (ator.userId) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: ator.userId,
      action: "protocolos.aberto",
      resourceType: "protocolos",
      resourceId: protocolo.id,
      requestId: ctx.requestId,
      metadata: {
        numero: numeroDoProtocolo(protocolo),
        prioridade: decidida.prioridade,
        prioridade_origem: decidida.origem,
        distribuido_por: distribuicao.distribuido_por,
      },
    });
  }
  return {
    protocolo,
    numero: numeroDoProtocolo(protocolo),
    deduplicado: false,
    exige_handoff: categoria.exige_handoff || (sub?.exige_handoff ?? false),
  };
}

// ─── leitura ─────────────────────────────────────────────────────────────────

async function lerParaEscrever(admin: SB, ctx: HandlerCtx, id: string): Promise<LinhaDoProtocolo> {
  const { data, error } = await admin
    .from("protocolos")
    .select(SELECT_DO_PROTOCOLO)
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx);
  return data as unknown as LinhaDoProtocolo;
}

/** Gravação com concorrência otimista: quem leu a revisão N só grava se ainda for N. */
async function gravar(
  admin: SB,
  ctx: HandlerCtx,
  atual: LinhaDoProtocolo,
  mudancas: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from("protocolos")
    .update(mudancas)
    .eq("organization_id", ctx.organization_id)
    .eq("id", atual.id)
    .eq("revision", atual.revision)
    .select(SELECT_DO_PROTOCOLO)
    .maybeSingle();
  falha(error, ctx);
  if (!data) {
    throw new ApiError(409, "revision_conflict", undefined, ctx.requestId, "O protocolo mudou enquanto você editava. Recarregue e tente de novo.");
  }
  return data as unknown as Record<string, unknown>;
}

export type Visao = "minha" | "fila" | "vencendo" | "todos";

export async function listarProtocolos(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  filtros: { visao: Visao; area?: string; prioridade?: Prioridade; company_id?: string; limite?: number },
) {
  const limite = Math.min(Math.max(filtros.limite ?? 50, 1), 200);
  let q = db
    .from("protocolos")
    .select(
      "id, ano, numero, titulo, prioridade, area, estado, responsavel_user_id, company_id, competencia, aberto_em, " +
        "primeira_resposta_vence_em, primeira_resposta_em, resolucao_vence_em, pausado_desde, categoria_id, subcategoria_id",
    )
    .eq("organization_id", ctx.organization_id)
    .limit(limite);

  if (filtros.visao !== "todos") q = q.in("estado", ESTADOS_ABERTOS as unknown as string[]);
  if (filtros.visao === "minha") q = q.eq("responsavel_user_id", userId);
  if (filtros.visao === "fila") q = q.is("responsavel_user_id", null);
  if (filtros.visao === "vencendo") {
    q = q.not("resolucao_vence_em", "is", null).lte("resolucao_vence_em", new Date(Date.now() + 4 * 3600_000).toISOString());
  }
  if (filtros.area) q = q.eq("area", filtros.area);
  if (filtros.prioridade) q = q.eq("prioridade", filtros.prioridade);
  if (filtros.company_id) q = q.eq("company_id", filtros.company_id);

  q =
    filtros.visao === "todos"
      ? q.order("aberto_em", { ascending: false })
      : q.order("prioridade", { ascending: true }).order("resolucao_vence_em", { ascending: true, nullsFirst: false });

  const { data, error } = await q;
  falha(error, ctx);
  return data ?? [];
}

export async function fichaDoProtocolo(db: SB, ctx: HandlerCtx, id: string) {
  const { data, error } = await db
    .from("protocolos")
    .select(SELECT_DO_PROTOCOLO)
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx);
  const { data: eventos, error: erroEventos } = await db
    .from("protocolo_eventos")
    .select("id, tipo, anterior, novo, texto, ator_kind, ator_user_id, created_at")
    .eq("organization_id", ctx.organization_id)
    .eq("protocolo_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  falha(erroEventos, ctx);
  const p = data as unknown as LinhaDoProtocolo & Record<string, unknown>;
  return { protocolo: p, numero: numeroDoProtocolo(p), eventos: eventos ?? [] };
}

// ─── mudanças ────────────────────────────────────────────────────────────────

/**
 * Muda o estado e mexe no relógio (spec 22 §10.3): entrar em "aguardando cliente/terceiro" pausa
 * a resolução se a política manda; sair soma a pausa, em minutos ÚTEIS, ao prazo. A máquina de
 * estados é do gatilho — a recusa volta como 409 `protocolo_transicao_invalida`.
 */
export async function mudarEstado(
  admin: SB,
  ctx: HandlerCtx,
  ator: Ator,
  id: string,
  para: EstadoDoProtocolo,
  motivo?: string | null,
) {
  const atual = await lerParaEscrever(admin, ctx, id);
  const politica = await politicaPorId(admin, ctx, atual.politica_sla_id);
  const mudancas: Record<string, unknown> = { estado: para, alterado_por: ator.userId };

  const pausaAqui =
    politica !== null &&
    ((para === "aguardando_cliente" && politica.pausa_aguardando_cliente) ||
      (para === "aguardando_terceiro" && politica.pausa_aguardando_terceiro));

  if (atual.pausado_desde && !pausaAqui) {
    const cal = await carregarCalendario(admin, ctx);
    const relogio = politica ? relogioDa(politica, cal) : cal.expediente;
    const pausados = minutosUteisEntre(new Date(atual.pausado_desde), new Date(), relogio, cal.feriados);
    mudancas.pausado_desde = null;
    mudancas.pausa_acumulada = `${minutosDoIntervalo(atual.pausa_acumulada) + pausados} minutes`;
    if (atual.resolucao_vence_em && pausados > 0) {
      mudancas.resolucao_vence_em = somarMinutosUteis(
        new Date(atual.resolucao_vence_em),
        pausados,
        relogio,
        cal.feriados,
      ).toISOString();
    }
  } else if (!atual.pausado_desde && pausaAqui) {
    mudancas.pausado_desde = new Date().toISOString();
  }

  if (para === "cancelado" || para === "fechado" || para === "resolvido") {
    mudancas.motivo_encerramento = motivo ?? null;
  }

  const gravado = await gravar(admin, ctx, atual, mudancas);
  if (ator.userId) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: ator.userId,
      action: "protocolos.estado_alterado",
      resourceType: "protocolos",
      resourceId: id,
      requestId: ctx.requestId,
      metadata: { de: atual.estado, para },
    });
  }
  return gravado;
}

/**
 * Corrige classificação e prioridade. Baixar a prioridade é de gestor (Q2); a categoria nova
 * leva a área dela; mudar prioridade ou categoria recalcula os prazos a partir da ABERTURA (o
 * relógio não recomeça), somando a pausa já acumulada.
 */
export async function alterarProtocolo(
  admin: SB,
  ctx: HandlerCtx,
  ator: Ator & { role: Role },
  id: string,
  patch: PatchDoProtocolo,
) {
  const atual = await lerParaEscrever(admin, ctx, id);
  const mudancas: Record<string, unknown> = { alterado_por: ator.userId };

  if (patch.prioridade && baixaPrioridade(atual.prioridade, patch.prioridade) && ROLE_RANK[ator.role] < ROLE_RANK.manager) {
    throw new ApiError(403, "baixar_prioridade_exige_gestor", undefined, ctx.requestId, "Só gestor pode baixar a prioridade.");
  }

  let categoriaId = atual.categoria_id;
  let area = atual.area;
  if (patch.categoria_id !== undefined || patch.subcategoria_id !== undefined) {
    categoriaId = patch.categoria_id ?? atual.categoria_id;
    const categoria = await categoriaAtiva(admin, ctx, categoriaId);
    if (!categoria || categoria.parent_id !== null) invalido(ctx, "Categoria inexistente ou desativada.");
    const subId = patch.subcategoria_id === undefined ? atual.subcategoria_id : patch.subcategoria_id;
    const sub = subId ? await categoriaAtiva(admin, ctx, subId) : null;
    if (subId && (!sub || sub.parent_id !== categoriaId)) invalido(ctx, "Subcategoria de outra categoria.");
    area = sub?.area ?? categoria.area;
    Object.assign(mudancas, { categoria_id: categoriaId, subcategoria_id: subId ?? null, area });
  }
  if (patch.competencia !== undefined) mudancas.competencia = patch.competencia;
  if (patch.titulo !== undefined) mudancas.titulo = patch.titulo;
  if (patch.prazo_cliente !== undefined) mudancas.prazo_cliente = patch.prazo_cliente;

  const prioridade = patch.prioridade ?? atual.prioridade;
  if (patch.prioridade && patch.prioridade !== atual.prioridade) {
    Object.assign(mudancas, {
      prioridade: patch.prioridade,
      prioridade_origem: "humano",
      prioridade_motivo: patch.prioridade_motivo ?? null,
    });
  }

  if (prioridade !== atual.prioridade || categoriaId !== atual.categoria_id) {
    const cal = await carregarCalendario(admin, ctx);
    const politica = await politicaPara(admin, ctx, prioridade, categoriaId);
    Object.assign(mudancas, {
      politica_sla_id: politica?.id ?? null,
      ...prazosDaPolitica(politica, new Date(atual.aberto_em), cal, minutosDoIntervalo(atual.pausa_acumulada)),
    });
  }

  const gravado = await gravar(admin, ctx, atual, mudancas);
  if (ator.userId) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: ator.userId,
      action: patch.prioridade && patch.prioridade !== atual.prioridade ? "protocolos.prioridade_alterada" : "protocolos.atualizado",
      resourceType: "protocolos",
      resourceId: id,
      requestId: ctx.requestId,
      metadata: { campos: Object.keys(patch), de: atual.prioridade, para: prioridade },
    });
  }
  return gravado;
}

/**
 * Atribui (gestor, a qualquer membro) ou assume (atendente, para si — se é da área, ou gestor).
 * `null` devolve à fila. Atribuir um protocolo novo ou em triagem o leva a "atribuído".
 */
export async function atribuir(
  admin: SB,
  ctx: HandlerCtx,
  ator: Ator & { role: Role },
  id: string,
  alvo: string | null,
  modo: "atribuir" | "assumir",
) {
  const atual = await lerParaEscrever(admin, ctx, id);

  if (modo === "assumir" && ROLE_RANK[ator.role] < ROLE_RANK.manager) {
    const { data: membro, error } = await admin
      .from("protocolo_area_membros")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("area", atual.area)
      .eq("user_id", ator.userId!)
      .maybeSingle();
    falha(error, ctx);
    if (!membro) {
      throw new ApiError(403, "fora_da_area", undefined, ctx.requestId, "Você não faz parte da fila desta área.");
    }
  }
  if (alvo && !(await membroAtivo(admin, ctx, alvo))) invalido(ctx, "Essa pessoa não é membro desta organização.");

  const mudancas: Record<string, unknown> = {
    responsavel_user_id: alvo,
    distribuido_por: "humano",
    alterado_por: ator.userId,
  };
  if (alvo && (atual.estado === "novo" || atual.estado === "triagem" || atual.estado === "reaberto")) mudancas.estado = "atribuido";
  if (!alvo && atual.estado === "atribuido") mudancas.estado = "triagem";

  const gravado = await gravar(admin, ctx, atual, mudancas);
  if (ator.userId) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: ator.userId,
      action: "protocolos.atribuido",
      resourceType: "protocolos",
      resourceId: id,
      requestId: ctx.requestId,
      metadata: { de: atual.responsavel_user_id, para: alvo, modo },
    });
  }
  return gravado;
}

export async function registrarNota(admin: SB, ctx: HandlerCtx, ator: Ator, id: string, texto: string) {
  const { data, error } = await admin.rpc("fn_protocolo_registrar_evento", {
    p_org: ctx.organization_id,
    p_protocolo: id,
    p_tipo: "nota",
    p_texto: texto,
    p_ator: ator.userId,
    p_ator_kind: ator.kind,
    p_novo: null,
  });
  falha(error, ctx);
  return { evento_id: data as string };
}

// ─── configuração ────────────────────────────────────────────────────────────

export async function lerConfiguracao(db: SB, admin: SB, ctx: HandlerCtx) {
  const [categorias, politicas, membros, feriados, cal] = await Promise.all([
    db.from("protocolo_categorias").select("*").eq("organization_id", ctx.organization_id).order("posicao").order("nome"),
    db.from("protocolo_politicas_sla").select("*").eq("organization_id", ctx.organization_id).order("prioridade"),
    db.from("protocolo_area_membros").select("id, area, user_id, papel").eq("organization_id", ctx.organization_id),
    db.from("protocolo_feriados").select("id, data, descricao").eq("organization_id", ctx.organization_id).order("data"),
    carregarCalendario(admin, ctx),
  ]);
  for (const r of [categorias, politicas, membros, feriados]) falha(r.error, ctx);
  return {
    categorias: categorias.data ?? [],
    politicas: politicas.data ?? [],
    membros: membros.data ?? [],
    feriados: feriados.data ?? [],
    expediente: cal.expediente,
    areas: areasDaOrganizacao(cal.settings),
    regras_de_prazo: regrasDePrazoDaOrganizacao(cal.settings),
  };
}

/**
 * Política por (prioridade, categoria): atualiza a que existe, senão cria. Não é `upsert` do
 * PostgREST de propósito: a unicidade é de índice PARCIAL (geral × por categoria), e `ON
 * CONFLICT` com índice parcial pede o predicado, que o PostgREST não manda.
 */
export async function salvarPolitica(
  db: SB,
  ctx: HandlerCtx,
  corpo: {
    prioridade: Prioridade;
    categoria_id?: string | null;
    primeira_resposta_min: number;
    resolucao_min: number;
    em_horario_util?: boolean;
    pausa_aguardando_cliente?: boolean;
    pausa_aguardando_terceiro?: boolean;
  },
) {
  let q = db
    .from("protocolo_politicas_sla")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("prioridade", corpo.prioridade);
  q = corpo.categoria_id ? q.eq("categoria_id", corpo.categoria_id) : q.is("categoria_id", null);
  const { data: existente, error } = await q.maybeSingle();
  falha(error, ctx);
  const linha = { ...corpo, categoria_id: corpo.categoria_id ?? null, organization_id: ctx.organization_id };
  const r = existente
    ? await db.from("protocolo_politicas_sla").update({ ...linha, updated_at: new Date().toISOString() }).eq("id", (existente as { id: string }).id).select("*").single()
    : await db.from("protocolo_politicas_sla").insert(linha).select("*").single();
  falha(r.error, ctx);
  return r.data;
}

/** `organizations.settings.<chave>` por MERGE — nunca sobrescrever o jsonb inteiro. */
async function mesclarSettings(admin: Admin, ctx: HandlerCtx, mesclar: (atual: Record<string, unknown>) => Record<string, unknown>) {
  const { data, error } = await admin.from("organizations").select("settings").eq("id", ctx.organization_id).single();
  falha(error, ctx);
  const atual = ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>;
  const { error: erroGravar } = await admin.from("organizations").update({ settings: mesclar(atual) }).eq("id", ctx.organization_id);
  falha(erroGravar, ctx);
}

export async function salvarExpediente(admin: Admin, ctx: HandlerCtx, userId: string, expediente: Expediente | null) {
  if (expediente && expedienteDaOrganizacao({ protocolos: { expediente } }) === null) {
    invalido(ctx, "Expediente inválido: confira o fuso e se o fim vem depois do início.");
  }
  await mesclarSettings(admin, ctx, (s) => ({
    ...s,
    protocolos: { ...((s.protocolos as Record<string, unknown>) ?? {}), expediente },
  }));
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "protocolos.config_alterada",
    resourceType: "organizations",
    resourceId: ctx.organization_id,
    requestId: ctx.requestId,
    metadata: { campo: "expediente" },
  });
  return { expediente };
}

/**
 * Aplica um modelo de nicho (spec 22 §13): as áreas (só as que faltam — nada que a organização
 * configurou é apagado) e as categorias (só as que faltam, pelo slug). Idempotente: aplicar de
 * novo não duplica nada. Políticas de SLA ficam EM BRANCO de propósito — prazo é do escritório.
 */
export async function aplicarModelo(db: SB, admin: Admin, ctx: HandlerCtx, userId: string, modelo: "contabilidade" | "generico") {
  const areasDoModelo: readonly Area[] = modelo === "contabilidade" ? AREAS_CONTABILIDADE : AREAS_PADRAO;
  await mesclarSettings(admin, ctx, (s) => {
    const atendimento = (s.atendimento as Record<string, unknown>) ?? {};
    const jaTem = Array.isArray(atendimento.areas) ? (atendimento.areas as Area[]) : [];
    const slugs = new Set(jaTem.map((a) => a.slug));
    return { ...s, atendimento: { ...atendimento, areas: [...jaTem, ...areasDoModelo.filter((a) => !slugs.has(a.slug))] } };
  });

  const { data: existentes, error } = await db
    .from("protocolo_categorias")
    .select("id, slug, parent_id")
    .eq("organization_id", ctx.organization_id);
  falha(error, ctx);
  const raiz = new Map(
    ((existentes ?? []) as Array<{ id: string; slug: string; parent_id: string | null }>)
      .filter((c) => c.parent_id === null)
      .map((c) => [c.slug, c.id]),
  );
  const subsExistentes = new Set(
    ((existentes ?? []) as Array<{ slug: string; parent_id: string | null }>)
      .filter((c) => c.parent_id !== null)
      .map((c) => `${c.parent_id}/${c.slug}`),
  );

  let criadas = 0;
  for (const [posicao, cat] of MODELOS_DE_CATEGORIAS[modelo].entries()) {
    let id = raiz.get(cat.slug);
    if (!id) {
      const r = await db
        .from("protocolo_categorias")
        .insert({
          organization_id: ctx.organization_id,
          nome: cat.nome,
          slug: cat.slug,
          area: cat.area,
          prioridade_padrao: cat.prioridade_padrao,
          exige_competencia: cat.exige_competencia,
          exige_handoff: cat.exige_handoff,
          descricao_para_ia: cat.descricao_para_ia,
          posicao: posicao * 10,
        })
        .select("id")
        .single();
      falha(r.error, ctx);
      id = (r.data as { id: string }).id;
      criadas++;
    }
    for (const [i, sub] of cat.subcategorias.entries()) {
      if (subsExistentes.has(`${id}/${sub.slug}`)) continue;
      const r = await db.from("protocolo_categorias").insert({
        organization_id: ctx.organization_id,
        parent_id: id,
        nome: sub.nome,
        slug: sub.slug,
        area: sub.area ?? cat.area,
        prioridade_padrao: sub.prioridade_padrao ?? cat.prioridade_padrao,
        exige_competencia: sub.exige_competencia ?? cat.exige_competencia,
        exige_handoff: sub.exige_handoff ?? cat.exige_handoff,
        posicao: i * 10,
      });
      falha(r.error, ctx);
      criadas++;
    }
  }

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "protocolos.config_alterada",
    resourceType: "organizations",
    resourceId: ctx.organization_id,
    requestId: ctx.requestId,
    metadata: { campo: "modelo", modelo, criadas },
  });
  return { modelo, categorias_criadas: criadas };
}

/** Escrita de configuração pela SESSÃO (a RLS da 0904 exige `admin`), sempre auditada. */
async function auditarConfig(ctx: HandlerCtx, userId: string, campo: string, metadata: Record<string, unknown> = {}) {
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "protocolos.config_alterada",
    resourceType: "organizations",
    resourceId: ctx.organization_id,
    requestId: ctx.requestId,
    metadata: { campo, ...metadata },
  });
}

async function conferirArea(admin: SB, ctx: HandlerCtx, area: string): Promise<void> {
  const cal = await carregarCalendario(admin, ctx);
  if (!areasDaOrganizacao(cal.settings).some((a) => a.slug === area)) {
    invalido(ctx, `Área desconhecida nesta organização: ${area}.`);
  }
}

export async function criarCategoria(db: SB, admin: SB, ctx: HandlerCtx, userId: string, corpo: Record<string, unknown> & { area: string }) {
  await conferirArea(admin, ctx, corpo.area);
  const { data, error } = await db
    .from("protocolo_categorias")
    .insert({ ...corpo, organization_id: ctx.organization_id })
    .select("*")
    .single();
  falha(error, ctx);
  await auditarConfig(ctx, userId, "categoria", { id: (data as { id: string }).id, acao: "criada" });
  return data;
}

export async function atualizarCategoria(
  db: SB,
  admin: SB,
  ctx: HandlerCtx,
  userId: string,
  id: string,
  patch: Record<string, unknown> & { area?: string },
) {
  if (patch.area) await conferirArea(admin, ctx, patch.area);
  const { data, error } = await db
    .from("protocolo_categorias")
    .update(patch)
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Categoria não encontrada.");
  await auditarConfig(ctx, userId, "categoria", { id, acao: "alterada", campos: Object.keys(patch) });
  return data;
}

/**
 * Remover só vale para categoria nunca usada (a FK dos protocolos é `restrict`); usada, a
 * resposta ensina a DESATIVAR — o histórico dos protocolos não pode perder a categoria.
 */
export async function removerCategoria(db: SB, ctx: HandlerCtx, userId: string, id: string) {
  const { data, error } = await db
    .from("protocolo_categorias")
    .delete()
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error?.code === "23503") {
    throw new ApiError(409, "categoria_em_uso", undefined, ctx.requestId, "Esta categoria já tem protocolos. Desative-a em vez de remover.");
  }
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Categoria não encontrada.");
  await auditarConfig(ctx, userId, "categoria", { id, acao: "removida" });
  return { id };
}

export async function adicionarMembro(
  db: SB,
  admin: SB,
  ctx: HandlerCtx,
  userId: string,
  corpo: { area: string; user_id: string; papel?: "membro" | "lider" },
) {
  await conferirArea(admin, ctx, corpo.area);
  const { data, error } = await db
    .from("protocolo_area_membros")
    .insert({ ...corpo, papel: corpo.papel ?? "membro", organization_id: ctx.organization_id })
    .select("id, area, user_id, papel")
    .single();
  if (error?.code === "23505") {
    throw new ApiError(409, "conflict", undefined, ctx.requestId, "Essa pessoa já está nessa área, ou a área já tem líder.");
  }
  falha(error, ctx);
  await auditarConfig(ctx, userId, "membro", { area: corpo.area, user_id: corpo.user_id, papel: corpo.papel ?? "membro" });
  return data;
}

export async function removerLinhaDeConfig(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  tabela: "protocolo_area_membros" | "protocolo_feriados",
  id: string,
) {
  const { data, error } = await db
    .from(tabela)
    .delete()
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Registro não encontrado.");
  await auditarConfig(ctx, userId, tabela === "protocolo_area_membros" ? "membro" : "feriado", { id, acao: "removido" });
  return { id };
}

export async function adicionarFeriado(db: SB, ctx: HandlerCtx, userId: string, corpo: { data: string; descricao: string }) {
  const { data, error } = await db
    .from("protocolo_feriados")
    .insert({ ...corpo, organization_id: ctx.organization_id })
    .select("id, data, descricao")
    .single();
  if (error?.code === "23505") throw new ApiError(409, "conflict", undefined, ctx.requestId, "Já existe um feriado nesse dia.");
  falha(error, ctx);
  await auditarConfig(ctx, userId, "feriado", { data: corpo.data });
  return data;
}
