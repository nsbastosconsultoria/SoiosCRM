/**
 * Capacidades da CARTEIRA DE EMPRESAS — módulo opcional (spec 21 §8, ADR-0002).
 *
 * `modulo: "carteira"`: com o módulo desligado (não instalado em `/admin/modulos`), estas entradas
 * somem da tela de capacidades, do agente publicado e do cliente MCP externo — ninguém liga o que
 * não existe. Ver `deModuloDesligado` em `./index.ts`.
 *
 * Só `atender`, nunca `vender` (mesma razão de `./honorarios.ts`): `vender` já consome quase toda a
 * folga do teto de capacidades (`pacote-reserva-vaga-da-critica.test.ts`), e saber de qual empresa
 * é a conversa é trabalho de quem atende cliente.
 */
import { declararTools } from "./tipos";

export const TOOLS_CARTEIRA = declararTools([
  {
    name: "crm_carteira_empresas_do_contato",
    category: "read",
    rotulo: "Ver as empresas de quem está na conversa",
    explicacao:
      "Mostra de quais empresas a pessoa faz parte, se cada uma é cliente e de qual empresa a conversa trata, para o assistente perguntar a empresa certa em vez de adivinhar.",
    oQueToca: "Carteira de empresas",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "carteira",
  },
  {
    name: "crm_carteira_definir_empresa_da_conversa",
    category: "write",
    rotulo: "Registrar de qual empresa é a conversa",
    explicacao:
      "Marca a empresa de que a conversa trata, depois que o cliente diz qual é. Só aceita empresa a que a pessoa está ligada no cadastro.",
    oQueToca: "Carteira de empresas",
    // Escreve (o contexto da conversa), então não se anuncia "só consulta". `atencao` e não
    // `critico`: o efeito é reversível (trocar de novo) e fica preso às empresas da pessoa.
    risco: "atencao",
    pacotes: ["atender"],
    modulo: "carteira",
  },
  {
    name: "crm_carteira_buscar_empresa",
    category: "read",
    rotulo: "Procurar uma empresa da carteira",
    explicacao:
      "Procura pelo nome ou pelos números do CNPJ que o cliente informou, para reconhecer a empresa citada. Não cria empresa nem liga ninguém a ela.",
    oQueToca: "Carteira de empresas",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "carteira",
  },
]);
