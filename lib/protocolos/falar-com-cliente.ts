/**
 * A EQUIPE FALA COM O CLIENTE PELA FICHA DO PROTOCOLO, e a IA leva a mensagem (spec 22 §6).
 *
 * Duas ações: "pedir uma informação" (o protocolo vai para aguardando o cliente) e "avisar que
 * resolveu" (o protocolo vai para resolvido). As duas abrem um caso humano CURTO, ligado ao
 * protocolo e já respondido, e enfileiram o `case_reply_turn` — o mesmo laço da spec 15 que a tela
 * de Chamados usa. Nada de envio novo: a mensagem sai pelo agente da conversa, com as travas dele.
 *
 * ═══ POR QUE CASO SOB DEMANDA ═══
 * O motor só permite UM caso aberto por conversa, e um caso aberto desliga a trava anti-promessa.
 * Um protocolo vive dias; prender um caso durante a vida dele bloquearia os outros chamados daquela
 * conversa. Aqui o caso nasce na hora de falar e fecha quando o cliente responde
 * (`resposta-do-cliente.ts`) ou já nasce fechado (avisar que resolveu). Decisão do dono, 05/10/2026.
 *
 * ═══ ORDEM ═══
 * 1. Recusas baratas antes de qualquer efeito: transição válida, protocolo com conversa, conversa
 *    sem pessoa no comando (handoff: quem fala é o atendente, pela inbox).
 * 2. UMA transação `pg`: abrir o caso, responder, enfileirar o turno e ligar o protocolo ao caso.
 *    Ou tudo, ou nada — o mesmo princípio da rota de resposta de caso.
 * 3. O estado do protocolo, pelo serviço de sempre (que recalcula o relógio). Se falhar aqui, a
 *    mensagem já saiu: a resposta diz isso, em vez de mentir com um erro que convidaria a repetir.
 */
import type pg from "pg";
import { z } from "zod";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/auth/types";
import { logger } from "@/lib/logger";
import {
  markAwaitingLead,
  openCase,
  resolveCaseFromHuman,
} from "@/lib/agent-engine/agent/human-cases";
import { enqueueJob } from "@/lib/agent-engine/queue/queue";

import { mudarEstado, numeroDoProtocolo, type Admin } from "./servico";
import { TRANSICOES_DO_PROTOCOLO, type EstadoDoProtocolo } from "./vocabulario";

export const falarComClienteSchema = z.strictObject({
  acao: z.enum(["pedir_informacao", "avisar_resolvido"]),
  texto: z.string().trim().min(3).max(2000),
});
export type FalarComCliente = z.infer<typeof falarComClienteSchema>;

const DESTINO: Record<FalarComCliente["acao"], EstadoDoProtocolo> = {
  pedir_informacao: "aguardando_cliente",
  avisar_resolvido: "resolvido",
};

export interface ResultadoDaFala {
  case_id: string;
  estado: EstadoDoProtocolo;
  /** false quando a mensagem saiu mas o estado do protocolo não pôde ser gravado. */
  estado_atualizado: boolean;
}

function recusa(status: number, code: string, ctx: HandlerCtx, mensagem: string): never {
  throw new ApiError(status, code, undefined, ctx.requestId, mensagem);
}

export async function falarComCliente(
  pool: pg.Pool,
  admin: Admin,
  ctx: HandlerCtx,
  ator: { userId: string; role: Role },
  id: string,
  entrada: FalarComCliente,
): Promise<ResultadoDaFala> {
  const { data, error } = await admin
    .from("protocolos")
    .select("id, ano, numero, titulo, estado, conversation_id, contact_id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", id)
    .maybeSingle();
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    recusa(404, "module_not_installed", ctx, "O módulo Protocolos não está instalado.");
  }
  if (error) throw new Error(`falar_com_cliente: ${error.message}`);
  if (!data) recusa(404, "not_found", ctx, "Protocolo não encontrado.");
  const p = data as {
    id: string;
    ano: number;
    numero: number;
    titulo: string;
    estado: EstadoDoProtocolo;
    conversation_id: string | null;
    contact_id: string | null;
  };
  const numero = numeroDoProtocolo(p);
  const para = DESTINO[entrada.acao];

  if (!TRANSICOES_DO_PROTOCOLO[p.estado].includes(para)) {
    recusa(409, "protocolo_transicao_invalida", ctx, "Neste estado, o protocolo não pode seguir por esta ação.");
  }
  if (!p.conversation_id || !p.contact_id) {
    recusa(
      422,
      "protocolo_sem_conversa",
      ctx,
      "Este protocolo não está ligado a uma conversa. Fale com o cliente pela inbox.",
    );
  }
  const { data: contato } = await admin
    .from("contacts")
    .select("force_human")
    .eq("organization_id", ctx.organization_id)
    .eq("id", p.contact_id)
    .maybeSingle();
  if ((contato as { force_human?: boolean } | null)?.force_human) {
    recusa(
      409,
      "conversa_com_pessoa",
      ctx,
      "Esta conversa está com uma pessoa da equipe, não com a IA. Responda ao cliente pela inbox.",
    );
  }

  const pedir = entrada.acao === "pedir_informacao";
  const client = await pool.connect();
  let caseId: string;
  try {
    await client.query("begin");
    const aberto = await openCase(
      client,
      { tenantId: ctx.organization_id, conversationId: p.conversation_id },
      {
        title: `Protocolo ${numero}: ${p.titulo}`.slice(0, 200),
        summary: entrada.texto,
        blocker: pedir
          ? "A equipe precisa de uma informação do cliente para seguir com o protocolo."
          : "A equipe concluiu o protocolo e quer avisar o cliente.",
        contextSnapshot: { protocolo_id: p.id, protocolo_numero: numero },
        source: "protocolo",
        actorUserId: ator.userId,
      },
    );
    if (!aberto.ok) {
      await client.query("rollback");
      recusa(
        409,
        "conversa_com_chamado_aberto",
        ctx,
        "Esta conversa já tem um chamado aberto com a IA. Responda por ele em Chamados, ou espere ele fechar.",
      );
    }
    caseId = aberto.caseId;
    const respondido = pedir
      ? await markAwaitingLead(client, ctx.organization_id, caseId, ator.userId, entrada.texto)
      : await resolveCaseFromHuman(client, ctx.organization_id, caseId, ator.userId, entrada.texto);
    if (!respondido) throw new Error("falar_com_cliente: o caso recém-aberto não aceitou a resposta");
    await enqueueJob(client, ctx.organization_id, {
      kind: "case_reply_turn",
      leadId: p.contact_id,
      payload: { case_id: caseId, action: pedir ? "need_lead_info" : "resolved", body: entrada.texto },
    });
    await client.query(
      "update public.protocolos set agent_case_id = $3 where organization_id = $1 and id = $2",
      [ctx.organization_id, p.id, caseId],
    );
    await client.query(
      "select public.fn_protocolo_registrar_evento($1, $2, 'nota', $3, $4, 'humano', null)",
      [ctx.organization_id, p.id, `Mensagem ao cliente, levada pela IA: ${entrada.texto}`, ator.userId],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  let estadoAtualizado = true;
  try {
    await mudarEstado(admin, ctx, { userId: ator.userId, kind: "humano" }, p.id, para, pedir ? null : entrada.texto);
  } catch (e) {
    estadoAtualizado = false;
    logger.error("[protocolos] mensagem enviada, estado do protocolo não gravado", {
      protocolo_id: p.id,
      error: e instanceof Error ? e.message : String(e),
      requestId: ctx.requestId,
    });
  }

  await audit({
    organizationId: ctx.organization_id,
    actorUserId: ator.userId,
    action: "protocolos.cliente_contatado",
    resourceType: "protocolos",
    resourceId: p.id,
    requestId: ctx.requestId,
    metadata: { acao: entrada.acao, case_id: caseId, estado_atualizado: estadoAtualizado },
  });
  return { case_id: caseId, estado: estadoAtualizado ? para : p.estado, estado_atualizado: estadoAtualizado };
}
