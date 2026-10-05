import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { FichaDoProtocolo } from "./_client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ficha do protocolo (spec 22 §12): o pedido, o relógio, as ações que o estado permite e a linha
 * do tempo. A porta é a fila (`/app/protocolos`), que está no catálogo de navegação.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  return (
    <FichaDoProtocolo
      protocoloId={id}
      podeAtender={ROLE_RANK[org.role] >= ROLE_RANK.agent}
      ehGestor={ROLE_RANK[org.role] >= ROLE_RANK.manager}
    />
  );
}
