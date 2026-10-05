/**
 * Vocabulário do módulo carteira — o MESMO dos CHECKs da migration 0902.
 *
 * Uma lista por coluna, e o tipo derivado dela (como `lib/audit/actions.ts`): quem escreve
 * usa a constante, nunca a string solta. Divergir daqui para o banco é recusa do Postgres
 * (23514) em produção, e o invariante `vocabulario-banco-x-typescript` não cobre colunas de
 * módulo (as tabelas não existem no banco onde ele roda) — por isso o teste unitário
 * `tests/unit/carteira-vocabulario.test.ts` compara estas listas com o TEXTO da migration.
 */

export const ESTADOS_DA_CARTEIRA = [
  "prospect",
  "em_qualificacao",
  "proposta",
  "em_implantacao",
  "ativo",
  "suspenso",
  "em_distrato",
  "inativo",
] as const;
export type EstadoDaCarteira = (typeof ESTADOS_DA_CARTEIRA)[number];

export const PAPEIS_DO_VINCULO = [
  "socio",
  "administrador",
  "financeiro",
  "rh",
  "fiscal",
  "procurador",
  "funcionario",
  "contador_externo",
  "outro",
] as const;
export type PapelDoVinculo = (typeof PAPEIS_DO_VINCULO)[number];

export const TIPOS_DE_ESTABELECIMENTO = ["matriz", "filial"] as const;
export type TipoDeEstabelecimento = (typeof TIPOS_DE_ESTABELECIMENTO)[number];

/**
 * As transições que `fn_carteira_transicionar` aceita — cópia para a TELA oferecer só os botões
 * que funcionam. A fonte de verdade é a função no banco; esta tabela nunca autoriza nada, e o
 * teste unitário a compara com o `case` da migration.
 */
export const TRANSICOES_DA_CARTEIRA: Readonly<Record<EstadoDaCarteira, readonly EstadoDaCarteira[]>> = {
  prospect: ["em_qualificacao", "proposta", "em_implantacao", "ativo", "inativo"],
  em_qualificacao: ["prospect", "proposta", "em_implantacao", "inativo"],
  proposta: ["em_qualificacao", "em_implantacao", "inativo"],
  em_implantacao: ["ativo", "inativo"],
  ativo: ["suspenso", "em_distrato", "inativo"],
  suspenso: ["ativo", "em_distrato", "inativo"],
  em_distrato: ["ativo", "inativo"],
  inativo: ["prospect"],
};

/** Rótulo em português (a chave do dicionário de i18n é o próprio texto). */
export const ROTULO_DO_ESTADO: Readonly<Record<EstadoDaCarteira, string>> = {
  prospect: "Prospect",
  em_qualificacao: "Em qualificação",
  proposta: "Proposta",
  em_implantacao: "Em implantação",
  ativo: "Cliente ativo",
  suspenso: "Suspenso",
  em_distrato: "Em distrato",
  inativo: "Inativo",
};

export const ROTULO_DO_PAPEL: Readonly<Record<PapelDoVinculo, string>> = {
  socio: "Sócio",
  administrador: "Administrador",
  financeiro: "Financeiro",
  rh: "RH",
  fiscal: "Fiscal",
  procurador: "Procurador",
  funcionario: "Funcionário",
  contador_externo: "Contador externo",
  outro: "Outro",
};
