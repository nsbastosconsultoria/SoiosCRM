/**
 * As instruções que o agente recebe num follow-up — os três defeitos da
 * reavaliação de 2026-10-02.
 *
 * 1. O passo de um FLUXO herdava a abertura do follow-up agendado pelo agente e
 *    afirmava "você havia combinado retornar" e "NÃO houve nova mensagem dele" —
 *    falso num fluxo de lead novo e falso no ramo `ai_classify → action`, que
 *    roda justamente porque o lead respondeu.
 * 2. As duas aberturas de follow-up mandavam usar `update_lead_state` e
 *    `save_lead_note` mesmo quando o runtime as tinha tirado do turno (Operador
 *    ligado) — a abertura do inbound já respeitava a lista.
 * 3. O `prompt_hint` do dono vinha depois de "retome com naturalidade", sem
 *    dizer quem vence.
 *
 * O que NÃO prova: que o modelo obedece. Mede o texto que chega a ele.
 */
import { describe, expect, it } from "vitest";

import {
  buildFlowStepOpeningMessage,
  buildFollowupOpeningMessage,
} from "@/lib/agent-engine/agent/followup-turn";
import { buildCaseReplyOpeningMessage } from "@/lib/agent-engine/agent/case-reply-turn";
import { buildOpeningMessage } from "@/lib/agent-engine/agent/inbound-turn";
import type { LeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

const msg = (direction: "inbound" | "outbound", body: string, sent_at: string) =>
  ({ direction, body, sent_at }) as LeadContext["messages"][number];

const contexto = (messages: LeadContext["messages"]): LeadContext =>
  ({ contact: { name: "Cliente", email: "c@x.com" }, messages }) as unknown as LeadContext;

const ENTREGUES = ["update_lead_state", "save_lead_note"] as const;

const passo = (over: Partial<Parameters<typeof buildFlowStepOpeningMessage>[0]> = {}) =>
  buildFlowStepOpeningMessage({
    temporalBlock: "Passaram 2 dias desde a última resposta do lead.",
    previous: null,
    leadState: null,
    context: contexto([]),
    notesIndexBlock: "sem notas",
    ...over,
  });

describe("passo de fluxo — o prompt não afirma o que pode ser falso", () => {
  it("não diz que o agente combinou retornar nem que o lead ficou em silêncio", () => {
    const t = passo();
    expect(t).not.toContain("você havia combinado retornar");
    expect(t).not.toContain("NÃO houve nova mensagem");
    expect(t).toContain("Passo de um fluxo de follow-up configurado pela empresa");
    expect(t).toContain("não diga que tinha prometido retornar");
  });

  it("quando o lead respondeu depois do nosso envio, a resposta vem destacada", () => {
    const t = passo({
      context: contexto([
        msg("outbound", "Oi! Ainda tem interesse?", "2026-10-01T10:00:00Z"),
        msg("inbound", "Tenho sim, mas só mês que vem", "2026-10-01T11:00:00Z"),
      ]),
    });
    expect(t).toContain("## Resposta do lead desde a última mensagem enviada");
    expect(t).toContain(JSON.stringify({ texto: "Tenho sim, mas só mês que vem" }));
    expect(t).not.toContain("O lead não respondeu");
  });

  it("quando o lead não respondeu ao nosso último envio, diz isso — e só isso", () => {
    const t = passo({
      context: contexto([
        msg("inbound", "Quanto custa?", "2026-09-28T10:00:00Z"),
        msg("outbound", "R$ 200. Posso agendar?", "2026-09-28T10:05:00Z"),
      ]),
    });
    expect(t).toContain("O lead não respondeu desde a última mensagem enviada.");
    expect(t).not.toContain("## Resposta do lead desde a última mensagem enviada");
  });

  it("sem conversa nenhuma, não afirma silêncio nem resposta", () => {
    const t = passo();
    expect(t).not.toContain("O lead não respondeu");
    expect(t).not.toContain("## Resposta do lead");
  });
});

describe("passo de fluxo — a orientação do dono declara precedência", () => {
  it("com orientação: bloco prioritário, e o rodapé não manda 'retomar'", () => {
    const t = passo({ promptHint: "Mande só a pesquisa de satisfação, sem retomar assunto." });
    expect(t).toContain("## Orientação do passo do fluxo — prioritária");
    expect(t).toContain("se ela conflitar com a orientação");
    expect(t).toContain("Mande só a pesquisa de satisfação, sem retomar assunto.");
    expect(t).not.toContain("Retome a conversa com naturalidade");
    // A orientação vem antes do rodapé genérico, não depois dele.
    expect(t.indexOf("## Orientação do passo do fluxo")).toBeLessThan(t.indexOf("send_message"));
  });

  it("sem orientação (ou só espaços): nenhum bloco vazio, rodapé de retomada", () => {
    for (const promptHint of [undefined, "   "]) {
      const t = passo({ promptHint });
      expect(t).not.toContain("## Orientação do passo do fluxo");
      expect(t).toContain("Retome a conversa com naturalidade");
    }
  });
});

describe("follow-up não cita ferramenta que o turno não tem", () => {
  it("passo de fluxo: com o Operador dono das duas, nenhuma é citada", () => {
    const t = passo({ entregues: ENTREGUES });
    expect(t).not.toContain("update_lead_state");
    expect(t).not.toContain("save_lead_note");
  });

  it("follow-up agendado: idem", () => {
    const t = buildFollowupOpeningMessage("bloco", null, null, contexto([]), "sem notas", false, ENTREGUES);
    expect(t).not.toContain("update_lead_state");
    expect(t).not.toContain("save_lead_note");
  });

  it("controle: sem Operador, as duas continuam citadas nos dois caminhos", () => {
    for (const t of [
      passo(),
      buildFollowupOpeningMessage("bloco", null, null, contexto([]), "sem notas"),
    ]) {
      expect(t).toContain("update_lead_state");
      expect(t).toContain("save_lead_note");
    }
  });

  it("entrega parcial: só a ferramenta entregue some", () => {
    const t = passo({ entregues: ["save_lead_note"] });
    expect(t).toContain("update_lead_state");
    expect(t).not.toContain("save_lead_note");
  });

  it("o inbound segue igual depois da extração do rodapé", () => {
    const com = buildOpeningMessage(null, null, contexto([]), "sem notas", false, ENTREGUES);
    const sem = buildOpeningMessage(null, null, contexto([]), "sem notas");
    expect(com).not.toContain("update_lead_state");
    expect(com).not.toContain("save_lead_note");
    expect(sem).toContain("update_lead_state");
    expect(sem).toContain("save_lead_note");
  });
});

describe("follow-up agendado pelo agente — o cabeçalho continua o dele", () => {
  it("mantém a afirmação de promessa, que ali é verdadeira", () => {
    const t = buildFollowupOpeningMessage("bloco", null, null, contexto([]), "sem notas");
    expect(t).toContain("você havia combinado retornar");
    expect(t).toContain("Retome a conversa com naturalidade");
  });
});

describe("resposta de caso — mesma regra de ferramentas", () => {
  const abrir = (entregues?: readonly string[]) =>
    buildCaseReplyOpeningMessage(
      "need_lead_info",
      "11111111-2222-3333-4444-555555555555",
      "o CPF do titular",
      null,
      null,
      contexto([]),
      "sem notas",
      false,
      entregues,
    );

  it("com o Operador dono das duas, nenhuma é citada", () => {
    const t = abrir(ENTREGUES);
    expect(t).not.toContain("update_lead_state");
    expect(t).not.toContain("save_lead_note");
    // A instrução do caso continua inteira.
    expect(t).toContain("provide_case_update");
  });

  it("controle: sem Operador, as duas continuam citadas", () => {
    const t = abrir();
    expect(t).toContain("update_lead_state");
    expect(t).toContain("save_lead_note");
  });
});
