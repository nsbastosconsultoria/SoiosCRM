"use client";
/**
 * A lista de implantações — quatro visões. Cada linha mostra o que decide a próxima ação: quantos
 * obrigatórios já fecharam, o que está vencido e o que espera o cliente.
 */
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { EstadoDaImplantacao } from "@/lib/implantacao/vocabulario";

type Visao = "todas" | "minhas" | "atrasadas" | "aguardando_cliente";

export type ResumoDosItens = {
  obrigatorios: number;
  obrigatorios_fechados: number;
  itens: number;
  itens_fechados: number;
  vencidos: number;
  aguardando_cliente: number;
  aguardando_terceiro: number;
  pode_concluir: boolean;
};

type Linha = {
  id: string;
  company_id: string;
  empresa: string | null;
  estado: EstadoDaImplantacao;
  iniciada_em: string;
  prevista_para: string | null;
  resumo: ResumoDosItens;
};

const VISOES: readonly Visao[] = ["todas", "minhas", "atrasadas", "aguardando_cliente"];

function rotuloDaVisao(v: Visao, t: (texto: string) => string): string {
  switch (v) {
    case "todas":
      return t("Em andamento");
    case "minhas":
      return t("Minhas");
    case "atrasadas":
      return t("Com item vencido");
    case "aguardando_cliente":
      return t("Esperando o cliente");
  }
}

/** Barra de progresso dos obrigatórios — o que decide a ativação. */
export function ProgressoDosObrigatorios({ resumo }: { resumo: ResumoDosItens }) {
  const t = useT();
  const pct = resumo.obrigatorios === 0 ? 100 : Math.round((resumo.obrigatorios_fechados / resumo.obrigatorios) * 100);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted" aria-hidden="true">
        <div className={`h-full ${resumo.pode_concluir ? "bg-success" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-text-muted">
        {`${resumo.obrigatorios_fechados}/${resumo.obrigatorios} ${t("obrigatórios")}`}
      </span>
    </div>
  );
}

export function Implantacoes() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [visao, setVisao] = useState<Visao>("todas");

  const lista = useQuery({
    queryKey: ["implantacoes", "lista", visao],
    queryFn: async () => (await apiClient.get<{ data: Linha[] }>(`/api/v1/implantacoes?visao=${visao}`)).data,
    retry: false,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="tablist">
        {VISOES.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={visao === v}
            onClick={() => setVisao(v)}
            className={`rounded-md border px-3 py-1 text-sm ${visao === v ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted"}`}
            data-testid={`implantacoes-visao-${v}`}
          >
            {rotuloDaVisao(v, t)}
          </button>
        ))}
      </div>

      {lista.error instanceof ApiError ? (
        <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
          {lista.error.message}
        </p>
      ) : !lista.data ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : lista.data.length === 0 ? (
        <p className="rounded-md border border-border p-3 text-sm text-text-muted" data-testid="implantacoes-vazio">
          {t("Nenhuma implantação aqui. Para começar uma, abra a empresa na Carteira de empresas e use Iniciar implantação.")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border" data-testid="implantacoes-lista">
          {lista.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link href={`/app/implantacoes/${l.id}`} className="font-medium hover:underline">
                  {l.empresa ?? t("Empresa sem nome")}
                </Link>
                <p className="text-xs text-text-muted">
                  {`${t("Iniciada em")} ${new Date(l.iniciada_em).toLocaleDateString(tagDoIdioma)}`}
                  {l.prevista_para
                    ? ` · ${t("previsão")} ${new Date(`${l.prevista_para}T12:00:00`).toLocaleDateString(tagDoIdioma)}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ProgressoDosObrigatorios resumo={l.resumo} />
                {l.resumo.vencidos > 0 ? (
                  <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                    {`${l.resumo.vencidos} ${t("vencido(s)")}`}
                  </span>
                ) : null}
                {l.resumo.aguardando_cliente > 0 ? (
                  <span className="rounded-md bg-warning/15 px-2 py-0.5 text-xs text-warning">
                    {`${l.resumo.aguardando_cliente} ${t("com o cliente")}`}
                  </span>
                ) : null}
                {l.resumo.pode_concluir ? (
                  <span className="rounded-md bg-success/15 px-2 py-0.5 text-xs text-success">{t("Pronta para concluir")}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
