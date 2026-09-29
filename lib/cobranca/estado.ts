/**
 * A REGRA DA COBRANÇA — o que muda numa assinatura, sem I/O.
 *
 * Recebe os fatos (assinatura, faturas em aberto, situação da organização, o dia de hoje) e
 * devolve o veredito. Quem executa é `aplicar.ts`, chamado pelo cron `cobranca-watcher` e pelas
 * rotas que dão baixa numa fatura — os dois recebem a MESMA resposta para a mesma pergunta.
 *
 * O ciclo:
 *
 *   trialing ──fim do teste──▶ active ──fatura vence──▶ past_due ──fim da carência──▶ suspended
 *       ▲                         ▲                         │                             │
 *       └──── nada mais em atraso (fatura paga ou cancelada) ◀────────────────────────────┘
 *
 * ⚠️ NA DÚVIDA, NÃO SUSPENDE. Suspender por engano tira a equipe do CRM no meio do expediente;
 * deixar de suspender custa, no pior caso, um dia a mais de uso sem pagar. Data que não se lê,
 * carência inválida ou fatura sem vencimento nunca levam à suspensão.
 *
 * ⚠️ SUSPENDER E REATIVAR SÃO ASSIMÉTRICOS DE PROPÓSITO. A suspensão por cobrança só alcança
 * organização ATIVA — uma que alguém suspendeu à mão já está parada, e marcá-la como "suspensa
 * pela cobrança" faria o próximo pagamento religá-la por cima da decisão daquela pessoa. E a
 * reativação só desfaz o que a cobrança fez (`suspensaPorCobranca`).
 */

export type StatusDaAssinatura = "trialing" | "active" | "past_due" | "suspended" | "canceled";
export type StatusDaFatura = "open" | "paid" | "overdue" | "canceled";

export interface AssinaturaFatos {
  readonly status: StatusDaAssinatura;
  /** `YYYY-MM-DD`; o teste vale ENQUANTO hoje for anterior a esta data. */
  readonly trialEndsAt: string | null;
  readonly graceDays: number;
  readonly suspensaPorCobranca: boolean;
}

export interface FaturaFatos {
  readonly id: string;
  /** `YYYY-MM-DD` */
  readonly dueDate: string;
  readonly status: StatusDaFatura;
}

export interface DecisaoDeCobranca {
  /** Faturas `open` cujo vencimento passou: viram `overdue`. */
  readonly faturasQueVenceram: readonly string[];
  readonly novoStatus: StatusDaAssinatura;
  /** Suspender a organização agora (ela estava ativa). */
  readonly suspender: boolean;
  /** Tirar da suspensão agora (foi a cobrança que suspendeu, e nada mais está em atraso). */
  readonly reativar: boolean;
  /** A fatura em atraso mais antiga, quando há — é ela que conta a carência. */
  readonly faturaMaisAntigaEmAtraso: { readonly id: string; readonly dueDate: string } | null;
  readonly diasDeAtraso: number;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Dias civis de `de` até `ate` (positivo quando `ate` é depois). `null` se alguma não se lê. */
export function diasEntre(de: string, ate: string): number | null {
  if (!DATA.test(de) || !DATA.test(ate)) return null;
  const [a, b] = [de, ate].map((d) => {
    const [y, m, dia] = d.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, dia);
  }) as [number, number];
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Soma dias a uma data civil. */
export function somarDias(data: string, dias: number): string {
  const [y, m, d] = data.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Soma meses a uma data civil, prendendo no último dia do mês quando o dia não existe (31/01 +
 * 1 mês = 28 ou 29/02) — a mesma regra de `competenciaDoMes` das recorrências do caixa.
 */
export function somarMeses(data: string, meses: number): string {
  const [y, m, d] = data.split("-").map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** O dia civil de hoje num fuso — `YYYY-MM-DD`. */
export function hojeNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function decidirCobranca(
  assinatura: AssinaturaFatos,
  faturas: readonly FaturaFatos[],
  organizacaoAtiva: boolean,
  hoje: string,
): DecisaoDeCobranca {
  const nada: DecisaoDeCobranca = {
    faturasQueVenceram: [],
    novoStatus: assinatura.status,
    suspender: false,
    reativar: false,
    faturaMaisAntigaEmAtraso: null,
    diasDeAtraso: 0,
  };
  // Cancelada é terminal: nem cobra, nem suspende, nem religa.
  if (assinatura.status === "canceled" || !DATA.test(hoje)) return nada;

  const queVenceram = faturas.filter((f) => {
    if (f.status !== "open") return false;
    const dias = diasEntre(f.dueDate, hoje);
    return dias !== null && dias > 0;
  });
  const emAtraso = faturas
    .filter((f) => f.status === "overdue" || queVenceram.includes(f))
    .filter((f) => diasEntre(f.dueDate, hoje) !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const maisAntiga = emAtraso[0] ?? null;

  if (maisAntiga) {
    const dias = diasEntre(maisAntiga.dueDate, hoje) ?? 0;
    const carencia = Number.isInteger(assinatura.graceDays) && assinatura.graceDays >= 0
      ? assinatura.graceDays
      : null;
    // Carência 7: vence dia 10, dias 11 a 17 são aviso, no dia 18 (8 dias de atraso) suspende.
    const passouDaCarencia = carencia !== null && dias > carencia;
    return {
      faturasQueVenceram: queVenceram.map((f) => f.id),
      novoStatus: passouDaCarencia ? "suspended" : "past_due",
      suspender: passouDaCarencia && organizacaoAtiva,
      reativar: false,
      faturaMaisAntigaEmAtraso: { id: maisAntiga.id, dueDate: maisAntiga.dueDate },
      diasDeAtraso: dias,
    };
  }

  // Nada em atraso: em teste enquanto o teste não acabou; senão, em dia.
  const emTeste =
    assinatura.trialEndsAt !== null &&
    (diasEntre(hoje, assinatura.trialEndsAt) ?? 0) > 0;
  return {
    ...nada,
    novoStatus: emTeste ? "trialing" : "active",
    reativar: assinatura.suspensaPorCobranca && !organizacaoAtiva,
  };
}
