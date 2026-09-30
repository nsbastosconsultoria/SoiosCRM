/**
 * Recorte 1 do #636 — o checkpoint do turno, fora do arquivo do turno.
 *
 * Saiu de `inbound-turn.ts` byte a byte (a única linha nova é o `export` de
 * `insertCheckpoint`, que era privado lá): mesmas strings, mesmo Zod, mesma
 * instrução de fechamento — portanto mesmo comportamento.
 *
 * O que mora aqui é o DADO do checkpoint: o schema que o Zod valida na chamada
 * de fechamento, a ROW do `lead_checkpoints`, a instrução fixa (com o
 * `rolling_summary` que ela pede), a gravação e o parse. O fechamento EM SI — a
 * chamada de modelo, o veto e a emissão da atividade — continua em
 * `inbound-turn.ts`: este recorte não toca no laço.
 *
 * `inbound-turn.ts` reexporta estes símbolos, e é por lá que os testes e os
 * irmãos (follow-up, resposta de caso, retomada) continuam os buscando.
 */

import { z } from "zod";

import {
  currentExecutionBoundary,
  guardServiceEffect,
} from "@/lib/atendimento/fronteira-server";

import type { Queryable } from "../../queue/queue";
import {
  DECLARACAO_INSTRUCTION,
  declaracaoDoTurnoSchema,
  type DeclaracaoDoTurno,
} from "../declaracao";

/** Conteúdo do checkpoint — o modelo devolve, o Zod valida, o Postgres guarda. */
export const checkpointContentSchema = z.object({
  commitments: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  next_action: z.string().nullable().default(null),
  rolling_summary: z.string().default(''),
  /**
   * A declaração do turno (spec 16 §5) — a fronteira entre FALAR e OPERAR.
   *
   * `.optional()` SEM default, e a diferença importa: `undefined` significa que o
   * modelo não declarou nada (fechamento incompleto — turno a investigar), e é
   * estado distinto de `{nada_a_declarar: true}`, que é uma avaliação registrada.
   * Um `.default({})` aqui apagaria essa distinção e faria "o modelo esqueceu"
   * parecer "não havia nada" — ver o cabeçalho de `declaracao.ts`.
   *
   * Opcional também é o que mantém a retrocompatibilidade: checkpoint gravado
   * antes desta versão, e clone self-host cujo modelo ainda não conhece o campo,
   * seguem validando.
   */
  declaracao: declaracaoDoTurnoSchema.optional(),
});
export type CheckpointContent = z.infer<typeof checkpointContentSchema>;

/**
 * A ROW como o Postgres a devolve. `declaracao` é `Omit`-ada e redeclarada porque
 * o "não sei" tem representação DIFERENTE nas duas pontas: o modelo omite o campo
 * (`undefined`), o banco guarda `null`. Herdar o `?:` do schema faria o tipo
 * prometer `undefined` onde `select *` entrega `null` — e o `=== undefined` de
 * quem lesse a row seria falso justamente no caso que ele quer pegar.
 */
export interface LeadCheckpointRow extends Omit<CheckpointContent, 'declaracao'> {
  id: string;
  seq: string;
  organization_id: string;
  contact_id: string;
  job_id: string | null;
  created_at: Date;
  declaracao: DeclaracaoDoTurno | null;
}

/**
 * Instrução FIXA do fechamento — o runtime a impõe; o teste a usa como marcador.
 *
 * A declaração (spec 16 §5) viaja AQUI, na chamada que já acontece, e não numa
 * tool: uma `declarar_intencao` dependeria de o modelo lembrar de chamá-la, e o
 * turno em que ele esquecesse seria um lead parado em silêncio. É o mesmo
 * argumento que este arquivo já usa para o checkpoint — e sai de graça, porque
 * é a mesma chamada de modelo.
 */
export const CHECKPOINT_INSTRUCTION =
  'Feche o turno AGORA. Responda SOMENTE com um JSON válido no formato ' +
  '{"commitments": string[], "objections": string[], "next_action": string|null, "rolling_summary": string} ' +
  '— compromissos assumidos, objeções do lead, próxima ação e o resumo acumulado ' +
  'da conversa até aqui (inclua o que o resumo anterior já dizia). ' +
  // ⚠️ O REFERENCIAL DE `next_action`, e ele não é zelo de redação.
  //
  // Este JSON é escrito no FECHO do turno: a pergunta já saiu, a resposta ainda
  // não chegou. Sem dizer QUANDO, "próxima ação" é ambígua entre "o que acabei
  // de fazer" e "o que farei depois" — e o modelo gravava a primeira. No turno
  // seguinte o texto volta como o PRIMEIRO bloco do prompt, acima do histórico,
  // e manda repetir a pergunta que o histórico logo abaixo já responde. Medido
  // numa conversa real: o agente pediu o e-mail QUATRO vezes, com o cliente
  // respondendo três. (issue #510)
  //
  // A negação explícita está aqui porque dizer o que É não basta quando o erro
  // tem um atrator forte: a pergunta recém-feita é o texto mais fresco no
  // contexto do modelo.
  'Em `next_action`, escreva a ação que vem DEPOIS da resposta que você está ' +
  'esperando — nunca a pergunta que você acabou de fazer. Se o turno terminou ' +
  'perguntando, a próxima ação é o que fazer COM a resposta quando ela chegar. ' +
  DECLARACAO_INSTRUCTION +
  ' Sem texto fora do JSON.';

export async function insertCheckpoint(
  db: Queryable,
  input: { tenantId: string; leadId: string; jobId: string; content: CheckpointContent },
): Promise<void> {
  await guardServiceEffect();
  const boundary = currentExecutionBoundary();
  await db.query(
    `insert into lead_checkpoints (organization_id, contact_id, job_id, commitments, objections, next_action, rolling_summary, declaracao, conversation_id, service_revision, demanda_id, demanda_revision)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.tenantId,
      input.leadId,
      input.jobId,
      JSON.stringify(input.content.commitments),
      JSON.stringify(input.content.objections),
      input.content.next_action,
      input.content.rolling_summary,
      // NULL (não `'{}'`) quando o modelo não declarou: a coluna preserva a
      // distinção "não declarou" × "declarou que não havia nada" que o schema
      // sustenta em memória. Gravar um objeto vazio aqui jogaria fora, no
      // Postgres, a informação que o Zod tomou o cuidado de manter.
      input.content.declaracao === undefined ? null : JSON.stringify(input.content.declaracao),
      boundary?.conversation_id ?? null,
      boundary?.service_revision ?? null,
      boundary?.demanda_id ?? null,
      boundary?.demanda_revision ?? null,
    ],
  );
}

/**
 * Os objetos `{...}` de nível mais alto do texto, na ordem em que aparecem.
 *
 * A varredura respeita strings JSON (chave dentro de aspas não abre nem fecha
 * objeto) e escapes. Existe porque "do primeiro '{' ao último '}'" junta DOIS
 * objetos num só quando o modelo devolve o JSON e, depois, prosa com chaves —
 * ou repete o JSON corrigido. Medido em 30/09/2026 com `gpt-5.4-mini`: o turno
 * respondia ao cliente e o fechamento caía em "JSON de checkpoint inválido".
 */
function objetosDeNivelSuperior(text: string): string[] {
  const achados: string[] = [];
  let profundidade = 0;
  let inicio = -1;
  let emString = false;
  let escapado = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (emString) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') emString = false;
      continue;
    }
    if (c === '"') {
      if (profundidade > 0) emString = true;
    } else if (c === '{') {
      if (profundidade === 0) inicio = i;
      profundidade++;
    } else if (c === '}' && profundidade > 0) {
      profundidade--;
      if (profundidade === 0) achados.push(text.slice(inicio, i + 1));
    }
  }
  return achados;
}

/** Vírgula antes de `}`/`]` — o erro de formato mais comum de modelo que escreve JSON à mão. */
function semVirgulaSobrando(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Extrai e valida o JSON do fechamento. Tolerante a cerca de código, prosa em
 * volta, mais de um objeto no texto e vírgula sobrando antes de `}`/`]`: vale o
 * primeiro candidato que o `JSON.parse` aceita E o schema valida. Nenhum → erro
 * SEM o texto do modelo na mensagem (pode carregar PII da conversa).
 */
export function parseCheckpointText(text: string): CheckpointContent {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('fechamento do turno sem JSON de checkpoint — run re-tentado pela fila');
  }
  const brutos = [text.slice(start, end + 1), ...objetosDeNivelSuperior(text)];
  const candidatos = [...brutos, ...brutos.map(semVirgulaSobrando)];
  let primeiroShapeInvalido: string | null = null;
  for (const candidato of new Set(candidatos)) {
    let raw: unknown;
    try {
      raw = JSON.parse(candidato);
    } catch {
      continue;
    }
    const parsed = checkpointContentSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    primeiroShapeInvalido ??= parsed.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.code}`)
      .join('; ');
  }
  if (primeiroShapeInvalido !== null) {
    throw new Error(
      `checkpoint do fechamento com shape inválido (${primeiroShapeInvalido}) — run re-tentado pela fila`,
    );
  }
  throw new Error(
    'JSON de checkpoint inválido no fechamento do turno — run re-tentado pela fila',
  );
}

/**
 * O checkpoint de CONTINUIDADE: o que se grava quando o fechamento do turno veio
 * ilegível duas vezes seguidas.
 *
 * O cliente JÁ recebeu a resposta quando o fechamento roda. Derrubar o job aqui
 * fazia a fila refazer o turno INTEIRO — outra chamada de modelo cara, uma
 * resposta nova que não sai (o envio já consta) e um checkpoint escrito a partir
 * dessa resposta que o cliente nunca viu. Carregar a memória anterior adiante é
 * mais barato e mais fiel ao que a conversa de fato contém; o histórico do turno
 * seguinte mostra ao modelo o que foi dito neste.
 *
 * `declaracao` fica AUSENTE de propósito: "o modelo não declarou" é o estado
 * honesto (ver `checkpointContentSchema`), e nenhuma promessa é inventada.
 */
export function checkpointDeContinuidade(
  anterior: Pick<LeadCheckpointRow, 'commitments' | 'objections' | 'next_action' | 'rolling_summary'> | null,
): CheckpointContent {
  return {
    commitments: anterior?.commitments ?? [],
    objections: anterior?.objections ?? [],
    next_action: anterior?.next_action ?? null,
    rolling_summary: anterior?.rolling_summary ?? '',
  };
}
