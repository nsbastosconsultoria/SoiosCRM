/**
 * COBRANÇA DOS TENANTS PELA TELA — do plano à suspensão e de volta (módulo `cobranca`, 0493).
 *
 * O caminho, como o dono de uma instalação faria:
 *   1. instala o módulo em Módulos, acha "Cobrança" no menu, cria um plano e assina uma empresa;
 *   2. lança a fatura (com o Pix colado) de um vencimento que já passou — a empresa entra em
 *      atraso na mesma requisição;
 *   3. o admin da empresa vê a faixa da carência, com o valor e como pagar;
 *   4. passada a carência, a rodada diária suspende: a empresa cai na tela de conta suspensa,
 *      que mostra a fatura;
 *   5. o dono dá baixa — e a empresa volta na hora, sem faixa.
 *
 * ⚠️ A EMPRESA COBRADA É DESCARTÁVEL, com usuário próprio. Suspender a organização do
 * `.e2e-creds.json` derrubaria todas as specs seguintes da parte; e o usuário é só dela, sem
 * MFA (a política da organização nova não exige), para o login não depender do TOTP
 * compartilhado que outros seeds rotacionam.
 *
 * ⚠️ O TEMPO É EMPURRADO PELO BANCO, NÃO ESPERADO. A carência é de 7 dias; a spec recua o
 * vencimento da fatura e chama o cron de verdade (`/api/v1/cron/cobranca-watcher`) — a regra que
 * decide é a mesma da produção, só o calendário é encurtado.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `honorarios-instalar-e-pagar`: as specs
 * seguintes da parte veem "Cobrança" no menu do painel. A tela nada exibe às empresas que não
 * têm assinatura.
 */
import { createClient } from "@supabase/supabase-js";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const ORG_SLUG = "e2e-cobranca";
const ORG_NOME = "E2E Cobranca Cliente";
const EMAIL = "e2e-cobranca-admin@deskcomm.test";
const PIX = "Pix: cobranca-e2e@deskcomm.test";

function bancoDeTeste() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error(
      "sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no processo de teste — " +
        "o playwright.config publica o .env.e2e aqui",
    );
  }
  return createClient(url, chave, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** `YYYY-MM-DD` de hoje em São Paulo, deslocado `dias`. */
function diaCivil(dias: number): string {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [y, m, d] = hoje.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** A empresa cobrada e o seu admin — recriados limpos a cada rodada. */
async function prepararEmpresa(senha: string): Promise<string> {
  const db = bancoDeTeste();

  const { data: existente } = await db.from("organizations").select("id").eq("slug", ORG_SLUG).maybeSingle();
  let orgId = (existente as { id: string } | null)?.id;
  if (orgId) {
    // Rodada anterior pode ter deixado a empresa suspensa e com assinatura: volta ao zero.
    // A assinatura cai sem erro quando o módulo ainda não foi instalado (a tabela não existe).
    await db.from("billing_subscriptions").delete().eq("organization_id", orgId);
    const { error } = await db
      .from("organizations")
      .update({
        status: "active",
        suspended_at: null,
        suspended_reason: null,
        suspended_by: null,
        onboarded_at: new Date().toISOString(),
      } as never)
      .eq("id", orgId);
    if (error) throw new Error(`reativar a empresa da cobrança: ${error.message}`);
  } else {
    const { data, error } = await db
      .from("organizations")
      .insert({
        slug: ORG_SLUG,
        display_name: ORG_NOME,
        legal_name: ORG_NOME,
        timezone: "America/Sao_Paulo",
        locale: "pt-BR",
        onboarded_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`criar a empresa da cobrança: ${error?.message}`);
    orgId = (data as { id: string }).id;
  }

  const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 });
  let userId = lista?.users.find((u) => u.email === EMAIL)?.id;
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email: EMAIL,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: "E2E Admin da Empresa Cobrada" },
    });
    if (error || !data.user) throw new Error(`criar o admin da empresa: ${error?.message}`);
    userId = data.user.id;
  } else {
    await db.auth.admin.updateUserById(userId, { password: senha });
  }

  const { data: vinculo } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!vinculo) {
    const { error } = await db.from("user_organizations").insert({
      user_id: userId,
      organization_id: orgId,
      role: "admin",
      accepted_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(`vincular o admin à empresa: ${error.message}`);
  }
  return orgId;
}

async function loginDaEmpresa(page: Page, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(app|account-suspended)/, { timeout: 30_000 });
}

test.describe("Cobrança dos tenants: da fatura à suspensão e de volta", () => {
  test.describe.configure({ mode: "serial" });

  let orgId = "";
  const creds = lerCreds();

  test.beforeAll(async () => {
    await afirmarDonoDoServidor(creds.users.dono!.email);
    orgId = await prepararEmpresa(creds.password);
  });

  test("o dono instala, cria o plano, assina a empresa e lança a fatura vencida", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, creds);

    // 1. Módulos › Cobrança dos tenants › Instalar.
    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-cobranca");
    await expect(cartao, "o catálogo de módulos não oferece a cobrança").toBeVisible();
    const instalar = page.getByTestId("instalar-cobranca");
    if (await instalar.isVisible()) await instalar.click();
    await expect(cartao.getByText(/instalado/i), "o módulo não ficou instalado").toBeVisible({
      timeout: 30_000,
    });

    // 2. A porta no menu do painel.
    const porta = page.locator('a[href="/admin/cobranca"]').first();
    await expect(porta, "o menu do painel não tem a porta da cobrança").toBeVisible();
    await porta.click();
    await expect(page).toHaveURL(/\/admin\/cobranca/);
    await expect(page.getByTestId("cobranca-modulo-ausente")).toHaveCount(0);

    // 3. O plano.
    const nomeDoPlano = `Essencial e2e ${Date.now()}`;
    await page.getByTestId("plano-nome").fill(nomeDoPlano);
    await page.getByTestId("plano-preco").fill("199,90");
    await page.getByTestId("criar-plano").click();
    await expect(page.getByTestId("cobranca-planos")).toContainText(nomeDoPlano);
    await expect(page.getByTestId("cobranca-planos")).toContainText("R$ 199,90");

    // 4. A assinatura, com o primeiro vencimento há 3 dias (dentro da carência de 7).
    const vencimento = diaCivil(-3);
    await page.getByLabel("Empresa").selectOption({ label: ORG_NOME });
    await page.getByLabel("Plano", { exact: true }).selectOption({ label: nomeDoPlano });
    await page.getByLabel("Primeiro vencimento").fill(vencimento);
    await page.getByTestId("criar-assinatura").click();
    const assinatura = page.getByTestId(`assinatura-${orgId}`);
    await expect(assinatura, "a assinatura não apareceu na tela").toBeVisible();
    await expect(assinatura.getByTestId("status-da-assinatura")).toHaveText("Em dia");

    // 5. A fatura, com o Pix — e o vencimento que já passou põe a empresa em atraso na hora.
    await assinatura.getByLabel(/como pagar/i).fill(PIX);
    await assinatura.getByTestId("lancar-fatura").click();
    await expect(assinatura.getByTestId("status-da-assinatura")).toHaveText("Em atraso", {
      timeout: 15_000,
    });
    const linha = assinatura.locator('tr[data-testid^="fatura-"]').first();
    await expect(linha).toContainText("Vencida");
    await expect(linha).toContainText("R$ 199,90");
    await page.screenshot({ path: "evidence/cobranca-dos-tenants/1-admin-em-atraso.png", fullPage: true });

    // Lançada a fatura do período, a assinatura avançou um mês: o botão já oferece o PRÓXIMO
    // vencimento, e não de novo o que acabou de ser faturado.
    await expect(assinatura.getByTestId("lancar-fatura")).not.toContainText(
      vencimento.split("-").reverse().join("/"),
    );
  });

  test("o admin da empresa vê a faixa da carência, com o valor e o Pix", async ({ page }) => {
    await loginDaEmpresa(page, creds.password);
    await page.goto("/app");
    const faixa = page.getByTestId("faixa-cobranca-em-atraso");
    await expect(faixa, "a faixa da carência não apareceu para o admin").toBeVisible();
    await expect(faixa).toContainText("R$ 199,90");
    await expect(faixa).toContainText(PIX);
    await expect(faixa).toContainText(/será suspenso em/);
    await page.screenshot({ path: "evidence/cobranca-dos-tenants/2-faixa-da-carencia.png" });
  });

  test("passada a carência, a rodada diária suspende e a tela mostra a fatura", async ({ page }) => {
    // O calendário encurtado: a fatura venceu há 10 dias (carência 7).
    const db = bancoDeTeste();
    const { error } = await db
      .from("billing_invoices")
      .update({ due_date: diaCivil(-10) } as never)
      .eq("organization_id", orgId)
      .in("status", ["open", "overdue"]);
    expect(error, error?.message).toBeNull();

    const segredo = process.env.INTERNAL_CRON_SECRET || process.env.INTERNAL_SECRET;
    const rodada = await page.request.post("/api/v1/cron/cobranca-watcher", {
      headers: { authorization: `Bearer ${segredo}` },
    });
    expect(rodada.ok(), await rodada.text()).toBe(true);
    const { data } = (await rodada.json()) as { data: { suspensas: number; modulo_instalado: boolean } };
    expect(data.modulo_instalado).toBe(true);
    expect(data.suspensas, "a rodada não suspendeu a empresa em atraso").toBeGreaterThanOrEqual(1);

    await loginDaEmpresa(page, creds.password);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/account-suspended/);
    const quadro = page.getByTestId("conta-suspensa-fatura");
    await expect(quadro, "a conta suspensa não mostra a fatura").toBeVisible();
    await expect(quadro).toContainText("R$ 199,90");
    await expect(quadro).toContainText(PIX);
    await page.screenshot({ path: "evidence/cobranca-dos-tenants/3-conta-suspensa.png" });
  });

  test("o dono dá baixa e a empresa volta na hora, sem faixa", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, creds);
    await page.goto("/admin/cobranca");
    const assinatura = page.getByTestId(`assinatura-${orgId}`);
    await expect(assinatura.getByTestId("status-da-assinatura")).toHaveText("Suspensa");
    await assinatura.getByTestId("dar-baixa").first().click();
    await expect(assinatura.getByTestId("status-da-assinatura")).toHaveText("Em dia", {
      timeout: 15_000,
    });
    await expect(assinatura.locator('tr[data-testid^="fatura-"]').first()).toContainText("Paga");
    await page.screenshot({ path: "evidence/cobranca-dos-tenants/4-baixa.png", fullPage: true });

    const contexto = await browser.newContext();
    const empresa = await contexto.newPage();
    await loginDaEmpresa(empresa, creds.password);
    await empresa.goto("/app");
    await expect(empresa, "a baixa não reativou a empresa").not.toHaveURL(/\/account-suspended/);
    await expect(empresa.getByTestId("faixa-cobranca-em-atraso")).toHaveCount(0);
    await contexto.close();
  });
});
