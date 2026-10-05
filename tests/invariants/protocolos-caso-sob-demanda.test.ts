/**
 * Protocolo ↔ caso humano, sob demanda (spec 22 §6, migration 0906) — contra o banco de verdade.
 *
 * Os testes unitários de `lib/protocolos/` provam a ordem e as recusas com o banco simulado; aqui
 * o SQL roda de fato: o CHECK novo aceita `source = 'protocolo'`, a resposta do cliente volta ao
 * protocolo com o prazo retomado e o caso fecha, numa transação — e nenhum caminho do protocolo
 * fecha ou cancela um caso que a IA abriu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  cancelarCasoDoProtocolo,
  hasOpenCaseForContact,
  markAwaitingLead,
  openCase,
  provideCaseUpdate,
} from "@/lib/agent-engine/agent/human-cases";
import { registrarRespostaNoProtocolo } from "@/lib/protocolos/resposta-do-cliente";

import { GOV_AGENT_A, GOV_ORG, seedGov, sql } from "./gov-helpers";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres`,
  max: 2,
});

// Namespace próprio (09060000-): um caso aberto por conversa, então nenhuma outra suíte pode
// dividir estas conversas.
const SESSAO = "09060000-2222-4000-8000-000000000001";
const CATEGORIA = "09060000-3333-4000-8000-000000000001";
const POLITICA = "09060000-4444-4000-8000-000000000001";

let seq = 0;
function conversaNova(): { contato: string; conversa: string } {
  seq += 1;
  const n = String(seq).padStart(12, "0");
  const contato = `09060000-5555-4000-8000-${n}`;
  const conversa = `09060000-6666-4000-8000-${n}`;
  sql(`
    insert into public.contacts (id, organization_id, name, phone_number)
      values ('${contato}', '${GOV_ORG}', 'Contato 0906', '+5511906${n.slice(-6)}') on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
      values ('${conversa}', '${GOV_ORG}', '${contato}', '${SESSAO}', 'ai_handling', false) on conflict (id) do nothing;
  `);
  return { contato, conversa };
}

async function protocoloAguardandoCliente(contato: string, conversa: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.protocolos
       (organization_id, categoria_id, titulo, descricao, prioridade, area, origem,
        contact_id, conversation_id, politica_sla_id, resolucao_vence_em)
     values ($1, $2, 'Guia', 'Pedido de guia', 'P3', 'fiscal', 'humano', $3, $4, $5, now() + interval '2 days')
     returning id`,
    [GOV_ORG, CATEGORIA, contato, conversa, POLITICA],
  );
  const id = rows[0]!.id;
  await pool.query(`update public.protocolos set estado = 'em_atendimento' where id = $1`, [id]);
  await pool.query(
    `update public.protocolos set estado = 'aguardando_cliente', pausado_desde = now() - interval '2 hours' where id = $1`,
    [id],
  );
  return id;
}

/** O que a ficha faz na transação dela (`falar-com-cliente.ts`), sem a parte do PostgREST. */
async function pedirPelaFicha(conversa: string, protocolo: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const aberto = await openCase(
      client,
      { tenantId: GOV_ORG, conversationId: conversa },
      { title: "Protocolo", summary: "Precisamos do CNPJ", blocker: "x", source: "protocolo", actorUserId: GOV_AGENT_A },
    );
    if (!aberto.ok) throw new Error(aberto.error.code);
    expect(await markAwaitingLead(client, GOV_ORG, aberto.caseId, GOV_AGENT_A, "Precisamos do CNPJ")).toBe(true);
    await client.query("update public.protocolos set agent_case_id = $2 where id = $1", [protocolo, aberto.caseId]);
    await client.query("commit");
    return aberto.caseId;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_protocolos_provisionar();
    insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
      values ('${SESSAO}', '${GOV_ORG}', 'sessao-0906', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing;
    insert into public.protocolo_categorias (id, organization_id, parent_id, nome, slug, area)
      values ('${CATEGORIA}', '${GOV_ORG}', null, 'Fiscal 0906', 'fiscal-0906', 'fiscal') on conflict do nothing;
    insert into public.protocolo_politicas_sla
      (id, organization_id, prioridade, primeira_resposta_min, resolucao_min, em_horario_util, pausa_aguardando_cliente)
      values ('${POLITICA}', '${GOV_ORG}', 'P3', 60, 2880, false, true) on conflict do nothing;
  `);
});

afterAll(async () => {
  await pool.end();
});

describe("caso aberto pela ficha do protocolo", () => {
  it("o CHECK aceita a origem 'protocolo', e o evento de abertura registra quem abriu", async () => {
    const { conversa, contato } = conversaNova();
    const protocolo = await protocoloAguardandoCliente(contato, conversa);
    const caso = await pedirPelaFicha(conversa, protocolo);
    const { rows } = await pool.query(
      `select c.source, c.status, e.actor_kind, e.actor_user_id
         from agent_cases c join agent_case_events e on e.case_id = c.id and e.kind = 'opened'
        where c.id = $1`,
      [caso],
    );
    expect(rows[0]).toEqual({ source: "protocolo", status: "awaiting_lead", actor_kind: "human", actor_user_id: GOV_AGENT_A });
  });

  it("o cliente responde: a resposta entra no protocolo, o prazo volta a correr e o caso fecha", async () => {
    const { conversa, contato } = conversaNova();
    const protocolo = await protocoloAguardandoCliente(contato, conversa);
    const { rows: antes } = await pool.query(`select resolucao_vence_em from public.protocolos where id = $1`, [protocolo]);
    const caso = await pedirPelaFicha(conversa, protocolo);

    expect(await provideCaseUpdate(pool, { tenantId: GOV_ORG, conversationId: conversa }, { caseId: caso, info: "CNPJ 123" })).toEqual({ ok: true });
    const r = await registrarRespostaNoProtocolo(pool, GOV_ORG, caso, "CNPJ 123");
    expect(r?.numero).toMatch(/^\d{4}-\d{6}$/);

    const { rows: p } = await pool.query(
      `select estado, pausado_desde, extract(epoch from pausa_acumulada)::int as pausa_s, resolucao_vence_em
         from public.protocolos where id = $1`,
      [protocolo],
    );
    expect(p[0].estado).toBe("em_atendimento");
    expect(p[0].pausado_desde).toBeNull();
    expect(p[0].pausa_s).toBeGreaterThanOrEqual(2 * 3600 - 60);
    expect(new Date(p[0].resolucao_vence_em).getTime() - new Date(antes[0].resolucao_vence_em).getTime()).toBeGreaterThanOrEqual(
      (2 * 3600 - 60) * 1000,
    );

    const { rows: ev } = await pool.query(
      `select texto, ator_kind from public.protocolo_eventos where protocolo_id = $1 and tipo = 'complemento_do_cliente'`,
      [protocolo],
    );
    expect(ev).toEqual([{ texto: "CNPJ 123", ator_kind: "ia" }]);

    const { rows: c } = await pool.query(`select status from agent_cases where id = $1`, [caso]);
    expect(c[0].status).toBe("resolved");
    expect(await hasOpenCaseForContact(pool, GOV_ORG, conversa)).toBe(false);
  });

  it("caso da IA (sem protocolo) não é tocado pelo caminho do protocolo", async () => {
    const { conversa } = conversaNova();
    const aberto = await openCase(pool, { tenantId: GOV_ORG, conversationId: conversa }, { title: "t", summary: "s", blocker: "b" });
    if (!aberto.ok) throw new Error(aberto.error.code);
    expect(await registrarRespostaNoProtocolo(pool, GOV_ORG, aberto.caseId, "x")).toBeNull();
    expect(await cancelarCasoDoProtocolo(pool, GOV_ORG, aberto.caseId, GOV_AGENT_A)).toBe(false);
    const { rows } = await pool.query(`select status from agent_cases where id = $1`, [aberto.caseId]);
    expect(rows[0].status).toBe("awaiting_human");
  });

  it("protocolo encerrado com o caso esperando o cliente: o caso é cancelado", async () => {
    const { conversa, contato } = conversaNova();
    const protocolo = await protocoloAguardandoCliente(contato, conversa);
    const caso = await pedirPelaFicha(conversa, protocolo);
    expect(await cancelarCasoDoProtocolo(pool, GOV_ORG, caso, GOV_AGENT_A)).toBe(true);
    const { rows } = await pool.query(
      `select c.status, e.actor_kind from agent_cases c
         join agent_case_events e on e.case_id = c.id and e.kind = 'cancelled' where c.id = $1`,
      [caso],
    );
    expect(rows[0]).toEqual({ status: "cancelled", actor_kind: "human" });
  });
});
