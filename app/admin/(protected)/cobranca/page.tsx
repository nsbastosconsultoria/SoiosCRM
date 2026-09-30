import Link from "next/link";
import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { moduloDeCobrancaAusente } from "@/lib/cobranca/modulo";
import { COLUNAS_DA_ASSINATURA, COLUNAS_DA_FATURA, COLUNAS_DO_PLANO } from "@/lib/cobranca/rota";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { PainelDeCobranca, type Assinatura, type Fatura, type Organizacao, type Plano } from "./_painel";

export const metadata = { title: "Cobrança dos tenants" };
export const dynamic = "force-dynamic";

/**
 * COBRANÇA DOS TENANTS — Fase 1, manual (módulo `cobranca`, migration 0493).
 *
 * O objeto é a INSTALAÇÃO: quem opera a VPS cobra as empresas que atende. Planos, a assinatura de
 * cada organização e as faturas lançadas e baixadas à mão. O corte por falta de pagamento é do
 * cron `cobranca-watcher` (7 dias de carência), e a baixa reativa na hora.
 *
 * Sem o módulo instalado, as tabelas não existem: a tela diz isso e aponta para /admin/modulos,
 * em vez de um erro.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const idioma = normalizarIdioma(usuario.locale);
  const t = (s: string) => traduzir(s, idioma);

  const db = await createClient();
  const [planos, assinaturas, faturas] = await Promise.all([
    db.from("billing_plans").select(COLUNAS_DO_PLANO).order("name"),
    db.from("billing_subscriptions").select(COLUNAS_DA_ASSINATURA),
    db
      .from("billing_invoices")
      .select(COLUNAS_DA_FATURA)
      .order("due_date", { ascending: false })
      .limit(500),
  ]);

  const cabecalho = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("Cobrança dos tenants")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">
        {t(
          "Planos, assinaturas e faturas das empresas desta instalação. A fatura em atraso suspende as telas da empresa depois da carência; WhatsApp e IA continuam atendendo. Dar baixa reativa na hora.",
        )}
      </p>
    </div>
  );

  if (moduloDeCobrancaAusente(planos.error)) {
    return (
      <div className="space-y-6" data-testid="tela-cobranca">
        {cabecalho}
        <div className="rounded-lg border bg-card p-6 text-sm" data-testid="cobranca-modulo-ausente">
          <p className="font-medium">{t("O módulo de cobrança não está instalado.")}</p>
          <p className="mt-1 text-text-muted">
            {t("Instale o módulo \"Cobrança dos tenants\" para criar planos e lançar faturas.")}
          </p>
          <Link href="/admin/modulos" className="mt-3 inline-block text-primary underline">
            {t("Abrir Módulos")}
          </Link>
        </div>
      </div>
    );
  }

  const erro = planos.error ?? assinaturas.error ?? faturas.error;
  if (erro) throw new Error(`cobranca: ${erro.message}`);

  // As organizações vêm pela service role porque a lista é da INSTALAÇÃO inteira (a sessão do
  // administrador da plataforma não tem vínculo com cada uma). Só id, nome e status.
  const { data: orgs } = await createAdminClient()
    .from("organizations")
    .select("id, display_name, status")
    .neq("status", "redacted")
    .order("display_name")
    .limit(1000);

  return (
    <div className="space-y-6" data-testid="tela-cobranca">
      {cabecalho}
      <PainelDeCobranca
        planos={(planos.data ?? []) as Plano[]}
        assinaturas={(assinaturas.data ?? []) as Assinatura[]}
        faturas={(faturas.data ?? []) as Fatura[]}
        organizacoes={(orgs ?? []) as Organizacao[]}
      />
    </div>
  );
}
