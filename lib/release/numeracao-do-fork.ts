/**
 * Numeração das versões do fork Soios.
 *
 * O fork publica tags no mesmo repositório-modelo do original (`vX.Y.Z`), e
 * todo o kit da VPS (install, update, agent) só aceita esse formato. Por isso o
 * fork não usa sufixo (`-soios.1`): usa uma FAIXA de números que o original não
 * alcança.
 *
 *   versão do fork = <maior>.<menor> do original + correção a partir de 100
 *
 * Em cima do DeskcommCRM 1.85.x, o fork publica 1.85.100, 1.85.101, ...; depois
 * de sincronizar com o 1.86.0, a próxima sai 1.86.100. O original lança poucas
 * correções por minor (nunca passou de um dígito), então as duas faixas não se
 * encontram, e `sort -V` / a comparação por partes ordenam certo
 * (1.85.100 > 1.85.9 > 1.85.0, e 1.86.0 > 1.85.100).
 *
 * Por isso o impacto dos fragmentos não decide o número aqui: um fragmento
 * `exige_acao` continua exigindo o aviso (`montar-secao.ts`), mas o número só
 * sobe dentro da faixa do fork. Minor e major vêm do original, na sincronização.
 *
 * A 1.81.0 publicada em 14/10/2026 é anterior a esta regra: ela é o original
 * 1.80.0 com os módulos do Soios (docs/soios/versoes-proprias-1.65-1.67.md).
 */

/** Primeira correção da faixa do fork. Abaixo disto, a versão é do original. */
export const INICIO_DA_FAIXA_DO_FORK = 100;

type Versao = readonly [number, number, number];

function ler(v: string): Versao | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function comparar(a: Versao, b: Versao): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function ehVersaoDoFork(v: string): boolean {
  const p = ler(v);
  return p !== null && p[2] >= INICIO_DA_FAIXA_DO_FORK;
}

/** Todas as versões `## [X.Y.Z]` do CHANGELOG, na ordem em que aparecem. */
export function versoesDoChangelog(changelog: string): string[] {
  const versoes: string[] = [];
  for (const linha of changelog.split("\n")) {
    const m = /^##\s+\[(\d+\.\d+\.\d+)\]/.exec(linha);
    if (m?.[1]) versoes.push(m[1]);
  }
  return versoes;
}

export interface ProximaDoFork {
  /** A versão que sai. */
  versao: string;
  /** De onde o link de comparação parte: a release anterior do fork, ou a do original. */
  anterior: string;
}

/**
 * Próxima versão do fork, a partir das versões que já existem (seções do
 * CHANGELOG e, quando houver, tags). Olha TODAS, e não só a do topo: depois de
 * uma sincronização a seção do original pode ficar acima da do fork no arquivo.
 *
 * - Sem release do fork na minor mais nova do original → `<maior>.<menor>.100`.
 * - Com release do fork nessa minor → a maior delas + 1.
 */
export function proximaVersaoDoFork(versoesConhecidas: readonly string[]): ProximaDoFork {
  const lidas = versoesConhecidas.map(ler).filter((v): v is Versao => v !== null);
  const doOriginal = lidas.filter((v) => v[2] < INICIO_DA_FAIXA_DO_FORK).sort(comparar);
  const doFork = lidas.filter((v) => v[2] >= INICIO_DA_FAIXA_DO_FORK).sort(comparar);

  const original = doOriginal.at(-1);
  if (!original) throw new Error("nenhuma versão do original no CHANGELOG: não sei em cima de qual minor o fork está");

  const [maior, menor] = original;
  const naMesmaMinor = doFork.filter((v) => v[0] === maior && v[1] === menor).at(-1);
  const ultimaDoFork = doFork.at(-1);

  if (ultimaDoFork && comparar(ultimaDoFork, original) > 0 && !naMesmaMinor) {
    // O fork já publicou numa minor ACIMA da última do original que o CHANGELOG
    // conhece: a sincronização ficou para trás do número. Recusar é melhor que
    // voltar a numeração e colidir com uma tag já publicada.
    throw new Error(
      `a última release do fork (${ultimaDoFork.join(".")}) está acima da última versão do original no CHANGELOG ` +
        `(${original.join(".")}). Sincronize com o original antes de cortar.`,
    );
  }

  if (naMesmaMinor) {
    return { versao: `${maior}.${menor}.${naMesmaMinor[2] + 1}`, anterior: naMesmaMinor.join(".") };
  }
  return { versao: `${maior}.${menor}.${INICIO_DA_FAIXA_DO_FORK}`, anterior: original.join(".") };
}
