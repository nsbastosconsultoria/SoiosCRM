/**
 * Modelos de nicho da implantação (spec 23 §6). Aplicar um modelo só CRIA: um modelo com esse nome
 * que já exista na organização não é tocado — a mesma regra do modelo de categorias dos protocolos.
 *
 * O de contabilidade é o checklist do §25.1 do modelo do escritório; o genérico serve a quem
 * implanta qualquer serviço recorrente. Áreas são slugs de `settings.atendimento.areas`; uma área
 * que a organização não tenha deixa o item sem responsável automático (cai no da implantação).
 */
import type { VezDe } from "./vocabulario";

export interface ItemDoModeloDeNicho {
  grupo: string;
  titulo: string;
  orientacao?: string;
  vez_de: VezDe;
  area: string | null;
  prazo_dias: number | null;
  obrigatorio: boolean;
  exige_evidencia: boolean;
}

export interface ModeloDeNichoDefinido {
  nome: string;
  itens: readonly ItemDoModeloDeNicho[];
}

const CONTABILIDADE: ModeloDeNichoDefinido = {
  nome: "Implantação contábil",
  itens: [
    { grupo: "Contrato", titulo: "Contrato assinado", vez_de: "cliente", area: "relacionamento", prazo_dias: 3, obrigatorio: true, exige_evidencia: true,
      orientacao: "O contrato de prestação de serviços assinado pelas duas partes." },
    { grupo: "Cadastro", titulo: "Cadastro completo da empresa", vez_de: "escritorio", area: "relacionamento", prazo_dias: 5, obrigatorio: true, exige_evidencia: false },
    { grupo: "Cadastro", titulo: "Contatos e responsáveis do cliente", vez_de: "cliente", area: "relacionamento", prazo_dias: 5, obrigatorio: true, exige_evidencia: false,
      orientacao: "Quem fala pela empresa em cada assunto: sócios, financeiro, RH." },
    { grupo: "Societário", titulo: "Documentos societários", vez_de: "cliente", area: "societario", prazo_dias: 10, obrigatorio: true, exige_evidencia: true,
      orientacao: "Contrato social e alterações, cartão CNPJ e documentos dos sócios." },
    { grupo: "Fiscal", titulo: "Regime tributário confirmado", vez_de: "escritorio", area: "fiscal", prazo_dias: 10, obrigatorio: true, exige_evidencia: false },
    { grupo: "Acessos", titulo: "Certificado digital", vez_de: "cliente", area: "fiscal", prazo_dias: 10, obrigatorio: true, exige_evidencia: true,
      orientacao: "O certificado digital da empresa (A1) ou o acesso a ele." },
    { grupo: "Acessos", titulo: "Procurações (e-CAC, prefeitura, estado)", vez_de: "cliente", area: "fiscal", prazo_dias: 15, obrigatorio: true, exige_evidencia: true,
      orientacao: "As procurações eletrônicas em nome do escritório." },
    { grupo: "Folha", titulo: "Dados de folha", vez_de: "cliente", area: "dp", prazo_dias: 15, obrigatorio: false, exige_evidencia: false,
      orientacao: "Funcionários, salários e eventos do mês, quando a empresa tem folha." },
    { grupo: "Fiscal", titulo: "Dados fiscais", vez_de: "cliente", area: "fiscal", prazo_dias: 15, obrigatorio: true, exige_evidencia: false,
      orientacao: "Notas emitidas e recebidas e as obrigações em aberto." },
    { grupo: "Contábil", titulo: "Saldos e contabilidade anterior", vez_de: "terceiro", area: "contabil", prazo_dias: 30, obrigatorio: true, exige_evidencia: true,
      orientacao: "Balancete e saldos de abertura, entregues pelo contador anterior." },
    { grupo: "Acessos", titulo: "Acessos e integrações", vez_de: "cliente", area: "relacionamento", prazo_dias: 15, obrigatorio: false, exige_evidencia: false },
    { grupo: "Carteira", titulo: "Carteira interna definida", vez_de: "escritorio", area: "relacionamento", prazo_dias: 5, obrigatorio: true, exige_evidencia: false,
      orientacao: "Quem do escritório cuida da empresa em cada área, cadastrado na carteira." },
    { grupo: "Comunicação", titulo: "Canais de comunicação", vez_de: "escritorio", area: "relacionamento", prazo_dias: 5, obrigatorio: true, exige_evidencia: false },
    { grupo: "Comunicação", titulo: "Regras de envio (quem recebe guias, folha…)", vez_de: "cliente", area: "relacionamento", prazo_dias: 10, obrigatorio: true, exige_evidencia: false,
      orientacao: "Para quem enviar cada tipo de documento." },
    { grupo: "Conclusão", titulo: "Reunião de boas-vindas", vez_de: "escritorio", area: "relacionamento", prazo_dias: 30, obrigatorio: false, exige_evidencia: false },
  ],
};

const GENERICO: ModeloDeNichoDefinido = {
  nome: "Implantação",
  itens: [
    { grupo: "Contrato", titulo: "Contrato assinado", vez_de: "cliente", area: null, prazo_dias: 5, obrigatorio: true, exige_evidencia: true },
    { grupo: "Cadastro", titulo: "Cadastro completo", vez_de: "escritorio", area: null, prazo_dias: 5, obrigatorio: true, exige_evidencia: false },
    { grupo: "Acessos", titulo: "Acessos liberados", vez_de: "cliente", area: null, prazo_dias: 10, obrigatorio: true, exige_evidencia: false },
    { grupo: "Treinamento", titulo: "Treinamento do cliente", vez_de: "escritorio", area: null, prazo_dias: 15, obrigatorio: false, exige_evidencia: false },
    { grupo: "Conclusão", titulo: "Reunião de conclusão", vez_de: "escritorio", area: null, prazo_dias: 20, obrigatorio: false, exige_evidencia: false },
  ],
};

export const MODELOS_DE_IMPLANTACAO: Readonly<Record<"contabilidade" | "generico", ModeloDeNichoDefinido>> = {
  contabilidade: CONTABILIDADE,
  generico: GENERICO,
};
