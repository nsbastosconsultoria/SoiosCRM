import { notFound } from "next/navigation";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Implantação de clientes é módulo opcional da instalação (ADR-0002, spec 23). Sem o módulo
 * instalado, as tabelas não existem e estas telas não existem para ninguém.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "implantacao"))) notFound();
  return children;
}
