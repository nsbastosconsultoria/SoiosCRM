import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * RECONECTAR O MESMO NÚMERO COMO CANAL NOVO LEVA AS CONVERSAS JUNTO (migration 0901).
 *
 * Medido numa instalação real em 30/09/2026: o operador excluiu o canal que
 * tinha caído e conectou o mesmo número como canal novo. O canal velho foi
 * arquivado com as conversas dentro, e o follow-up de um lead que só estava em
 * silêncio morreu — o envio recusava com "canal arquivado" até a fila desistir.
 *
 * Com Postgres de verdade, este arquivo prova:
 *   1. quando o canal novo ganha o número, a conversa 1:1 do canal arquivado
 *      com o mesmo número passa para ele, e o banco audita;
 *   2. o que NÃO se move: conversa de contato que já tem conversa no canal novo
 *      (não funde histórico), grupo, e canal arquivado de outro número;
 *   3. a função não é alcançável pela anon key nem pelo usuário logado.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "eeeeeeee-0901-4000-8000-000000000001";
const OUTRO_NUMERO = "+5563900000999";
/** Um número por caso: canais arquivados de casos anteriores com o MESMO número
 * seriam herdados também — e com razão, é exatamente o que a função faz. */
let NUMERO = "";
let caso = 0;

let seq = 0;
const uuid = () => `eeeeeeee-0901-4000-8000-${String(100 + ++seq).padStart(12, "0")}`;

async function canal(opts: { phone: string | null; arquivado: boolean }): Promise<string> {
  const id = uuid();
  await pool.query(
    `insert into channel_sessions (id, organization_id, provider, waha_session_name, status,
                                   webhook_secret_encrypted, phone_number, archived_at)
     values ($1, $2, 'waha', $3, $4, '\\x00'::bytea, $5, $6)`,
    [
      id,
      ORG,
      `herda-${id}`,
      opts.arquivado ? "STOPPED" : "SCAN_QR_CODE",
      opts.phone,
      opts.arquivado ? new Date("2026-09-30T10:10:49Z") : null,
    ],
  );
  return id;
}

async function contato(nome: string): Promise<string> {
  const id = uuid();
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number) values ($1, $2, $3, $4)`,
    [id, ORG, nome, `+55639${String(10000000 + seq).slice(-8)}`],
  );
  return id;
}

async function conversa(contactId: string, canalId: string): Promise<string> {
  const id = uuid();
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1, $2, $3, $4, 'open', false)`,
    [id, ORG, contactId, canalId],
  );
  return id;
}

async function grupo(canalId: string): Promise<string> {
  const g = uuid();
  await pool.query(
    `insert into contacts (id, organization_id, name, display_name, kind, source)
     values ($1, $2, 'Grupo', 'Grupo', 'whatsapp_group', 'whatsapp_group')`,
    [g, ORG],
  );
  const id = uuid();
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, channel, status, is_group, group_chat_id)
     values ($1, $2, $3, $4, 'whatsapp', 'open', true, $5)`,
    [id, ORG, g, canalId, `${g}@g.us`],
  );
  return id;
}

async function canalDa(conversaId: string): Promise<string> {
  const { rows } = await pool.query<{ channel_session_id: string }>(
    "select channel_session_id from conversations where organization_id = $1 and id = $2",
    [ORG, conversaId],
  );
  return rows[0]!.channel_session_id;
}

beforeEach(async () => {
  NUMERO = `+55639000${String(10 + ++caso).padStart(5, "0")}`;
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'canal-herda-conversas', 'Canal Herda', 'Canal Herda') on conflict (id) do nothing`,
    [ORG],
  );
  // Cada caso começa sem canal ativo com o número: a trava de número único (0107)
  // vale só entre canais ATIVOS, e os casos criam o seu.
  await pool.query(
    "update channel_sessions set archived_at = now(), status = 'STOPPED' where organization_id = $1 and archived_at is null",
    [ORG],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("canal reconectado herda as conversas do mesmo número", () => {
  it("a conversa do canal arquivado passa para o canal novo quando ele ganha o número", async () => {
    const velho = await canal({ phone: NUMERO, arquivado: true });
    const lead = await contato("Lead em silêncio");
    const conv = await conversa(lead, velho);

    // O canal novo nasce SEM número (pareando) e o ganha quando o QR é lido —
    // é a ordem real: a rota do canal grava `phone_number` ao ver WORKING.
    const novo = await canal({ phone: null, arquivado: false });
    expect(await canalDa(conv)).toBe(velho);

    await pool.query(
      "update channel_sessions set phone_number = $3, status = 'WORKING' where organization_id = $1 and id = $2",
      [ORG, novo, NUMERO],
    );

    expect(await canalDa(conv)).toBe(novo);

    const { rows: audit } = await pool.query<{
      metadata: { conversations: number; from_channel_session_ids: string[] };
    }>(
      `select metadata from api_audit_log
        where organization_id = $1 and action = 'channel.conversations_inherited' and resource_id = $2`,
      [ORG, novo],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata.conversations).toBe(1);
    expect(audit[0]!.metadata.from_channel_session_ids).toEqual([velho]);
  });

  it("não funde: contato que já tem conversa no canal novo deixa a antiga no arquivo", async () => {
    const velho = await canal({ phone: NUMERO, arquivado: true });
    const lead = await contato("Lead que voltou a escrever");
    const antiga = await conversa(lead, velho);

    const novo = await canal({ phone: null, arquivado: false });
    const nova = await conversa(lead, novo);

    await pool.query(
      "update channel_sessions set phone_number = $3 where organization_id = $1 and id = $2",
      [ORG, novo, NUMERO],
    );

    expect(await canalDa(antiga)).toBe(velho);
    expect(await canalDa(nova)).toBe(novo);
  });

  it("grupo e canal arquivado de OUTRO número ficam onde estão", async () => {
    const velho = await canal({ phone: NUMERO, arquivado: true });
    const deOutroNumero = await canal({ phone: OUTRO_NUMERO, arquivado: true });
    const doGrupo = await grupo(velho);
    const lead = await contato("Lead do outro número");
    const daOutra = await conversa(lead, deOutroNumero);

    const novo = await canal({ phone: null, arquivado: false });
    await pool.query(
      "update channel_sessions set phone_number = $3 where organization_id = $1 and id = $2",
      [ORG, novo, NUMERO],
    );

    expect(await canalDa(doGrupo)).toBe(velho);
    expect(await canalDa(daOutra)).toBe(deOutroNumero);
  });

  it("o backfill (a função chamada direto) é idempotente", async () => {
    const velho = await canal({ phone: NUMERO, arquivado: true });
    const lead = await contato("Lead do backfill");
    const conv = await conversa(lead, velho);
    // Canal ativo que JÁ tinha o número antes da migration: o gatilho não
    // dispara de novo, é o backfill que alcança.
    const novo = await canal({ phone: null, arquivado: false });
    await pool.query("alter table channel_sessions disable trigger trg_canal_herda_conversas");
    try {
      await pool.query(
        "update channel_sessions set phone_number = $3 where organization_id = $1 and id = $2",
        [ORG, novo, NUMERO],
      );
    } finally {
      await pool.query("alter table channel_sessions enable trigger trg_canal_herda_conversas");
    }
    expect(await canalDa(conv)).toBe(velho);

    const um = await pool.query<{ n: number }>(
      "select public.fn_canal_herda_conversas_do_numero($1, $2) as n",
      [ORG, novo],
    );
    const dois = await pool.query<{ n: number }>(
      "select public.fn_canal_herda_conversas_do_numero($1, $2) as n",
      [ORG, novo],
    );
    expect(um.rows[0]!.n).toBe(1);
    expect(dois.rows[0]!.n).toBe(0);
    expect(await canalDa(conv)).toBe(novo);
  });

  it("a função não é RPC alcançável por anon nem authenticated", async () => {
    const { rows } = await pool.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.fn_canal_herda_conversas_do_numero(uuid,uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.fn_canal_herda_conversas_do_numero(uuid,uuid)', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.fn_canal_herda_conversas_do_numero(uuid,uuid)', 'execute') as service`,
    );
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });
});
