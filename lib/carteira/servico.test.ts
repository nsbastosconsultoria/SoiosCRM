/**
 * `vincularContato` e `definirResponsavel` — a ordem das escritas no NÚCLEO e no módulo.
 *
 * O banco falso responde por `<tabela>:<operação>` numa fila, e registra cada escrita com a
 * carga. O que se prova: o vínculo passa pelo caminho do núcleo (pessoa → company_people) antes
 * do detalhe; contato sem pessoa ganha uma com o nome dele; tudo leva a organização do contexto;
 * área desconhecida é recusada ANTES de qualquer escrita; trocar o responsável encerra o atual.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";

import { definirResponsavel, vincularContato } from "./servico";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const EMPRESA = "33333333-3333-4333-8333-333333333333";
const CONTATO = "44444444-4444-4444-8444-444444444444";

const ctx: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: USER, role: "manager" },
  requestId: "req-1",
} as HandlerCtx;

type Resposta = { data: unknown; error: unknown };
type Escrita = { tabela: string; op: string; carga: unknown; filtros: Array<[string, unknown]> };

function bancoFalso(respostas: Record<string, Resposta[]>) {
  const escritas: Escrita[] = [];
  const cliente = {
    from(tabela: string) {
      let op = "select";
      let carga: unknown = undefined;
      const filtros: Array<[string, unknown]> = [];
      const resolver = (): Promise<Resposta> => {
        if (op !== "select") escritas.push({ tabela, op, carga, filtros });
        const fila = respostas[`${tabela}:${op}`] ?? [];
        return Promise.resolve(fila.shift() ?? { data: null, error: null });
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
        is: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        insert: (x: unknown) => ((op = "insert"), (carga = x), b),
        update: (x: unknown) => ((op = "update"), (carga = x), b),
        upsert: (x: unknown) => ((op = "upsert"), (carga = x), b),
        single: resolver,
        maybeSingle: resolver,
        then: (ok: (r: Resposta) => unknown, ko: (e: unknown) => unknown) => resolver().then(ok, ko),
      };
      return b;
    },
  };
  return { cliente: cliente as never, escritas };
}

beforeEach(() => vi.clearAllMocks());

describe("vincularContato — o vínculo é o do núcleo", () => {
  it("contato sem pessoa: cria a pessoa com o nome dele, liga o contato, cria o company_people e só então o detalhe", async () => {
    const { cliente, escritas } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "contacts:select": [
        { data: { id: CONTATO, person_id: null, name: "Maria Souza", display_name: null, phone_number: null }, error: null },
      ],
      "companies:select": [{ data: { id: EMPRESA }, error: null }],
      "people:insert": [{ data: { id: "pessoa-nova" }, error: null }],
      "company_people:select": [{ data: null, error: null }],
      "company_people:insert": [{ data: { id: "cp-novo" }, error: null }],
      "carteira_vinculo_detalhes:upsert": [
        { data: { company_people_id: "cp-novo", papel: "financeiro", areas: ["financeiro"], ativo: true }, error: null },
      ],
    });

    const r = await vincularContato(cliente, ctx, USER, EMPRESA, {
      contact_id: CONTATO,
      papel: "financeiro",
      areas: ["financeiro"],
    });

    expect(r.company_people_id).toBe("cp-novo");
    expect(escritas.map((e) => `${e.tabela}:${e.op}`)).toEqual([
      "people:insert",
      "contacts:update",
      "company_people:insert",
      "carteira_vinculo_detalhes:upsert",
    ]);
    expect(escritas[0]!.carga).toMatchObject({ organization_id: ORG, full_name: "Maria Souza" });
    expect(escritas[1]!.carga).toEqual({ person_id: "pessoa-nova" });
    expect(escritas[2]!.carga).toEqual({ organization_id: ORG, company_id: EMPRESA, person_id: "pessoa-nova" });
    expect(escritas[3]!.carga).toMatchObject({
      company_people_id: "cp-novo",
      organization_id: ORG,
      papel: "financeiro",
      origem: "manual",
      alterado_por: USER,
    });
  });

  it("contato que já tem pessoa e vínculo no núcleo: só grava o detalhe", async () => {
    const { cliente, escritas } = bancoFalso({
      "contacts:select": [
        { data: { id: CONTATO, person_id: "pessoa-1", name: "João", display_name: null, phone_number: null }, error: null },
      ],
      "companies:select": [{ data: { id: EMPRESA }, error: null }],
      "company_people:select": [{ data: { id: "cp-existente" }, error: null }],
      "carteira_vinculo_detalhes:upsert": [{ data: { company_people_id: "cp-existente" }, error: null }],
    });

    await vincularContato(cliente, ctx, USER, EMPRESA, { contact_id: CONTATO, papel: "socio" });
    expect(escritas.map((e) => `${e.tabela}:${e.op}`)).toEqual(["carteira_vinculo_detalhes:upsert"]);
  });

  it("área desconhecida na organização → 422 antes de qualquer escrita", async () => {
    const { cliente, escritas } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
    });
    await expect(
      vincularContato(cliente, ctx, USER, EMPRESA, { contact_id: CONTATO, papel: "fiscal", areas: ["fiscal"] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(escritas).toEqual([]);
  });

  it("contato de outra organização (não achado com o filtro da org) → 404", async () => {
    const { cliente } = bancoFalso({ "contacts:select": [{ data: null, error: null }] });
    await expect(
      vincularContato(cliente, ctx, USER, EMPRESA, { contact_id: CONTATO, papel: "socio" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("definirResponsavel — trocar é encerrar e abrir outro", () => {
  it("com responsável vigente diferente: encerra a vigência dele e insere o novo", async () => {
    const { cliente, escritas } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "carteira_responsaveis:select": [{ data: { id: "resp-antigo", user_id: "outro-user" }, error: null }],
      "carteira_responsaveis:insert": [{ data: { id: "resp-novo" }, error: null }],
    });
    const r = await definirResponsavel(cliente, ctx, USER, EMPRESA, { area: "financeiro", user_id: USER });
    expect(r).toEqual({ id: "resp-novo", alterado: true });
    expect(escritas.map((e) => `${e.tabela}:${e.op}`)).toEqual([
      "carteira_responsaveis:update",
      "carteira_responsaveis:insert",
    ]);
    expect(escritas[0]!.carga).toMatchObject({ alterado_por: USER });
    expect(Object.keys(escritas[0]!.carga as object)).toContain("vigencia_fim");
  });

  it("a mesma pessoa de novo não escreve nada", async () => {
    const { cliente, escritas } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "carteira_responsaveis:select": [{ data: { id: "resp-1", user_id: USER }, error: null }],
    });
    const r = await definirResponsavel(cliente, ctx, USER, EMPRESA, { area: "financeiro", user_id: USER });
    expect(r).toEqual({ id: "resp-1", alterado: false });
    expect(escritas).toEqual([]);
  });

  it("quem não é membro da organização (FK composta, 23503) → 422 com mensagem clara", async () => {
    const { cliente } = bancoFalso({
      "organizations:select": [{ data: { settings: {} }, error: null }],
      "carteira_responsaveis:select": [{ data: null, error: null }],
      "carteira_responsaveis:insert": [{ data: null, error: { code: "23503", message: "fk" } }],
    });
    await expect(
      definirResponsavel(cliente, ctx, USER, EMPRESA, { area: "financeiro", user_id: USER }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
