/**
 * Serviço do módulo implantacao (spec 23). Duas mãos, como a carteira e os protocolos:
 *
 *   - `db` é o cliente da SESSÃO: lê (a RLS recorta a organização) e escreve a configuração
 *     (modelos e itens de modelo), que a RLS só deixa o `admin` escrever;
 *   - `admin` é o service role: inicia, conclui e cancela pelas funções do banco (só ele as
 *     executa) e altera os itens (a sessão só lê). Toda query dele filtra `organization_id`.
 *
 * As regras moram no banco (migration 0907) — a trava da ativação, as transições do item, a
 * evidência, a dispensa. Aqui ficam só as que dependem de PAPEL (dispensar é de gestor), que o
 * gatilho não enxerga com o service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { areasDaOrganizacao } from "@/lib/atendimento/areas";
import { audit } from "@/lib/audit";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import type { createAdminClient } from "@/lib/supabase/admin";

import { lancarErroDaImplantacao, moduloImplantacaoAusente, type ErroDoBanco } from "./erros";
import { MODELOS_DE_IMPLANTACAO } from "./modelos";
import type {
  EntradaDeInicio,
  EntradaDeItemDeModelo,
  EntradaDeModelo,
  ModeloDeNicho,
  PatchDoItem,
} from "./schemas";
import { ESTADOS_QUE_FECHAM, type EstadoDaImplantacao, type EstadoDoItem, type VezDe } from "./vocabulario";

type SB = SupabaseClient;
export type Admin = ReturnType<typeof createAdminClient>;

export interface Ator {
  userId: string;
  role: Role;
}

function falha(erro: ErroDoBanco | null, ctx: HandlerCtx): void {
  if (erro) lancarErroDaImplantacao(erro, ctx.requestId);
}

function naoEncontrado(ctx: HandlerCtx, mensagem = "Implantação não encontrada."): never {
  throw new ApiError(404, "not_found", undefined, ctx.requestId, mensagem);
}

/** `AAAA-MM-DD` de hoje no fuso (sem fuso, America/Sao_Paulo). */
export function hojeNoFuso(agora: Date, fuso: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: fuso || "America/Sao_Paulo" }).format(agora);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  }
}

async function fusoDaOrganizacao(db: SB, ctx: HandlerCtx): Promise<string | null> {
  const { data } = await db.from("organizations").select("timezone").eq("id", ctx.organization_id).maybeSingle();
  return (data as { timezone?: string | null } | null)?.timezone ?? null;
}

function nomeDaEmpresa(e: { trade_name?: string | null; legal_name?: string | null } | undefined): string | null {
  return e?.trade_name || e?.legal_name || null;
}

// ─── leitura ─────────────────────────────────────────────────────────────────

export type LinhaDoItem = {
  id: string;
  implantacao_id: string;
  estado: EstadoDoItem;
  obrigatorio: boolean;
  prazo: string | null;
  vez_de: VezDe;
  responsavel_user_id: string | null;
};

/** O resumo que a lista e o cartão da carteira mostram (spec 23 §8). */
export function resumoDosItens(itens: readonly Omit<LinhaDoItem, "id" | "implantacao_id">[], hoje: string) {
  const fechado = (e: EstadoDoItem) => ESTADOS_QUE_FECHAM.includes(e);
  const obrigatorios = itens.filter((i) => i.obrigatorio);
  const abertos = itens.filter((i) => !fechado(i.estado));
  return {
    obrigatorios: obrigatorios.length,
    obrigatorios_fechados: obrigatorios.filter((i) => fechado(i.estado)).length,
    itens: itens.length,
    itens_fechados: itens.length - abertos.length,
    vencidos: abertos.filter((i) => i.prazo !== null && i.prazo < hoje).length,
    aguardando_cliente: abertos.filter((i) => i.estado === "aguardando_cliente").length,
    aguardando_terceiro: abertos.filter((i) => i.estado === "aguardando_terceiro").length,
    pode_concluir: obrigatorios.every((i) => fechado(i.estado)),
  };
}

export type VisaoDaLista = "todas" | "minhas" | "atrasadas" | "aguardando_cliente";

export async function listarImplantacoes(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  filtros: { estado?: EstadoDaImplantacao; visao?: VisaoDaLista; company_id?: string; limite?: number },
) {
  const limite = Math.min(Math.max(filtros.limite ?? 100, 1), 200);
  let q = db
    .from("implantacoes")
    .select("id, company_id, estado, origem, responsavel_user_id, iniciada_em, prevista_para, concluida_em, cancelada_em")
    .eq("organization_id", ctx.organization_id)
    .order("iniciada_em", { ascending: false })
    .limit(limite);
  if (filtros.company_id) q = q.eq("company_id", filtros.company_id);
  else q = q.eq("estado", filtros.estado ?? "em_andamento");
  const { data, error } = await q;
  falha(error, ctx);
  const implantacoes = (data ?? []) as Array<{
    id: string;
    company_id: string;
    estado: EstadoDaImplantacao;
    origem: string;
    responsavel_user_id: string | null;
    iniciada_em: string;
    prevista_para: string | null;
    concluida_em: string | null;
    cancelada_em: string | null;
  }>;
  if (implantacoes.length === 0) return [];

  const ids = implantacoes.map((i) => i.id);
  const [itens, empresas, fuso] = await Promise.all([
    db
      .from("implantacao_itens")
      .select("id, implantacao_id, estado, obrigatorio, prazo, vez_de, responsavel_user_id")
      .eq("organization_id", ctx.organization_id)
      .in("implantacao_id", ids),
    db
      .from("companies")
      .select("id, legal_name, trade_name")
      .eq("organization_id", ctx.organization_id)
      .in("id", [...new Set(implantacoes.map((i) => i.company_id))]),
    fusoDaOrganizacao(db, ctx),
  ]);
  falha(itens.error, ctx);
  falha(empresas.error, ctx);
  const hoje = hojeNoFuso(new Date(), fuso);
  const itensPorImplantacao = new Map<string, LinhaDoItem[]>();
  for (const it of (itens.data ?? []) as LinhaDoItem[]) {
    const lista = itensPorImplantacao.get(it.implantacao_id) ?? [];
    lista.push(it);
    itensPorImplantacao.set(it.implantacao_id, lista);
  }
  const empresaPorId = new Map(
    ((empresas.data ?? []) as Array<{ id: string; legal_name: string | null; trade_name: string | null }>).map((e) => [e.id, e]),
  );

  const linhas = implantacoes.map((imp) => {
    const seus = itensPorImplantacao.get(imp.id) ?? [];
    return {
      ...imp,
      empresa: nomeDaEmpresa(empresaPorId.get(imp.company_id)),
      resumo: resumoDosItens(seus, hoje),
      minha:
        imp.responsavel_user_id === userId ||
        seus.some((i) => i.responsavel_user_id === userId && !ESTADOS_QUE_FECHAM.includes(i.estado)),
    };
  });

  switch (filtros.visao ?? "todas") {
    case "minhas":
      return linhas.filter((l) => l.minha);
    case "atrasadas":
      return linhas.filter((l) => l.resumo.vencidos > 0);
    case "aguardando_cliente":
      return linhas.filter((l) => l.resumo.aguardando_cliente > 0);
    default:
      return linhas;
  }
}

export async function lerImplantacao(db: SB, ctx: HandlerCtx, id: string) {
  const { data, error } = await db
    .from("implantacoes")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx);
  const imp = data as { company_id: string; modelo_id: string | null } & Record<string, unknown>;

  const [itens, eventos, empresa, perfil, modelo, fuso] = await Promise.all([
    db
      .from("implantacao_itens")
      .select(
        "id, grupo, titulo, orientacao, posicao, obrigatorio, vez_de, area, exige_evidencia, prazo, estado, " +
          "responsavel_user_id, observacao, evidencia, motivo_dispensa, concluido_em, concluido_por, estado_desde, revision",
      )
      .eq("organization_id", ctx.organization_id)
      .eq("implantacao_id", id)
      .order("posicao")
      .order("titulo"),
    db
      .from("implantacao_eventos")
      .select("id, item_id, tipo, anterior, novo, ator_kind, ator_user_id, created_at")
      .eq("organization_id", ctx.organization_id)
      .eq("implantacao_id", id)
      .order("created_at", { ascending: true })
      .limit(500),
    db.from("companies").select("id, legal_name, trade_name, cnpj").eq("organization_id", ctx.organization_id).eq("id", imp.company_id).maybeSingle(),
    db.from("carteira_perfis").select("estado, cliente_desde").eq("organization_id", ctx.organization_id).eq("company_id", imp.company_id).maybeSingle(),
    imp.modelo_id
      ? db.from("implantacao_modelos").select("id, nome").eq("organization_id", ctx.organization_id).eq("id", imp.modelo_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    fusoDaOrganizacao(db, ctx),
  ]);
  for (const r of [itens, eventos, empresa, perfil, modelo]) falha(r.error, ctx);
  const linhasDosItens = (itens.data ?? []) as unknown as LinhaDoItem[];
  return {
    implantacao: imp,
    empresa: empresa.data,
    carteira: perfil.data,
    modelo: modelo.data,
    itens: itens.data ?? [],
    eventos: eventos.data ?? [],
    resumo: resumoDosItens(linhasDosItens, hojeNoFuso(new Date(), fuso)),
    hoje: hojeNoFuso(new Date(), fuso),
  };
}

// ─── escrita ─────────────────────────────────────────────────────────────────

export async function iniciarImplantacao(admin: Admin, ctx: HandlerCtx, ator: Ator, entrada: EntradaDeInicio, origem: "manual" | "negocio_ganho" = "manual", leadId: string | null = null) {
  let modeloId = entrada.modelo_id;
  if (!modeloId) {
    const { data, error } = await admin
      .from("implantacao_modelos")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("padrao", true)
      .eq("ativo", true)
      .maybeSingle();
    falha(error, ctx);
    if (!data) {
      throw new ApiError(
        422,
        "implantacao_sem_modelo_padrao",
        undefined,
        ctx.requestId,
        "Não há modelo de implantação padrão. Crie um em Configurações › Implantação ou escolha um modelo.",
      );
    }
    modeloId = (data as { id: string }).id;
  }

  const { data, error } = await admin.rpc("fn_implantacao_iniciar", {
    p_org: ctx.organization_id,
    p_company: entrada.company_id,
    p_modelo: modeloId,
    p_origem: origem,
    p_lead: leadId,
    p_responsavel: entrada.responsavel_user_id ?? ator.userId,
    p_ator: ator.userId,
  });
  falha(error, ctx);
  const r = data as { implantacao_id: string; criada: boolean; itens?: number };
  if (r.criada) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: ator.userId,
      action: "implantacao.iniciada",
      resourceType: "implantacoes",
      resourceId: r.implantacao_id,
      requestId: ctx.requestId,
      metadata: { company_id: entrada.company_id, modelo_id: modeloId, origem, itens: r.itens ?? null },
    });
  }
  return r;
}

/**
 * Altera um item. O banco confere a transição, a evidência e a dispensa; aqui, só o PAPEL:
 * dispensar e tirar da dispensa são de gestor (§5.2 — a dispensa formal do §25.3).
 */
export async function alterarItem(admin: Admin, ctx: HandlerCtx, ator: Ator, implantacaoId: string, itemId: string, patch: PatchDoItem) {
  const { data: atual, error } = await admin
    .from("implantacao_itens")
    .select("id, estado")
    .eq("organization_id", ctx.organization_id)
    .eq("implantacao_id", implantacaoId)
    .eq("id", itemId)
    .maybeSingle();
  falha(error, ctx);
  if (!atual) naoEncontrado(ctx, "Item não encontrado.");
  const estadoAtual = (atual as { estado: EstadoDoItem }).estado;
  const mexeNaDispensa = patch.estado === "dispensado" || (estadoAtual === "dispensado" && patch.estado !== undefined);
  if (mexeNaDispensa && ROLE_RANK[ator.role] < ROLE_RANK.manager) {
    throw new ApiError(403, "dispensa_exige_gestor", undefined, ctx.requestId, "Só gestor pode dispensar um item ou tirá-lo da dispensa.");
  }

  const mudancas: Record<string, unknown> = { alterado_por: ator.userId };
  for (const campo of ["estado", "responsavel_user_id", "prazo", "observacao", "evidencia", "motivo_dispensa"] as const) {
    if (patch[campo] !== undefined) mudancas[campo] = patch[campo] === "" ? null : patch[campo];
  }
  const { data: gravado, error: erroGravar } = await admin
    .from("implantacao_itens")
    .update(mudancas)
    .eq("organization_id", ctx.organization_id)
    .eq("id", itemId)
    .eq("revision", patch.revision)
    .select("id, estado, revision")
    .maybeSingle();
  falha(erroGravar, ctx);
  if (!gravado) {
    throw new ApiError(409, "revision_conflict", undefined, ctx.requestId, "O item mudou enquanto você editava. Recarregue e tente de novo.");
  }
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: ator.userId,
    action: "implantacao.item_alterado",
    resourceType: "implantacao_itens",
    resourceId: itemId,
    requestId: ctx.requestId,
    metadata: { implantacao_id: implantacaoId, campos: Object.keys(mudancas).filter((c) => c !== "alterado_por"), de: estadoAtual, para: patch.estado ?? estadoAtual },
  });
  return gravado;
}

export async function concluirImplantacao(admin: Admin, ctx: HandlerCtx, userId: string, id: string) {
  const { data, error } = await admin.rpc("fn_implantacao_concluir", { p_org: ctx.organization_id, p_implantacao: id, p_ator: userId });
  falha(error, ctx);
  const r = data as { ativou: boolean; cliente_desde: string | null };
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "implantacao.concluida",
    resourceType: "implantacoes",
    resourceId: id,
    requestId: ctx.requestId,
    metadata: { ativou: r.ativou },
  });
  return r;
}

export async function cancelarImplantacao(admin: Admin, ctx: HandlerCtx, userId: string, id: string, motivo: string, inativar: boolean) {
  const { data, error } = await admin.rpc("fn_implantacao_cancelar", {
    p_org: ctx.organization_id,
    p_implantacao: id,
    p_motivo: motivo,
    p_inativar: inativar,
    p_ator: userId,
  });
  falha(error, ctx);
  const r = data as { inativou: boolean };
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "implantacao.cancelada",
    resourceType: "implantacoes",
    resourceId: id,
    requestId: ctx.requestId,
    metadata: { inativou: r.inativou },
  });
  return r;
}

/**
 * Para a carteira (spec 23 Q2): a implantação em andamento da empresa e quantos obrigatórios
 * estão abertos. `null` sem o módulo instalado ou sem implantação em andamento.
 */
export async function obrigatoriosAbertosDaEmpresa(
  admin: Admin,
  organizationId: string,
  companyId: string,
): Promise<{ implantacao_id: string; abertos: number } | null> {
  const { data, error } = await admin
    .from("implantacoes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .eq("estado", "em_andamento")
    .maybeSingle();
  if (error) {
    if (moduloImplantacaoAusente(error)) return null;
    throw new Error(`implantacao: ${error.message}`);
  }
  if (!data) return null;
  const id = (data as { id: string }).id;
  const { count, error: erroItens } = await admin
    .from("implantacao_itens")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("implantacao_id", id)
    .eq("obrigatorio", true)
    .not("estado", "in", `(${ESTADOS_QUE_FECHAM.join(",")})`);
  if (erroItens) throw new Error(`implantacao: ${erroItens.message}`);
  return { implantacao_id: id, abertos: count ?? 0 };
}

// ─── configuração ────────────────────────────────────────────────────────────

export async function lerConfiguracao(db: SB, ctx: HandlerCtx) {
  const [modelos, itens, org] = await Promise.all([
    db.from("implantacao_modelos").select("*").eq("organization_id", ctx.organization_id).order("nome"),
    db.from("implantacao_modelo_itens").select("*").eq("organization_id", ctx.organization_id).order("posicao").order("titulo"),
    db.from("organizations").select("settings").eq("id", ctx.organization_id).maybeSingle(),
  ]);
  falha(modelos.error, ctx);
  falha(itens.error, ctx);
  return {
    modelos: modelos.data ?? [],
    itens: itens.data ?? [],
    areas: areasDaOrganizacao((org.data as { settings?: unknown } | null)?.settings),
  };
}

async function auditarConfig(ctx: HandlerCtx, userId: string, metadata: Record<string, unknown>) {
  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "implantacao.config_alterada",
    resourceType: "implantacao_modelos",
    requestId: ctx.requestId,
    metadata,
  });
}

/** Cria ou altera um modelo. Marcar como padrão tira o padrão do outro (um por organização). */
export async function salvarModelo(db: SB, ctx: HandlerCtx, userId: string, entrada: EntradaDeModelo) {
  if (entrada.padrao) {
    let q = db.from("implantacao_modelos").update({ padrao: false }).eq("organization_id", ctx.organization_id).eq("padrao", true);
    if (entrada.id) q = q.neq("id", entrada.id);
    const { error } = await q;
    falha(error, ctx);
  }
  const linha = { nome: entrada.nome, padrao: entrada.padrao, ativo: entrada.ativo };
  const { data, error } = entrada.id
    ? await db.from("implantacao_modelos").update(linha).eq("organization_id", ctx.organization_id).eq("id", entrada.id).select("*").maybeSingle()
    : await db.from("implantacao_modelos").insert({ ...linha, organization_id: ctx.organization_id }).select("*").maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Modelo não encontrado.");
  await auditarConfig(ctx, userId, { modelo: entrada.id ? "alterado" : "criado" });
  return data;
}

export async function salvarItemDeModelo(db: SB, ctx: HandlerCtx, userId: string, entrada: EntradaDeItemDeModelo) {
  const linha = {
    modelo_id: entrada.modelo_id,
    grupo: entrada.grupo,
    titulo: entrada.titulo,
    orientacao: entrada.orientacao ?? null,
    posicao: entrada.posicao,
    obrigatorio: entrada.obrigatorio,
    vez_de: entrada.vez_de,
    area: entrada.area ?? null,
    prazo_dias: entrada.prazo_dias ?? null,
    exige_evidencia: entrada.exige_evidencia,
  };
  const { data, error } = entrada.id
    ? await db.from("implantacao_modelo_itens").update(linha).eq("organization_id", ctx.organization_id).eq("id", entrada.id).select("*").maybeSingle()
    : await db.from("implantacao_modelo_itens").insert({ ...linha, organization_id: ctx.organization_id }).select("*").maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Item do modelo não encontrado.");
  await auditarConfig(ctx, userId, { item_de_modelo: entrada.id ? "alterado" : "criado" });
  return data;
}

/** Tirar um item do MODELO não mexe nas implantações já começadas: os itens delas são cópias. */
export async function removerItemDeModelo(db: SB, ctx: HandlerCtx, userId: string, itemId: string) {
  const { data, error } = await db
    .from("implantacao_modelo_itens")
    .delete()
    .eq("organization_id", ctx.organization_id)
    .eq("id", itemId)
    .select("id")
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Item do modelo não encontrado.");
  await auditarConfig(ctx, userId, { item_de_modelo: "removido" });
  return { removido: true };
}

/**
 * Aplica o modelo de nicho: cria o modelo e os itens. Já existindo um modelo com esse nome, não
 * toca em nada (`criado: false`). Vira o padrão se a organização ainda não tem um.
 */
export async function aplicarModeloDeNicho(db: SB, ctx: HandlerCtx, userId: string, nicho: ModeloDeNicho) {
  const definido = MODELOS_DE_IMPLANTACAO[nicho];
  const { data: existentes, error } = await db
    .from("implantacao_modelos")
    .select("id, nome, padrao")
    .eq("organization_id", ctx.organization_id);
  falha(error, ctx);
  const lista = (existentes ?? []) as Array<{ id: string; nome: string; padrao: boolean }>;
  const mesmo = lista.find((m) => m.nome.trim().toLowerCase() === definido.nome.toLowerCase());
  if (mesmo) return { criado: false, modelo_id: mesmo.id };

  const { data: modelo, error: erroModelo } = await db
    .from("implantacao_modelos")
    .insert({ organization_id: ctx.organization_id, nome: definido.nome, padrao: !lista.some((m) => m.padrao) })
    .select("id")
    .single();
  falha(erroModelo, ctx);
  const modeloId = (modelo as { id: string }).id;
  const { error: erroItens } = await db.from("implantacao_modelo_itens").insert(
    definido.itens.map((it, posicao) => ({
      organization_id: ctx.organization_id,
      modelo_id: modeloId,
      grupo: it.grupo,
      titulo: it.titulo,
      orientacao: it.orientacao ?? null,
      posicao,
      obrigatorio: it.obrigatorio,
      vez_de: it.vez_de,
      area: it.area,
      prazo_dias: it.prazo_dias,
      exige_evidencia: it.exige_evidencia,
    })),
  );
  falha(erroItens, ctx);
  await auditarConfig(ctx, userId, { modelo_de_nicho: nicho, itens: definido.itens.length });
  return { criado: true, modelo_id: modeloId };
}
