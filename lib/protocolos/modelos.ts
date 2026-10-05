/**
 * Modelos de nicho para as categorias de protocolo (spec 22 §13).
 *
 * Aplicados por ação explícita do administrador (`aplicarModelo`), nunca sozinhos. Áreas são
 * slugs de `lib/atendimento/areas.ts`. Políticas de SLA NÃO vêm no modelo: prazo é do escritório,
 * e um número semeado aqui seria a mesma falha de inventar preço (modelo do escritório, §7).
 *
 * `descricao_para_ia` diz ao assistente QUANDO usar a categoria — vai para a descrição da
 * ferramenta (PR-D), nunca para o cliente.
 */
import type { Prioridade } from "./prioridade";

export interface SubcategoriaDoModelo {
  nome: string;
  slug: string;
  area?: string;
  prioridade_padrao?: Prioridade;
  exige_competencia?: boolean;
  exige_handoff?: boolean;
}

export interface CategoriaDoModelo {
  nome: string;
  slug: string;
  area: string;
  prioridade_padrao: Prioridade;
  exige_competencia: boolean;
  exige_handoff: boolean;
  descricao_para_ia: string;
  subcategorias: readonly SubcategoriaDoModelo[];
}

const sub = (nome: string, slug: string, extra: Partial<SubcategoriaDoModelo> = {}): SubcategoriaDoModelo => ({
  nome,
  slug,
  ...extra,
});

/** As 10 categorias do modelo do escritório de contabilidade (§6) + notificação/fiscalização. */
const CONTABILIDADE: readonly CategoriaDoModelo[] = [
  {
    nome: "Fiscal",
    slug: "fiscal",
    area: "fiscal",
    prioridade_padrao: "P3",
    exige_competencia: true,
    exige_handoff: false,
    descricao_para_ia: "Guias e impostos (DAS, ICMS, ISS), notas fiscais e obrigações como o SPED.",
    subcategorias: [
      sub("DAS", "das"),
      sub("ICMS", "icms"),
      sub("ISS", "iss"),
      sub("Notas fiscais", "notas"),
      sub("SPED", "sped"),
    ],
  },
  {
    nome: "Departamento Pessoal",
    slug: "dp",
    area: "dp",
    prioridade_padrao: "P3",
    exige_competencia: true,
    exige_handoff: false,
    descricao_para_ia: "Funcionários: admissão, demissão, férias, folha de pagamento e pró-labore.",
    subcategorias: [
      sub("Admissão", "admissao", { prioridade_padrao: "P2", exige_competencia: false }),
      sub("Demissão", "demissao", { prioridade_padrao: "P2", exige_competencia: false }),
      sub("Férias", "ferias", { exige_competencia: false }),
      sub("Folha de pagamento", "folha"),
      sub("Pró-labore", "pro_labore"),
    ],
  },
  {
    nome: "Contábil",
    slug: "contabil",
    area: "contabil",
    prioridade_padrao: "P3",
    exige_competencia: true,
    exige_handoff: false,
    descricao_para_ia: "Balanço, balancete, lançamentos e documentos contábeis.",
    subcategorias: [
      sub("Balanço", "balanco"),
      sub("Balancete", "balancete"),
      sub("Lançamentos", "lancamentos"),
      sub("Documentos contábeis", "documentos"),
    ],
  },
  {
    nome: "Societário",
    slug: "societario",
    area: "societario",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Abertura, alteração ou baixa de empresa e contrato social.",
    subcategorias: [
      sub("Abertura", "abertura"),
      sub("Alteração", "alteracao"),
      sub("Baixa", "baixa"),
      sub("Contrato social", "contrato_social"),
    ],
  },
  {
    nome: "Tributário",
    slug: "tributario",
    area: "tributario",
    prioridade_padrao: "P4",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Dúvida sobre tributação, enquadramento ou planejamento — a equipe avalia; nunca responda o mérito.",
    subcategorias: [sub("Planejamento tributário", "planejamento"), sub("Enquadramento", "enquadramento")],
  },
  {
    nome: "Certidões",
    slug: "certidoes",
    area: "fiscal",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Pedido de certidão negativa (CND) ou de regularidade fiscal.",
    subcategorias: [sub("CND", "cnd"), sub("Regularidade fiscal", "regularidade")],
  },
  {
    nome: "IRPF",
    slug: "irpf",
    area: "fiscal",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Imposto de renda de pessoa física: declaração, pendência ou malha fina.",
    subcategorias: [sub("Declaração", "declaracao"), sub("Pendência", "pendencia"), sub("Malha fina", "malha", { prioridade_padrao: "P2" })],
  },
  {
    nome: "Financeiro",
    slug: "financeiro",
    area: "financeiro",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Mensalidade do escritório, cobrança ou boleto.",
    subcategorias: [sub("Mensalidade", "mensalidade"), sub("Cobrança", "cobranca"), sub("Boleto", "boleto")],
  },
  {
    nome: "Tecnologia / Portal",
    slug: "tecnologia",
    area: "relacionamento",
    prioridade_padrao: "P4",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Acesso ao portal, envio de documentos ou integração com sistemas.",
    subcategorias: [sub("Acesso", "acesso"), sub("Envio de documentos", "envio_documentos"), sub("Integração", "integracao")],
  },
  {
    nome: "Notificação, intimação ou fiscalização",
    slug: "notificacao",
    area: "fiscal",
    prioridade_padrao: "P1",
    exige_competencia: false,
    exige_handoff: true,
    descricao_para_ia:
      "O cliente recebeu notificação, intimação ou está sob fiscalização. Não interprete o documento: registre e passe para a equipe.",
    subcategorias: [],
  },
  {
    nome: "Outros",
    slug: "outros",
    area: "relacionamento",
    prioridade_padrao: "P4",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Pedido que não se encaixa em nenhuma outra categoria.",
    subcategorias: [],
  },
];

const GENERICO: readonly CategoriaDoModelo[] = [
  {
    nome: "Solicitação",
    slug: "solicitacao",
    area: "operacao",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Pedido de serviço ou de documento.",
    subcategorias: [],
  },
  {
    nome: "Problema",
    slug: "problema",
    area: "operacao",
    prioridade_padrao: "P2",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Algo que não está funcionando como deveria.",
    subcategorias: [],
  },
  {
    nome: "Financeiro",
    slug: "financeiro",
    area: "financeiro",
    prioridade_padrao: "P3",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Cobrança, boleto ou pagamento.",
    subcategorias: [],
  },
  {
    nome: "Outros",
    slug: "outros",
    area: "relacionamento",
    prioridade_padrao: "P4",
    exige_competencia: false,
    exige_handoff: false,
    descricao_para_ia: "Pedido que não se encaixa em nenhuma outra categoria.",
    subcategorias: [],
  },
];

export const MODELOS_DE_CATEGORIAS: Readonly<Record<"contabilidade" | "generico", readonly CategoriaDoModelo[]>> = {
  contabilidade: CONTABILIDADE,
  generico: GENERICO,
};
