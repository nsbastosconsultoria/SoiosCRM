/**
 * Carteira de empresas — as operações que a API expõe (spec 21 §9).
 *
 * Um lugar só para a regra de COMO se usa o schema da migration 0902; as rotas só autenticam,
 * validam a forma e chamam daqui. O schema já recusa o que é inválido (transição, organização
 * cruzada, segundo responsável principal) — este arquivo não reimplementa essas recusas, só as
 * traduz (`lancarErroDaCarteira`).
 *
 * Dois clientes, e a diferença importa:
 *   - `db` é o cliente da SESSÃO: a RLS da 0902 (e a do núcleo, em `company_people`) vale como
 *     segunda cerca, por cima do `requireRole` da rota;
 *   - `admin` é o service role, usado SÓ para `fn_carteira_transicionar`, que é executável só por
 *     ele. O `organization_id` vem do `authz` (cookie validado), nunca do corpo.
 *
 * O VÍNCULO É DO NÚCLEO (spec 21 §4.4): contato → `contacts.person_id` → `company_people`. Este
 * módulo só grava o detalhe (`carteira_vinculo_detalhes`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { createCompanyHandler, getCompanyHandler } from "@/lib/crm-b2b/companies-handler";
import { normalizeCnpj } from "@/lib/crm-b2b/normalize";

import { areasDaOrganizacao, type Area } from "./areas";
import { lancarErroDaCarteira, type ErroDoBanco } from "./erros";
import type {
  EmpresaNovaNaCarteira,
  PatchDoPerfil,
  PatchDoVinculo,
  ResponsavelNovo,
  VinculoNovo,
} from "./schemas";
import type { EstadoDaCarteira } from "./vocabulario";

type SB = SupabaseClient;

const SELECT_DO_PERFIL =
  "company_id, estado, cliente_desde, grupo_id, tipo_estabelecimento, matriz_company_id, atributos, estado_alterado_em, updated_at";

function falha(erro: ErroDoBanco | null, ctx: HandlerCtx): void {
  if (erro) lancarErroDaCarteira(erro, ctx.requestId);
}

function naoEncontrado(ctx: HandlerCtx, mensagem: string): never {
  throw new ApiError(404, "not_found", undefined, ctx.requestId, mensagem);
}

function invalido(ctx: HandlerCtx, mensagem: string): never {
  throw new ApiError(422, "validation_failed", undefined, ctx.requestId, mensagem);
}

async function areasDaOrg(db: SB, ctx: HandlerCtx): Promise<readonly Area[]> {
  const { data } = await db
    .from("organizations")
    .select("settings")
    .eq("id", ctx.organization_id)
    .maybeSingle();
  return areasDaOrganizacao((data as { settings?: unknown } | null)?.settings);
}

async function conferirAreas(db: SB, ctx: HandlerCtx, areas: readonly string[]): Promise<void> {
  if (areas.length === 0) return;
  const validas = new Set((await areasDaOrg(db, ctx)).map((a) => a.slug));
  const fora = areas.filter((a) => !validas.has(a));
  if (fora.length > 0) invalido(ctx, `Área desconhecida nesta organização: ${fora.join(", ")}.`);
}

// ─── lista ───────────────────────────────────────────────────────────────────

export async function listarCarteira(
  db: SB,
  ctx: HandlerCtx,
  filtros: { estado?: EstadoDaCarteira; q?: string; limite?: number },
) {
  const limite = Math.min(Math.max(filtros.limite ?? 50, 1), 200);
  let consulta = db
    .from("carteira_perfis")
    .select(
      `${SELECT_DO_PERFIL}, empresa:companies!carteira_perfis_company_id_fkey!inner(id, legal_name, trade_name, cnpj, city, state)`,
    )
    .eq("organization_id", ctx.organization_id)
    .order("estado_alterado_em", { ascending: false })
    .limit(limite + 1);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);
  const termo = filtros.q?.trim().replace(/[%,()]/g, " ");
  if (termo) {
    const digitos = normalizeCnpj(termo) ?? termo.replace(/\D/g, "");
    const partes = [`legal_name.ilike.%${termo}%`, `trade_name.ilike.%${termo}%`];
    if (digitos.length >= 4) partes.push(`normalized_cnpj.ilike.%${digitos}%`);
    consulta = consulta.or(partes.join(","), { referencedTable: "empresa" });
  }
  const { data, error } = await consulta;
  falha(error, ctx);
  const linhas = data ?? [];
  return { empresas: linhas.slice(0, limite), tem_mais: linhas.length > limite };
}

// ─── empresa entra na carteira ───────────────────────────────────────────────

/**
 * Põe uma empresa na carteira. Com CNPJ de empresa que já existe na organização, reaproveita a
 * linha (nunca duplica — o índice único do núcleo também não deixaria); sem ela, cria pelo
 * mesmo caminho da tela de Empresas (`createCompanyHandler`, com enriquecimento da BrasilAPI).
 * `estado_inicial = 'ativo'` é a carga da carteira de quem já é cliente: passa pela função de
 * transição como qualquer outra mudança.
 */
export async function adicionarEmpresa(
  db: SB,
  admin: SB,
  ctx: HandlerCtx,
  userId: string,
  corpo: EmpresaNovaNaCarteira,
) {
  let companyId: string | null = corpo.company_id ?? null;

  if (!companyId && corpo.cnpj) {
    const normalizado = normalizeCnpj(corpo.cnpj);
    if (!normalizado) invalido(ctx, "CNPJ inválido.");
    const { data: existente } = await db
      .from("companies")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("normalized_cnpj", normalizado)
      .maybeSingle();
    companyId = (existente as { id: string } | null)?.id ?? null;
  }

  if (companyId) {
    const { data: existe } = await db
      .from("companies")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("id", companyId)
      .maybeSingle();
    if (!existe) naoEncontrado(ctx, "Empresa não encontrada.");
  } else {
    if (!corpo.cnpj && !corpo.legal_name) invalido(ctx, "Informe o CNPJ ou o nome da empresa.");
    const criada = await createCompanyHandler(db, ctx, userId, {
      cnpj: corpo.cnpj ?? null,
      legal_name: corpo.legal_name ?? null,
    });
    companyId = (criada as { id: string }).id;
  }

  const { error } = await db
    .from("carteira_perfis")
    .upsert(
      { company_id: companyId, organization_id: ctx.organization_id, alterado_por: userId },
      { onConflict: "company_id", ignoreDuplicates: true },
    );
  falha(error, ctx);

  if (corpo.estado_inicial && corpo.estado_inicial !== "prospect") {
    await transicionar(admin, ctx, userId, companyId, corpo.estado_inicial);
  }

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.empresa_adicionada",
    resourceType: "companies",
    resourceId: companyId,
    requestId: ctx.requestId,
    metadata: { estado_inicial: corpo.estado_inicial ?? "prospect" },
  });

  const { data: perfil, error: erroLeitura } = await db
    .from("carteira_perfis")
    .select(SELECT_DO_PERFIL)
    .eq("organization_id", ctx.organization_id)
    .eq("company_id", companyId)
    .single();
  falha(erroLeitura, ctx);
  return perfil;
}

// ─── ficha ───────────────────────────────────────────────────────────────────

export async function detalheDaEmpresa(db: SB, ctx: HandlerCtx, companyId: string) {
  const { data: perfil, error } = await db
    .from("carteira_perfis")
    .select(SELECT_DO_PERFIL)
    .eq("organization_id", ctx.organization_id)
    .eq("company_id", companyId)
    .maybeSingle();
  falha(error, ctx);
  if (!perfil) naoEncontrado(ctx, "Esta empresa não está na carteira.");

  // Empresa, pessoas ligadas (company_people) e os contatos de cada pessoa: a leitura do núcleo.
  const nucleo = await getCompanyHandler(db, ctx, companyId);
  const vinculoIds = (nucleo.people as Array<{ id: string }>).map((p) => p.id);

  const [detalhes, responsaveis, eventos] = await Promise.all([
    vinculoIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db
          .from("carteira_vinculo_detalhes")
          .select("company_people_id, papel, areas, ativo, origem, updated_at")
          .eq("organization_id", ctx.organization_id)
          .in("company_people_id", vinculoIds),
    db
      .from("carteira_responsaveis")
      .select("id, area, user_id, principal, vigencia_inicio, vigencia_fim")
      .eq("organization_id", ctx.organization_id)
      .eq("company_id", companyId)
      .is("vigencia_fim", null)
      .order("area"),
    db
      .from("carteira_eventos")
      .select("id, tipo, anterior, novo, ator_kind, ator_user_id, person_id, conversation_id, created_at")
      .eq("organization_id", ctx.organization_id)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  falha(detalhes.error, ctx);
  falha(responsaveis.error, ctx);
  falha(eventos.error, ctx);

  return {
    empresa: nucleo.company,
    perfil,
    vinculos: nucleo.people,
    contatos: nucleo.contacts,
    detalhes: detalhes.data ?? [],
    responsaveis: responsaveis.data ?? [],
    eventos: eventos.data ?? [],
    areas: await areasDaOrg(db, ctx),
  };
}

// ─── perfil e estado ─────────────────────────────────────────────────────────

export async function atualizarPerfil(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  companyId: string,
  patch: PatchDoPerfil,
) {
  const { data, error } = await db
    .from("carteira_perfis")
    .update({ ...patch, alterado_por: userId, updated_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization_id)
    .eq("company_id", companyId)
    .select(SELECT_DO_PERFIL)
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Esta empresa não está na carteira.");

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.perfil_atualizado",
    resourceType: "companies",
    resourceId: companyId,
    requestId: ctx.requestId,
    metadata: { campos: Object.keys(patch) },
  });
  return data;
}

/** A única porta do estado: `fn_carteira_transicionar`, que só o service role executa. */
export async function transicionar(
  admin: SB,
  ctx: HandlerCtx,
  userId: string,
  companyId: string,
  estado: EstadoDaCarteira,
) {
  const { data, error } = await admin.rpc("fn_carteira_transicionar", {
    p_org: ctx.organization_id,
    p_company: companyId,
    p_estado: estado,
    p_ator: userId,
  });
  falha(error, ctx);
  const resultado = data as { de: string; para: string; alterado: boolean; cliente_desde: string | null };

  if (resultado.alterado) {
    await audit({
      organizationId: ctx.organization_id,
      actorUserId: userId,
      action: "carteira.estado_alterado",
      resourceType: "companies",
      resourceId: companyId,
      requestId: ctx.requestId,
      metadata: { de: resultado.de, para: resultado.para },
    });
  }
  return resultado;
}

// ─── vínculos (o do núcleo + o detalhe do módulo) ────────────────────────────

/**
 * Liga um contato à empresa. O contato sem pessoa ganha uma, com o nome dele (ou o telefone);
 * a pessoa sem vínculo com a empresa ganha o `company_people`. Só então o detalhe do módulo.
 * Tudo pela sessão: `company_people` exige `manager`+ para inserir (RLS da 0239).
 */
export async function vincularContato(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  companyId: string,
  corpo: VinculoNovo,
) {
  await conferirAreas(db, ctx, corpo.areas ?? []);

  const { data: contato } = await db
    .from("contacts")
    .select("id, person_id, name, display_name, phone_number")
    .eq("organization_id", ctx.organization_id)
    .eq("id", corpo.contact_id)
    .is("is_merged_into", null)
    .maybeSingle();
  if (!contato) naoEncontrado(ctx, "Contato não encontrado.");
  const c = contato as {
    id: string;
    person_id: string | null;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
  };

  const { data: empresa } = await db
    .from("companies")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", companyId)
    .maybeSingle();
  if (!empresa) naoEncontrado(ctx, "Empresa não encontrada.");

  let personId = c.person_id;
  if (!personId) {
    const nome = (c.name || c.display_name || c.phone_number || "Contato").trim();
    const { data: pessoa, error } = await db
      .from("people")
      .insert({ organization_id: ctx.organization_id, full_name: nome, created_by: userId })
      .select("id")
      .single();
    falha(error, ctx);
    personId = (pessoa as { id: string }).id;
    const { error: erroContato } = await db
      .from("contacts")
      .update({ person_id: personId })
      .eq("organization_id", ctx.organization_id)
      .eq("id", c.id);
    falha(erroContato, ctx);
  }

  const { data: existente } = await db
    .from("company_people")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("company_id", companyId)
    .eq("person_id", personId)
    .maybeSingle();
  let companyPeopleId = (existente as { id: string } | null)?.id ?? null;
  if (!companyPeopleId) {
    const { data: criado, error } = await db
      .from("company_people")
      .insert({ organization_id: ctx.organization_id, company_id: companyId, person_id: personId })
      .select("id")
      .single();
    falha(error, ctx);
    companyPeopleId = (criado as { id: string }).id;
  }

  const { data: detalhe, error: erroDetalhe } = await db
    .from("carteira_vinculo_detalhes")
    .upsert(
      {
        company_people_id: companyPeopleId,
        organization_id: ctx.organization_id,
        papel: corpo.papel,
        areas: corpo.areas ?? [],
        ativo: true,
        origem: "manual",
        alterado_por: userId,
      },
      { onConflict: "company_people_id" },
    )
    .select("company_people_id, papel, areas, ativo, origem")
    .single();
  falha(erroDetalhe, ctx);

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.vinculo_criado",
    resourceType: "company_people",
    resourceId: companyPeopleId,
    requestId: ctx.requestId,
    metadata: { company_id: companyId, contact_id: c.id, person_id: personId, papel: corpo.papel },
  });

  return { company_people_id: companyPeopleId, person_id: personId, detalhe };
}

/**
 * Edita o detalhe de um vínculo — inclusive de um vínculo criado pela tela de Pessoas, que ainda
 * não tinha detalhe (por isso `upsert`). Desativar é `ativo: false`; nada se apaga.
 */
export async function atualizarVinculo(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  companyPeopleId: string,
  patch: PatchDoVinculo,
) {
  if (patch.areas) await conferirAreas(db, ctx, patch.areas);

  const { data: vinculo } = await db
    .from("company_people")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", companyPeopleId)
    .maybeSingle();
  if (!vinculo) naoEncontrado(ctx, "Vínculo não encontrado.");

  const { data: atual } = await db
    .from("carteira_vinculo_detalhes")
    .select("papel, areas, ativo")
    .eq("organization_id", ctx.organization_id)
    .eq("company_people_id", companyPeopleId)
    .maybeSingle();
  const base = (atual as { papel: string; areas: string[]; ativo: boolean } | null) ?? {
    papel: "outro",
    areas: [],
    ativo: true,
  };

  const { data, error } = await db
    .from("carteira_vinculo_detalhes")
    .upsert(
      {
        company_people_id: companyPeopleId,
        organization_id: ctx.organization_id,
        papel: patch.papel ?? base.papel,
        areas: patch.areas ?? base.areas,
        ativo: patch.ativo ?? base.ativo,
        alterado_por: userId,
      },
      { onConflict: "company_people_id" },
    )
    .select("company_people_id, papel, areas, ativo, origem")
    .single();
  falha(error, ctx);

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.vinculo_atualizado",
    resourceType: "company_people",
    resourceId: companyPeopleId,
    requestId: ctx.requestId,
    metadata: { campos: Object.keys(patch) },
  });
  return data;
}

// ─── responsáveis ────────────────────────────────────────────────────────────

/**
 * Define o responsável principal da empresa numa área. Trocar é encerrar a vigência do atual e
 * abrir outra linha — o gatilho recusa reescrever a pessoa de uma linha (quem cuidou da empresa
 * naquele período não se apaga). Definir de novo a mesma pessoa não muda nada.
 */
export async function definirResponsavel(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  companyId: string,
  corpo: ResponsavelNovo,
) {
  await conferirAreas(db, ctx, [corpo.area]);

  const { data: vigente } = await db
    .from("carteira_responsaveis")
    .select("id, user_id")
    .eq("organization_id", ctx.organization_id)
    .eq("company_id", companyId)
    .eq("area", corpo.area)
    .eq("principal", true)
    .is("vigencia_fim", null)
    .maybeSingle();
  const atual = vigente as { id: string; user_id: string } | null;
  if (atual?.user_id === corpo.user_id) return { id: atual.id, alterado: false };

  if (atual) {
    const { error } = await db
      .from("carteira_responsaveis")
      .update({ vigencia_fim: new Date().toISOString().slice(0, 10), alterado_por: userId })
      .eq("organization_id", ctx.organization_id)
      .eq("id", atual.id);
    falha(error, ctx);
  }

  const { data, error } = await db
    .from("carteira_responsaveis")
    .insert({
      organization_id: ctx.organization_id,
      company_id: companyId,
      area: corpo.area,
      user_id: corpo.user_id,
      principal: true,
      alterado_por: userId,
    })
    .select("id")
    .single();
  if (error?.code === "23503") invalido(ctx, "Essa pessoa não é membro desta organização.");
  falha(error, ctx);

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.responsavel_definido",
    resourceType: "companies",
    resourceId: companyId,
    requestId: ctx.requestId,
    metadata: { area: corpo.area, user_id: corpo.user_id, anterior: atual?.user_id ?? null },
  });
  return { id: (data as { id: string }).id, alterado: true };
}

export async function encerrarResponsavel(db: SB, ctx: HandlerCtx, userId: string, responsavelId: string) {
  const { data, error } = await db
    .from("carteira_responsaveis")
    .update({ vigencia_fim: new Date().toISOString().slice(0, 10), alterado_por: userId })
    .eq("organization_id", ctx.organization_id)
    .eq("id", responsavelId)
    .is("vigencia_fim", null)
    .select("id, company_id, area")
    .maybeSingle();
  falha(error, ctx);
  if (!data) naoEncontrado(ctx, "Responsável vigente não encontrado.");
  const r = data as { id: string; company_id: string; area: string };

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.responsavel_encerrado",
    resourceType: "companies",
    resourceId: r.company_id,
    requestId: ctx.requestId,
    metadata: { area: r.area, responsavel_id: r.id },
  });
  return r;
}

// ─── grupos ──────────────────────────────────────────────────────────────────

export async function listarGrupos(db: SB, ctx: HandlerCtx) {
  const { data, error } = await db
    .from("carteira_grupos")
    .select("id, nome, descricao, responsavel_user_id, ativo")
    .eq("organization_id", ctx.organization_id)
    .order("nome");
  falha(error, ctx);
  return data ?? [];
}

export async function criarGrupo(
  db: SB,
  ctx: HandlerCtx,
  userId: string,
  corpo: { nome: string; descricao?: string | null },
) {
  const { data, error } = await db
    .from("carteira_grupos")
    .insert({ organization_id: ctx.organization_id, nome: corpo.nome, descricao: corpo.descricao ?? null })
    .select("id, nome, descricao, responsavel_user_id, ativo")
    .single();
  falha(error, ctx);
  const grupo = data as { id: string; nome: string };

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: userId,
    action: "carteira.grupo_criado",
    resourceType: "carteira_grupos",
    resourceId: grupo.id,
    requestId: ctx.requestId,
    metadata: { nome: grupo.nome },
  });
  return data;
}
