/**
 * O que uma mudança de estado faz com o RELÓGIO do protocolo (spec 22 §10.3) — função pura.
 *
 * Entrar em "aguardando cliente/terceiro" pausa a resolução, se a política manda. Sair da pausa
 * soma o tempo pausado, em minutos ÚTEIS, ao prazo de resolução e à pausa acumulada.
 *
 * Mora fora de `servico.ts` porque tem DOIS chamadores com clientes diferentes: a tela (PostgREST,
 * `mudarEstado`) e o motor da IA (`pg`, `resposta-do-cliente.ts`, quando o cliente responde o que a
 * equipe pediu). Uma regra de prazo, uma função — a transição em si quem aceita ou recusa é o
 * gatilho do banco, nos dois caminhos.
 */
import { minutosUteisEntre, somarMinutosUteis, type Expediente } from "./sla";
import type { EstadoDoProtocolo } from "./vocabulario";

export type PoliticaDePausa = {
  em_horario_util: boolean;
  pausa_aguardando_cliente: boolean;
  pausa_aguardando_terceiro: boolean;
};

export type RelogioAtual = {
  pausado_desde: string | null;
  /** A pausa já acumulada, em minutos. */
  pausa_acumulada_min: number;
  resolucao_vence_em: string | null;
};

export function mudancasDoRelogio(
  atual: RelogioAtual,
  politica: PoliticaDePausa | null,
  cal: { expediente: Expediente | null; feriados: ReadonlySet<string> },
  para: EstadoDoProtocolo,
  agora: Date,
): Record<string, unknown> {
  const mudancas: Record<string, unknown> = {};
  const pausaAqui =
    politica !== null &&
    ((para === "aguardando_cliente" && politica.pausa_aguardando_cliente) ||
      (para === "aguardando_terceiro" && politica.pausa_aguardando_terceiro));

  if (atual.pausado_desde && !pausaAqui) {
    const relogio = politica ? (politica.em_horario_util ? cal.expediente : null) : cal.expediente;
    const pausados = minutosUteisEntre(new Date(atual.pausado_desde), agora, relogio, cal.feriados);
    mudancas.pausado_desde = null;
    mudancas.pausa_acumulada = `${atual.pausa_acumulada_min + pausados} minutes`;
    if (atual.resolucao_vence_em && pausados > 0) {
      mudancas.resolucao_vence_em = somarMinutosUteis(
        new Date(atual.resolucao_vence_em),
        pausados,
        relogio,
        cal.feriados,
      ).toISOString();
    }
  } else if (!atual.pausado_desde && pausaAqui) {
    mudancas.pausado_desde = agora.toISOString();
  }
  return mudancas;
}
