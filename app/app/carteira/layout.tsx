import { notFound } from "next/navigation";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Carteira de empresas é módulo opcional da instalação (ADR-0002, spec 21). Sem o módulo
 * instalado, as tabelas não existem e estas telas não existem para ninguém — quem instala é o
 * administrador da instalação, em Modo administrador › Módulos.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "carteira"))) notFound();
  return children;
}
