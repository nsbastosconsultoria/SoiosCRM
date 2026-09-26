# Runbook — "entrar com Google" devolve `provider is not enabled`

Para quem clicou em **Entrar com Google** e caiu num erro, ou viu isto no log/network:

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

## 1. Não é bug — é config que falta

`app/actions/auth/signInWithGoogle.ts` já reconhece essa mensagem exata e devolve
`google_indisponivel` para a tela em vez de deixar o erro genérico vazar — é o
GoTrue (o Auth do Supabase) respondendo que **ninguém ligou o provedor Google
neste projeto**. Login por e-mail/senha continua funcionando normalmente; o
Google é opcional. Tentar de novo, reiniciar o app ou mexer no `.env` **não**
resolve — o toggle vive no dashboard do Supabase, fora deste repo.

Cada instalação (cada clone self-host) tem o **seu próprio** projeto Supabase, e
esse toggle é por projeto — habilitar no seu não habilita no de outro
self-hoster, nem o self-host tem `GOTRUE_EXTERNAL_GOOGLE_*` em compose para
ajustar (confira: `grep -ri gotrue docker-compose*.yml` não acha nada — esta
instalação fala com Supabase Cloud, não roda GoTrue próprio).

## 2. Descubra qual é o seu Project Ref

```bash
grep NEXT_PUBLIC_SUPABASE_URL .env   # https://<project-ref>.supabase.co
```

O `<project-ref>` das próximas URLs é esse trecho.

## 3. Crie a credencial OAuth no Google Cloud Console

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials**
   → **OAuth client ID**.
2. Se pedir, configure a **OAuth consent screen** primeiro (External, nome do
   app, e-mail de suporte — não precisa de verificação do Google pra uso
   interno/poucos usuários).
3. **Application type:** Web application.
4. **Authorized redirect URIs** — adicione **exatamente**:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

   Esse é o callback do **GoTrue**, não o do app (`/auth/callback` do Next é
   outro salto, depois deste — ver `lib/auth/entrada-com-google.ts`). Domínio
   errado aqui é a causa nº 1 de `redirect_uri_mismatch` na primeira tentativa
   depois de habilitar o provedor.
5. Salve o **Client ID** e o **Client secret**.

## 4. Habilite o provedor no Supabase

No dashboard do projeto: **Authentication → Providers → Google**.

1. Ligue o toggle.
2. Cole **Client ID** e **Client secret** do passo 3.
3. Salvar.

## 5. Confirme a allowlist de redirect do app

O `redirectTo` que `signInWithGoogle` manda é
`${NEXT_PUBLIC_APP_URL}/auth/callback` (`lib/auth/entrada-com-google.ts`) — o
GoTrue só aceita voltar para uma URL que estiver na allowlist do projeto, em
**Authentication → URL Configuration → Redirect URLs**. Confira que
`<seu-domínio>/auth/callback` está lá (em dev, `http://localhost:3000/auth/callback`).
Sem isso o sintoma muda: some o `provider is not enabled`, mas aparece um erro
de `redirect_to` não permitido depois do consentimento no Google.

```bash
grep NEXT_PUBLIC_APP_URL .env
```

## 6. Prove pela tela

`curl` não prova esse fluxo — precisa do PKCE ida-e-volta pelo navegador (ver o
comentário no topo de `signInWithGoogle.ts`). Abra `/login`, clique **Entrar
com Google**, complete o consentimento e confirme que volta autenticado em
`/app`. Se ainda cair em `google_indisponivel`, o toggle do passo 4 não pegou —
recarregue a página do dashboard e confira de novo (às vezes o save não
propaga na hora).

## 7. Se ainda falhar depois disso

Abra o Network do navegador na chamada para
`https://<project-ref>.supabase.co/auth/v1/authorize?provider=google&...` — o
`msg` da resposta diz a causa exata (`provider is not enabled` = passo 4 não
salvou; `redirect_uri_mismatch` = passo 3 ou 5 com URL diferente da cadastrada
por um caractere que seja, incluindo barra final).
