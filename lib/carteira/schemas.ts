/**
 * Zod de todo corpo que entra pela API da carteira (CLAUDE.md: "Zod em todo input externo").
 * `.strict()` em tudo: campo desconhecido é erro, não silêncio — um cliente que manda `estado`
 * no PATCH do perfil precisa ouvir que estado muda por outra rota.
 */
import { z } from "zod";

import { SLUG_DE_AREA } from "@/lib/atendimento/areas";
import { ESTADOS_DA_CARTEIRA, PAPEIS_DO_VINCULO, TIPOS_DE_ESTABELECIMENTO } from "./vocabulario";

const slugDeArea = z.string().regex(SLUG_DE_AREA, "área inválida");
const areas = z.array(slugDeArea).max(30).refine((l) => new Set(l).size === l.length, "área repetida");

export const estadoSchema = z.enum(ESTADOS_DA_CARTEIRA);

export const empresaNovaSchema = z
  .object({
    company_id: z.string().uuid().optional(),
    cnpj: z.string().trim().min(1).max(32).optional(),
    legal_name: z.string().trim().min(1).max(500).optional(),
    estado_inicial: z.enum(["prospect", "ativo"]).optional(),
  })
  .strict();
export type EmpresaNovaNaCarteira = z.infer<typeof empresaNovaSchema>;

export const patchDoPerfilSchema = z
  .object({
    grupo_id: z.string().uuid().nullable().optional(),
    tipo_estabelecimento: z.enum(TIPOS_DE_ESTABELECIMENTO).nullable().optional(),
    matriz_company_id: z.string().uuid().nullable().optional(),
    atributos: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "nada para alterar");
export type PatchDoPerfil = z.infer<typeof patchDoPerfilSchema>;

export const transicaoSchema = z
  .object({
    estado: estadoSchema,
    /**
     * Com o módulo implantacao instalado, `ativo` com implantação em andamento e item obrigatório
     * aberto exige `admin` E esta confirmação explícita (spec 23 Q2). Sem ela, 409
     * `implantacao_em_andamento`, com a contagem — a tela mostra e pergunta.
     */
    confirmar_implantacao_aberta: z.boolean().optional(),
  })
  .strict();

export const vinculoNovoSchema = z
  .object({
    contact_id: z.string().uuid(),
    papel: z.enum(PAPEIS_DO_VINCULO),
    areas: areas.optional(),
  })
  .strict();
export type VinculoNovo = z.infer<typeof vinculoNovoSchema>;

export const patchDoVinculoSchema = z
  .object({
    papel: z.enum(PAPEIS_DO_VINCULO).optional(),
    areas: areas.optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, "nada para alterar");
export type PatchDoVinculo = z.infer<typeof patchDoVinculoSchema>;

export const responsavelNovoSchema = z
  .object({
    area: slugDeArea,
    user_id: z.string().uuid(),
  })
  .strict();
export type ResponsavelNovo = z.infer<typeof responsavelNovoSchema>;

export const grupoNovoSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    descricao: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const contextoSchema = z
  .object({
    company_id: z.string().uuid().nullable(),
  })
  .strict();
