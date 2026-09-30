import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O FECHAMENTO ILEGÍVEL NÃO REFAZ O TURNO.
 *
 * Medido numa instalação real em 30/09/2026, com `gpt-5.4-mini`: o agente
 * respondeu ao cliente, a segunda chamada (o JSON de checkpoint) veio quebrada,
 * e o log disse `JSON de checkpoint inválido no fechamento do turno — run
 * re-tentado pela fila`. A fila refez o turno INTEIRO — outra chamada de modelo
 * cara, para uma resposta que não saía mais (o envio já constava).
 *
 * O que este arquivo prova, com Postgres de verdade e modelo fake:
 *   1. JSON seguido de prosa com chaves é aceito de primeira (o parse antigo,
 *      "do primeiro '{' ao último '}'", juntava os dois e quebrava);
 *   2. fechamento ilegível UMA vez → só o fechamento é repetido, e o segundo vale;
 *   3. ilegível DUAS vezes → o job termina sem erro, a memória anterior é
 *      mantida — sem o erro que fazia a fila refazer o turno inteiro.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "dddddddd-0000-4000-8000-000000000001";
const CONTACT = "dddddddd-0000-4000-8000-000000000002";
const SESSION = "dddddddd-0000-4000-8000-000000000003";
const CONV = "dddddddd-0000-4000-8000-000000000004";
const MSG = "dddddddd-0000-4000-8000-000000000005";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  CHECKPOINT_INSTRUCTION: string;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

let enviados: string[] = [];
let chamadasDeFechamento = 0;
let chamadasDeResposta = 0;

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function texto(t: string) {
  return {
    content: [{ type: "text" as const, text: t }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

/** O texto da ÚLTIMA mensagem de usuário do prompt — é onde a instrução de fechamento vai. */
function ultimaFalaDoUsuario(prompt: unknown): string {
  const msgs = (prompt ?? []) as Array<{ role: string; content?: unknown }>;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return (msg.content as Array<{ type?: string; text?: string }>)
        .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
        .join("");
    }
    return "";
  }
  return "";
}

/**
 * Modelo fake: responde ao cliente com texto e, no fechamento, devolve os textos
 * de `fechamentos` em ordem (o último se repete). Qualquer outra chamada (os
 * classificadores laterais do turno) recebe o texto da resposta — eles são
 * fail-safe e não decidem nada aqui.
 */
function modelo(fechamentos: string[]) {
  return async (opts: { prompt?: unknown }) => {
    if (ultimaFalaDoUsuario(opts.prompt).includes(m.CHECKPOINT_INSTRUCTION.slice(0, 40))) {
      const t = fechamentos[Math.min(chamadasDeFechamento, fechamentos.length - 1)]!;
      chamadasDeFechamento++;
      return texto(t);
    }
    chamadasDeResposta++;
    return texto("Olá! Como posso ajudar?");
  };
}

function montaHandler(doGenerate: unknown) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 4,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: "captura",
        send: async (i: { body: string }) => {
          enviados.push(i.body);
          return { kind: "sent" as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    clock: () => new Date("2026-07-30T15:00:00Z"),
    sleep: async () => {},
  });
}

let evento = 0;
async function rodaTurno(handler: ReturnType<typeof montaHandler>): Promise<Error | null> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  evento++;
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      inbound_message_id: MSG,
      crm_event_id: `dddddddd-0000-4000-8000-${String(100 + evento).padStart(12, "0")}`,
    },
    maxAttempts: 1,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "ckp", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await handler(claimed!, pool, { workerId: "ckp" });
    await m.queue.completeJob(pool, claimed!.id, "ckp");
    return null;
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "ckp", err);
    return err as Error;
  }
}

async function checkpoints(): Promise<Array<{ rolling_summary: string; next_action: string | null; declaracao: unknown }>> {
  const { rows } = await pool.query(
    `select rolling_summary, next_action, declaracao from lead_checkpoints
      where organization_id = $1 and contact_id = $2 order by seq`,
    [ORG, CONTACT],
  );
  return rows;
}

const VALIDO = (resumo: string) =>
  JSON.stringify({ commitments: [], objections: [], next_action: "aguardar", rolling_summary: resumo });

beforeAll(async () => {
  const turno = await import("@/lib/agent-engine/agent/inbound-turn");
  m = {
    createInboundTurnHandler: turno.createInboundTurnHandler,
    CHECKPOINT_INSTRUCTION: turno.CHECKPOINT_INSTRUCTION,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };

  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'checkpoint-ilegivel','Checkpoint Ilegível','Checkpoint Ilegível')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,'Lead Checkpoint','+5511900000888') on conflict (id) do nothing`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, provider, waha_session_name,
                                   status, webhook_secret_encrypted)
     values ($1,$2,'waha','ckp-waha','WORKING','\\x00'::bytea)
     on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'open',false) on conflict (id) do nothing`,
    [CONV, ORG, CONTACT, SESSION],
  );
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','oi','external_device', now() - interval '1 minute')
     on conflict (id) do nothing`,
    [MSG, ORG, CONV, SESSION, CONTACT],
  );
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(async () => {
  enviados = [];
  chamadasDeFechamento = 0;
  chamadasDeResposta = 0;
  await pool.query("delete from lead_checkpoints where organization_id = $1", [ORG]);
});

describe("fechamento do turno — JSON ilegível não refaz o turno", () => {
  it("JSON seguido de prosa com chaves é aceito de primeira, sem repetir o fechamento", async () => {
    const erro = await rodaTurno(
      montaHandler(modelo([`${VALIDO("resumo 1")}\n\nObs.: nada a declarar {fim}.`])),
    );
    expect(erro).toBeNull();
    expect(chamadasDeFechamento).toBe(1);
    expect((await checkpoints()).map((c) => c.rolling_summary)).toEqual(["resumo 1"]);
  });

  it("ilegível uma vez → repete SÓ o fechamento, e o segundo vale", async () => {
    const erro = await rodaTurno(
      montaHandler(modelo(['{"commitments": [, "rolling_summary": "quebrado"}', VALIDO("resumo 2")])),
    );
    expect(erro).toBeNull();
    expect(chamadasDeFechamento).toBe(2);
    expect((await checkpoints()).map((c) => c.rolling_summary)).toEqual(["resumo 2"]);
  });

  it("ilegível duas vezes → o job termina, a memória anterior segue, e o turno não é refeito", async () => {
    await pool.query(
      `insert into lead_checkpoints (organization_id, contact_id, commitments, objections, next_action, rolling_summary)
       values ($1,$2,'[]','[]','ligar amanhã','memória anterior')`,
      [ORG, CONTACT],
    );

    const erro = await rodaTurno(montaHandler(modelo(["isto não é JSON {"])));

    // O defeito medido: aqui o job lançava e a fila refazia o turno inteiro.
    expect(erro).toBeNull();
    expect(chamadasDeFechamento).toBe(2);
    expect(chamadasDeResposta).toBeGreaterThan(0);

    const linhas = await checkpoints();
    expect(linhas).toHaveLength(2);
    const [, novo] = linhas;
    expect(novo!.rolling_summary).toBe("memória anterior");
    expect(novo!.next_action).toBe("ligar amanhã");
    // "O modelo não declarou" é o estado honesto: nenhuma promessa inventada.
    expect(novo!.declaracao).toBeNull();
  });
});
