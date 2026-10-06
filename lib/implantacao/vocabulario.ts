/**
 * Vocabulário do módulo implantacao — o MESMO dos CHECKs da migration 0907 (spec 23).
 *
 * Uma lista por coluna, o tipo derivado dela. A tabela de transições do item é cópia da que o
 * gatilho `fn_implantacao_item_antes_de_gravar` aplica: a tela a usa para oferecer só os botões
 * que funcionam, e nunca autoriza nada. `tests/unit/implantacao-vocabulario.test.ts` compara as
 * duas com o TEXTO da migration (o invariante de vocabulário não alcança tabela de módulo).
 */

export const ESTADOS_DA_IMPLANTACAO = ["em_andamento", "concluida", "cancelada"] as const;
export type EstadoDaImplantacao = (typeof ESTADOS_DA_IMPLANTACAO)[number];

export const ORIGENS_DA_IMPLANTACAO = ["manual", "negocio_ganho"] as const;
export type OrigemDaImplantacao = (typeof ORIGENS_DA_IMPLANTACAO)[number];

/** De quem é a vez num item (spec 23 §4.1). */
export const VEZ_DE = ["escritorio", "cliente", "terceiro"] as const;
export type VezDe = (typeof VEZ_DE)[number];

export const ESTADOS_DO_ITEM = [
  "pendente",
  "em_andamento",
  "aguardando_cliente",
  "aguardando_terceiro",
  "bloqueado",
  "concluido",
  "dispensado",
] as const;
export type EstadoDoItem = (typeof ESTADOS_DO_ITEM)[number];

/** Estados que fecham o item para a trava da ativação (spec 23 §5.3). */
export const ESTADOS_QUE_FECHAM: readonly EstadoDoItem[] = ["concluido", "dispensado"];

export const TRANSICOES_DO_ITEM: Readonly<Record<EstadoDoItem, readonly EstadoDoItem[]>> = {
  pendente: ["em_andamento", "aguardando_cliente", "aguardando_terceiro", "bloqueado", "concluido", "dispensado"],
  em_andamento: ["pendente", "aguardando_cliente", "aguardando_terceiro", "bloqueado", "concluido", "dispensado"],
  aguardando_cliente: ["em_andamento", "concluido", "dispensado"],
  aguardando_terceiro: ["em_andamento", "concluido", "dispensado"],
  bloqueado: ["em_andamento", "concluido", "dispensado"],
  concluido: ["em_andamento"],
  dispensado: ["pendente"],
};
