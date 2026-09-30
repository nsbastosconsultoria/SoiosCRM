import { describe, expect, it } from "vitest";

import {
  checkpointDeContinuidade,
  parseCheckpointText,
} from "@/lib/agent-engine/agent/abertura/checkpoint";

/**
 * O parse do fechamento do turno, com os formatos que um modelo de fato devolve.
 *
 * Medido em 30/09/2026 com `gpt-5.4-mini`: o turno respondia ao cliente e o
 * fechamento caía em "JSON de checkpoint inválido". O parse antigo pegava "do
 * primeiro '{' ao último '}'" — e JSON seguido de prosa com chaves, ou o JSON
 * repetido, virava um texto que nenhum `JSON.parse` aceita.
 */
const OK = { commitments: ["retornar"], objections: [], next_action: "aguardar", rolling_summary: "r" };

describe("parseCheckpointText — tolerante ao que o modelo devolve", () => {
  it("JSON limpo continua valendo", () => {
    expect(parseCheckpointText(JSON.stringify(OK)).rolling_summary).toBe("r");
  });

  it("cerca de código em volta", () => {
    expect(parseCheckpointText("```json\n" + JSON.stringify(OK) + "\n```").next_action).toBe("aguardar");
  });

  it("JSON seguido de prosa com chaves — o caso que quebrava", () => {
    const t = `${JSON.stringify(OK)}\n\nObs.: o cliente disse {não sei}.`;
    expect(parseCheckpointText(t).commitments).toEqual(["retornar"]);
  });

  it("dois objetos: vale o primeiro que o schema aceita", () => {
    const t = `{"rascunho": true, "commitments": "não é lista"} ${JSON.stringify(OK)}`;
    expect(parseCheckpointText(t).rolling_summary).toBe("r");
  });

  it("chave dentro de string não confunde a varredura", () => {
    const t = `Segue: {"commitments": [], "objections": [], "next_action": null, "rolling_summary": "cliente mandou } e {"} fim`;
    expect(parseCheckpointText(t).rolling_summary).toBe("cliente mandou } e {");
  });

  it("vírgula sobrando antes de } e ]", () => {
    const t = '{"commitments": ["a",], "objections": [], "next_action": null, "rolling_summary": "x",}';
    expect(parseCheckpointText(t).commitments).toEqual(["a"]);
  });

  it("sem JSON nenhum → erro, sem o texto do modelo na mensagem", () => {
    expect(() => parseCheckpointText("não tenho JSON pra você, CPF 123")).toThrow(/sem JSON de checkpoint/);
    expect(() => parseCheckpointText("não tenho JSON pra você, CPF 123")).not.toThrow(/CPF/);
  });

  it("JSON irrecuperável → erro de JSON inválido", () => {
    expect(() => parseCheckpointText('{"commitments": [, "rolling_summary": "q"}')).toThrow(
      /JSON de checkpoint inválido/,
    );
  });

  it("JSON válido com shape errado → erro de shape, como antes", () => {
    expect(() => parseCheckpointText('{"commitments": "não é lista"}')).toThrow(/shape inválido/);
  });
});

describe("checkpointDeContinuidade — a memória anterior segue adiante", () => {
  it("copia o que havia e não inventa declaração", () => {
    const c = checkpointDeContinuidade({
      commitments: ["ligar"],
      objections: ["preço"],
      next_action: "ligar amanhã",
      rolling_summary: "resumo",
    });
    expect(c).toEqual({
      commitments: ["ligar"],
      objections: ["preço"],
      next_action: "ligar amanhã",
      rolling_summary: "resumo",
    });
    expect("declaracao" in c).toBe(false);
  });

  it("sem checkpoint anterior → memória vazia", () => {
    expect(checkpointDeContinuidade(null)).toEqual({
      commitments: [],
      objections: [],
      next_action: null,
      rolling_summary: "",
    });
  });
});
