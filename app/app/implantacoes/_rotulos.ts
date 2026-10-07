/**
 * Rótulos da implantação na tela — cada um um `t("…")` LITERAL, para o guarda de i18n enxergar a
 * chave (o mesmo cuidado de `app/app/protocolos/_rotulos.ts`).
 */
import type { EstadoDaImplantacao, EstadoDoItem, VezDe } from "@/lib/implantacao/vocabulario";

type T = (texto: string) => string;

export function rotuloDoEstadoDoItem(estado: EstadoDoItem, t: T): string {
  switch (estado) {
    case "pendente":
      return t("Pendente");
    case "em_andamento":
      return t("Em andamento");
    case "aguardando_cliente":
      return t("Aguardando cliente");
    case "aguardando_terceiro":
      return t("Aguardando terceiro");
    case "bloqueado":
      return t("Bloqueado");
    case "concluido":
      return t("Concluído");
    case "dispensado":
      return t("Dispensado");
  }
}

export function classeDoEstadoDoItem(estado: EstadoDoItem): string {
  switch (estado) {
    case "concluido":
      return "bg-success/15 text-success";
    case "dispensado":
      return "bg-surface-muted text-text-muted";
    case "bloqueado":
      return "bg-destructive/15 text-destructive";
    case "aguardando_cliente":
    case "aguardando_terceiro":
      return "bg-warning/15 text-warning";
    default:
      return "bg-surface-muted text-text";
  }
}

export function rotuloDoEstadoDaImplantacao(estado: EstadoDaImplantacao, t: T): string {
  switch (estado) {
    case "em_andamento":
      return t("Em andamento");
    case "concluida":
      return t("Concluída");
    case "cancelada":
      return t("Cancelada");
  }
}

export function rotuloDaVez(vez: VezDe, t: T): string {
  switch (vez) {
    case "escritorio":
      return t("Equipe");
    case "cliente":
      return t("Cliente");
    case "terceiro":
      return t("Terceiro");
  }
}

export function rotuloDoEvento(tipo: string, t: T): string {
  switch (tipo) {
    case "iniciada":
      return t("Implantação iniciada");
    case "concluida":
      return t("Implantação concluída");
    case "cancelada":
      return t("Implantação cancelada");
    case "responsavel_alterado":
      return t("Responsável da implantação alterado");
    case "item_estado_alterado":
      return t("Item mudou de estado");
    case "item_responsavel_alterado":
      return t("Responsável do item alterado");
    case "item_prazo_alterado":
      return t("Prazo do item alterado");
    default:
      return t("Alteração");
  }
}
