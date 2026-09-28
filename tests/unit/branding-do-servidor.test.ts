/**
 * A MARCA DAS TELAS DE SERVIDOR — `lib/branding/servidor.ts`.
 *
 * Login, cadastro, `/get-started`, a casca e as boas-vindas da configuração
 * inicial e o texto legal liam `branding()`, que só enxerga o `.env`. Numa
 * instalação que salvou o nome em `/admin/marca` sem mexer no `APP_NAME`, a
 * casca do onboarding seguia dizendo "DESKCOMMCRM" acima do nome da empresa —
 * reportado numa VPS real. Estes casos guardam as duas metades da regra: o banco
 * vence o `.env`, e um banco que falha nunca derruba a tela de entrada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** O que `marcaDaInstalacao()` devolve no caso corrente; `"explode"` = lança. */
let linha: { app_name?: string | null; logo_url?: string | null } | null | "explode" = null;

vi.mock("@/lib/branding/instalacao", () => ({
  marcaDaInstalacao: async () => {
    if (linha === "explode") throw new Error("conexão recusada");
    return linha;
  },
}));

async function carregar() {
  vi.resetModules();
  return (await import("@/lib/branding/servidor")).brandingDoServidor;
}

describe("brandingDoServidor", () => {
  const nomeOriginal = process.env.APP_NAME;

  beforeEach(() => {
    process.env.APP_NAME = "Nome do Env";
  });
  afterEach(() => {
    linha = null;
    if (nomeOriginal === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = nomeOriginal;
  });

  it("o nome salvo na tela vence o APP_NAME do .env", async () => {
    linha = { app_name: "Soios CRM", logo_url: null };
    const marca = await (await carregar())();
    expect(marca.name).toBe("Soios CRM");
    expect(marca.initial).toBe("S");
  });

  it("sem marca no banco, o .env continua sendo o piso", async () => {
    linha = null;
    const marca = await (await carregar())();
    expect(marca.name).toBe("Nome do Env");
  });

  it("banco que lança não derruba a tela: cai no que branding() devolve", async () => {
    linha = "explode";
    const marca = await (await carregar())();
    expect(marca.name).toBe("Nome do Env");
  });
});
