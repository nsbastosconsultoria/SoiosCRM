/**
 * O catálogo de módulos instaláveis (ADR-0002, D3).
 *
 * Não há uma segunda lista para divergir da real: `fn_modulo_instalar` só aceita um slug cuja
 * `fn_<slug>_provisionar()` EXISTE no banco (`to_regprocedure`), e é essa checagem que decide
 * de verdade. Este array é só a vitrine — nome e descrição para a tela do administrador da
 * instalação escolher o que instalar. Um módulo aqui sem provisionadora no banco falharia com
 * `extension_module_unknown` ao tentar instalar, nunca silenciosamente.
 */
export interface ModuloCatalogo {
  slug: string;
  nome: string;
  descricao: string;
  /**
   * Módulos que precisam estar instalados ANTES deste (spec 23 §11.1). A tela desabilita
   * "Instalar" e diz o que falta; `instalarModulo` recusa com `modulo_requer_outro`; e a
   * provisionadora recusa no banco — a régua mora lá, a tela e o serviço só explicam.
   */
  requer?: readonly string[];
}

export const CATALOGO_DE_MODULOS: readonly ModuloCatalogo[] = [
  {
    slug: "honorarios",
    nome: "Honorários (advocacia)",
    descricao:
      "Contrato de honorários (fixo, êxito ou misto) e o calendário de parcelas, ligado ao caixa " +
      "do núcleo. Para escritórios de advocacia que cobram por caso.",
  },
  {
    // #1907 item 4 — sem esta linha `service.ts:84` recusava o slug fora do
    // catálogo (`extension_module_unknown`) e não havia como instalar a
    // comanda em lugar nenhum: as telas e as rotas ficariam mortas para
    // sempre, mesmo com a provisionadora pronta.
    slug: "financeiro",
    // As cinco tabelas da comanda nascem SÓ onde o módulo é instalado (ADR-0002
    // D2/D3). O texto abaixo é o que quem administra lê em `/admin/modulos`.
    nome: "Comandas",
    descricao:
      "A comanda do atendimento: itens, forma de pagamento, comissões e fidelidade. O caixa " +
      "continua no sistema mesmo sem este módulo. Toda instalação anterior a esta versão " +
      "continua com Comandas ligada.",
  },
  {
    slug: "carteira",
    nome: "Carteira de empresas",
    descricao:
      "Liga quem escreve às empresas que representa, guarda se cada empresa é prospect ou " +
      "cliente, quem cuida dela em cada área e de qual empresa é cada conversa. Para quem " +
      "atende empresas recorrentes por um número só (contabilidade, agência, TI gerenciada).",
  },
  {
    slug: "protocolos",
    nome: "Protocolos",
    descricao:
      "As demandas dos clientes atuais com número, categoria, prioridade, fila por área e prazo " +
      "de resposta e de resolução (SLA). Para quem precisa saber o que vence hoje e quem é o " +
      "dono de cada pedido.",
  },
  {
    slug: "implantacao",
    nome: "Implantação de clientes",
    descricao:
      "O checklist de implantação de cada cliente novo (contrato, documentos, acessos…), com de " +
      "quem é a vez em cada item e a empresa só virando cliente ativo na carteira quando os itens " +
      "obrigatórios estão concluídos. Para quem implanta o cliente antes de atendê-lo de rotina.",
    requer: ["carteira"],
  },
];

export function moduloDoCatalogo(slug: string): ModuloCatalogo | undefined {
  return CATALOGO_DE_MODULOS.find((m) => m.slug === slug);
}
