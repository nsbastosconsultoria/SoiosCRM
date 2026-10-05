"use client";
/**
 * Ficha do protocolo.
 *
 * Os botões de estado são só os da tabela de transições (`lib/protocolos/vocabulario.ts`,
 * conferida contra o gatilho por teste) — o banco recusa o resto de qualquer jeito, e oferecer um
 * botão que falha é pior que não oferecer. Baixar a prioridade só aparece para gestor (Q2).
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
import { PRIORIDADES, baixaPrioridade, type Prioridade } from "@/lib/protocolos/prioridade";
import { TRANSICOES_DO_PROTOCOLO, type EstadoDoProtocolo } from "@/lib/protocolos/vocabulario";

import { numero, useAgora, type Configuracao } from "../_client";
import { classeDaPrioridade, relogioDoPrazo, rotuloDaPrioridade, rotuloDoEstado, rotuloDoEvento } from "../_rotulos";

type Protocolo = {
  id: string;
  ano: number;
  numero: number;
  titulo: string;
  descricao: string;
  resumo: { solicitacao?: string; acao_esperada?: string | null; informacoes_coletadas?: string[] } | null;
  categoria_id: string;
  subcategoria_id: string | null;
  competencia: string | null;
  prioridade: Prioridade;
  prioridade_origem: string;
  prioridade_motivo: string | null;
  urgencia_declarada: string | null;
  prazo_cliente: string | null;
  area: string;
  responsavel_user_id: string | null;
  estado: EstadoDoProtocolo;
  origem: string;
  primeira_resposta_vence_em: string | null;
  primeira_resposta_em: string | null;
  resolucao_vence_em: string | null;
  pausado_desde: string | null;
  conversation_id: string | null;
  company_id: string | null;
};

type Evento = { id: string; tipo: string; texto: string | null; ator_kind: string; created_at: string; novo: unknown };
type Membro = { user_id: string; full_name: string | null };

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

export function FichaDoProtocolo({
  protocoloId,
  podeAtender,
  ehGestor,
}: {
  protocoloId: string;
  podeAtender: boolean;
  ehGestor: boolean;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const agora = useAgora();
  const qc = useQueryClient();
  const chave = ["protocolos", "ficha", protocoloId];

  const ficha = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (await apiClient.get<{ data: { protocolo: Protocolo; numero: string; eventos: Evento[] } }>(`/api/v1/protocolos/${protocoloId}`)).data,
    retry: false,
  });
  const config = useQuery({
    queryKey: ["protocolos", "config"],
    queryFn: async () => (await apiClient.get<{ data: Configuracao }>("/api/v1/protocolos/config")).data,
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
    void qc.invalidateQueries({ queryKey: ["protocolos", "lista"] });
  };
  const estado = useMutation({
    mutationFn: (para: EstadoDoProtocolo) => apiClient.post(`/api/v1/protocolos/${protocoloId}/estado`, { estado: para }),
    onSuccess: recarregar,
    onError: showApiError,
  });
  const assumir = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/protocolos/${protocoloId}/assumir`, {}),
    onSuccess: recarregar,
    onError: showApiError,
  });
  const atribuir = useMutation({
    mutationFn: (userId: string | null) => apiClient.post(`/api/v1/protocolos/${protocoloId}/atribuir`, { user_id: userId }),
    onSuccess: recarregar,
    onError: showApiError,
  });

  if (ficha.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {ficha.error.message}
      </p>
    );
  }
  if (!ficha.data) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;

  const p = ficha.data.protocolo;
  const nomeDa = (id: string | null) => config.data?.categorias.find((c) => c.id === id)?.nome ?? "";
  const rotuloDaArea = config.data?.areas.find((a) => a.slug === p.area)?.rotulo ?? p.area;
  const nomeDe = (userId: string) => equipe.data?.find((m) => m.user_id === userId)?.full_name ?? t("Membro da equipe");
  const relogio = relogioDoPrazo(p.resolucao_vence_em, p.pausado_desde, agora, t);
  const primeira = p.primeira_resposta_em ? null : relogioDoPrazo(p.primeira_resposta_vence_em, null, agora, t);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Link href="/app/protocolos" className="text-xs text-text-muted hover:underline">
          {t("← Protocolos")}
        </Link>
        <h1 className="text-xl font-semibold">
          <span className="mr-2 tabular-nums text-text-muted">{numero(p)}</span>
          {p.titulo}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-md px-2 py-0.5 text-xs ${classeDaPrioridade(p.prioridade)}`} data-testid="protocolo-prioridade">
            {rotuloDaPrioridade(p.prioridade, t)}
          </span>
          <span data-testid="protocolo-estado">{rotuloDoEstado(p.estado, t)}</span>
          <span className="text-text-muted">
            · {[nomeDa(p.categoria_id), nomeDa(p.subcategoria_id)].filter(Boolean).join(" › ")} · {rotuloDaArea}
            {p.competencia ? ` · ${p.competencia}` : ""}
          </span>
        </div>
      </div>

      <section className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-3">
        <div>
          <div className="text-xs text-text-muted">{t("Responsável")}</div>
          <div className="text-sm">{p.responsavel_user_id ? nomeDe(p.responsavel_user_id) : t("Na fila da área")}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">{t("Primeira resposta")}</div>
          <div className={`text-sm ${primeira?.classe ?? ""}`}>
            {p.primeira_resposta_em ? new Date(p.primeira_resposta_em).toLocaleString(tagDoIdioma) : (primeira?.texto ?? t("Sem prazo definido"))}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">{t("Resolução")}</div>
          <div className={`text-sm ${relogio?.classe ?? ""}`}>{relogio?.texto ?? t("Sem prazo definido")}</div>
        </div>
      </section>

      {podeAtender ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap gap-2">
            {p.responsavel_user_id === null && TRANSICOES_DO_PROTOCOLO[p.estado].length > 0 ? (
              <Button size="sm" onClick={() => assumir.mutate()} disabled={assumir.isPending} data-testid="protocolo-assumir">
                {t("Assumir")}
              </Button>
            ) : null}
            {TRANSICOES_DO_PROTOCOLO[p.estado].map((para) => (
              <Button
                key={para}
                size="sm"
                variant="outline"
                disabled={estado.isPending}
                data-testid={`protocolo-transicao-${para}`}
                onClick={() => estado.mutate(para)}
              >
                {`${t("Mover para")} ${rotuloDoEstado(para, t)}`}
              </Button>
            ))}
          </div>
          {ehGestor ? (
            <label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              {t("Atribuir a")}
              <select
                value={p.responsavel_user_id ?? ""}
                onChange={(e) => atribuir.mutate(e.target.value || null)}
                className={CAMPO}
                data-testid="protocolo-atribuir"
              >
                <option value="">{t("Ninguém — devolver à fila")}</option>
                {(equipe.data ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name ?? t("Membro da equipe")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <SeletorDePrioridade
            protocoloId={protocoloId}
            atual={p.prioridade}
            ehGestor={ehGestor}
            onFeito={recarregar}
          />
        </section>
      ) : null}

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("O pedido")}</h2>
        <p className="whitespace-pre-wrap text-sm">{p.descricao}</p>
        {p.resumo?.acao_esperada ? (
          <p className="mt-2 text-sm">
            <span className="text-text-muted">{t("Ação esperada:")}</span> {p.resumo.acao_esperada}
          </p>
        ) : null}
        {p.urgencia_declarada ? (
          <p className="mt-1 text-sm">
            <span className="text-text-muted">{t("O cliente disse sobre urgência:")}</span> {p.urgencia_declarada}
          </p>
        ) : null}
        {p.prazo_cliente ? (
          <p className="mt-1 text-sm">
            <span className="text-text-muted">{t("Prazo informado pelo cliente:")}</span>{" "}
            {new Date(`${p.prazo_cliente}T12:00:00`).toLocaleDateString(tagDoIdioma)}
          </p>
        ) : null}
        {p.conversation_id ? (
          <Link href={`/app/inbox/${p.conversation_id}`} className="mt-2 inline-block text-sm underline">
            {t("Abrir a conversa")}
          </Link>
        ) : null}
      </section>

      {podeAtender && p.conversation_id ? (
        <FalarComCliente protocoloId={protocoloId} estado={p.estado} onFeito={recarregar} />
      ) : null}

      <LinhaDoTempo protocoloId={protocoloId} eventos={ficha.data.eventos} podeAtender={podeAtender} onNota={recarregar} />
    </div>
  );
}

/**
 * A equipe fala com o cliente pela ficha, e a IA leva a mensagem (spec 22 §6): pedir uma
 * informação ou avisar que resolveu. Só as ações que a tabela de transições aceita a partir do
 * estado atual aparecem — o servidor recusa o resto de qualquer jeito.
 */
function FalarComCliente({
  protocoloId,
  estado,
  onFeito,
}: {
  protocoloId: string;
  estado: EstadoDoProtocolo;
  onFeito: () => void;
}) {
  const t = useT();
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const podePedir = TRANSICOES_DO_PROTOCOLO[estado].includes("aguardando_cliente");
  const podeAvisar = TRANSICOES_DO_PROTOCOLO[estado].includes("resolvido");
  const falar = useMutation({
    mutationFn: (acao: "pedir_informacao" | "avisar_resolvido") =>
      apiClient.post<{ data: { estado_atualizado: boolean } }>(`/api/v1/protocolos/${protocoloId}/cliente`, {
        acao,
        texto: texto.trim(),
      }),
    onSuccess: (r) => {
      setTexto("");
      setAviso(
        r.data.estado_atualizado
          ? t("Pronto: a IA vai levar a mensagem ao cliente pela conversa.")
          : t("A IA vai levar a mensagem, mas o estado do protocolo não mudou. Atualize o estado à mão."),
      );
      onFeito();
    },
    onError: showApiError,
  });
  if (!podePedir && !podeAvisar) return null;

  const pronto = texto.trim().length >= 3 && !falar.isPending;
  return (
    <section className="rounded-md border border-border p-3" data-testid="protocolo-falar-com-cliente">
      <h2 className="mb-1 text-sm font-semibold">{t("Falar com o cliente")}</h2>
      <p className="mb-2 text-xs text-text-muted">
        {t("A IA leva a sua mensagem ao cliente pela conversa. Quando ele responder, a resposta entra aqui.")}
      </p>
      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAviso(null);
        }}
        rows={3}
        maxLength={2000}
        placeholder={t("O que a IA deve dizer ao cliente")}
        className={`w-full ${CAMPO}`}
        data-testid="protocolo-mensagem-ao-cliente"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {podePedir ? (
          <Button size="sm" variant="outline" disabled={!pronto} onClick={() => falar.mutate("pedir_informacao")}>
            {t("Pedir informação ao cliente")}
          </Button>
        ) : null}
        {podeAvisar ? (
          <Button size="sm" disabled={!pronto} onClick={() => falar.mutate("avisar_resolvido")}>
            {t("Avisar que resolveu")}
          </Button>
        ) : null}
      </div>
      {aviso ? (
        <p className="mt-2 text-xs text-text-muted" role="status">
          {aviso}
        </p>
      ) : null}
    </section>
  );
}

function SeletorDePrioridade({
  protocoloId,
  atual,
  ehGestor,
  onFeito,
}: {
  protocoloId: string;
  atual: Prioridade;
  ehGestor: boolean;
  onFeito: () => void;
}) {
  const t = useT();
  const [nova, setNova] = useState<Prioridade>(atual);
  const [motivo, setMotivo] = useState("");
  const mudar = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/protocolos/${protocoloId}`, { prioridade: nova, prioridade_motivo: motivo.trim() }),
    onSuccess: () => {
      setMotivo("");
      onFeito();
    },
    onError: showApiError,
  });
  // Atendente só oferece SUBIR: baixar é de gestor, e o servidor recusaria.
  const opcoes = PRIORIDADES.filter((p) => ehGestor || !baixaPrioridade(atual, p));

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Prioridade")}
        <select value={nova} onChange={(e) => setNova(e.target.value as Prioridade)} className={CAMPO} data-testid="protocolo-nova-prioridade">
          {opcoes.map((p) => (
            <option key={p} value={p}>
              {rotuloDaPrioridade(p, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Motivo")}
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`w-64 ${CAMPO}`} data-testid="protocolo-motivo-prioridade" />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={nova === atual || motivo.trim() === "" || mudar.isPending}
        onClick={() => mudar.mutate()}
        data-testid="protocolo-mudar-prioridade"
      >
        {t("Mudar prioridade")}
      </Button>
    </div>
  );
}

function LinhaDoTempo({
  protocoloId,
  eventos,
  podeAtender,
  onNota,
}: {
  protocoloId: string;
  eventos: Evento[];
  podeAtender: boolean;
  onNota: () => void;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [texto, setTexto] = useState("");
  const nota = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/protocolos/${protocoloId}/notas`, { texto: texto.trim() }),
    onSuccess: () => {
      setTexto("");
      onNota();
    },
    onError: showApiError,
  });

  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("Linha do tempo")}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {eventos.map((ev) => (
          <li key={ev.id} className="border-b border-border/60 py-1">
            <div className="flex justify-between gap-2">
              <span>
                {rotuloDoEvento(ev.tipo, t)}
                {ev.ator_kind === "ia" ? <span className="text-text-muted">{` · ${t("pelo assistente")}`}</span> : null}
              </span>
              <span className="text-xs text-text-muted">{new Date(ev.created_at).toLocaleString(tagDoIdioma)}</span>
            </div>
            {ev.texto ? <p className="whitespace-pre-wrap text-text-muted">{ev.texto}</p> : null}
          </li>
        ))}
      </ul>
      {podeAtender ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim() && !nota.isPending) nota.mutate();
          }}
        >
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            placeholder={t("Nota interna (o cliente não vê)")}
            className={CAMPO}
            data-testid="protocolo-nota"
          />
          <div>
            <Button size="sm" type="submit" disabled={!texto.trim() || nota.isPending}>
              {t("Registrar nota")}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
