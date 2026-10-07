/**
 * Capacidade de IMPLANTAÇÃO — módulo opcional (spec 23 §7, ADR-0002).
 *
 * `modulo: "implantacao"`: com o módulo desligado, a entrada some da tela de capacidades, do
 * agente publicado e do cliente MCP externo. Só leitura.
 *
 * Pacote `reter` ("Não perder o cliente"), e não `atender`: o `atender` chegou ao teto de
 * `TETO_TOOLS_POR_AGENTE` com as capacidades da carteira e dos protocolos, e subir o teto é decisão
 * de produto (`selecao-por-pacote.ts`). Decisão do dono, 07/10/2026: uma implantação parada porque o
 * cliente não mandou o documento é o cliente que esfria — o que o `reter` existe para evitar.
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
    pacotes: ["reter"],
    modulo: "implantacao",
  },
]);
