import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { Implantacoes } from "./_client";

export const dynamic = "force-dynamic";

/**
 * IMPLANTAÇÃO DE CLIENTES (spec 23 §8): as implantações em andamento, com o progresso dos itens
 * obrigatórios, o que está vencido e o que espera o cliente. Iniciar é pela ficha da empresa na
 * carteira — é lá que a empresa já existe.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Implantação de clientes")}</h1>
        <p className="text-sm text-text-muted">
          {t("O checklist de cada cliente novo, de quem é a vez em cada item e quando ele pode virar cliente ativo.")}
        </p>
      </div>
      <Implantacoes />
    </div>
  );
}
