# Soios — como o fork publica versões e como a VPS se atualiza

O SoiosCRM é um fork do DeskcommCRM. Até 30/09/2026 o kit de instalação (`hostgator-setup-kit/`)
apontava para o **original**: as imagens em `ghcr.io/melgarafael/…` e as releases de
`melgarafael/DeskcommCRM`. Por isso o botão **"Atualizar agora"** e o `update.sh` levavam a VPS
para a versão do original, sem nada da Soios.

Desde este documento, o kit aponta para o fork:

| Peça | Antes | Agora |
|---|---|---|
| Imagens (`IMG_NS` em `_common.sh`, defaults do `docker-compose.prod.yml`, `.env.hostgator.example`) | `ghcr.io/melgarafael` | `ghcr.io/nsbastosconsultoria` |
| Repositório do `install.sh`, `comecar.sh` e da consulta de versão | `melgarafael/DeskcommCRM` | `nsbastosconsultoria/SoiosCRM` |
| Links do CHANGELOG (`scripts/cortar-release.ts`) | original | fork |

A numeração **continua a do original** (decisão de 30/09/2026): a próxima versão da Soios é
calculada a partir da 1.64.1 pelos fragmentos de `.changes/`, como no original. A VPS só enxerga
as tags do fork, então um número igual a uma versão futura do original não confunde a atualização.

## 1. Uma vez: o GitHub App que corta as versões

O `release.yml` cria branch, PR e tag com o token de um **GitHub App**, nunca com o
`GITHUB_TOKEN`: tag criada pelo `GITHUB_TOKEN` não dispara o `publish-image.yml`, e as imagens da
versão nunca seriam publicadas. Sem o App, o job falha logo no começo ("The 'client-id' (or
deprecated 'app-id') input must be set").

1. Em **GitHub › Settings (da conta nsbastosconsultoria) › Developer settings › GitHub Apps ›
   New GitHub App**:
   - **Nome:** `soios-release` (ou outro qualquer, único no GitHub).
   - **Homepage URL:** `https://github.com/nsbastosconsultoria/SoiosCRM`.
   - **Webhook:** desmarque **Active**.
   - **Repository permissions:** **Contents: Read and write**, **Pull requests: Read and
     write**, **Metadata: Read-only** (vem marcada).
   - **Where can this GitHub App be installed?** **Only on this account**.
   - **Create GitHub App**.
2. Na página do App: anote o **App ID**; em **Private keys › Generate a private key**, baixe o
   arquivo `.pem`.
3. **Install App** (menu lateral) › instale **só no repositório SoiosCRM**.
4. No repositório **SoiosCRM › Settings › Secrets and variables › Actions › New repository
   secret**, crie os dois:
   - `RELEASE_APP_ID` — o App ID do passo 2;
   - `RELEASE_APP_PRIVATE_KEY` — o conteúdo inteiro do `.pem`, incluindo as linhas
     `-----BEGIN…` e `-----END…`.

## 2. A cada versão: cortar

1. **Actions › release › Run workflow** (na `main`). Ele lê `.changes/`, calcula o número e abre
   um PR "Release X.Y.Z".
2. Confira o PR e faça o **merge**. O merge cria a tag `vX.Y.Z`, publica a release e as três
   imagens `ghcr.io/nsbastosconsultoria/*:X.Y.Z`, e move o canal `stable`.
3. O passo que confere o changelog no site deskcomm.com.br só roda no original
   (`github.repository == 'melgarafael/DeskcommCRM'`); no fork ele é pulado.

## 3. Uma vez: apontar a VPS para o fork

A VPS da Soios já roda as imagens do fork (troca feita em 30/09/2026, à mão), mas o clone em
`/root/DeskcommCRM` ainda tem `origin` no original, e é pela `origin` que o `update.sh` descobre a
versão. **Só faça isto depois de existir a primeira release do fork** (passo 2):

```bash
cd /root/DeskcommCRM
git remote set-url origin https://github.com/nsbastosconsultoria/SoiosCRM.git
git fetch --tags origin && git tag -l 'v*' --sort=-v:refname | head -3
```

A lista tem de mostrar a versão que você acabou de cortar. A partir daí, **"Atualizar agora"** e
`bash hostgator-setup-kit/update.sh` levam a VPS para a última release **do fork**, com backup,
banco e conferência, como no original.

## Até a primeira release: a atualização manual

Enquanto o fork não tiver release, **não use "Atualizar agora"**: com a `origin` no original, ele
voltaria a VPS para as imagens de lá. Para levar à VPS o que está na `main` do fork:

```bash
cd /root/DeskcommCRM
bash hostgator-setup-kit/backup.sh
git fetch soios main && git checkout -B soios-main soios/main
bash -c 'source hostgator-setup-kit/_common.sh; enter_project;
reaplicar_baseline "$PROJECT_DIR/supabase/baseline.sql" "$PROJECT_DIR/.deskcomm-banco.log" && echo "✓ BANCO OK"'
bash -c 'source hostgator-setup-kit/_common.sh; enter_project; load_env .env; dc pull app worker scheduler && dc up -d'
curl -sS -o /dev/null -w "%{http_code}\n" https://soioscrm.lnailabs.com.br/   # 307
```

O caminho absoluto no `reaplicar_baseline` (`$PROJECT_DIR/…`) é obrigatório: com caminho relativo
o `docker run -v` recusa o arquivo e nada é aplicado.

## Sincronizar com o original

Trazer uma versão nova do original é um merge de `melgarafael/DeskcommCRM` `main` na `main` do
fork, por PR. Os conflitos recorrentes, medidos no merge da v1.64.1 (PR #12):

- **Números de migration:** o original e o fork usam os mesmos `NNNN`. As do fork são
  renumeradas para depois da última do original, com timestamp novo, no MANIFEST e nas
  referências (`pnpm checar:colisao-de-migration`).
- **`baseline.sql`:** os blocos dos dois lados antes da varredura `anon`, e **uma** definição
  por provisionadora (`tests/unit/adr-0002-funcao-provisionadora.test.ts`).
- **`.changes/` e `CHANGELOG.md`:** os fragmentos que o original consumiu somem; os do fork ficam.
