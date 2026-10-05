/**
 * Vocabulário do módulo protocolos — o MESMO dos CHECKs da migration 0904.
 *
 * Uma lista por coluna, o tipo derivado dela. A tabela de transições é cópia da que o gatilho
 * `fn_protocolo_antes_de_gravar` aplica: a tela a usa para oferecer só os botões que funcionam, e
 * nunca autoriza nada. `tests/unit/protocolos-vocabulario.test.ts` compara as duas com o TEXTO da
 * migration (o invariante de vocabulário não alcança tabela de módulo).
 */

export const ESTADOS_DO_PROTOCOLO = [
  "novo",
  "triagem",
  "atribuido",
  "em_atendimento",
  "aguardando_cliente",
  "aguardando_terceiro",
  "aguardando_interno",
  "resolvido",
  "fechado",
  "cancelado",
  "reaberto",
] as const;
export type EstadoDoProtocolo = (typeof ESTADOS_DO_PROTOCOLO)[number];

export const ORIGENS_DO_PROTOCOLO = ["agente", "humano", "api", "automacao"] as const;
export type OrigemDoProtocolo = (typeof ORIGENS_DO_PROTOCOLO)[number];

export const DISTRIBUICOES = ["carteira", "fila", "fallback", "humano"] as const;
export type Distribuicao = (typeof DISTRIBUICOES)[number];

export const TRANSICOES_DO_PROTOCOLO: Readonly<Record<EstadoDoProtocolo, readonly EstadoDoProtocolo[]>> = {
  novo: ["triagem", "atribuido", "em_atendimento", "cancelado"],
  triagem: ["atribuido", "em_atendimento", "cancelado"],
  atribuido: [
    "triagem",
    "em_atendimento",
    "aguardando_cliente",
    "aguardando_terceiro",
    "aguardando_interno",
    "resolvido",
    "cancelado",
  ],
  em_atendimento: [
    "atribuido",
    "aguardando_cliente",
    "aguardando_terceiro",
    "aguardando_interno",
    "resolvido",
    "cancelado",
  ],
  aguardando_cliente: ["em_atendimento", "resolvido", "cancelado"],
  aguardando_terceiro: ["em_atendimento", "resolvido", "cancelado"],
  aguardando_interno: ["em_atendimento", "resolvido", "cancelado"],
  resolvido: ["fechado", "reaberto"],
  fechado: [],
  cancelado: [],
  reaberto: ["atribuido", "em_atendimento", "aguardando_cliente", "resolvido", "cancelado"],
};

/** Estados em que o protocolo ainda é trabalho de alguém. */
export const ESTADOS_ABERTOS: readonly EstadoDoProtocolo[] = ESTADOS_DO_PROTOCOLO.filter(
  (e) => e !== "resolvido" && e !== "fechado" && e !== "cancelado",
);

/** Estados que PODEM pausar o relógio de resolução (cada política diz se pausa). */
export const ESTADOS_QUE_PAUSAM = ["aguardando_cliente", "aguardando_terceiro"] as const;
