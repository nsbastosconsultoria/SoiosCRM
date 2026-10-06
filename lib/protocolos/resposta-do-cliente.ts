/**
 * O CLIENTE RESPONDEU O QUE A EQUIPE PEDIU PELA FICHA DO PROTOCOLO (spec 22 §6) — lado do motor.
 *
 * Chamado por `provide_case_update` (`lib/agent-engine/agent/inbound-turn.ts`) depois que o caso
 * voltou para `awaiting_human`. Quando o caso é de um protocolo (`protocolos.agent_case_id`), numa
 * transação só:
 *   - a resposta entra na linha do tempo do protocolo (`complemento_do_cliente`);
 *   - o protocolo sai de "aguardando o cliente" para "em atendimento", e o prazo volta a correr
 *     (o tempo pausado soma ao prazo — `relogio-do-estado.ts`, a MESMA regra da tela);
 *   - o caso fecha: a equipe segue pelo protocolo, e um caso esperando resposta na fila de
 *     Chamados seria trabalho em dobro.
 *
 * Instalação sem o módulo: `to_regclass` devolve nulo e nada acontece — o caso segue o caminho de
 * sempre. Caso sem protocolo: idem. Falhar aqui não desfaz o `provide_case_update`: o caso fica
 * em `awaiting_human`, visível em Chamados, que é o desfecho seguro.
 *
 * `pg` e não PostgREST: o motor da IA fala com o banco por `pg`, e a transição do protocolo é
 * aceita ou recusada pelo gatilho do banco do mesmo jeito nos dois caminhos.
 */
import type pg from "pg";

import { fecharCasoDoProtocoloRespondido } from "@/lib/agent-engine/agent/human-cases";

import { mudancasDoRelogio } from "./relogio-do-estado";
import { expedienteDaOrganizacao } from "./sla";
import type { EstadoDoProtocolo } from "./vocabulario";

/** Colunas que este caminho pode gravar — nunca nome de coluna vindo de fora. */
const COLUNAS = ["estado", "alterado_por", "pausado_desde", "pausa_acumulada", "resolucao_vence_em"] as const;

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : v;
}

export async function registrarRespostaNoProtocolo(
  pool: pg.Pool,
  tenantId: string,
  caseId: string,
  info: string,
): Promise<{ numero: string } | null> {
  const { rows: modulo } = await pool.query<{ ok: boolean }>(
    "select to_regclass('public.protocolos') is not null as ok",
  );
  if (!modulo[0]?.ok) return null;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{
      id: string;
      ano: number;
      numero: number;
      estado: EstadoDoProtocolo;
      pausado_desde: Date | null;
      pausa_min: number;
      resolucao_vence_em: Date | null;
      politica_sla_id: string | null;
    }>(
      `select id, ano, numero, estado, pausado_desde, resolucao_vence_em, politica_sla_id,
              coalesce(round(extract(epoch from pausa_acumulada) / 60), 0)::int as pausa_min
         from public.protocolos
        where organization_id = $1 and agent_case_id = $2
        for update`,
      [tenantId, caseId],
    );
    const p = rows[0];
    if (!p) {
      await client.query("commit");
      return null;
    }

    if (p.estado === "aguardando_cliente") {
      const [{ rows: pol }, { rows: org }, { rows: fer }] = await Promise.all([
        p.politica_sla_id
          ? client.query<{ em_horario_util: boolean; pausa_aguardando_cliente: boolean; pausa_aguardando_terceiro: boolean }>(
              `select em_horario_util, pausa_aguardando_cliente, pausa_aguardando_terceiro
                 from public.protocolo_politicas_sla where organization_id = $1 and id = $2`,
              [tenantId, p.politica_sla_id],
            )
          : Promise.resolve({ rows: [] }),
        client.query<{ settings: unknown }>("select settings from public.organizations where id = $1", [tenantId]),
        client.query<{ data: string }>(
          "select to_char(data, 'YYYY-MM-DD') as data from public.protocolo_feriados where organization_id = $1",
          [tenantId],
        ),
      ]);
      const mudancas: Record<string, unknown> = {
        estado: "em_atendimento",
        alterado_por: null,
        ...mudancasDoRelogio(
          { pausado_desde: iso(p.pausado_desde), pausa_acumulada_min: p.pausa_min, resolucao_vence_em: iso(p.resolucao_vence_em) },
          pol[0] ?? null,
          { expediente: expedienteDaOrganizacao(org[0]?.settings ?? {}), feriados: new Set(fer.map((f) => f.data)) },
          "em_atendimento",
          new Date(),
        ),
      };
      const colunas = COLUNAS.filter((c) => c in mudancas);
      await client.query(
        `update public.protocolos set ${colunas.map((c, i) => `${c} = $${i + 3}`).join(", ")}
          where organization_id = $1 and id = $2`,
        [tenantId, p.id, ...colunas.map((c) => mudancas[c])],
      );
    }

    await client.query(
      "select public.fn_protocolo_registrar_evento($1, $2, 'complemento_do_cliente', $3, null, 'ia', null)",
      [tenantId, p.id, info],
    );
    await fecharCasoDoProtocoloRespondido(client, tenantId, caseId);
    await client.query("commit");
    return { numero: `${p.ano}-${String(p.numero).padStart(6, "0")}` };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
