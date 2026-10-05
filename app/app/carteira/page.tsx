import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { Carteira } from "./_client";

export const dynamic = "force-dynamic";

/**
 * CARTEIRA DE EMPRESAS — módulo opcional (spec 21): quem é cliente, desde quando, e a porta
 * para a ficha de cada empresa. `viewer` lê; pôr empresa na carteira é `manager`+, o mesmo
 * degrau que o núcleo exige para criar empresa.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Carteira de empresas")}</h1>
        <p className="text-sm text-text-muted">
          {t("Quem é cliente, desde quando, quem representa cada empresa e quem cuida dela.")}
        </p>
      </div>
      <Carteira podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager} />
    </div>
  );
}
