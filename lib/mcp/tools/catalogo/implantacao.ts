/**
 * Capacidade de IMPLANTAÇÃO — módulo opcional (spec 23 §7, ADR-0002).
 *
 * `modulo: "implantacao"`: com o módulo desligado, a entrada some da tela de capacidades, do
 * agente publicado e do cliente MCP externo. Só leitura, e só `atender` (mesma razão de
 * `./honorarios.ts`).
 */
import { declararTools } from "./tipos";

export const TOOLS_IMPLANTACAO = declararTools([
  {
    name: "crm_implantacao_pendencias_do_cliente",
    category: "read",
    rotulo: "Ver o que falta o cliente entregar na implantação",
    explicacao:
      "Mostra ao assistente os itens da implantação que estão com o cliente (documentos, certificado, procurações), para responder o que ainda falta mandar. Não marca nada como recebido.",
    oQueToca: "Implantação de clientes",
    risco: "seguro",
    pacotes: ["atender"],
    modulo: "implantacao",
  },
]);
