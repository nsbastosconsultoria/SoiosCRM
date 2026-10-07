/**
 * O VIGIA DA IMPLANTAÇÃO (spec 23 §5.5) — uma vez por dia.
 *
 * Para cada implantação em andamento com item vencido (prazo antes de hoje, no fuso da
 * organização) e ainda aberto, abre UM aviso `implantacao_atrasada` na Central, com o nome da
 * empresa e quantos itens vencidos estão com a equipe, com o cliente e com terceiros. Enquanto
 * houver um aviso aberto para a mesma implantação, não abre outro: o sino que toca todo dia pelo
 * mesmo atraso ensina a ignorá-lo.
 *
 * O texto não leva observação nem evidência dos itens — só contagens e o nome da empresa (pessoa
 * jurídica). Instalação sem o módulo: a tabela não existe, e a rodada responde
 * `modulo_instalado: false`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { hojeNoFuso } from "./servico";
import { ESTADOS_QUE_FECHAM, type EstadoDoItem, type VezDe } from "./vocabulario";

type SB = SupabaseClient;

/** Teto por rodada. Sobra volta amanhã. */
const LIMITE_DA_VARREDURA = 1000;

export interface ResultadoDoVigia {
  modulo_instalado: boolean;
  examinadas: number;
  avisos: number;
}

function ausente(erro: { code?: string } | null): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

/** Os vencidos de uma implantação, por de quem é a vez. */
export function vencidosPorVez(
  itens: ReadonlyArray<{ estado: EstadoDoItem; prazo: string | null; vez_de: VezDe }>,
  hoje: string,
): Record<VezDe, number> {
  const contagem: Record<VezDe, number> = { escritorio: 0, cliente: 0, terceiro: 0 };
  for (const i of itens) {
    if (i.prazo !== null && i.prazo < hoje && !ESTADOS_QUE_FECHAM.includes(i.estado)) contagem[i.vez_de] += 1;
  }
  return contagem;
}

export function textoDoAviso(empresa: string | null, vencidos: Record<VezDe, number>): { title: string; body: string } {
  const total = vencidos.escritorio + vencidos.cliente + vencidos.terceiro;
  const partes = [
    vencidos.escritorio ? `${vencidos.escritorio} com a equipe` : null,
    vencidos.cliente ? `${vencidos.cliente} com o cliente` : null,
    vencidos.terceiro ? `${vencidos.terceiro} com terceiros` : null,
  ].filter(Boolean);
  return {
    title: `Implantação de ${empresa ?? "uma empresa"}: ${total} ${total === 1 ? "item vencido" : "itens vencidos"}`,
    body: `${partes.join(", ")}. Abra a implantação para cobrar quem está com a vez ou ajustar o prazo.`,
  };
}

export async function rodarVigia(admin: SB, agora: Date, requestId: string): Promise<ResultadoDoVigia> {
  const resultado: ResultadoDoVigia = { modulo_instalado: true, examinadas: 0, avisos: 0 };

  const { data, error } = await admin
    .from("implantacoes")
    .select("id, organization_id, company_id")
    .eq("estado", "em_andamento")
    .order("iniciada_em", { ascending: true })
    .limit(LIMITE_DA_VARREDURA);
  if (ausente(error)) return { ...resultado, modulo_instalado: false };
  if (error) throw new Error(`vigia_da_implantacao: ${error.message}`);
  const implantacoes = (data ?? []) as Array<{ id: string; organization_id: string; company_id: string }>;
  resultado.examinadas = implantacoes.length;
  if (implantacoes.length === 0) return resultado;

  const fusos = new Map<string, string>();
  async function hojeDa(org: string): Promise<string> {
    if (!fusos.has(org)) {
      const { data: o } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
      fusos.set(org, (o as { timezone?: string | null } | null)?.timezone ?? "America/Sao_Paulo");
    }
    return hojeNoFuso(agora, fusos.get(org));
  }

  for (const imp of implantacoes) {
    const hoje = await hojeDa(imp.organization_id);
    const { data: itens, error: erroItens } = await admin
      .from("implantacao_itens")
      .select("estado, prazo, vez_de")
      .eq("organization_id", imp.organization_id)
      .eq("implantacao_id", imp.id)
      .lt("prazo", hoje);
    if (erroItens) {
      logger.error("[implantacao-watcher] itens não lidos", { implantacao_id: imp.id, error: erroItens.message, requestId });
      continue;
    }
    const vencidos = vencidosPorVez((itens ?? []) as Array<{ estado: EstadoDoItem; prazo: string | null; vez_de: VezDe }>, hoje);
    if (vencidos.escritorio + vencidos.cliente + vencidos.terceiro === 0) continue;

    const { data: jaTem } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", imp.organization_id)
      .eq("kind", "implantacao_atrasada")
      .eq("ref_id", imp.id)
      .eq("status", "open")
      .maybeSingle();
    if (jaTem) continue;

    const { data: empresa } = await admin
      .from("companies")
      .select("legal_name, trade_name")
      .eq("organization_id", imp.organization_id)
      .eq("id", imp.company_id)
      .maybeSingle();
    const e = empresa as { legal_name?: string | null; trade_name?: string | null } | null;
    const { title, body } = textoDoAviso(e?.trade_name || e?.legal_name || null, vencidos);
    const { error: erroAviso } = await admin.from("agent_inbox_items").insert({
      organization_id: imp.organization_id,
      kind: "implantacao_atrasada",
      severity: "warn",
      title,
      body,
      ref_kind: "implantacao",
      ref_id: imp.id,
    });
    if (erroAviso) {
      logger.error("[implantacao-watcher] aviso não foi aberto", { implantacao_id: imp.id, error: erroAviso.message, requestId });
      continue;
    }
    resultado.avisos += 1;
  }
  return resultado;
}
