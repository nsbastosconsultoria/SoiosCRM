/**
 * Erro do banco → resposta da API, para o módulo carteira.
 *
 * As regras do módulo moram no schema (migration 0902): a função de transição recusa a
 * mudança de estado, o gatilho recusa o vínculo de outra organização, o índice parcial recusa
 * o segundo responsável principal. A rota não repete essas regras — traduz a recusa num código
 * estável e numa mensagem que quem está na tela entende. Um erro que não está aqui vira 500 com
 * o código do banco, nunca um 200 silencioso.
 */
import { ApiError } from "@/lib/api/types";

export const MODULO_CARTEIRA_NAO_INSTALADO =
  "O módulo Carteira de empresas não está instalado nesta instalação. Peça ao administrador " +
  "para instalar em Modo administrador › Módulos.";

export interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** A tabela do módulo não existe: o módulo não foi instalado (42P01 no Postgres, PGRST205 no PostgREST). */
export function moduloCarteiraAusente(erro: ErroDoBanco | null | undefined): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

const RECUSAS: Readonly<Record<string, { status: number; mensagem: string }>> = {
  carteira_transicao_invalida: {
    status: 409,
    mensagem: "Essa mudança de estado não é permitida a partir do estado atual.",
  },
  carteira_empresa_nao_encontrada: { status: 404, mensagem: "Empresa não encontrada." },
  carteira_conversa_nao_encontrada: { status: 404, mensagem: "Conversa não encontrada." },
  carteira_contato_sem_vinculo_com_a_empresa: {
    status: 422,
    mensagem: "Este contato não está ligado a essa empresa.",
  },
  carteira_empresa_de_outra_organizacao: { status: 422, mensagem: "Empresa inválida para esta organização." },
  carteira_matriz_de_outra_organizacao: { status: 422, mensagem: "Matriz inválida para esta organização." },
  carteira_vinculo_de_outra_organizacao: { status: 422, mensagem: "Vínculo inválido para esta organização." },
  carteira_vinculo_imutavel: { status: 422, mensagem: "O vínculo não pode trocar de pessoa ou empresa." },
  carteira_organizacao_imutavel: { status: 422, mensagem: "O registro não pode mudar de organização." },
  carteira_responsavel_encerre_e_abra_outro: {
    status: 422,
    mensagem: "Para trocar o responsável, encerre o atual e defina outro.",
  },
  carteira_entrada_invalida: { status: 422, mensagem: "Dados inválidos." },
  carteira_humano_sem_usuario: { status: 422, mensagem: "Dados inválidos." },
};

/**
 * Lança o `ApiError` certo para um erro do banco. Nunca devolve: quem chama passa adiante
 * para `handleRouteError`.
 */
export function lancarErroDaCarteira(erro: ErroDoBanco, requestId: string): never {
  if (moduloCarteiraAusente(erro)) {
    throw new ApiError(409, "module_not_installed", undefined, requestId, MODULO_CARTEIRA_NAO_INSTALADO);
  }
  const recusa = erro.message ? RECUSAS[erro.message] : undefined;
  if (recusa) {
    throw new ApiError(
      recusa.status,
      erro.message!,
      erro.details ? { detalhe: erro.details } : undefined,
      requestId,
      recusa.mensagem,
    );
  }
  if (erro.code === "23505") {
    throw new ApiError(409, "conflict", undefined, requestId, "Já existe um registro igual.");
  }
  if (erro.code === "42501") {
    throw new ApiError(403, "forbidden_role", undefined, requestId, "Seu papel não permite esta ação.");
  }
  throw new ApiError(500, "internal_error", { db_code: erro.code ?? null }, requestId, "Erro interno.");
}
