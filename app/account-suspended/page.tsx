import Link from "next/link";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { avisoDeCobranca } from "@/lib/cobranca/aviso";
import { formatarData, formatarValor } from "@/lib/cobranca/formato";

export const metadata = {
  title: "Conta suspensa",
};

/**
 * Esta tela entregava o NOSSO endereço de suporte ao cliente de um revendedor —
 * e aqui isso é ativamente errado: quem suspendeu a conta foi o revendedor, e
 * escrever para nós não desbloqueia nada. O endereço agora sai de
 * `SUPPORT_EMAIL` (o do operador) e, quando ninguém configurou, o parágrafo do
 * contato simplesmente NÃO renderiza. Cair de volta num endereço do produto
 * seria o defeito de volta, com o agravante de parecer resolvido.
 */
export default async function AccountSuspendedPage() {
  const suporte = await emailDeSuporte();
  // Rota fora da árvore de `app/app/layout.tsx` — sem o `IdiomaProvider` de lá, então
  // resolve o idioma direto, como `admin/forbidden/page.tsx`. Quem chega aqui
  // normalmente tem sessão do Supabase Auth (a suspensão é regra do produto,
  // não um ban de autenticação), mas `user` fica opcional por segurança.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? null,
  );

  // SUSPENSA POR FALTA DE PAGAMENTO (módulo `cobranca`): a tela diz qual fatura e como pagar —
  // é a única coisa que tira a conta daqui. Lido com o cliente da SESSÃO: a RLS da provisionadora
  // deixa o membro ler a assinatura e as faturas da própria organização, e só elas. Suspensa à
  // mão (ou sem o módulo), `avisoDeCobranca` devolve null e a tela fica como sempre foi.
  //
  // `loadAuthUser` falha ALTO de propósito quando o banco oscila; aqui o quadro é acessório, e
  // a tela de conta suspensa não pode virar 500 por causa dele.
  const aviso = await (async () => {
    if (!user) return null;
    try {
      const authUser = await loadAuthUser();
      const org = authUser ? await resolveActiveOrg(authUser) : null;
      return org ? await avisoDeCobranca(supabase, org.orgId) : null;
    } catch {
      return null;
    }
  })();

  return (
    <IdiomaProvider locale={idioma}>
      <main className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <h1 className="text-2xl font-semibold">{traduzir("Conta suspensa", idioma)}</h1>
          {suporte ? (
            <p className="text-sm text-muted-foreground">
              {traduzir("Sua conta está suspensa. Entre em contato com", idioma)}{" "}
              <a
                href={`mailto:${suporte}`}
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                {suporte}
              </a>{" "}
              {traduzir("para mais informações.", idioma)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {traduzir(
                "Sua conta está suspensa. Fale com quem administra este sistema para saber o motivo e como reativá-la.",
                idioma,
              )}
            </p>
          )}
          {aviso && (
            <div
              className="space-y-1 rounded-md border bg-muted/40 p-4 text-left text-sm"
              data-testid="conta-suspensa-fatura"
            >
              <p className="font-medium">
                {traduzir("Suspensa por falta de pagamento.", idioma)}
              </p>
              <p className="text-muted-foreground">
                {traduzir("Fatura de", idioma)} {formatarValor(aviso.valorCents, aviso.moeda)}
                {", "}
                {traduzir("venceu em", idioma)} {formatarData(aviso.vencimento)}.
              </p>
              {aviso.instrucao && (
                <p className="break-all">
                  {traduzir("Como pagar", idioma)}: <span className="font-mono">{aviso.instrucao}</span>
                </p>
              )}
              <p className="text-muted-foreground">
                {traduzir("O acesso volta assim que o pagamento for registrado.", idioma)}
              </p>
            </div>
          )}
          <div className="pt-2">
            <Button asChild variant="outline">
              <Link href="/login">{traduzir("Sair", idioma)}</Link>
            </Button>
          </div>
        </Card>
      </main>
    </IdiomaProvider>
  );
}
