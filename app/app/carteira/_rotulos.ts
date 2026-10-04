/**
 * Rótulos da carteira na tela — cada um um `t("…")` LITERAL, para o guarda de i18n
 * (`tests/unit/i18n-espanhol-cobre-a-tela.test.ts`) enxergar a chave. Um `t(MAPA[x])` esconderia
 * a chave dele e o espanhol sairia em português sem nenhum teste ficar vermelho.
 */
import type { EstadoDaCarteira, PapelDoVinculo } from "@/lib/carteira/vocabulario";

type T = (texto: string) => string;

export function rotuloDoEstado(estado: EstadoDaCarteira, t: T): string {
  switch (estado) {
    case "prospect":
      return t("Prospect");
    case "em_qualificacao":
      return t("Em qualificação");
    case "proposta":
      return t("Proposta");
    case "em_implantacao":
      return t("Em implantação");
    case "ativo":
      return t("Cliente ativo");
    case "suspenso":
      return t("Suspenso");
    case "em_distrato":
      return t("Em distrato");
    case "inativo":
      return t("Inativo");
  }
}

export function rotuloDoPapel(papel: PapelDoVinculo, t: T): string {
  switch (papel) {
    case "socio":
      return t("Sócio");
    case "administrador":
      return t("Administrador");
    case "financeiro":
      return t("Financeiro");
    case "rh":
      return t("RH");
    case "fiscal":
      return t("Fiscal");
    case "procurador":
      return t("Procurador");
    case "funcionario":
      return t("Funcionário");
    case "contador_externo":
      return t("Contador externo");
    case "outro":
      return t("Outro");
  }
}

/** O que aconteceu, numa linha da linha do tempo (`carteira_eventos.tipo`). */
export function rotuloDoEvento(tipo: string, t: T): string {
  switch (tipo) {
    case "perfil_criado":
      return t("Entrou na carteira");
    case "estado_alterado":
      return t("Estado alterado");
    case "perfil_atualizado":
      return t("Dados do relacionamento alterados");
    case "vinculo_criado":
      return t("Pessoa ligada à empresa");
    case "vinculo_atualizado":
      return t("Vínculo alterado");
    case "responsavel_definido":
      return t("Responsável definido");
    case "responsavel_atualizado":
      return t("Responsável alterado");
    case "contexto_alterado":
      return t("Conversa associada à empresa");
    default:
      return tipo;
  }
}

/** Cor do selo do estado — classes do design system, nada de cor solta. */
export function classeDoEstado(estado: EstadoDaCarteira): string {
  if (estado === "ativo") return "bg-success/15 text-success";
  if (estado === "suspenso" || estado === "em_distrato") return "bg-warning/15 text-warning";
  if (estado === "inativo") return "bg-surface-elevated text-text-muted";
  return "bg-accent/15 text-accent";
}
