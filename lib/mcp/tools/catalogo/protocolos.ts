/**
 * Capacidades de PROTOCOLOS — módulo opcional (spec 22 §8, ADR-0002).
 *
 * `modulo: "protocolos"`: com o módulo desligado, estas entradas somem da tela de capacidades, do
 * agente publicado e do cliente MCP externo. Só `atender` (mesma razão de `./honorarios.ts`).
 *
 * Abrir é CRÍTICO: cria trabalho para a equipe e pode passar a conversa para uma pessoa — liga-se
 * uma a uma, como a capacidade "casos" de hoje.
 */
import { declararTools } from "./tipos";

export const TOOLS_PROTOCOLOS = declararTools([
  {
    name: "crm_protocolo_categorias",
    category: "read",
    rotulo: "Ver as categorias de protocolo",
    explicacao:
      "Mostra as categorias e subcategorias que o escritório configurou, para o assistente classificar o pedido do cliente sem inventar.",
    oQueToca: "Protocolos",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "protocolos",
  },
  {
    name: "crm_protocolo_abrir",
    category: "write",
    rotulo: "Abrir um protocolo para a equipe",
    explicacao:
      "Registra o pedido do cliente como protocolo, com categoria e resumo, e passa a conversa para uma pessoa quando a categoria exige. O cliente recebe o número.",
    oQueToca: "Protocolos",
    risco: "critico",
    pacotes: ["atender"],
    modulo: "protocolos",
  },
  {
    name: "crm_protocolo_consultar",
    category: "read",
    rotulo: "Consultar os protocolos do cliente",
    explicacao:
      "Mostra os protocolos do cliente da conversa e a situação de cada um em palavras simples, sem prometer prazo.",
    oQueToca: "Protocolos",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "protocolos",
  },
  {
    name: "crm_protocolo_complementar",
    category: "write",
    rotulo: "Acrescentar informação a um protocolo",
    explicacao:
      "Junta ao protocolo do cliente o que ele informou depois, e reabre um protocolo resolvido há poucos dias.",
    oQueToca: "Protocolos",
    risco: "atencao",
    pacotes: ["atender"],
    modulo: "protocolos",
  },
]);
