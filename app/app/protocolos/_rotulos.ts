/**
 * Rótulos dos protocolos na tela — cada um um `t("…")` LITERAL, para o guarda de i18n enxergar a
 * chave (o mesmo cuidado de `app/app/carteira/_rotulos.ts`).
 */
import type { Prioridade } from "@/lib/protocolos/prioridade";
import type { EstadoDoProtocolo } from "@/lib/protocolos/vocabulario";

type T = (texto: string) => string;

export function rotuloDoEstado(estado: EstadoDoProtocolo, t: T): string {
  switch (estado) {
    case "novo":
      return t("Novo");
    case "triagem":
      return t("Na fila");
    case "atribuido":
      return t("Atribuído");
    case "em_atendimento":
      return t("Em atendimento");
    case "aguardando_cliente":
      return t("Aguardando cliente");
    case "aguardando_terceiro":
      return t("Aguardando terceiro");
    case "aguardando_interno":
      return t("Aguardando equipe");
    case "resolvido":
      return t("Resolvido");
    case "fechado":
      return t("Fechado");
    case "cancelado":
      return t("Cancelado");
    case "reaberto":
      return t("Reaberto");
  }
}

export function rotuloDaPrioridade(p: Prioridade, t: T): string {
  switch (p) {
    case "P1":
      return t("P1 · Crítico");
    case "P2":
      return t("P2 · Urgente");
    case "P3":
      return t("P3 · Normal");
    case "P4":
      return t("P4 · Solicitação");
  }
}

export function classeDaPrioridade(p: Prioridade): string {
  if (p === "P1") return "bg-danger/15 text-danger";
  if (p === "P2") return "bg-warning/15 text-warning";
  if (p === "P3") return "bg-accent/15 text-accent";
  return "bg-surface-elevated text-text-muted";
}

export function rotuloDoEvento(tipo: string, t: T): string {
  switch (tipo) {
    case "aberto":
      return t("Protocolo aberto");
    case "classificacao_corrigida":
      return t("Classificação corrigida");
    case "prioridade_alterada":
      return t("Prioridade alterada");
    case "atribuido":
      return t("Atribuído");
    case "transferido":
      return t("Transferido");
    case "estado_alterado":
      return t("Estado alterado");
    case "nota":
      return t("Nota");
    case "complemento_do_cliente":
      return t("Complemento do cliente");
    case "sla_alerta":
      return t("Prazo perto de vencer");
    case "sla_estourado":
      return t("Prazo vencido");
    case "reaberto":
      return t("Reaberto");
    case "resolvido":
      return t("Resolvido");
    case "fechado":
      return t("Fechado");
    case "cancelado":
      return t("Cancelado");
    default:
      return tipo;
  }
}

/**
 * O relógio do prazo de resolução, em palavras: "vence em 2 h", "vencido há 30 min", "pausado".
 * `agora` entra por parâmetro para o componente decidir quando recalcula.
 */
export function relogioDoPrazo(
  venceEm: string | null,
  pausadoDesde: string | null,
  agora: number,
  t: T,
): { texto: string; classe: string } | null {
  if (pausadoDesde) return { texto: t("prazo pausado"), classe: "text-text-muted" };
  if (!venceEm) return null;
  const diferenca = new Date(venceEm).getTime() - agora;
  const minutos = Math.round(Math.abs(diferenca) / 60_000);
  const quanto = minutos >= 60 * 24 ? `${Math.round(minutos / 1440)} d` : minutos >= 60 ? `${Math.round(minutos / 60)} h` : `${minutos} min`;
  if (diferenca < 0) return { texto: `${t("vencido há")} ${quanto}`, classe: "text-danger" };
  return { texto: `${t("vence em")} ${quanto}`, classe: diferenca < 2 * 3600_000 ? "text-warning" : "text-text-muted" };
}
