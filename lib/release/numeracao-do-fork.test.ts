import { describe, expect, it } from "vitest";

import { ehVersaoDoFork, proximaVersaoDoFork, versoesDoChangelog } from "./numeracao-do-fork";

describe("numeração do fork Soios", () => {
  it("primeira release do fork em cima de uma minor do original → correção 100", () => {
    expect(proximaVersaoDoFork(["1.85.0", "1.84.0", "1.83.0"])).toEqual({ versao: "1.85.100", anterior: "1.85.0" });
  });

  it("já há release do fork nessa minor → a maior + 1", () => {
    expect(proximaVersaoDoFork(["1.85.101", "1.85.100", "1.85.0"])).toEqual({ versao: "1.85.102", anterior: "1.85.101" });
  });

  it("sincronizou com a minor seguinte do original → volta para 100 na minor nova", () => {
    expect(proximaVersaoDoFork(["1.86.0", "1.85.101", "1.85.100", "1.85.0"]).versao).toBe("1.86.100");
  });

  it("correção do original sincronizada DEPOIS da release do fork, e acima dela no arquivo: não reusa 1.85.100", () => {
    expect(proximaVersaoDoFork(["1.85.1", "1.85.100", "1.85.0"]).versao).toBe("1.85.101");
  });

  it("tag do fork que o CHANGELOG não tem também conta (nada de reusar número publicado)", () => {
    expect(proximaVersaoDoFork(["1.85.0", "1.85.100", "1.85.103"]).versao).toBe("1.85.104");
  });

  it("release do fork acima da última minor do original conhecida: recusa em vez de colidir", () => {
    expect(() => proximaVersaoDoFork(["1.85.0", "1.86.100"])).toThrow(/Sincronize/);
  });

  it("sem versão do original: recusa", () => {
    expect(() => proximaVersaoDoFork(["1.85.100"])).toThrow();
    expect(() => proximaVersaoDoFork([])).toThrow();
  });

  it("nunca colide com o original e ordena certo contra ele", () => {
    const v = proximaVersaoDoFork(["1.85.0"]).versao;
    expect(ehVersaoDoFork(v)).toBe(true);
    expect(ehVersaoDoFork("1.85.0")).toBe(false);
    expect(ehVersaoDoFork("1.85.9")).toBe(false);
    const ordem = ["1.86.0", "1.85.100", "1.85.9", "1.85.0", "1.81.0"];
    const ordenada = [...ordem].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    expect(ordenada).toEqual(ordem);
  });

  it("lê as versões das seções do CHANGELOG, e não as do rodapé de links", () => {
    const changelog = [
      "## [Não lançado]",
      "",
      "## [1.85.0] — 2026-10-17",
      "## [1.85.100] — 2026-10-20",
      "",
      "[1.85.0]: https://exemplo/compare/v1.84.0...v1.85.0",
    ].join("\n");
    expect(versoesDoChangelog(changelog)).toEqual(["1.85.0", "1.85.100"]);
  });
});
