import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { FichaDaImplantacao } from "./_client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ficha da implantação (spec 23 §8): os itens por grupo, quem cuida de cada um e o botão de
 * concluir — liberado só com os obrigatórios fechados. A porta é a lista (`/app/implantacoes`),
 * que está no catálogo de navegação, e o cartão da ficha da empresa na carteira.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <FichaDaImplantacao
      implantacaoId={id}
      podeAtender={ROLE_RANK[org.role] >= ROLE_RANK.agent}
      ehGestor={ROLE_RANK[org.role] >= ROLE_RANK.manager}
    />
  );
}
