import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

import { FichaDaEmpresa } from "./_client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ficha da empresa na carteira (spec 21 §9): relacionamento, pessoas que a representam e quem
 * cuida dela em cada área. A porta é a lista (`/app/carteira`), que já está no catálogo de
 * navegação; esta é a página de detalhe dela.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <FichaDaEmpresa
      companyId={id}
      podeGerenciar={ROLE_RANK[org.role] >= ROLE_RANK.manager}
      podeEditarVinculo={ROLE_RANK[org.role] >= ROLE_RANK.agent}
      ehAdmin={ROLE_RANK[org.role] >= ROLE_RANK.admin}
      comImplantacao={await moduloLigado(createAdminClient(), "implantacao")}
    />
  );
}
