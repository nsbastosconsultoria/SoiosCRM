import { notFound } from "next/navigation";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/** Configuração de protocolos: some junto com o módulo (ADR-0002, spec 22). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "protocolos"))) notFound();
  return children;
}
