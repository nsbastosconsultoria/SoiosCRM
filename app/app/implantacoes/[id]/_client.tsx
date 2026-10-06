"use client";
/**
 * Ficha da implantação.
 *
 * As mudanças de estado oferecidas são só as da tabela de transições (`lib/implantacao/vocabulario.ts`,
 * conferida contra o gatilho por teste); dispensar e tirar da dispensa só aparecem para gestor. A
 * tela pede a evidência antes de concluir um item que a exige, e o motivo antes de dispensar — o
 * banco recusaria de qualquer jeito, e oferecer um botão que falha é pior que não oferecer.
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
import {
  ESTADOS_QUE_FECHAM,
  TRANSICOES_DO_ITEM,
  type EstadoDaImplantacao,
  type EstadoDoItem,
  type VezDe,
} from "@/lib/implantacao/vocabulario";

import { ProgressoDosObrigatorios, type ResumoDosItens } from "../_client";
import {
  classeDoEstadoDoItem,
  rotuloDaVez,
  rotuloDoEstadoDaImplantacao,
  rotuloDoEstadoDoItem,
  rotuloDoEvento,
} from "../_rotulos";

type Item = {
  id: string;
  grupo: string;
  titulo: string;
  orientacao: string | null;
  obrigatorio: boolean;
  vez_de: VezDe;
  exige_evidencia: boolean;
  prazo: string | null;
  estado: EstadoDoItem;
  responsavel_user_id: string | null;
  observacao: string | null;
  evidencia: string | null;
  motivo_dispensa: string | null;
  revision: number;
};

type Evento = { id: string; item_id: string | null; tipo: string; novo: unknown; ator_kind: string; created_at: string };

type Ficha = {
  implantacao: {
    id: string;
    company_id: string;
    estado: EstadoDaImplantacao;
    iniciada_em: string;
    prevista_para: string | null;
    motivo_cancelamento: string | null;
  };
  empresa: { id: string; legal_name: string | null; trade_name: string | null; cnpj: string | null } | null;
  carteira: { estado: string; cliente_desde: string | null } | null;
  modelo: { id: string; nome: string } | null;
  itens: Item[];
  eventos: Evento[];
  resumo: ResumoDosItens;
  hoje: string;
};

type Membro = { user_id: string; full_name: string | null };

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

export function FichaDaImplantacao({
  implantacaoId,
  podeAtender,
  ehGestor,
}: {
  implantacaoId: string;
  podeAtender: boolean;
  ehGestor: boolean;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  const chave = ["implantacoes", "ficha", implantacaoId];

  const ficha = useQuery({
    queryKey: chave,
    queryFn: async () => (await apiClient.get<{ data: Ficha }>(`/api/v1/implantacoes/${implantacaoId}`)).data,
    retry: false,
  });
  const equipe = useQuery({
    queryKey: ["team", "assignable"],
    queryFn: async () => (await apiClient.get<{ data: Membro[] }>("/api/v1/team/assignable")).data,
    retry: false,
    enabled: podeAtender,
  });
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: chave });
    void qc.invalidateQueries({ queryKey: ["implantacoes", "lista"] });
  };

  if (ficha.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {ficha.error.message}
      </p>
    );
  }
  if (!ficha.data) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;

  const f = ficha.data;
  const aberta = f.implantacao.estado === "em_andamento";
  const nome = f.empresa?.trade_name || f.empresa?.legal_name || t("Empresa sem nome");
  const grupos = [...new Set(f.itens.map((i) => i.grupo))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Link href="/app/implantacoes" className="text-xs text-text-muted hover:underline">
          {t("← Implantação de clientes")}
        </Link>
        <h1 className="text-xl font-semibold">{nome}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-text-muted">
          <span className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-text" data-testid="implantacao-estado">
            {rotuloDoEstadoDaImplantacao(f.implantacao.estado, t)}
          </span>
          <span>{`${t("Iniciada em")} ${new Date(f.implantacao.iniciada_em).toLocaleDateString(tagDoIdioma)}`}</span>
          {f.implantacao.prevista_para ? (
            <span>{`${t("previsão")} ${new Date(`${f.implantacao.prevista_para}T12:00:00`).toLocaleDateString(tagDoIdioma)}`}</span>
          ) : null}
          {f.modelo ? <span>{`${t("Modelo")}: ${f.modelo.nome}`}</span> : null}
          <Link href={`/app/carteira/${f.implantacao.company_id}`} className="underline">
            {t("Ver na carteira")}
          </Link>
        </div>
        {f.implantacao.motivo_cancelamento ? (
          <p className="mt-1 text-sm text-text-muted">{`${t("Motivo do cancelamento")}: ${f.implantacao.motivo_cancelamento}`}</p>
        ) : null}
      </div>

      <Conclusao
        implantacaoId={implantacaoId}
        resumo={f.resumo}
        itens={f.itens}
        aberta={aberta}
        ehGestor={ehGestor}
        onFeito={recarregar}
      />

      {grupos.map((grupo) => (
        <section key={grupo} className="rounded-md border border-border p-3">
          <h2 className="mb-2 text-sm font-semibold">{grupo}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {f.itens
              .filter((i) => i.grupo === grupo)
              .map((item) => (
                <LinhaDoItem
                  key={item.id}
                  implantacaoId={implantacaoId}
                  item={item}
                  hoje={f.hoje}
                  podeAtender={podeAtender && aberta}
                  ehGestor={ehGestor}
                  equipe={equipe.data ?? []}
                  onFeito={recarregar}
                />
              ))}
          </ul>
        </section>
      ))}

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("Linha do tempo")}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {f.eventos.map((ev) => {
            const item = ev.item_id ? f.itens.find((i) => i.id === ev.item_id) : undefined;
            const novoEstado = (ev.novo as { estado?: EstadoDoItem } | null)?.estado;
            return (
              <li key={ev.id} className="flex justify-between gap-2 border-b border-border/60 py-1">
                <span className="min-w-0">
                  {rotuloDoEvento(ev.tipo, t)}
                  {item ? <span className="text-text-muted">{` — ${item.titulo}`}</span> : null}
                  {ev.tipo === "item_estado_alterado" && novoEstado ? (
                    <span className="text-text-muted">{`: ${rotuloDoEstadoDoItem(novoEstado, t)}`}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-text-muted">{new Date(ev.created_at).toLocaleString(tagDoIdioma)}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Concluir (ativa o cliente) e cancelar. Concluir só liberado com os obrigatórios fechados. */
function Conclusao({
  implantacaoId,
  resumo,
  itens,
  aberta,
  ehGestor,
  onFeito,
}: {
  implantacaoId: string;
  resumo: ResumoDosItens;
  itens: Item[];
  aberta: boolean;
  ehGestor: boolean;
  onFeito: () => void;
}) {
  const t = useT();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [inativar, setInativar] = useState(false);
  const faltam = itens.filter((i) => i.obrigatorio && !ESTADOS_QUE_FECHAM.includes(i.estado));

  const concluir = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/implantacoes/${implantacaoId}/concluir`, {}),
    onSuccess: onFeito,
    onError: showApiError,
  });
  const cancelar = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/implantacoes/${implantacaoId}/cancelar`, { motivo: motivo.trim(), inativar }),
    onSuccess: () => {
      setCancelando(false);
      onFeito();
    },
    onError: showApiError,
  });

  return (
    <section className="rounded-md border border-border p-3" data-testid="implantacao-conclusao">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProgressoDosObrigatorios resumo={resumo} />
        {aberta && ehGestor ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!resumo.pode_concluir || concluir.isPending}
              onClick={() => concluir.mutate()}
              data-testid="implantacao-concluir"
            >
              {t("Concluir implantação e ativar o cliente")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCancelando((v) => !v)} data-testid="implantacao-cancelar">
              {t("Cancelar implantação")}
            </Button>
          </div>
        ) : null}
      </div>
      {aberta && faltam.length > 0 ? (
        <p className="mt-2 text-sm text-text-muted">
          {`${t("Para concluir, falta fechar")}: ${faltam.map((i) => i.titulo).join(", ")}.`}
        </p>
      ) : null}
      {aberta && resumo.pode_concluir ? (
        <p className="mt-2 text-sm text-success">{t("Todos os itens obrigatórios estão fechados. A implantação pode ser concluída.")}</p>
      ) : null}
      {cancelando ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (motivo.trim() && !cancelar.isPending) cancelar.mutate();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Motivo do cancelamento")}
            <input id="implantacao-motivo-cancelamento" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input id="implantacao-inativar" type="checkbox" checked={inativar} onChange={(e) => setInativar(e.target.checked)} />
            {t("Marcar a empresa como inativa na carteira")}
          </label>
          <div>
            <Button size="sm" variant="destructive" type="submit" disabled={!motivo.trim() || cancelar.isPending}>
              {t("Confirmar cancelamento")}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function LinhaDoItem({
  implantacaoId,
  item,
  hoje,
  podeAtender,
  ehGestor,
  equipe,
  onFeito,
}: {
  implantacaoId: string;
  item: Item;
  hoje: string;
  podeAtender: boolean;
  ehGestor: boolean;
  equipe: Membro[];
  onFeito: () => void;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<EstadoDoItem | null>(null);
  const [motivo, setMotivo] = useState("");
  const [evidencia, setEvidencia] = useState(item.evidencia ?? "");
  const [observacao, setObservacao] = useState(item.observacao ?? "");

  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      apiClient.patch(`/api/v1/implantacoes/${implantacaoId}/itens/${item.id}`, { revision: item.revision, ...corpo }),
    onSuccess: () => {
      setDestino(null);
      setMotivo("");
      onFeito();
    },
    onError: showApiError,
  });

  const vencido = item.prazo !== null && item.prazo < hoje && !ESTADOS_QUE_FECHAM.includes(item.estado);
  const opcoes = TRANSICOES_DO_ITEM[item.estado].filter(
    (e) => ehGestor || (e !== "dispensado" && item.estado !== "dispensado"),
  );
  const nomeDe = (id: string | null) => (id ? (equipe.find((m) => m.user_id === id)?.full_name ?? t("Membro da equipe")) : t("Ninguém"));

  function mudar(para: EstadoDoItem) {
    // Concluir com evidência exigida e vazia, ou dispensar: pede o texto antes de enviar.
    if (para === "dispensado" || (para === "concluido" && item.exige_evidencia && !evidencia.trim())) {
      setDestino(para);
      setAberto(true);
      return;
    }
    salvar.mutate({ estado: para, ...(para === "concluido" && evidencia.trim() ? { evidencia: evidencia.trim() } : {}) });
  }

  return (
    <li className="py-2" data-testid={`implantacao-item-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {item.titulo}
            {item.obrigatorio ? <span className="ml-2 text-xs text-text-muted">{t("obrigatório")}</span> : null}
          </p>
          <p className="text-xs text-text-muted">
            {`${t("Vez de")}: ${rotuloDaVez(item.vez_de, t)} · ${t("Responsável")}: ${nomeDe(item.responsavel_user_id)}`}
            {item.prazo ? (
              <span className={vencido ? "text-destructive" : undefined}>
                {` · ${t("prazo")} ${new Date(`${item.prazo}T12:00:00`).toLocaleDateString(tagDoIdioma)}`}
                {vencido ? ` (${t("vencido")})` : ""}
              </span>
            ) : null}
          </p>
          {item.motivo_dispensa ? <p className="text-xs text-text-muted">{`${t("Dispensado")}: ${item.motivo_dispensa}`}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-xs ${classeDoEstadoDoItem(item.estado)}`}>{rotuloDoEstadoDoItem(item.estado, t)}</span>
          {podeAtender ? (
            <select
              id={`item-estado-${item.id}`}
              aria-label={t("Mudar o estado do item")}
              className={CAMPO}
              value=""
              disabled={salvar.isPending}
              onChange={(e) => e.target.value && mudar(e.target.value as EstadoDoItem)}
            >
              <option value="">{t("Mudar para…")}</option>
              {opcoes.map((e) => (
                <option key={e} value={e}>
                  {rotuloDoEstadoDoItem(e, t)}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="text-xs text-text-muted underline" onClick={() => setAberto((v) => !v)}>
            {aberto ? t("Fechar") : t("Detalhes")}
          </button>
        </div>
      </div>

      {aberto ? (
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-surface-muted p-2">
          {item.orientacao ? <p className="text-xs text-text-muted">{item.orientacao}</p> : null}
          {podeAtender ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                {t("Responsável")}
                <select
                  id={`item-responsavel-${item.id}`}
                  className={CAMPO}
                  value={item.responsavel_user_id ?? ""}
                  onChange={(e) => salvar.mutate({ responsavel_user_id: e.target.value || null })}
                >
                  <option value="">{t("Ninguém")}</option>
                  {equipe.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name ?? t("Membro da equipe")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                {item.exige_evidencia ? t("Evidência (obrigatória para concluir)") : t("Evidência")}
                <textarea
                  id={`item-evidencia-${item.id}`}
                  rows={2}
                  maxLength={2000}
                  value={evidencia}
                  onChange={(e) => setEvidencia(e.target.value)}
                  placeholder={t("Como foi feito: data, meio, número do protocolo…")}
                  className={CAMPO}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                {t("Observação")}
                <textarea
                  id={`item-observacao-${item.id}`}
                  rows={2}
                  maxLength={2000}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder={t("Sobre a operação da empresa. Não registre dados pessoais aqui.")}
                  className={CAMPO}
                />
              </label>
              {destino === "dispensado" ? (
                <label className="flex flex-col gap-1 text-xs text-text-muted">
                  {t("Motivo da dispensa")}
                  <input id={`item-motivo-${item.id}`} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {destino ? (
                  <Button
                    size="sm"
                    disabled={salvar.isPending || (destino === "dispensado" ? !motivo.trim() : !evidencia.trim())}
                    onClick={() =>
                      salvar.mutate(
                        destino === "dispensado"
                          ? { estado: "dispensado", motivo_dispensa: motivo.trim() }
                          : { estado: "concluido", evidencia: evidencia.trim() },
                      )
                    }
                  >
                    {destino === "dispensado" ? t("Dispensar o item") : t("Concluir o item")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate({ evidencia: evidencia.trim() || null, observacao: observacao.trim() || null })}
                >
                  {t("Salvar anotações")}
                </Button>
              </div>
            </>
          ) : (
            <>
              {item.evidencia ? <p className="text-xs">{`${t("Evidência")}: ${item.evidencia}`}</p> : null}
              {item.observacao ? <p className="text-xs">{`${t("Observação")}: ${item.observacao}`}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}
