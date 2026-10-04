import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/types";

import { lancarErroDaCarteira, moduloCarteiraAusente } from "./erros";

function capturar(erro: Parameters<typeof lancarErroDaCarteira>[0]): ApiError {
  try {
    lancarErroDaCarteira(erro, "req-1");
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("lancarErroDaCarteira não lançou");
}

describe("erro do banco → resposta da API (carteira)", () => {
  it("tabela ausente (módulo não instalado) é 409 com a mensagem de quem resolve", () => {
    for (const code of ["42P01", "PGRST205"]) {
      expect(moduloCarteiraAusente({ code })).toBe(true);
      const e = capturar({ code });
      expect(e.status).toBe(409);
      expect(e.code).toBe("module_not_installed");
      expect(e.message).toMatch(/Modo administrador › Módulos/);
    }
  });

  it("transição recusada pela função é 409 com o código estável e o detalhe do banco", () => {
    const e = capturar({ code: "P0001", message: "carteira_transicao_invalida", details: "ativo -> proposta" });
    expect(e.status).toBe(409);
    expect(e.code).toBe("carteira_transicao_invalida");
    expect(e.details).toEqual({ detalhe: "ativo -> proposta" });
  });

  it("organização cruzada recusada pelo gatilho é 422, não 500", () => {
    const e = capturar({ code: "23514", message: "carteira_vinculo_de_outra_organizacao" });
    expect(e.status).toBe(422);
  });

  it("empresa inexistente é 404", () => {
    expect(capturar({ code: "P0002", message: "carteira_empresa_nao_encontrada" }).status).toBe(404);
  });

  it("violação de unicidade é 409; privilégio negado é 403", () => {
    expect(capturar({ code: "23505", message: "duplicate key" }).status).toBe(409);
    expect(capturar({ code: "42501", message: "permission denied" }).status).toBe(403);
  });

  it("erro desconhecido é 500 com o código do banco — nunca engolido", () => {
    const e = capturar({ code: "XX000", message: "algo" });
    expect(e.status).toBe(500);
    expect(e.details).toEqual({ db_code: "XX000" });
  });
});
