/**
 * PR-C da implantação (spec 23 §5.1, §5.5, §7): o negócio ganho que inicia a implantação, o vigia
 * diário e a ferramenta de leitura da IA — com o banco simulado. A função `fn_implantacao_iniciar`
 * tem invariante de banco próprio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: unknown; count?: number };
const estado = vi.hoisted(() => ({ respostas: {} as Record<string, Resposta[]>, escritas: [] as Array<{ tabela: string; carga: unknown }>, rpcs: [] as Array<{ nome: string; args: unknown }> }));

function cliente() {
  return {
    from(tabela: string) {
      let op = "select";
      let carga: unknown;
      const resolver = () => {
        if (op === "insert") estado.escritas.push({ tabela, carga });
        return Promise.resolve((estado.respostas[`${tabela}:${op}`] ?? []).shift() ?? { data: null, error: null });
      };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit", "lt", "is"]) q[m] = () => q;
      q.insert = (x: unknown) => ((op = "insert"), (carga = x), resolver());
      q.maybeSingle = resolver;
      q.then = (ok: (r: Resposta) => unknown) => resolver().then(ok);
      return q;
    },
    rpc(nome: string, args: unknown) {
      estado.rpcs.push({ nome, args });
      return Promise.resolve((estado.respostas[`rpc:${nome}`] ?? []).shift() ?? { data: null, error: null });
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => cliente() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { processarNegocioGanho, funilComercialDe } = await import("./negocio-ganho.handler");
const { rodarVigia, textoDoAviso, vencidosPorVez } = await import("./vigia");
const { crmImplantacaoPendenciasDoCliente } = await import("@/lib/mcp/tools/implantacao");

const FUNIL = "f0000000-0000-4000-8000-000000000001";
const evento = (payload: Record<string, unknown> = { lead_id: "lead-1" }) =>
  ({ id: "ev", organization_id: "org", event_type: "lead.won", entity_kind: "lead", entity_id: null, payload, metadata: {}, consumed_by: [], attempts: 0 }) as never;

beforeEach(() => {
  estado.respostas = {};
  estado.escritas = [];
  estado.rpcs = [];
});

/** O caminho feliz até a chamada da função: funil certo, ganho, um contato, uma empresa. */
function cenarioFeliz(sobrescrever: Record<string, Resposta[]> = {}) {
  estado.respostas = {
    "implantacoes:select": [{ data: [], error: null }],
    "organizations:select": [{ data: { settings: { implantacao: { funil_comercial_id: FUNIL } } }, error: null }],
    "crm_leads:select": [{ data: { status: "won", pipeline_id: FUNIL, contact_id: "c1", owner_user_id: "u1" }, error: null }],
    "contacts:select": [{ data: { person_id: "p1" }, error: null }],
    "company_people:select": [{ data: [{ id: "cp1", company_id: "empresa-1" }], error: null }],
    "carteira_vinculo_detalhes:select": [{ data: [], error: null }],
    "implantacao_modelos:select": [{ data: { id: "modelo" }, error: null }],
    "user_organizations:select": [{ data: { user_id: "u1" }, error: null }],
    "rpc:fn_implantacao_iniciar": [{ data: { implantacao_id: "imp", criada: true }, error: null }],
    ...sobrescrever,
  };
}

describe("negócio ganho → implantação", () => {
  it("funil certo, ganho, uma empresa: inicia com o modelo padrão, origem negocio_ganho e o dono como responsável", async () => {
    cenarioFeliz();
    expect(await processarNegocioGanho(evento())).toMatchObject({ status: "ok", detail: "implantacao_iniciada" });
    expect(estado.rpcs[0]).toEqual({
      nome: "fn_implantacao_iniciar",
      args: { p_org: "org", p_company: "empresa-1", p_modelo: "modelo", p_origem: "negocio_ganho", p_lead: "lead-1", p_responsavel: "u1", p_ator: null },
    });
  });

  it("sem o módulo instalado, pula na primeira consulta", async () => {
    estado.respostas = { "implantacoes:select": [{ data: null, error: { code: "PGRST205" } }] };
    expect(await processarNegocioGanho(evento())).toMatchObject({ status: "skipped", detail: "modulo_nao_instalado" });
    expect(estado.rpcs).toHaveLength(0);
  });

  it("negócio que já gerou implantação não gera outra (mover entre etapas de ganho, reprocessar)", async () => {
    cenarioFeliz({ "implantacoes:select": [{ data: [{ id: "antiga" }], error: null }] });
    expect(await processarNegocioGanho(evento())).toMatchObject({ status: "skipped", detail: "negocio_ja_tem_implantacao" });
  });

  it("o payload é dica, o banco é verdade: lead que não está ganho não inicia", async () => {
    cenarioFeliz({ "crm_leads:select": [{ data: { status: "open", pipeline_id: FUNIL, contact_id: "c1", owner_user_id: null }, error: null }] });
    expect(await processarNegocioGanho(evento())).toMatchObject({ detail: "negocio_nao_ganho" });
  });

  it("outro funil, ou funil não configurado, não inicia", async () => {
    cenarioFeliz({ "crm_leads:select": [{ data: { status: "won", pipeline_id: "outro", contact_id: "c1", owner_user_id: null }, error: null }] });
    expect(await processarNegocioGanho(evento())).toMatchObject({ detail: "outro_funil" });
    cenarioFeliz({ "organizations:select": [{ data: { settings: {} }, error: null }] });
    expect(await processarNegocioGanho(evento())).toMatchObject({ detail: "funil_comercial_nao_configurado" });
  });

  it("contato que representa várias empresas: não escolhe por ele", async () => {
    cenarioFeliz({
      "company_people:select": [{ data: [{ id: "cp1", company_id: "e1" }, { id: "cp2", company_id: "e2" }], error: null }],
    });
    expect(await processarNegocioGanho(evento())).toMatchObject({ detail: "contato_com_varias_empresas" });
    expect(estado.rpcs).toHaveLength(0);
  });

  it("vínculo desativado na carteira não conta", async () => {
    cenarioFeliz({
      "company_people:select": [{ data: [{ id: "cp1", company_id: "e1" }, { id: "cp2", company_id: "e2" }], error: null }],
      "carteira_vinculo_detalhes:select": [{ data: [{ company_people_id: "cp2" }], error: null }],
    });
    expect(await processarNegocioGanho(evento())).toMatchObject({ status: "ok" });
    expect((estado.rpcs[0]!.args as { p_company: string }).p_company).toBe("e1");
  });

  it("dono que saiu da equipe: a implantação nasce sem responsável (a FK recusaria)", async () => {
    cenarioFeliz({ "user_organizations:select": [{ data: null, error: null }] });
    await processarNegocioGanho(evento());
    expect((estado.rpcs[0]!.args as { p_responsavel: string | null }).p_responsavel).toBeNull();
  });

  it("empresa inativa é decisão, não falha", async () => {
    cenarioFeliz({ "rpc:fn_implantacao_iniciar": [{ data: null, error: { message: "implantacao_estado_da_empresa_nao_permite" } }] });
    expect(await processarNegocioGanho(evento())).toMatchObject({ status: "skipped", detail: "estado_da_empresa_nao_permite" });
  });

  it("funilComercialDe lê só um uuid em string", () => {
    expect(funilComercialDe({ implantacao: { funil_comercial_id: FUNIL } })).toBe(FUNIL);
    expect(funilComercialDe({ implantacao: { funil_comercial_id: 3 } })).toBeNull();
    expect(funilComercialDe(null)).toBeNull();
  });
});

describe("vigia diário", () => {
  it("conta vencidos abertos por de quem é a vez", () => {
    expect(
      vencidosPorVez(
        [
          { estado: "pendente", prazo: "2026-10-01", vez_de: "cliente" },
          { estado: "aguardando_terceiro", prazo: "2026-10-01", vez_de: "terceiro" },
          { estado: "concluido", prazo: "2026-10-01", vez_de: "escritorio" },
          { estado: "pendente", prazo: "2026-10-09", vez_de: "escritorio" },
        ],
        "2026-10-06",
      ),
    ).toEqual({ escritorio: 0, cliente: 1, terceiro: 1 });
  });

  it("o texto leva empresa e contagens, sem texto livre dos itens", () => {
    expect(textoDoAviso("Padaria Sol", { escritorio: 0, cliente: 2, terceiro: 1 })).toEqual({
      title: "Implantação de Padaria Sol: 3 itens vencidos",
      body: "2 com o cliente, 1 com terceiros. Abra a implantação para cobrar quem está com a vez ou ajustar o prazo.",
    });
  });

  it("abre um aviso por implantação com vencido, e não repete com um aberto", async () => {
    estado.respostas = {
      "implantacoes:select": [{ data: [{ id: "imp1", organization_id: "org", company_id: "e1" }, { id: "imp2", organization_id: "org", company_id: "e2" }], error: null }],
      "organizations:select": [{ data: { timezone: "America/Sao_Paulo" }, error: null }],
      "implantacao_itens:select": [
        { data: [{ estado: "pendente", prazo: "2020-01-01", vez_de: "cliente" }], error: null },
        { data: [{ estado: "pendente", prazo: "2020-01-01", vez_de: "cliente" }], error: null },
      ],
      "agent_inbox_items:select": [{ data: null, error: null }, { data: { id: "aberto" }, error: null }],
      "companies:select": [{ data: { trade_name: "Padaria Sol" }, error: null }],
    };
    const r = await rodarVigia(cliente() as never, new Date(), "r");
    expect(r).toMatchObject({ examinadas: 2, avisos: 1 });
    expect(estado.escritas[0]!.carga).toMatchObject({ kind: "implantacao_atrasada", ref_kind: "implantacao", ref_id: "imp1", severity: "warn" });
  });

  it("sem o módulo instalado, responde e não faz mais nada", async () => {
    estado.respostas = { "implantacoes:select": [{ data: null, error: { code: "42P01" } }] };
    expect(await rodarVigia(cliente() as never, new Date(), "r")).toMatchObject({ modulo_instalado: false, avisos: 0 });
  });
});

describe("crm_implantacao_pendencias_do_cliente", () => {
  const ctx = () => ({ organizationId: "org", supabase: cliente() }) as never;

  it("devolve só os itens abertos com o cliente, com título e orientação — nada interno", async () => {
    estado.respostas = {
      "carteira_contexto_conversa:select": [{ data: { company_id: "e1" }, error: null }],
      "implantacoes:select": [{ data: { id: "imp" }, error: null }],
      "implantacao_itens:select": [
        {
          data: [
            { titulo: "Certificado digital", orientacao: "O A1 da empresa.", estado: "aguardando_cliente", observacao: "interno" },
            { titulo: "Contrato assinado", orientacao: null, estado: "concluido" },
          ],
          error: null,
        },
      ],
    };
    const r = await crmImplantacaoPendenciasDoCliente.handler({ conversation_id: "11111111-1111-4111-8111-111111111111" }, ctx());
    expect(r).toEqual({ em_implantacao: true, pendencias: [{ item: "Certificado digital", o_que_conta_como_pronto: "O A1 da empresa." }] });
    expect(JSON.stringify(r)).not.toContain("interno");
  });

  it("sem empresa definida na conversa: ensina a definir", async () => {
    estado.respostas = { "carteira_contexto_conversa:select": [{ data: null, error: null }] };
    await expect(
      crmImplantacaoPendenciasDoCliente.handler({ conversation_id: "11111111-1111-4111-8111-111111111111" }, ctx()),
    ).rejects.toThrow(/crm_carteira_definir_empresa_da_conversa/);
  });

  it("empresa sem implantação em andamento: diz isso, sem lista", async () => {
    estado.respostas = {
      "carteira_contexto_conversa:select": [{ data: { company_id: "e1" }, error: null }],
      "implantacoes:select": [{ data: null, error: null }],
    };
    expect(await crmImplantacaoPendenciasDoCliente.handler({ conversation_id: "11111111-1111-4111-8111-111111111111" }, ctx())).toEqual({
      em_implantacao: false,
      pendencias: [],
    });
  });
});
