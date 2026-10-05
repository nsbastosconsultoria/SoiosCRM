/**
 * A prioridade do protocolo (spec 22 §7) — regra pura.
 *
 * Ordem, e a mais alta vence (P1 > P2 > P3 > P4):
 *   1. o padrão da categoria, com a subcategoria sobrepondo;
 *   2. a regra de prazo: prazo do cliente hoje ou vencido ⇒ P1; em até N dias úteis ⇒ P2
 *      (padrão 2 — decisão do dono, Q9; configurável em `settings.protocolos.regras_de_prazo`);
 *   3. a sugestão da IA, que SÓ SOBE, nunca desce abaixo da regra.
 *
 * O humano é outro caminho (pode baixar, com papel de gestor — Q2), e não passa por aqui.
 */
import type { Expediente } from "./sla";

export const PRIORIDADES = ["P1", "P2", "P3", "P4"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** A mais urgente das duas. */
export function maisUrgente(a: Prioridade, b: Prioridade): Prioridade {
  return PRIORIDADES.indexOf(a) <= PRIORIDADES.indexOf(b) ? a : b;
}

export interface RegrasDePrazo {
  /** Até quantos dias úteis de prazo do cliente o protocolo é P2. */
  diasUteisParaP2: number;
}

export const REGRAS_DE_PRAZO_PADRAO: RegrasDePrazo = { diasUteisParaP2: 2 };

export function regrasDePrazoDaOrganizacao(settings: unknown): RegrasDePrazo {
  const bruto = (settings as { protocolos?: { regras_de_prazo?: { dias_uteis_para_p2?: unknown } } } | null)
    ?.protocolos?.regras_de_prazo?.dias_uteis_para_p2;
  return typeof bruto === "number" && Number.isInteger(bruto) && bruto >= 0 && bruto <= 30
    ? { diasUteisParaP2: bruto }
    : REGRAS_DE_PRAZO_PADRAO;
}

/** Dias úteis de `hoje` (exclusive) até `prazo` (inclusive), datas `AAAA-MM-DD`. 0 = hoje ou vencido. */
export function diasUteisAte(
  hoje: string,
  prazo: string,
  expediente: Expediente | null,
  feriados: ReadonlySet<string> = new Set(),
): number {
  const dias = expediente?.dias ?? [1, 2, 3, 4, 5];
  let cursor = Date.parse(`${hoje}T12:00:00Z`);
  const fim = Date.parse(`${prazo}T12:00:00Z`);
  let conta = 0;
  while (cursor < fim && conta < 400) {
    cursor += 24 * 60 * 60 * 1000;
    const d = new Date(cursor);
    const chave = d.toISOString().slice(0, 10);
    const diaIso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (dias.includes(diaIso) && !feriados.has(chave)) conta++;
  }
  return conta;
}

export interface EntradaDaPrioridade {
  padraoDaCategoria: Prioridade;
  padraoDaSubcategoria?: Prioridade | null;
  /** `AAAA-MM-DD` no fuso da organização, ou ausente. */
  prazoCliente?: string | null;
  hoje: string;
  sugestaoDaIa?: Prioridade | null;
  regras?: RegrasDePrazo;
  expediente?: Expediente | null;
  feriados?: ReadonlySet<string>;
}

export interface PrioridadeDecidida {
  prioridade: Prioridade;
  origem: "regra" | "ia";
}

export function decidirPrioridade(e: EntradaDaPrioridade): PrioridadeDecidida {
  let daRegra: Prioridade = e.padraoDaSubcategoria ?? e.padraoDaCategoria;

  if (e.prazoCliente) {
    const regras = e.regras ?? REGRAS_DE_PRAZO_PADRAO;
    const faltam = e.prazoCliente <= e.hoje ? 0 : diasUteisAte(e.hoje, e.prazoCliente, e.expediente ?? null, e.feriados);
    if (faltam === 0) daRegra = "P1";
    else if (faltam <= regras.diasUteisParaP2) daRegra = maisUrgente(daRegra, "P2");
  }

  if (e.sugestaoDaIa && maisUrgente(e.sugestaoDaIa, daRegra) === e.sugestaoDaIa && e.sugestaoDaIa !== daRegra) {
    return { prioridade: e.sugestaoDaIa, origem: "ia" };
  }
  return { prioridade: daRegra, origem: "regra" };
}

/** Baixar a prioridade (P2 → P3) — o que só gestor pode (Q2). */
export function baixaPrioridade(de: Prioridade, para: Prioridade): boolean {
  return PRIORIDADES.indexOf(para) > PRIORIDADES.indexOf(de);
}
