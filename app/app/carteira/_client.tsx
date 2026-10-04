"use client";
/**
 * Carteira de empresas — a lista.
 *
 * Módulo opcional (ADR-0002): se o módulo for desinstalado com a tela aberta, a leitura volta
 * 409 `module_not_installed`, e a tela mostra o texto da rota (quem resolve é o administrador da
 * instalação, não quem está aqui).
 */
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { ESTADOS_DA_CARTEIRA, type EstadoDaCarteira } from "@/lib/carteira/vocabulario";

import { classeDoEstado, rotuloDoEstado } from "./_rotulos";

export type LinhaDaCarteira = {
  company_id: string;
  estado: EstadoDaCarteira;
  cliente_desde: string | null;
  empresa: {
    id: string;
    legal_name: string | null;
    trade_name: string | null;
    cnpj: string | null;
    city: string | null;
    state: string | null;
  };
};

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

export function Carteira({ podeGerenciar }: { podeGerenciar: boolean }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [estado, setEstado] = useState<EstadoDaCarteira | "">("");
  const [busca, setBusca] = useState("");

  const lista = useQuery({
    queryKey: ["carteira", "empresas", estado, busca],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (estado) qs.set("estado", estado);
      if (busca.trim()) qs.set("q", busca.trim());
      return (await apiClient.get<{ data: LinhaDaCarteira[] }>(`/api/v1/carteira/empresas?${qs}`)).data;
    },
    retry: false,
  });

  const naoInstalado = lista.error instanceof ApiError && lista.error.code === "module_not_installed";
  if (naoInstalado) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {(lista.error as ApiError).message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {podeGerenciar ? <FormularioDeEmpresa /> : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Estado")}
          <select
            value={estado}
            data-testid="carteira-filtro-estado"
            onChange={(e) => setEstado(e.target.value as EstadoDaCarteira | "")}
            className={CAMPO}
          >
            <option value="">{t("Todos")}</option>
            {ESTADOS_DA_CARTEIRA.map((e) => (
              <option key={e} value={e}>
                {rotuloDoEstado(e, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Buscar por nome ou CNPJ")}
          <input
            value={busca}
            data-testid="carteira-busca"
            onChange={(e) => setBusca(e.target.value)}
            className={`w-64 ${CAMPO}`}
          />
        </label>
      </div>

      <section className="rounded-md border border-border p-3">
        {lista.isError ? (
          <p className="text-sm text-danger">{t("Não foi possível carregar a carteira.")}</p>
        ) : (lista.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">
            {lista.isLoading ? t("Carregando…") : t("Nenhuma empresa na carteira ainda.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(lista.data ?? []).map((linha) => (
                <tr key={linha.company_id} className="border-b border-border/60" data-testid={`carteira-${linha.company_id}`}>
                  <td className="py-2">
                    <Link href={`/app/carteira/${linha.company_id}`} className="font-medium hover:underline">
                      {linha.empresa.trade_name || linha.empresa.legal_name || t("Empresa sem nome")}
                    </Link>
                    <div className="text-xs text-text-muted">{linha.empresa.cnpj ?? t("Sem CNPJ")}</div>
                  </td>
                  <td className="py-2 text-xs text-text-muted">
                    {[linha.empresa.city, linha.empresa.state].filter(Boolean).join(" / ")}
                  </td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${classeDoEstado(linha.estado)}`}>
                      {rotuloDoEstado(linha.estado, t)}
                    </span>
                  </td>
                  <td className="py-2 text-right text-xs text-text-muted">
                    {linha.cliente_desde
                      ? `${t("Cliente desde")} ${new Date(`${linha.cliente_desde}T12:00:00`).toLocaleDateString(tagDoIdioma)}`
                      : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FormularioDeEmpresa() {
  const t = useT();
  const qc = useQueryClient();
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [jaECliente, setJaECliente] = useState(false);

  const adicionar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => apiClient.post("/api/v1/carteira/empresas", corpo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["carteira", "empresas"] });
      setCnpj("");
      setNome("");
      setJaECliente(false);
    },
    onError: showApiError,
  });

  const pode = (cnpj.trim() !== "" || nome.trim() !== "") && !adicionar.isPending;

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pode) return;
        adicionar.mutate({
          ...(cnpj.trim() ? { cnpj: cnpj.trim() } : {}),
          ...(nome.trim() ? { legal_name: nome.trim() } : {}),
          estado_inicial: jaECliente ? "ativo" : "prospect",
        });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("CNPJ")}
        <input
          value={cnpj}
          inputMode="numeric"
          data-testid="carteira-nova-cnpj"
          onChange={(e) => setCnpj(e.target.value)}
          className={`w-48 ${CAMPO}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Nome (se não houver CNPJ)")}
        <input
          value={nome}
          data-testid="carteira-nova-nome"
          onChange={(e) => setNome(e.target.value)}
          className={`w-64 ${CAMPO}`}
        />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          checked={jaECliente}
          data-testid="carteira-nova-ja-cliente"
          onChange={(e) => setJaECliente(e.target.checked)}
        />
        {t("Já é cliente")}
      </label>
      <Button type="submit" disabled={!pode} data-testid="carteira-adicionar">
        {t("Adicionar à carteira")}
      </Button>
    </form>
  );
}
