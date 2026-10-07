/**
 * NEGÓCIO GANHO → IMPLANTAÇÃO (spec 23 §5.1, regra 2; cumpre a regra 5 do §6 da spec 21).
 *
 * Com `organizations.settings.implantacao.funil_comercial_id` apontando para um funil, o negócio
 * ganho NAQUELE funil inicia a implantação da empresa com o modelo padrão.
 *
 * ─── As duas portas (lição de `lib/conversoes/envio.handler.ts`) ────────────
 * Ganhar tem mais de um caminho: o botão/capacidade emite `lead.won`; arrastar o card no kanban
 * e mover em lote emitem `lead.stage_changed`, e quem grava `status` é o gatilho. O payload é DICA
 * e o banco é VERDADE: o handler relê `crm_leads` e só segue com `status = 'won'`.
 *
 * ─── Qual empresa ───────────────────────────────────────────────────────────
 * `crm_lead_links` não aceita empresa como destino, então a empresa vem do CONTATO do negócio,
 * pelo vínculo que a carteira usa: `contacts.person_id` → `company_people` (vínculo sem detalhe, ou
 * com detalhe ativo). Só com EXATAMENTE uma empresa: com zero ou várias, nada acontece e o motivo
 * fica no resultado — a regra da carteira de nunca escolher a empresa por quem escreve quando há
 * mais de um vínculo (spec 21 §5).
 *
 * ─── Uma vez por negócio ────────────────────────────────────────────────────
 * Já havendo implantação nascida deste negócio (qualquer estado), não abre outra: mover o card
 * entre etapas de ganho, ou reprocessar o evento, não pode recomeçar a implantação de quem já foi
 * ativado. Em andamento para a empresa por outro caminho: a função devolve a existente.
 *
 * Instalação sem o módulo: a tabela não existe e o handler pula (`modulo_nao_instalado`).
 */
import { audit } from "@/lib/audit";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

const CONSUMER_KEY = "implantacao.negocio-ganho";

const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: CONSUMER_KEY,
  status,
  detail,
});

function ausente(erro: { code?: string } | null): boolean {
  return erro?.code === "42P01" || erro?.code === "PGRST205";
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
}

/** O funil comercial configurado (spec 23 §8, Configurações › Implantação). */
export function funilComercialDe(settings: unknown): string | null {
  const v = (settings as { implantacao?: { funil_comercial_id?: unknown } } | null)?.implantacao?.funil_comercial_id;
  return typeof v === "string" && v ? v : null;
}

export async function processarNegocioGanho(row: EventRow): Promise<HandlerResult> {
  const leadId = texto(row.payload?.lead_id) ?? row.entity_id;
  if (!leadId) return resultado("skipped", "sem_lead");
  const admin = createAdminClient();
  const org = row.organization_id;

  // Módulo instalado? E já houve implantação deste negócio?
  const { data: daqui, error: erroModulo } = await admin
    .from("implantacoes")
    .select("id")
    .eq("organization_id", org)
    .eq("lead_id", leadId)
    .limit(1);
  if (ausente(erroModulo)) return resultado("skipped", "modulo_nao_instalado");
  if (erroModulo) return resultado("error", `leitura das implantações falhou: ${erroModulo.message}`);
  if ((daqui ?? []).length > 0) return resultado("skipped", "negocio_ja_tem_implantacao");

  const { data: organizacao } = await admin.from("organizations").select("settings").eq("id", org).maybeSingle();
  const funil = funilComercialDe((organizacao as { settings?: unknown } | null)?.settings);
  if (!funil) return resultado("skipped", "funil_comercial_nao_configurado");

  const { data: lead, error: erroLead } = await admin
    .from("crm_leads")
    .select("id, status, pipeline_id, contact_id, owner_user_id")
    .eq("organization_id", org)
    .eq("id", leadId)
    .maybeSingle();
  if (erroLead) return resultado("error", `leitura do negócio falhou: ${erroLead.message}`);
  const l = lead as { status: string; pipeline_id: string; contact_id: string | null; owner_user_id: string | null } | null;
  if (!l || l.status !== "won") return resultado("skipped", "negocio_nao_ganho");
  if (l.pipeline_id !== funil) return resultado("skipped", "outro_funil");
  if (!l.contact_id) return resultado("skipped", "negocio_sem_contato");

  const { data: contato } = await admin
    .from("contacts")
    .select("person_id")
    .eq("organization_id", org)
    .eq("id", l.contact_id)
    .maybeSingle();
  const pessoa = (contato as { person_id?: string | null } | null)?.person_id;
  if (!pessoa) return resultado("skipped", "contato_sem_empresa");

  const { data: vinculos, error: erroVinculos } = await admin
    .from("company_people")
    .select("id, company_id")
    .eq("organization_id", org)
    .eq("person_id", pessoa);
  if (erroVinculos) return resultado("error", `leitura dos vínculos falhou: ${erroVinculos.message}`);
  const lista = (vinculos ?? []) as Array<{ id: string; company_id: string }>;
  const { data: inativos } = lista.length
    ? await admin
        .from("carteira_vinculo_detalhes")
        .select("company_people_id")
        .in(
          "company_people_id",
          lista.map((v) => v.id),
        )
        .eq("ativo", false)
    : { data: [] };
  const desligados = new Set(((inativos ?? []) as Array<{ company_people_id: string }>).map((d) => d.company_people_id));
  const empresas = [...new Set(lista.filter((v) => !desligados.has(v.id)).map((v) => v.company_id))];
  if (empresas.length === 0) return resultado("skipped", "contato_sem_empresa");
  if (empresas.length > 1) return resultado("skipped", "contato_com_varias_empresas");
  const companyId = empresas[0]!;

  const { data: modelo } = await admin
    .from("implantacao_modelos")
    .select("id")
    .eq("organization_id", org)
    .eq("padrao", true)
    .eq("ativo", true)
    .maybeSingle();
  if (!modelo) return resultado("skipped", "sem_modelo_padrao");

  // O dono do negócio conduz a implantação, se ainda for da equipe; senão, ninguém (a FK recusaria).
  let responsavel: string | null = null;
  if (l.owner_user_id) {
    const { data: membro } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", org)
      .eq("user_id", l.owner_user_id)
      .maybeSingle();
    if (membro) responsavel = l.owner_user_id;
  }

  const { data, error } = await admin.rpc("fn_implantacao_iniciar", {
    p_org: org,
    p_company: companyId,
    p_modelo: (modelo as { id: string }).id,
    p_origem: "negocio_ganho",
    p_lead: leadId,
    p_responsavel: responsavel,
    p_ator: null,
  });
  if (error) {
    // A empresa suspensa, em distrato ou inativa não começa implantação: é decisão, não falha.
    if (error.message === "implantacao_estado_da_empresa_nao_permite") return resultado("skipped", "estado_da_empresa_nao_permite");
    return resultado("error", `início da implantação falhou: ${error.message}`);
  }
  const r = data as { implantacao_id: string; criada: boolean };
  if (!r.criada) return resultado("skipped", "empresa_ja_em_implantacao");

  await audit({
    organizationId: org,
    action: "implantacao.iniciada",
    resourceType: "implantacoes",
    resourceId: r.implantacao_id,
    metadata: { company_id: companyId, origem: "negocio_ganho", lead_id: leadId },
  });
  return resultado("ok", "implantacao_iniciada");
}

async function handle(row: EventRow): Promise<HandlerResult> {
  try {
    return await processarNegocioGanho(row);
  } catch (e) {
    return resultado("error", e instanceof Error ? e.message : String(e));
  }
}

export const negocioGanhoHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["lead.won", "lead.stage_changed"],
  handle,
};
