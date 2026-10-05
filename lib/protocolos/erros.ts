/**
 * Erro do banco → resposta da API, para o módulo protocolos (molde de `lib/carteira/erros.ts`).
 *
 * As regras moram no schema (migration 0904): a máquina de estados, os campos imutáveis, a
 * hierarquia de categoria, a organização cruzada. A rota não as repete; traduz a recusa num
 * código estável e numa mensagem que quem está na tela entende.
 */
import { ApiError } from "@/lib/api/types";

export const MODULO_PROTOCOLOS_NAO_INSTALADO =
  "O módulo Protocolos não está instalado nesta instalação. Peça ao administrador para instalar " +
  "em Modo administrador › Módulos.";

export interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export function moduloProtocolosAusente(erro: ErroDoBanco | null | undefined): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

const RECUSAS: Readonly<Record<string, { status: number; mensagem: string }>> = {
  protocolo_transicao_invalida: {
    status: 409,
    mensagem: "Essa mudança de estado não é permitida a partir do estado atual.",
  },
  protocolo_campo_imutavel: {
    status: 422,
    mensagem: "Número, empresa, contato, conversa e origem não mudam depois de aberto o protocolo.",
  },
  protocolo_categoria_nao_e_raiz: { status: 422, mensagem: "Escolha uma categoria, não uma subcategoria." },
  protocolo_subcategoria_de_outra_categoria: {
    status: 422,
    mensagem: "A subcategoria não pertence a essa categoria.",
  },
  protocolo_subcategoria_de_subcategoria: { status: 422, mensagem: "Subcategoria tem um nível só." },
  protocolo_nasce_aberto: { status: 422, mensagem: "Um protocolo não pode nascer fechado." },
  protocolo_nao_encontrado: { status: 404, mensagem: "Protocolo não encontrado." },
  protocolo_evento_invalido: { status: 422, mensagem: "Dados inválidos." },
  protocolo_empresa_de_outra_organizacao: { status: 422, mensagem: "Empresa inválida para esta organização." },
  protocolo_contato_de_outra_organizacao: { status: 422, mensagem: "Contato inválido para esta organização." },
  protocolo_conversa_de_outra_organizacao: { status: 422, mensagem: "Conversa inválida para esta organização." },
  protocolo_caso_de_outra_organizacao: { status: 422, mensagem: "Caso inválido para esta organização." },
  protocolo_organizacao_imutavel: { status: 422, mensagem: "O registro não pode mudar de organização." },
};

export function lancarErroDoProtocolo(erro: ErroDoBanco, requestId: string): never {
  if (moduloProtocolosAusente(erro)) {
    throw new ApiError(409, "module_not_installed", undefined, requestId, MODULO_PROTOCOLOS_NAO_INSTALADO);
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
  if (erro.code === "23505") throw new ApiError(409, "conflict", undefined, requestId, "Já existe um registro igual.");
  if (erro.code === "23503") {
    throw new ApiError(422, "validation_failed", undefined, requestId, "Referência inválida para esta organização.");
  }
  if (erro.code === "42501") {
    throw new ApiError(403, "forbidden_role", undefined, requestId, "Seu papel não permite esta ação.");
  }
  throw new ApiError(500, "internal_error", { db_code: erro.code ?? null }, requestId, "Erro interno.");
}
