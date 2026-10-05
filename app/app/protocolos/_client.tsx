"use client";
/**
 * A fila de protocolos — quatro visões e a abertura.
 *
 * Ordem das visões abertas: prioridade, depois o prazo de resolução mais próximo (o servidor
 * ordena). O relógio de cada linha é recalculado a cada minuto na tela; o prazo em si mora no
 * banco e só muda pelo serviço.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { Prioridade } from "@/lib/protocolos/prioridade";
import type { EstadoDoProtocolo } from "@/lib/protocolos/vocabulario";

import { classeDaPrioridade, relogioDoPrazo, rotuloDaPrioridade, rotuloDoEstado } from "./_rotulos";

type Visao = "minha" | "fila" | "vencendo" | "todos";

type Linha = {
  id: string;
  ano: number;
  numero: number;
  titulo: string;
  prioridade: Prioridade;
  area: string;
  estado: EstadoDoProtocolo;
  responsavel_user_id: string | null;
  resolucao_vence_em: string | null;
  pausado_desde: string | null;
};

export type Categoria = {
  id: string;
  parent_id: string | null;
  nome: string;
  area: string;
  exige_competencia: boolean;
  ativa: boolean;
};

export type Configuracao = {
  categorias: Categoria[];
  areas: Array<{ slug: string; rotulo: string }>;
};

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

const VISOES: readonly Visao[] = ["minha", "fila", "vencendo", "todos"];

function rotuloDaVisao(v: Visao, t: (texto: string) => string): string {
  switch (v) {
    case "minha":
      return t("Minha fila");
    case "fila":
      return t("Fila da área");
    case "vencendo":
      return t("Vencendo");
    case "todos":
      return t("Todos");
  }
}

export function numero(p: { ano: number; numero: number }): string {
  return `${p.ano}-${String(p.numero).padStart(6, "0")}`;
}

/** Re-renderiza a cada minuto, para o relógio dos prazos andar sem recarregar a lista. */
export function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return agora;
}

export function Protocolos({ podeAtender, podeConfigurar }: { podeAtender: boolean; podeConfigurar: boolean }) {
  const t = useT();
  const agora = useAgora();
  const qc = useQueryClient();
  const [visao, setVisao] = useState<Visao>(podeAtender ? "minha" : "todos");
  const [area, setArea] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  const config = useQuery({
    queryKey: ["protocolos", "config"],
    queryFn: async () => (await apiClient.get<{ data: Configuracao }>("/api/v1/protocolos/config")).data,
    retry: false,
  });

  const lista = useQuery({
    queryKey: ["protocolos", "lista", visao, area],
    queryFn: async () => {
      const qs = new URLSearchParams({ visao });
      if (area) qs.set("area", area);
      return (await apiClient.get<{ data: Linha[] }>(`/api/v1/protocolos?${qs}`)).data;
    },
    retry: false,
  });

  const assumir = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/protocolos/${id}/assumir`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["protocolos", "lista"] }),
    onError: showApiError,
  });

  if (lista.error instanceof ApiError && lista.error.code === "module_not_installed") {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {lista.error.message}
      </p>
    );
  }

  const rotuloDaArea = (slug: string) => config.data?.areas.find((a) => a.slug === slug)?.rotulo ?? slug;
  const semCategorias = config.data !== undefined && config.data.categorias.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {semCategorias ? (
        <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
          {podeConfigurar ? (
            <>
              {t("Ainda não há categorias de protocolo.")}{" "}
              <Link href="/app/settings/tenant/protocolos" className="underline">
                {t("Configurar protocolos")}
              </Link>
            </>
          ) : (
            t("Ainda não há categorias de protocolo. Peça ao administrador para configurar.")
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {VISOES.map((v) => (
            <Button
              key={v}
              size="sm"
              variant={visao === v ? "primary" : "outline"}
              role="tab"
              aria-selected={visao === v}
              data-testid={`protocolos-visao-${v}`}
              onClick={() => setVisao(v)}
            >
              {rotuloDaVisao(v, t)}
            </Button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Área")}
          <select value={area} onChange={(e) => setArea(e.target.value)} className={CAMPO} data-testid="protocolos-area">
            <option value="">{t("Todas")}</option>
            {(config.data?.areas ?? []).map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </label>
        {podeAtender && !semCategorias ? (
          <Button className="ml-auto" onClick={() => setAbrindo((v) => !v)} data-testid="protocolos-novo">
            {abrindo ? t("Fechar") : t("Novo protocolo")}
          </Button>
        ) : null}
      </div>

      {abrindo && config.data ? <FormularioDeAbertura config={config.data} onAberto={() => setAbrindo(false)} /> : null}

      <section className="rounded-md border border-border p-3">
        {lista.isError ? (
          <p className="text-sm text-danger">{t("Não foi possível carregar os protocolos.")}</p>
        ) : (lista.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">{lista.isLoading ? t("Carregando…") : t("Nenhum protocolo nesta visão.")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(lista.data ?? []).map((p) => {
                const relogio = relogioDoPrazo(p.resolucao_vence_em, p.pausado_desde, agora, t);
                return (
                  <tr key={p.id} className="border-b border-border/60" data-testid={`protocolo-${p.id}`}>
                    <td className="py-2 pr-2 text-xs tabular-nums text-text-muted">{numero(p)}</td>
                    <td className="py-2">
                      <Link href={`/app/protocolos/${p.id}`} className="font-medium hover:underline">
                        {p.titulo}
                      </Link>
                      <div className="text-xs text-text-muted">
                        {rotuloDaArea(p.area)} · {rotuloDoEstado(p.estado, t)}
                      </div>
                    </td>
                    <td className="py-2">
                      <span className={`rounded-md px-2 py-0.5 text-xs ${classeDaPrioridade(p.prioridade)}`}>
                        {rotuloDaPrioridade(p.prioridade, t)}
                      </span>
                    </td>
                    <td className={`py-2 text-right text-xs ${relogio?.classe ?? ""}`}>{relogio?.texto ?? ""}</td>
                    <td className="py-2 text-right">
                      {podeAtender && visao === "fila" && p.responsavel_user_id === null ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={assumir.isPending}
                          data-testid={`protocolo-assumir-${p.id}`}
                          onClick={() => assumir.mutate(p.id)}
                        >
                          {t("Assumir")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FormularioDeAbertura({ config, onAberto }: { config: Configuracao; onAberto: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const raizes = config.categorias.filter((c) => c.parent_id === null && c.ativa);
  const [categoriaId, setCategoriaId] = useState(raizes[0]?.id ?? "");
  const [subcategoriaId, setSubcategoriaId] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");

  const subs = config.categorias.filter((c) => c.parent_id === categoriaId && c.ativa);
  const categoria = raizes.find((c) => c.id === categoriaId);
  const sub = subs.find((c) => c.id === subcategoriaId);
  const pedeCompetencia = Boolean(categoria?.exige_competencia || sub?.exige_competencia);

  const abrir = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: { numero: string; deduplicado: boolean } }>("/api/v1/protocolos", {
        categoria_id: categoriaId,
        subcategoria_id: subcategoriaId || null,
        competencia: competencia || null,
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        prazo_cliente: prazo || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["protocolos", "lista"] });
      onAberto();
    },
    onError: showApiError,
  });

  const pode =
    categoriaId !== "" && titulo.trim() !== "" && descricao.trim() !== "" && (!pedeCompetencia || competencia !== "");

  return (
    <form
      className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode && !abrir.isPending) abrir.mutate();
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Categoria")}
        <select
          value={categoriaId}
          onChange={(e) => {
            setCategoriaId(e.target.value);
            setSubcategoriaId("");
          }}
          className={CAMPO}
          data-testid="novo-protocolo-categoria"
        >
          {raizes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Subcategoria")}
        <select
          value={subcategoriaId}
          onChange={(e) => setSubcategoriaId(e.target.value)}
          className={CAMPO}
          disabled={subs.length === 0}
          data-testid="novo-protocolo-subcategoria"
        >
          <option value="">{t("Nenhuma")}</option>
          {subs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
        {t("Título")}
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={CAMPO} data-testid="novo-protocolo-titulo" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
        {t("O que o cliente pediu")}
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          rows={3}
          className={CAMPO}
          data-testid="novo-protocolo-descricao"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {pedeCompetencia ? t("Competência (obrigatória)") : t("Competência")}
        <input
          type="month"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
          className={CAMPO}
          data-testid="novo-protocolo-competencia"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Prazo informado pelo cliente")}
        <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={CAMPO} data-testid="novo-protocolo-prazo" />
      </label>
      <div className="md:col-span-2">
        <Button type="submit" disabled={!pode || abrir.isPending} data-testid="novo-protocolo-abrir">
          {t("Abrir protocolo")}
        </Button>
      </div>
    </form>
  );
}
