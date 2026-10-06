/**
 * Zod de todo corpo que entra pela API de implantação. `.strict()` em tudo: campo desconhecido é
 * erro, não silêncio.
 */
import { z } from "zod";

import { ESTADOS_DO_ITEM, VEZ_DE } from "./vocabulario";

const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato AAAA-MM-DD");
const slug = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "use letras minúsculas, números e _");

export const iniciarSchema = z
  .object({
    company_id: uuid,
    /** Ausente = o modelo padrão da organização. */
    modelo_id: uuid.optional(),
    responsavel_user_id: uuid.nullable().optional(),
  })
  .strict();
export type EntradaDeInicio = z.infer<typeof iniciarSchema>;

export const itemPatchSchema = z
  .object({
    revision: z.number().int().positive(),
    estado: z.enum(ESTADOS_DO_ITEM).optional(),
    responsavel_user_id: uuid.nullable().optional(),
    prazo: data.nullable().optional(),
    observacao: z.string().trim().max(2000).nullable().optional(),
    evidencia: z.string().trim().max(2000).nullable().optional(),
    motivo_dispensa: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 1, "nada para alterar")
  .refine((p) => p.estado !== "dispensado" || (p.motivo_dispensa ?? "").length > 0, {
    message: "Diga o motivo da dispensa.",
  });
export type PatchDoItem = z.infer<typeof itemPatchSchema>;

export const cancelarSchema = z
  .object({
    motivo: z.string().trim().min(1).max(300),
    inativar: z.boolean().default(false),
  })
  .strict();

export const modeloSchema = z
  .object({
    id: uuid.optional(),
    nome: z.string().trim().min(1).max(80),
    padrao: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .strict();
export type EntradaDeModelo = z.infer<typeof modeloSchema>;

export const itemDeModeloSchema = z
  .object({
    id: uuid.optional(),
    modelo_id: uuid,
    grupo: z.string().trim().min(1).max(60),
    titulo: z.string().trim().min(1).max(120),
    orientacao: z.string().trim().max(1000).nullable().optional(),
    posicao: z.number().int().min(0).max(10_000).default(0),
    obrigatorio: z.boolean().default(true),
    vez_de: z.enum(VEZ_DE).default("escritorio"),
    area: slug.nullable().optional(),
    prazo_dias: z.number().int().min(0).max(365).nullable().optional(),
    exige_evidencia: z.boolean().default(false),
  })
  .strict();
export type EntradaDeItemDeModelo = z.infer<typeof itemDeModeloSchema>;

export const modeloDeNichoSchema = z.object({ modelo: z.enum(["contabilidade", "generico"]) }).strict();
export type ModeloDeNicho = z.infer<typeof modeloDeNichoSchema>["modelo"];
