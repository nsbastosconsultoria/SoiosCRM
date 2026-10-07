import { notFound } from "next/navigation";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/** Configuração da implantação: some junto com o módulo (ADR-0002, spec 23). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "implantacao"))) notFound();
  return children;
}
