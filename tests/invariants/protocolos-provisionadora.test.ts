/**
 * Protocolos — módulo opcional via ADR-0002 (migration 0904, spec 22).
 *
 * O molde cobre forma (D4) e efeito: provisionar cria exatamente as oito tabelas, protegidas, e o
 * núcleo fica intocado. `protecaoPropria` em todas: a RLS é por operação (configuração escrita
 * pelo `admin`, protocolos só lidos pela sessão, contador fechado), ligada dentro da função.
 */
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

const TABELAS = [
  "protocolo_categorias",
  "protocolo_politicas_sla",
  "protocolo_area_membros",
  "protocolo_feriados",
  "protocolo_contadores",
  "protocolos",
  "protocolo_eventos",
  "protocolo_marcos_sla",
];

moldeDeProvisionadora({
  modulo: "protocolos",
  tabelas: TABELAS,
  protecaoPropria: TABELAS,
});
