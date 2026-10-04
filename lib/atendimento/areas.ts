/**
 * As áreas de atendimento da organização — UM vocabulário, compartilhado por todo módulo que
 * divide o trabalho por área: a carteira (responsável por área, áreas que uma pessoa recebe —
 * spec 21 §4.5.1) e os protocolos (a fila e a categoria de cada demanda — spec 22).
 *
 * Mora em `organizations.settings.atendimento.areas` como `[{ slug, rotulo }]`, numa chave NEUTRA
 * e não dentro de um módulo: os protocolos funcionam sem a carteira instalada, e duas listas (uma
 * por módulo) divergiriam — o "fiscal" da carteira deixaria de ser o "fiscal" da fila.
 *
 * Quem é MEMBRO ou LÍDER de cada área não mora aqui: é id de usuário, e id de usuário em jsonb é
 * chave estrangeira que o banco não confere (anti-patterns 1 e 4). Isso vive em tabela, no módulo
 * que precisa (spec 22).
 *
 * Sem configuração — ou com uma que não passa no schema — vale o modelo genérico: a tela funciona
 * no primeiro dia, e o modelo de nicho (contabilidade) é aplicado por ação explícita, nunca
 * sozinho. Falha ABERTA para o padrão, como `janela-de-atendimento.ts`: uma configuração torta não
 * pode deixar a tela sem área nenhuma para escolher.
 */
import { z } from "zod";

/** O mesmo formato do CHECK de `carteira_responsaveis.area` e `carteira_vinculo_detalhes.areas`. */
export const SLUG_DE_AREA = /^[a-z][a-z0-9_]{1,40}$/;

export interface Area {
  slug: string;
  rotulo: string;
}

const areaSchema = z.object({
  slug: z.string().regex(SLUG_DE_AREA),
  rotulo: z.string().trim().min(1).max(60),
});

const areasSchema = z
  .array(areaSchema)
  .min(1)
  .max(30)
  .refine((lista) => new Set(lista.map((a) => a.slug)).size === lista.length, "slug repetido");

/** O modelo genérico — vale para qualquer operação que atende empresas. */
export const AREAS_PADRAO: readonly Area[] = [
  { slug: "relacionamento", rotulo: "Relacionamento" },
  { slug: "operacao", rotulo: "Operação" },
  { slug: "financeiro", rotulo: "Financeiro" },
];

/** O modelo de nicho "contabilidade" (spec 21 §10). */
export const AREAS_CONTABILIDADE: readonly Area[] = [
  { slug: "relacionamento", rotulo: "Relacionamento" },
  { slug: "contabil", rotulo: "Contábil" },
  { slug: "fiscal", rotulo: "Fiscal" },
  { slug: "dp", rotulo: "Departamento Pessoal" },
  { slug: "societario", rotulo: "Societário" },
  { slug: "tributario", rotulo: "Tributário" },
  { slug: "financeiro", rotulo: "Financeiro" },
];

/** `settings` é o jsonb inteiro de `organizations.settings`. */
export function areasDaOrganizacao(settings: unknown): readonly Area[] {
  const bruto = (settings as { atendimento?: { areas?: unknown } } | null | undefined)?.atendimento?.areas;
  if (bruto === undefined) return AREAS_PADRAO;
  const lido = areasSchema.safeParse(bruto);
  return lido.success ? lido.data : AREAS_PADRAO;
}
