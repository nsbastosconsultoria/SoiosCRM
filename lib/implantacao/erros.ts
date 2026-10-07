/**
 * Erro do banco → resposta da API, para o módulo implantacao (molde de `lib/protocolos/erros.ts`).
 *
 * As regras moram no schema (migration 0907): a trava da ativação, a tabela de transições do
 * item, evidência, dispensa, campos imutáveis, implantação encerrada. A rota não as repete;
 * traduz a recusa num código estável e numa mensagem que quem está na tela entende.
 */
import { ApiError } from "@/lib/api/types";

export const MODULO_IMPLANTACAO_NAO_INSTALADO =
  "O módulo Implantação de clientes não está instalado nesta instalação. Peça ao administrador " +
  "para instalar em Modo administrador › Módulos.";

export interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export function moduloImplantacaoAusente(erro: ErroDoBanco | null | undefined): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

const RECUSAS: Readonly<Record<string, { status: number; mensagem: string }>> = {
  implantacao_obrigatorios_abertos: {
    status: 409,
    mensagem: "Ainda há itens obrigatórios abertos. Conclua ou dispense cada um antes de concluir a implantação.",
  },
  implantacao_encerrada: { status: 409, mensagem: "Esta implantação já foi encerrada e não muda mais." },
  implantacao_item_transicao_invalida: {
    status: 409,
    mensagem: "Essa mudança de estado não é permitida a partir do estado atual do item.",
  },
  implantacao_item_exige_evidencia: {
    status: 422,
    mensagem: "Este item exige evidência. Registre como foi feito (por exemplo, a data e o meio) antes de concluir.",
  },
  implantacao_item_campo_imutavel: {
    status: 422,
    mensagem: "Obrigatoriedade, evidência exigida e de quem é a vez não mudam no meio da implantação.",
  },
  implantacao_campo_imutavel: { status: 422, mensagem: "Empresa, origem e início não mudam depois de iniciada." },
  implantacao_estado_da_empresa_nao_permite: {
    status: 409,
    mensagem: "A empresa está suspensa, em distrato ou inativa na carteira. Reative-a antes de iniciar uma implantação.",
  },
  implantacao_modelo_nao_encontrado: { status: 422, mensagem: "Modelo de implantação inexistente ou desativado." },
  implantacao_empresa_nao_encontrada: { status: 404, mensagem: "Empresa não encontrada." },
  implantacao_nao_encontrada: { status: 404, mensagem: "Implantação não encontrada." },
  implantacao_cancelamento_sem_motivo: { status: 422, mensagem: "Diga o motivo do cancelamento." },
  implantacao_entrada_invalida: { status: 422, mensagem: "Dados inválidos." },
  implantacao_organizacao_imutavel: { status: 422, mensagem: "O registro não pode mudar de organização." },
  implantacao_empresa_de_outra_organizacao: { status: 422, mensagem: "Empresa inválida para esta organização." },
  implantacao_negocio_de_outra_organizacao: { status: 422, mensagem: "Negócio inválido para esta organização." },
  carteira_transicao_invalida: {
    status: 409,
    mensagem: "A carteira não permite essa mudança de estado para a empresa agora.",
  },
};

/** Recusa do CHECK de dispensa com motivo (o nome da constraint vem na mensagem do Postgres). */
const RECUSA_POR_CONSTRAINT: Readonly<Record<string, { status: number; mensagem: string }>> = {
  implantacao_itens_dispensa_com_motivo: { status: 422, mensagem: "Diga o motivo da dispensa." },
};

export function lancarErroDaImplantacao(erro: ErroDoBanco, requestId: string): never {
  if (moduloImplantacaoAusente(erro)) {
    throw new ApiError(409, "module_not_installed", undefined, requestId, MODULO_IMPLANTACAO_NAO_INSTALADO);
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
  if (erro.code === "23514" && erro.message) {
    const porConstraint = Object.entries(RECUSA_POR_CONSTRAINT).find(([nome]) => erro.message!.includes(nome));
    if (porConstraint) {
      throw new ApiError(porConstraint[1].status, porConstraint[0], undefined, requestId, porConstraint[1].mensagem);
    }
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
