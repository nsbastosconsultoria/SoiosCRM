/**
 * Um PostgREST de mentira, em memória, para os testes das rotas da cobrança. Só o que as rotas
 * usam: `select`/`eq`/`neq`/`in`/`order`/`limit`, `insert`/`update`, `single`/`maybeSingle`.
 * `unicas` declara as restrições únicas por tabela — o insert que as viola devolve `23505`.
 */
type Linha = Record<string, unknown>;

export type Banco = Record<string, Linha[]>;

export function bancoFalso(banco: Banco, unicas: Record<string, string[][]> = {}) {
  let seq = 0;
  return {
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let patch: Linha | null = null;
      let novo: Linha | null = null;
      const linhas = () => (banco[tabela] ??= []);
      const executar = (): { data: Linha[] | null; error: { code: string; message: string } | null } => {
        if (novo) {
          const n: Linha = { id: `id-${++seq}`, ...novo };
          for (const cols of unicas[tabela] ?? []) {
            if (linhas().some((l) => cols.every((c) => l[c] === n[c]))) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
          linhas().push(n);
          return { data: [{ ...n }], error: null };
        }
        const alvo = linhas().filter((l) => filtros.every((f) => f(l)));
        if (patch) for (const l of alvo) Object.assign(l, patch);
        return { data: alvo.map((l) => ({ ...l })), error: null };
      };
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
        neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
        in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), q),
        update: (p: Linha) => ((patch = p), q),
        insert: (l: Linha) => ((novo = l), q),
        single: async () => {
          const r = executar();
          return r.error ? r : { data: r.data?.[0] ?? null, error: null };
        },
        maybeSingle: async () => {
          const r = executar();
          return r.error ? r : { data: r.data?.[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(executar()).then(res),
      };
      return q;
    },
  };
}
