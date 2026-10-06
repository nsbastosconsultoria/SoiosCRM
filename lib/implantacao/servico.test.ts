/**
 * Serviço da implantação — o que mora no TypeScript (o resto é do banco e tem invariante):
 * o resumo que decide "pronta para concluir", o modelo padrão no início, a dispensa só de gestor,
 * o conflito de revisão e o modelo de nicho que só cria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const { alterarItem, aplicarModeloDeNicho, iniciarImplantacao, resumoDosItens } = await import("./servico");
const { MODELOS_DE_IMPLANTACAO } = await import("./modelos");

const CTX = { organization_id: "org", requestId: "r" } as never;

type Resposta = { data: unknown; error: unknown };
function banco(respostas: Record<string, Resposta[]>) {
  const escritas: Array<{ tabela: string; op: string; carga: unknown }> = [];
  const rpcs: Array<{ nome: string; args: unknown }> = [];
  const cliente = {
    from(tabela: string) {
      let op = "select";
      let carga: unknown;
      const resolver = () => {
        if (op !== "select") escritas.push({ tabela, op, carga });
        return Promise.resolve((respostas[`${tabela}:${op}`] ?? []).shift() ?? { data: null, error: null });
      };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "order", "limit", "not"]) q[m] = () => q;
      q.insert = (x: unknown) => ((op = "insert"), (carga = x), q);
      q.update = (x: unknown) => ((op = "update"), (carga = x), q);
      q.delete = () => ((op = "delete"), q);
      q.maybeSingle = resolver;
      q.single = resolver;
      q.then = (ok: (r: Resposta) => unknown) => resolver().then(ok);
      return q;
    },
    rpc(nome: string, args: unknown) {
      rpcs.push({ nome, args });
      return Promise.resolve((respostas[`rpc:${nome}`] ?? []).shift() ?? { data: null, error: null });
    },
  };
  return { cliente: cliente as never, escritas, rpcs };
}

beforeEach(() => vi.clearAllMocks());

describe("resumoDosItens", () => {
  const item = (estado: string, obrigatorio: boolean, prazo: string | null = null) =>
    ({ estado, obrigatorio, prazo, vez_de: "cliente", responsavel_user_id: null }) as never;

  it("pronta para concluir só com TODOS os obrigatórios concluídos ou dispensados; opcional aberto não trava", () => {
    expect(resumoDosItens([item("concluido", true), item("dispensado", true), item("pendente", false)], "2026-10-06")).toMatchObject({
      obrigatorios: 2,
      obrigatorios_fechados: 2,
      pode_concluir: true,
    });
    expect(resumoDosItens([item("concluido", true), item("aguardando_cliente", true)], "2026-10-06")).toMatchObject({
      pode_concluir: false,
      aguardando_cliente: 1,
    });
  });

  it("vencido = aberto com prazo antes de hoje; o fechado não conta", () => {
    expect(
      resumoDosItens([item("pendente", true, "2026-10-01"), item("concluido", true, "2026-10-01"), item("pendente", true, "2026-10-06")], "2026-10-06")
        .vencidos,
    ).toBe(1);
  });
});

describe("iniciarImplantacao", () => {
  it("sem modelo escolhido usa o padrão; e a função recebe org, empresa, origem e ator", async () => {
    const { cliente, rpcs } = banco({
      "implantacao_modelos:select": [{ data: { id: "modelo-padrao" }, error: null }],
      "rpc:fn_implantacao_iniciar": [{ data: { implantacao_id: "imp", criada: true, itens: 15 }, error: null }],
    });
    const r = await iniciarImplantacao(cliente, CTX, { userId: "u1", role: "manager" }, { company_id: "11111111-1111-4111-8111-111111111111" });
    expect(r).toMatchObject({ implantacao_id: "imp", criada: true });
    expect(rpcs[0]).toEqual({
      nome: "fn_implantacao_iniciar",
      args: {
        p_org: "org",
        p_company: "11111111-1111-4111-8111-111111111111",
        p_modelo: "modelo-padrao",
        p_origem: "manual",
        p_lead: null,
        p_responsavel: "u1",
        p_ator: "u1",
      },
    });
  });

  it("sem modelo padrão: 422 que ensina onde criar, sem chamar a função", async () => {
    const { cliente, rpcs } = banco({ "implantacao_modelos:select": [{ data: null, error: null }] });
    await expect(
      iniciarImplantacao(cliente, CTX, { userId: "u1", role: "manager" }, { company_id: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toMatchObject({ code: "implantacao_sem_modelo_padrao", status: 422 });
    expect(rpcs).toHaveLength(0);
  });

  it("recusa do banco vira mensagem que a tela entende", async () => {
    const { cliente } = banco({
      "rpc:fn_implantacao_iniciar": [{ data: null, error: { code: "P0001", message: "implantacao_estado_da_empresa_nao_permite" } }],
    });
    await expect(
      iniciarImplantacao(cliente, CTX, { userId: "u1", role: "manager" }, { company_id: "11111111-1111-4111-8111-111111111111", modelo_id: "22222222-2222-4222-8222-222222222222" }),
    ).rejects.toMatchObject({ code: "implantacao_estado_da_empresa_nao_permite", status: 409 });
  });
});

describe("alterarItem", () => {
  it("dispensar é de gestor: o atendente recebe 403 sem gravar", async () => {
    const { cliente, escritas } = banco({ "implantacao_itens:select": [{ data: { id: "i", estado: "pendente" }, error: null }] });
    await expect(
      alterarItem(cliente, CTX, { userId: "u1", role: "agent" }, "imp", "i", { revision: 1, estado: "dispensado", motivo_dispensa: "sem folha" }),
    ).rejects.toMatchObject({ code: "dispensa_exige_gestor", status: 403 });
    expect(escritas).toHaveLength(0);
  });

  it("tirar da dispensa também é de gestor", async () => {
    const { cliente } = banco({ "implantacao_itens:select": [{ data: { id: "i", estado: "dispensado" }, error: null }] });
    await expect(alterarItem(cliente, CTX, { userId: "u1", role: "agent" }, "imp", "i", { revision: 2, estado: "pendente" })).rejects.toMatchObject({
      code: "dispensa_exige_gestor",
    });
  });

  it("atendente conclui com evidência; grava com o ator e a revisão", async () => {
    const { cliente, escritas } = banco({
      "implantacao_itens:select": [{ data: { id: "i", estado: "em_andamento" }, error: null }],
      "implantacao_itens:update": [{ data: { id: "i", estado: "concluido", revision: 3 }, error: null }],
    });
    await alterarItem(cliente, CTX, { userId: "u1", role: "agent" }, "imp", "i", { revision: 2, estado: "concluido", evidencia: "A1 recebido" });
    expect(escritas[0]).toMatchObject({ tabela: "implantacao_itens", op: "update", carga: { estado: "concluido", evidencia: "A1 recebido", alterado_por: "u1" } });
  });

  it("revisão velha: 409 revision_conflict", async () => {
    const { cliente } = banco({
      "implantacao_itens:select": [{ data: { id: "i", estado: "pendente" }, error: null }],
      "implantacao_itens:update": [{ data: null, error: null }],
    });
    await expect(alterarItem(cliente, CTX, { userId: "u1", role: "agent" }, "imp", "i", { revision: 1, observacao: "x" })).rejects.toMatchObject({
      code: "revision_conflict",
    });
  });
});

describe("aplicarModeloDeNicho", () => {
  it("cria o modelo com os itens na ordem e vira padrão quando não há outro", async () => {
    const { cliente, escritas } = banco({
      "implantacao_modelos:select": [{ data: [], error: null }],
      "implantacao_modelos:insert": [{ data: { id: "novo" }, error: null }],
      "implantacao_modelo_itens:insert": [{ data: null, error: null }],
    });
    expect(await aplicarModeloDeNicho(cliente, CTX, "u1", "contabilidade")).toEqual({ criado: true, modelo_id: "novo" });
    expect(escritas[0]).toMatchObject({ tabela: "implantacao_modelos", carga: { padrao: true } });
    const itens = escritas[1]!.carga as Array<{ posicao: number; titulo: string }>;
    expect(itens).toHaveLength(MODELOS_DE_IMPLANTACAO.contabilidade.itens.length);
    expect(itens.map((i) => i.posicao)).toEqual(itens.map((_, i) => i));
  });

  it("já existindo um modelo com o mesmo nome, não toca em nada", async () => {
    const { cliente, escritas } = banco({
      "implantacao_modelos:select": [{ data: [{ id: "antigo", nome: "Implantação contábil", padrao: true }], error: null }],
    });
    expect(await aplicarModeloDeNicho(cliente, CTX, "u1", "contabilidade")).toEqual({ criado: false, modelo_id: "antigo" });
    expect(escritas).toHaveLength(0);
  });
});

describe("modelos de nicho", () => {
  it("o de contabilidade tem os 15 itens do §25.1, com áreas e prazos válidos para o banco", () => {
    const itens = MODELOS_DE_IMPLANTACAO.contabilidade.itens;
    expect(itens).toHaveLength(15);
    for (const m of Object.values(MODELOS_DE_IMPLANTACAO)) {
      for (const i of m.itens) {
        if (i.area !== null) expect(i.area).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
        if (i.prazo_dias !== null) expect(i.prazo_dias).toBeGreaterThanOrEqual(0);
        expect(i.titulo.length).toBeLessThanOrEqual(120);
        expect(i.grupo.length).toBeLessThanOrEqual(60);
      }
    }
  });
});
