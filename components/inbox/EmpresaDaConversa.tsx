"use client";
/**
 * De qual empresa é esta conversa — no cabeçalho da inbox (spec 21 §9), com o módulo carteira.
 *
 * Com um número só, a mesma pessoa escreve por várias empresas. O atendente vê aqui a empresa de
 * que a conversa trata agora (o assistente também a define, pela ferramenta) e troca num clique.
 * Trocar nunca move o que já foi tratado: só vale daqui para frente.
 *
 * Some por completo quando não há o que mostrar (pessoa sem empresa ligada e nenhum contexto),
 * e quando o módulo não está ligado — quem chama decide isso pelo `modulos_ligados`.
 */
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Contexto = {
  empresas: Array<{ company_id: string; nome: string; cnpj: string | null; estado: string | null }>;
  empresa_da_conversa: string | null;
};

export function EmpresaDaConversa({ conversationId, podeTrocar }: { conversationId: string; podeTrocar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const chave = ["carteira", "contexto", conversationId];

  const contexto = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (await apiClient.get<{ data: Contexto }>(`/api/v1/carteira/conversas/${conversationId}/contexto`)).data,
    retry: false,
  });

  const trocar = useMutation({
    mutationFn: (companyId: string | null) =>
      apiClient.post(`/api/v1/carteira/conversas/${conversationId}/contexto`, { company_id: companyId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });

  const dados = contexto.data;
  if (!dados || (dados.empresas.length === 0 && dados.empresa_da_conversa === null)) return null;

  const atual = dados.empresas.find((e) => e.company_id === dados.empresa_da_conversa);

  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground" data-testid="empresa-da-conversa">
      <span className="shrink-0">{t("Empresa:")}</span>
      {podeTrocar && dados.empresas.length > 0 ? (
        <select
          value={dados.empresa_da_conversa ?? ""}
          disabled={trocar.isPending}
          aria-label={t("Empresa de que a conversa trata")}
          data-testid="empresa-da-conversa-select"
          onChange={(e) => trocar.mutate(e.target.value || null)}
          className="min-w-0 truncate rounded-md border border-border bg-background px-1 py-0.5 text-xs text-foreground"
        >
          <option value="">{t("Nenhuma definida")}</option>
          {dados.empresas.map((e) => (
            <option key={e.company_id} value={e.company_id}>
              {[e.nome || t("Empresa sem nome"), e.cnpj].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      ) : atual ? (
        <Link href={`/app/carteira/${atual.company_id}`} className="truncate hover:underline">
          {atual.nome || t("Empresa sem nome")}
        </Link>
      ) : (
        <span>{t("Nenhuma definida")}</span>
      )}
      {atual ? (
        <Link
          href={`/app/carteira/${atual.company_id}`}
          className="shrink-0 underline-offset-2 hover:underline"
          data-testid="empresa-da-conversa-ficha"
        >
          {t("ver ficha")}
        </Link>
      ) : null}
    </div>
  );
}
