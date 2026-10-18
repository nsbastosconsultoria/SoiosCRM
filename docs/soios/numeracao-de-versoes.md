# Numeração das versões do SoiosCRM

**Regra:** versão do fork = `<maior>.<menor>` do DeskcommCRM em que o fork está + correção a
partir de **100**.

| Situação | Versão do fork |
|---|---|
| Primeira release depois de sincronizar com o original 1.85.0 | `1.85.100` |
| Releases seguintes, ainda em cima do 1.85.x | `1.85.101`, `1.85.102`, … |
| Depois de sincronizar com o original 1.86.0 | `1.86.100` |

## Por quê

O fork publica tags `vX.Y.Z` no próprio repositório, e as VPSs se atualizam por elas. Duas vezes
o fork publicou um número que o original também usa (1.65.0–1.67.0 e 1.81.0), e a versão com o
mesmo número tinha conteúdo diferente nos dois lados.

Um sufixo (`1.85.0-soios.1`) resolveria a colisão, mas o kit da VPS (`install.sh`, `update.sh`,
`agent.sh`), as imagens Docker e o corte de release só aceitam `vX.Y.Z`. Adotar sufixo seria mexer
em todos esses arquivos do original e ganhar conflito em cada sincronização. A faixa de correção a
partir de 100 cabe no formato que já existe:

- o original nunca chegou a 100 correções numa mesma minor (o máximo até hoje é de um dígito);
- `sort -V` e a comparação por partes ordenam certo: `1.85.0 < 1.85.9 < 1.85.100 < 1.86.0`;
- o número diz em cima de qual versão do original o fork está.

## Como funciona

- `pnpm release:conferir` / o workflow de release calculam o número com
  `lib/release/numeracao-do-fork.ts` (chamado por `scripts/cortar-release.ts`). O impacto dos
  fragmentos continua decidindo o aviso (`exige_acao` → "Requer atenção"), não o número.
- `--major` é recusado no fork: maior e menor vêm do original, na sincronização.
- Se a última release do fork estiver numa minor acima da última versão do original no
  CHANGELOG, o corte é recusado (sincronize antes).

## Sincronizar com o original

A partir da 1.85.0, as seções do fork (`## [X.Y.1NN]`) **ficam** no `CHANGELOG.md` ao resolver o
conflito da sincronização, junto com as do original. Os números não colidem, e o corte usa essas
seções para não repetir um número já publicado.

As versões publicadas antes desta regra (1.65.0–1.67.0 e 1.81.0) estão em
[versoes-proprias-1.65-1.67.md](versoes-proprias-1.65-1.67.md).
