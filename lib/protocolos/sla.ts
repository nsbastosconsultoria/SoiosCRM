/**
 * O relógio do SLA dos protocolos (spec 22 §10) — funções PURAS, sem banco, sem relógio do sistema.
 *
 * "2 horas úteis" depende do expediente da organização (dias da semana, início e fim, fuso) e dos
 * feriados. As duas perguntas que o resto do módulo faz:
 *
 *   - `somarMinutosUteis(inicio, minutos, …)` — quando vence um prazo que começa agora?
 *   - `minutosUteisEntre(a, b, …)` — quanto do expediente passou entre dois instantes? (a pausa em
 *     "aguardando cliente" desconta isso do prazo)
 *
 * FALHA ABERTA, como `janela-de-atendimento.ts`: expediente ausente ou torto vira `null`, e `null`
 * é relógio CORRIDO (24×7). Um SLA que nunca vence é pior que um SLA apertado demais: o primeiro
 * some sem ninguém ver; o segundo aparece como alerta e alguém corrige o expediente.
 */
import { z } from "zod";

export interface Expediente {
  /** Fuso IANA (ex.: "America/Sao_Paulo"). */
  fuso: string;
  /** Dias da semana ISO: 1 = segunda … 7 = domingo. */
  dias: readonly number[];
  /** "HH:MM", 24h. */
  inicio: string;
  fim: string;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const expedienteSchema = z
  .object({
    fuso: z.string().min(1),
    dias: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    inicio: z.string().regex(HORA),
    fim: z.string().regex(HORA),
  })
  .refine((e) => minutosDoDia(e.inicio) < minutosDoDia(e.fim), "o expediente termina antes de começar")
  .refine((e) => fusoValido(e.fuso), "fuso desconhecido");

function minutosDoDia(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** `organizations.settings.protocolos.expediente`, lido com falha aberta (null = 24×7). */
export function expedienteDaOrganizacao(settings: unknown): Expediente | null {
  const bruto = (settings as { protocolos?: { expediente?: unknown } } | null | undefined)?.protocolos?.expediente;
  const lido = expedienteSchema.safeParse(bruto);
  return lido.success ? lido.data : null;
}

// ─── fuso: parede ↔ instante ─────────────────────────────────────────────────

interface Parede {
  ano: number;
  mes: number; // 1–12
  dia: number;
  minutos: number; // minutos desde 00:00 local
  diaIso: number; // 1 = segunda … 7 = domingo
}

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatadores.set(fuso, f);
  }
  return f;
}

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parede(instante: number, fuso: string): Parede {
  const p = Object.fromEntries(formatador(fuso).formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    minutos: Number(p.hour) * 60 + Number(p.minute),
    diaIso: DIA_ISO[p.weekday as string] ?? 1,
  };
}

/** O instante em que a parede do fuso marca `ano-mes-dia hh:mm` (duas passadas cobrem horário de verão). */
function instante(ano: number, mes: number, dia: number, minutos: number, fuso: string): number {
  const alvo = Date.UTC(ano, mes - 1, dia, 0, minutos);
  let palpite = alvo;
  for (let i = 0; i < 2; i++) {
    const p = parede(palpite, fuso);
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, 0, p.minutos);
    palpite += alvo - visto;
  }
  return palpite;
}

function chaveDoDia(p: Parede): string {
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

const MINUTO = 60_000;
/** Um ano de dias: um prazo que não cabe nisso é configuração errada, não espera legítima. */
const LIMITE_DE_DIAS = 400;

interface Janela {
  abre: number;
  fecha: number;
}

/** As janelas de expediente dia a dia, a partir do dia local de `desde`. */
function* janelas(desde: number, expediente: Expediente, feriados: ReadonlySet<string>): Generator<Janela> {
  const inicio = minutosDoDia(expediente.inicio);
  const fim = minutosDoDia(expediente.fim);
  let p = parede(desde, expediente.fuso);
  for (let i = 0; i < LIMITE_DE_DIAS; i++) {
    if (expediente.dias.includes(p.diaIso) && !feriados.has(chaveDoDia(p))) {
      yield {
        abre: instante(p.ano, p.mes, p.dia, inicio, expediente.fuso),
        fecha: instante(p.ano, p.mes, p.dia, fim, expediente.fuso),
      };
    }
    // Meio-dia do dia seguinte: longe de qualquer virada de horário de verão.
    const proximo = instante(p.ano, p.mes, p.dia, 12 * 60, expediente.fuso) + 24 * 60 * MINUTO;
    p = parede(proximo, expediente.fuso);
  }
}

/** Quando vence um prazo de `minutos` que começa em `inicio`. Sem expediente: relógio corrido. */
export function somarMinutosUteis(
  inicio: Date,
  minutos: number,
  expediente: Expediente | null,
  feriados: ReadonlySet<string> = new Set(),
): Date {
  if (minutos <= 0) return new Date(inicio.getTime());
  if (expediente === null) return new Date(inicio.getTime() + minutos * MINUTO);

  let restante = minutos * MINUTO;
  const desde = inicio.getTime();
  for (const j of janelas(desde, expediente, feriados)) {
    const comeca = Math.max(desde, j.abre);
    if (comeca >= j.fecha) continue;
    const cabe = j.fecha - comeca;
    if (restante <= cabe) return new Date(comeca + restante);
    restante -= cabe;
  }
  throw new Error("sla_prazo_fora_do_limite: o prazo não cabe em um ano de expediente");
}

/** Quanto do expediente (em minutos) passou entre `a` e `b`. Sem expediente: tempo corrido. */
export function minutosUteisEntre(
  a: Date,
  b: Date,
  expediente: Expediente | null,
  feriados: ReadonlySet<string> = new Set(),
): number {
  const de = a.getTime();
  const ate = b.getTime();
  if (ate <= de) return 0;
  if (expediente === null) return Math.floor((ate - de) / MINUTO);

  let total = 0;
  for (const j of janelas(de, expediente, feriados)) {
    if (j.abre >= ate) break;
    const inicio = Math.max(de, j.abre);
    const fim = Math.min(ate, j.fecha);
    if (fim > inicio) total += fim - inicio;
  }
  return Math.floor(total / MINUTO);
}
