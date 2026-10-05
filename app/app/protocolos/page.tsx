import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { Protocolos } from "./_client";

export const dynamic = "force-dynamic";

/**
 * PROTOCOLOS — as demandas dos clientes atuais (spec 22): minha fila, a fila da área, o que está
 * vencendo, e abrir um protocolo. `viewer` lê; abrir e assumir é `agent`+.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Protocolos")}</h1>
        <p className="text-sm text-text-muted">
          {t("As demandas dos clientes com número, categoria, prioridade, fila por área e prazo de resposta.")}
        </p>
      </div>
      <Protocolos
        podeAtender={ROLE_RANK[org.role] >= ROLE_RANK.agent}
        podeConfigurar={ROLE_RANK[org.role] >= ROLE_RANK.admin}
      />
    </div>
  );
}
