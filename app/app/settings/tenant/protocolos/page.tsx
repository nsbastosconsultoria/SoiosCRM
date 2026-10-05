import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ConfiguracaoDeProtocolos } from "./_client";

export const dynamic = "force-dynamic";

/**
 * CONFIGURAÇÃO DE PROTOCOLOS (spec 22 §12): modelo de nicho, expediente, prazos por prioridade,
 * filas por área, categorias e feriados. Só `admin` — a RLS da 0904 exige o mesmo.
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
        <h1 className="text-xl font-semibold">{t("Configuração de protocolos")}</h1>
        <p className="text-sm text-text-muted">
          {t("Categorias, filas por área, prazos de resposta e o expediente que conta o prazo.")}
        </p>
      </div>
      <ConfiguracaoDeProtocolos />
    </div>
  );
}
