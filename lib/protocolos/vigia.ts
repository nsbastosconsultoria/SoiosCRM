/**
 * O VIGIA DE PRAZO DOS PROTOCOLOS (spec 22 §10.5, §17).
 *
 * Para cada protocolo aberto com prazo, mede quanto do prazo já passou — em minutos ÚTEIS, pelo
 * mesmo relógio que o calculou (`sla.ts`) — e, ao cruzar 80%, 100% e 120%, registra o marco e
 * avisa a equipe na Central. Também acusa o protocolo que está numa fila sem ninguém.
 *
 * ═══ UMA VEZ POR MARCO ═══
 * A trava é a PK de `protocolo_marcos_sla` (protocolo, relógio, marco): o INSERT que bate na PK
 * (23505) é "já avisado", nunca um segundo aviso. O cron pode rodar de novo, ser repetido pelo
 * scheduler, ou duas réplicas podem rodar juntas — o banco decide quem avisa.
 *
 * Protocolo visto pela primeira vez já em 130% grava os três marcos e avisa UMA vez, pelo mais
 * alto: três avisos do mesmo atraso no mesmo minuto ensinam a ignorar o sino.
 *
 * ═══ SÓ NA CENTRAL ═══
 * O destinatário é a EQUIPE. O vigia nunca escreve para o cliente — e o texto do aviso não leva
 * título nem descrição do protocolo (dado sobre a pessoa): número, categoria e prazo bastam.
 *
 * Prazo PAUSADO (aguardando o cliente) não anda e não é medido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { expedienteDaOrganizacao, minutosUteisEntre, type Expediente } from "./sla";
import { ESTADOS_ABERTOS } from "./vocabulario";

type SB = SupabaseClient;

export const MARCOS = [80, 100, 120] as const;
export type Marco = (typeof MARCOS)[number];
export type Relogio = "primeira_resposta" | "resolucao";

/** Teto por rodada. Sobra volta na seguinte. */
const LIMITE_DA_VARREDURA = 500;
/** Fila sem ninguém só é aviso depois disto — protocolo recém-aberto ainda pode ser pego. */
const FILA_SEM_DONO_APOS_MS = 60 * 60 * 1000;

/**
 * Quanto do prazo passou, em fração (1 = venceu agora). Pelo que FALTA, e não pelo que passou
 * desde a abertura: o prazo de resolução já foi empurrado pelas pausas, então "o que falta até ele"
 * é a medida certa sem reconstruir a pausa. Depois de vencido, quanto passou além.
 */
export function fracaoDoPrazo(
  agora: Date,
  venceEm: Date,
  totalMin: number,
  relogio: Expediente | null,
  feriados: ReadonlySet<string>,
): number {
  if (totalMin <= 0) return 0;
  if (agora.getTime() <= venceEm.getTime()) {
    return 1 - minutosUteisEntre(agora, venceEm, relogio, feriados) / totalMin;
  }
  return 1 + minutosUteisEntre(venceEm, agora, relogio, feriados) / totalMin;
}

export function marcosAtingidos(fracao: number): Marco[] {
  return MARCOS.filter((m) => fracao * 100 >= m);
}

type Linha = {
  id: string;
  organization_id: string;
  ano: number;
  numero: number;
  categoria_id: string;
  area: string;
  estado: string;
  responsavel_user_id: string | null;
  politica_sla_id: string | null;
  aberto_em: string;
  primeira_resposta_vence_em: string | null;
  primeira_resposta_em: string | null;
  resolucao_vence_em: string | null;
  pausado_desde: string | null;
};

type Politica = { id: string; primeira_resposta_min: number; resolucao_min: number; em_horario_util: boolean };

export interface ResultadoDoVigia {
  modulo_instalado: boolean;
  examinados: number;
  marcos_registrados: number;
  avisos: number;
  sem_dono: number;
}

function ausente(erro: { code?: string } | null): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

function numero(p: { ano: number; numero: number }): string {
  return `${p.ano}-${String(p.numero).padStart(6, "0")}`;
}

export async function rodarVigia(admin: SB, agora: Date, requestId: string): Promise<ResultadoDoVigia> {
  const resultado: ResultadoDoVigia = { modulo_instalado: true, examinados: 0, marcos_registrados: 0, avisos: 0, sem_dono: 0 };

  const { data, error } = await admin
    .from("protocolos")
    .select(
      "id, organization_id, ano, numero, categoria_id, area, estado, responsavel_user_id, politica_sla_id, aberto_em, " +
        "primeira_resposta_vence_em, primeira_resposta_em, resolucao_vence_em, pausado_desde",
    )
    .in("estado", ESTADOS_ABERTOS as unknown as string[])
    .order("aberto_em", { ascending: true })
    .limit(LIMITE_DA_VARREDURA);
  if (ausente(error)) return { ...resultado, modulo_instalado: false };
  if (error) throw new Error(`vigia_de_protocolos: ${error.message}`);
  const linhas = (data ?? []) as unknown as Linha[];
  resultado.examinados = linhas.length;

  // Caches por rodada: uma organização, um calendário; uma política, uma leitura.
  const calendarios = new Map<string, { expediente: Expediente | null; feriados: Set<string> }>();
  const politicas = new Map<string, Politica | null>();
  const nomesDeCategoria = new Map<string, string>();

  async function calendario(org: string) {
    let c = calendarios.get(org);
    if (!c) {
      const [{ data: o }, { data: f }] = await Promise.all([
        admin.from("organizations").select("settings").eq("id", org).maybeSingle(),
        admin.from("protocolo_feriados").select("data").eq("organization_id", org),
      ]);
      c = {
        expediente: expedienteDaOrganizacao((o as { settings?: unknown } | null)?.settings),
        feriados: new Set(((f ?? []) as Array<{ data: string }>).map((x) => x.data)),
      };
      calendarios.set(org, c);
    }
    return c;
  }

  async function politica(id: string) {
    if (!politicas.has(id)) {
      const { data: p } = await admin
        .from("protocolo_politicas_sla")
        .select("id, primeira_resposta_min, resolucao_min, em_horario_util")
        .eq("id", id)
        .maybeSingle();
      politicas.set(id, (p as Politica | null) ?? null);
    }
    return politicas.get(id) ?? null;
  }

  async function categoria(id: string) {
    if (!nomesDeCategoria.has(id)) {
      const { data: c } = await admin.from("protocolo_categorias").select("nome").eq("id", id).maybeSingle();
      nomesDeCategoria.set(id, (c as { nome: string } | null)?.nome ?? "");
    }
    return nomesDeCategoria.get(id) ?? "";
  }

  for (const p of linhas) {
    if (p.pausado_desde || !p.politica_sla_id) continue;
    const pol = await politica(p.politica_sla_id);
    if (!pol) continue;
    const cal = await calendario(p.organization_id);
    const relogio = pol.em_horario_util ? cal.expediente : null;

    const medicoes: Array<{ relogio: Relogio; venceEm: string; total: number }> = [];
    if (!p.primeira_resposta_em && p.primeira_resposta_vence_em) {
      medicoes.push({ relogio: "primeira_resposta", venceEm: p.primeira_resposta_vence_em, total: pol.primeira_resposta_min });
    }
    if (p.resolucao_vence_em) medicoes.push({ relogio: "resolucao", venceEm: p.resolucao_vence_em, total: pol.resolucao_min });

    for (const m of medicoes) {
      const atingidos = marcosAtingidos(fracaoDoPrazo(agora, new Date(m.venceEm), m.total, relogio, cal.feriados));
      const novos: Marco[] = [];
      for (const marco of atingidos) {
        const { error: erroMarco } = await admin.from("protocolo_marcos_sla").insert({
          protocolo_id: p.id,
          organization_id: p.organization_id,
          relogio: m.relogio,
          marco,
        });
        if (erroMarco?.code === "23505") continue; // já registrado: a PK é a trava
        if (erroMarco) {
          logger.error("[protocolos-sla-watcher] marco não registrado", { protocolo_id: p.id, error: erroMarco.message, requestId });
          continue;
        }
        novos.push(marco);
      }
      if (novos.length === 0) continue;
      resultado.marcos_registrados += novos.length;

      const maior = novos[novos.length - 1]!;
      const tipo = maior >= 100 ? "sla_estourado" : "sla_alerta";
      await admin.rpc("fn_protocolo_registrar_evento", {
        p_org: p.organization_id,
        p_protocolo: p.id,
        p_tipo: tipo,
        p_texto: null,
        p_ator: null,
        p_ator_kind: "sistema",
        p_novo: { relogio: m.relogio, marco: maior },
      });

      const qual = m.relogio === "primeira_resposta" ? "a primeira resposta" : "a resolução";
      const quando = maior === 80 ? "está perto de vencer" : maior === 100 ? "venceu" : "venceu há tempo";
      const nomeDaCategoria = await categoria(p.categoria_id);
      const { error: erroAviso } = await admin.from("agent_inbox_items").insert({
        organization_id: p.organization_id,
        kind: "protocolo_sla",
        severity: maior === 80 ? "warn" : "critical",
        title: `Protocolo ${numero(p)}: o prazo de ${qual} ${quando}`,
        body:
          `${nomeDaCategoria ? `${nomeDaCategoria}. ` : ""}` +
          (p.responsavel_user_id ? "O protocolo tem responsável." : "O protocolo está na fila, sem responsável.") +
          " Abra e decida: atender agora, passar para outra pessoa ou ajustar a prioridade.",
        ref_kind: "protocolo",
        ref_id: p.id,
      });
      if (erroAviso) {
        logger.error("[protocolos-sla-watcher] aviso não foi aberto", { protocolo_id: p.id, error: erroAviso.message, requestId });
        continue;
      }
      resultado.avisos += 1;
    }
  }

  resultado.sem_dono = await avisarFilasSemDono(admin, agora, linhas, requestId);
  return resultado;
}

/**
 * Protocolo na fila (sem responsável) há mais de uma hora numa área SEM membro e SEM líder: ele
 * não anda até alguém configurar a fila. Um aviso por protocolo enquanto houver um aberto.
 */
async function avisarFilasSemDono(admin: SB, agora: Date, linhas: Linha[], requestId: string): Promise<number> {
  const candidatos = linhas.filter(
    (p) => p.responsavel_user_id === null && agora.getTime() - Date.parse(p.aberto_em) >= FILA_SEM_DONO_APOS_MS,
  );
  if (candidatos.length === 0) return 0;

  const areasComGente = new Map<string, Set<string>>();
  for (const org of new Set(candidatos.map((p) => p.organization_id))) {
    const { data } = await admin.from("protocolo_area_membros").select("area").eq("organization_id", org);
    areasComGente.set(org, new Set(((data ?? []) as Array<{ area: string }>).map((m) => m.area)));
  }

  let avisados = 0;
  for (const p of candidatos) {
    if (areasComGente.get(p.organization_id)?.has(p.area)) continue;
    const { data: jaTem } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", p.organization_id)
      .eq("kind", "protocolo_sem_dono")
      .eq("ref_id", p.id)
      .eq("status", "open")
      .maybeSingle();
    if (jaTem) continue;
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: p.organization_id,
      kind: "protocolo_sem_dono",
      severity: "warn",
      title: `Protocolo ${numero(p)} está numa fila sem ninguém`,
      body:
        "A área deste protocolo não tem ninguém na fila nem líder, então ninguém vai pegá-lo. " +
        "Atribua o protocolo, ou ponha pessoas na fila da área em Configurações › Protocolos.",
      ref_kind: "protocolo",
      ref_id: p.id,
    });
    if (error) {
      logger.error("[protocolos-sla-watcher] aviso de fila sem dono não foi aberto", { protocolo_id: p.id, error: error.message, requestId });
      continue;
    }
    avisados += 1;
  }
  return avisados;
}
