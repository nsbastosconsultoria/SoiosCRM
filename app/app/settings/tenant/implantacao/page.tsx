import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ConfiguracaoDaImplantacao } from "./_client";

export const dynamic = "force-dynamic";

/**
 * CONFIGURAÇÃO DA IMPLANTAÇÃO (spec 23 §8): os modelos de checklist e os itens de cada um. Só
 * `admin` — a RLS da 0907 exige o mesmo.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Configuração da implantação")}</h1>
        <p className="text-sm text-text-muted">
          {t("Os modelos de checklist que cada cliente novo segue. Mudar um modelo não mexe nas implantações já começadas.")}
        </p>
      </div>
      <ConfiguracaoDaImplantacao />
    </div>
  );
}
