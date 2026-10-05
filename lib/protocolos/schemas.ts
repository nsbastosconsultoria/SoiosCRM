/**
 * Zod de todo corpo que entra pela API de protocolos. `.strict()` em tudo: campo desconhecido é
 * erro, não silêncio — quem manda `estado` no PATCH precisa ouvir que estado tem rota própria.
 */
import { z } from "zod";

import { SLUG_DE_AREA } from "@/lib/atendimento/areas";

import { PRIORIDADES } from "./prioridade";
import { ESTADOS_DO_PROTOCOLO } from "./vocabulario";

const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "competência no formato AAAA-MM");
const slug = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "use letras minúsculas, números e _");

/** Resumo estruturado (spec 22 §5) — o que o analista lê sem reler a conversa. */
export const resumoSchema = z
  .object({
    solicitacao: z.string().trim().min(1).max(2000),
    prazo_informado: z.string().trim().max(300).nullable().optional(),
    informacoes_coletadas: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    acao_esperada: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type Resumo = z.infer<typeof resumoSchema>;

export const abrirSchema = z
  .object({
    categoria_id: uuid,
    subcategoria_id: uuid.nullable().optional(),
    competencia: competencia.nullable().optional(),
    titulo: z.string().trim().min(1).max(200),
    descricao: z.string().trim().min(1).max(5000),
    resumo: resumoSchema.nullable().optional(),
    urgencia_declarada: z.string().trim().max(300).nullable().optional(),
    prazo_cliente: data.nullable().optional(),
    company_id: uuid.nullable().optional(),
    contact_id: uuid.nullable().optional(),
    conversation_id: uuid.nullable().optional(),
    lead_id: uuid.nullable().optional(),
  })
  .strict();
export type EntradaDeAbertura = z.infer<typeof abrirSchema>;

export const patchSchema = z
  .object({
    categoria_id: uuid.optional(),
    subcategoria_id: uuid.nullable().optional(),
    competencia: competencia.nullable().optional(),
    titulo: z.string().trim().min(1).max(200).optional(),
    prioridade: z.enum(PRIORIDADES).optional(),
    prioridade_motivo: z.string().trim().max(300).nullable().optional(),
    prazo_cliente: data.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "nada para alterar")
  .refine((p) => p.prioridade === undefined || (p.prioridade_motivo ?? "").trim().length > 0, {
    message: "Diga o motivo da mudança de prioridade.",
  });
export type PatchDoProtocolo = z.infer<typeof patchSchema>;

export const transicaoSchema = z
  .object({
    estado: z.enum(ESTADOS_DO_PROTOCOLO),
    motivo: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export const atribuirSchema = z.object({ user_id: uuid.nullable() }).strict();

export const notaSchema = z.object({ texto: z.string().trim().min(1).max(5000) }).strict();

// ─── configuração ────────────────────────────────────────────────────────────

export const categoriaSchema = z
  .object({
    parent_id: uuid.nullable().optional(),
    nome: z.string().trim().min(1).max(80),
    slug,
    area: z.string().regex(SLUG_DE_AREA),
    prioridade_padrao: z.enum(PRIORIDADES).optional(),
    exige_competencia: z.boolean().optional(),
    exige_handoff: z.boolean().optional(),
    descricao_para_ia: z.string().trim().max(500).nullable().optional(),
    ativa: z.boolean().optional(),
    posicao: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const patchDeCategoriaSchema = categoriaSchema
  .omit({ parent_id: true, slug: true })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, "nada para alterar");

export const politicaSchema = z
  .object({
    prioridade: z.enum(PRIORIDADES),
    categoria_id: uuid.nullable().optional(),
    primeira_resposta_min: z.number().int().min(1).max(60 * 24 * 60),
    resolucao_min: z.number().int().min(1).max(60 * 24 * 365),
    em_horario_util: z.boolean().optional(),
    pausa_aguardando_cliente: z.boolean().optional(),
    pausa_aguardando_terceiro: z.boolean().optional(),
  })
  .strict()
  .refine((p) => p.primeira_resposta_min <= p.resolucao_min, {
    message: "A primeira resposta não pode vencer depois da resolução.",
  });

export const membroSchema = z
  .object({
    area: z.string().regex(SLUG_DE_AREA),
    user_id: uuid,
    papel: z.enum(["membro", "lider"]).optional(),
  })
  .strict();

export const feriadoSchema = z
  .object({ data, descricao: z.string().trim().min(1).max(120) })
  .strict();

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora no formato HH:MM");
export const expedienteSchema = z
  .object({
    fuso: z.string().min(1).max(60),
    dias: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    inicio: hora,
    fim: hora,
  })
  .strict()
  .nullable();

export const modeloSchema = z.object({ modelo: z.enum(["contabilidade", "generico"]) }).strict();
