"use client";
/**
 * Ficha da empresa na carteira — três blocos e a linha do tempo.
 *
 *   - Relacionamento: o estado, com SÓ os botões que a função de transição aceita (a tabela de
 *     `lib/carteira/vocabulario.ts`, conferida contra a migration por teste);
 *   - Pessoas: o vínculo do NÚCLEO (company_people), com o papel e as áreas do módulo;
 *   - Responsáveis: quem cuida da empresa em cada área.
 *
 * O servidor recusa o que o papel não permite; os controles só somem para não oferecer o que
 * vai falhar.
 */
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { ApiError } from "@/lib/api/types";
import {
  PAPEIS_DO_VINCULO,
  TRANSICOES_DA_CARTEIRA,
  type EstadoDaCarteira,
  type PapelDoVinculo,
} from "@/lib/carteira/vocabulario";

import { classeDoEstado, rotuloDoEstado, rotuloDoEvento, rotuloDoPapel } from "../_rotulos";

type Vinculo = {
  id: string;
  person_id: string;
  job_title: string | null;
  people: { id: string; full_name: string } | null;
};
type Contato = { id: string; person_id: string; phone_number: string | null; display_name: string | null; name: string | null };
type Detalhe = { company_people_id: string; papel: PapelDoVinculo; areas: string[]; ativo: boolean };
type Responsavel = { id: string; area: string; user_id: string };
type Evento = { id: string; tipo: string; anterior: unknown; novo: unknown; ator_kind: string; created_at: string };

type Ficha = {
  empresa: { id: string; legal_name: string | null; trade_name: string | null; cnpj: string | null };
  perfil: { estado: EstadoDaCarteira; cliente_desde: string | null };
  vinculos: Vinculo[];
  contatos: Contato[];
  detalhes: Detalhe[];
  responsaveis: Responsavel[];
  eventos: Evento[];
  areas: Array<{ slug: string; rotulo: string }>;
};

type Membro = { user_id: string; full_name: string | null };

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

export function FichaDaEmpresa({
  companyId,
  podeGerenciar,
  podeEditarVinculo,
  ehAdmin = false,
  comImplantacao = false,
}: {
  companyId: string;
  podeGerenciar: boolean;
  podeEditarVinculo: boolean;
  ehAdmin?: boolean;
  /** Módulo implantacao instalado (spec 23): o cartão da implantação e o botão de iniciar. */
  comImplantacao?: boolean;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const chave = ["carteira", "empresa", companyId];

  const ficha = useQuery({
    queryKey: chave,
    queryFn: async () => (await apiClient.get<{ data: Ficha }>(`/api/v1/carteira/empresas/${companyId}`)).data,
    retry: false,
  });

  if (ficha.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {ficha.error.message}
      </p>
    );
  }
  if (!ficha.data) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;

  const f = ficha.data;
  const nome = f.empresa.trade_name || f.empresa.legal_name || t("Empresa sem nome");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Link href="/app/carteira" className="text-xs text-text-muted hover:underline">
          {t("← Carteira de empresas")}
        </Link>
        <h1 className="text-xl font-semibold">{nome}</h1>
        <p className="text-sm text-text-muted">{f.empresa.cnpj ?? t("Sem CNPJ")}</p>
      </div>

      <Relacionamento
        companyId={companyId}
        estado={f.perfil.estado}
        clienteDesde={f.perfil.cliente_desde}
        podeGerenciar={podeGerenciar}
        ehAdmin={ehAdmin}
        chave={chave}
      />
      {comImplantacao ? (
        <CartaoDaImplantacao companyId={companyId} estado={f.perfil.estado} podeGerenciar={podeGerenciar} chave={chave} />
      ) : null}
      <Pessoas
        companyId={companyId}
        ficha={f}
        podeGerenciar={podeGerenciar}
        podeEditarVinculo={podeEditarVinculo}
        chave={chave}
      />
      <Responsaveis companyId={companyId} ficha={f} podeGerenciar={podeGerenciar} chave={chave} />

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("Linha do tempo")}</h2>
        {f.eventos.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nada registrado ainda.")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {f.eventos.map((ev) => (
              <li key={ev.id} className="flex justify-between gap-2 border-b border-border/60 py-1">
                <span>
                  {rotuloDoEvento(ev.tipo, t)}
                  {ev.tipo === "estado_alterado" ? (
                    <span className="text-text-muted">
                      {" — "}
                      {rotuloDoEstado(((ev.novo ?? {}) as { estado: EstadoDaCarteira }).estado, t)}
                    </span>
                  ) : null}
                  {ev.ator_kind === "ia" ? <span className="text-text-muted">{` · ${t("pelo assistente")}`}</span> : null}
                </span>
                <span className="text-xs text-text-muted">{new Date(ev.created_at).toLocaleString(tagDoIdioma)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Relacionamento({
  companyId,
  estado,
  clienteDesde,
  podeGerenciar,
  ehAdmin,
  chave,
}: {
  companyId: string;
  estado: EstadoDaCarteira;
  clienteDesde: string | null;
  podeGerenciar: boolean;
  ehAdmin: boolean;
  chave: string[];
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  // Spec 23 Q2: ativar com implantação em andamento e obrigatório aberto pede confirmação do admin.
  const [confirmacao, setConfirmacao] = useState<string | null>(null);
  const mudar = useMutation({
    mutationFn: ({ para, confirmar }: { para: EstadoDaCarteira; confirmar?: boolean }) =>
      apiClient.post(`/api/v1/carteira/empresas/${companyId}/estado`, {
        estado: para,
        ...(confirmar ? { confirmar_implantacao_aberta: true } : {}),
      }),
    onSuccess: () => {
      setConfirmacao(null);
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "implantacao_em_andamento" && ehAdmin) {
        setConfirmacao(e.message);
        return;
      }
      showApiError(e);
    },
  });

  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("Relacionamento")}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs ${classeDoEstado(estado)}`} data-testid="carteira-estado">
          {rotuloDoEstado(estado, t)}
        </span>
        {clienteDesde ? (
          <span className="text-xs text-text-muted">
            {`${t("Cliente desde")} ${new Date(`${clienteDesde}T12:00:00`).toLocaleDateString(tagDoIdioma)}`}
          </span>
        ) : null}
      </div>
      {podeGerenciar ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSICOES_DA_CARTEIRA[estado].map((para) => (
            <Button
              key={para}
              size="sm"
              variant="outline"
              disabled={mudar.isPending}
              data-testid={`carteira-transicao-${para}`}
              onClick={() => mudar.mutate({ para })}
            >
              {`${t("Mover para")} ${rotuloDoEstado(para, t)}`}
            </Button>
          ))}
        </div>
      ) : null}
      {confirmacao ? (
        <div className="mt-2 rounded-md border border-warning p-2 text-sm" role="alert" data-testid="carteira-confirmar-ativacao">
          <p>{confirmacao}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={mudar.isPending} onClick={() => mudar.mutate({ para: "ativo", confirmar: true })}>
              {t("Ativar mesmo assim")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmacao(null)}>
              {t("Voltar")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type ResumoDaImplantacao = {
  obrigatorios: number;
  obrigatorios_fechados: number;
  vencidos: number;
  aguardando_cliente: number;
  pode_concluir: boolean;
};
type ImplantacaoDaEmpresa = {
  id: string;
  estado: "em_andamento" | "concluida" | "cancelada";
  iniciada_em: string;
  concluida_em: string | null;
  resumo: ResumoDaImplantacao;
};

/**
 * O cartão da implantação (spec 23 §8): a em andamento, com o progresso dos obrigatórios e o link
 * para a ficha; sem nenhuma, o botão de iniciar (gestor) para empresa que ainda não é cliente ou
 * que é ativa e contratou um serviço novo.
 */
function CartaoDaImplantacao({
  companyId,
  estado,
  podeGerenciar,
  chave,
}: {
  companyId: string;
  estado: EstadoDaCarteira;
  podeGerenciar: boolean;
  chave: string[];
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  const chaveDaImplantacao = ["implantacoes", "empresa", companyId];
  const lista = useQuery({
    queryKey: chaveDaImplantacao,
    queryFn: async () =>
      (await apiClient.get<{ data: ImplantacaoDaEmpresa[] }>(`/api/v1/implantacoes?company_id=${companyId}`)).data,
    retry: false,
  });
  const iniciar = useMutation({
    mutationFn: () => apiClient.post("/api/v1/implantacoes", { company_id: companyId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chaveDaImplantacao });
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: showApiError,
  });

  const emAndamento = lista.data?.find((i) => i.estado === "em_andamento");
  const ultimaConcluida = lista.data?.find((i) => i.estado === "concluida");
  const podeIniciar = ["prospect", "em_qualificacao", "proposta", "em_implantacao", "ativo"].includes(estado);

  return (
    <section className="rounded-md border border-border p-3" data-testid="carteira-implantacao">
      <h2 className="mb-2 text-sm font-semibold">{t("Implantação")}</h2>
      {lista.error instanceof ApiError ? (
        <p className="text-sm text-text-muted">{lista.error.message}</p>
      ) : !lista.data ? (
        <p className="text-sm text-text-muted">{t("Carregando…")}</p>
      ) : emAndamento ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {`${emAndamento.resumo.obrigatorios_fechados}/${emAndamento.resumo.obrigatorios} ${t("obrigatórios fechados")}`}
            {emAndamento.resumo.vencidos > 0 ? ` · ${emAndamento.resumo.vencidos} ${t("vencido(s)")}` : ""}
            {emAndamento.resumo.pode_concluir ? ` · ${t("Pronta para concluir")}` : ""}
          </span>
          <Link href={`/app/implantacoes/${emAndamento.id}`} className="underline">
            {t("Abrir a implantação")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-text-muted">
            {ultimaConcluida?.concluida_em
              ? `${t("Implantação concluída em")} ${new Date(ultimaConcluida.concluida_em).toLocaleDateString(tagDoIdioma)}`
              : t("Nenhuma implantação em andamento.")}
          </span>
          {podeGerenciar && podeIniciar ? (
            <Button size="sm" variant="outline" disabled={iniciar.isPending} onClick={() => iniciar.mutate()} data-testid="carteira-iniciar-implantacao">
              {t("Iniciar implantação")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Pessoas({
  companyId,
  ficha,
  podeGerenciar,
  podeEditarVinculo,
  chave,
}: {
  companyId: string;
  ficha: Ficha;
  podeGerenciar: boolean;
  podeEditarVinculo: boolean;
  chave: string[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const atualizar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: Record<string, unknown> }) =>
      apiClient.patch(`/api/v1/carteira/vinculos/${id}`, corpo),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });

  const detalheDe = (id: string): Detalhe | undefined => ficha.detalhes.find((d) => d.company_people_id === id);
  const telefonesDe = (personId: string): string =>
    ficha.contatos
      .filter((c) => c.person_id === personId)
      .map((c) => (c.phone_number ? phoneForDisplay(c.phone_number) : null))
      .filter(Boolean)
      .join(", ");

  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("Pessoas que representam a empresa")}</h2>
      {ficha.vinculos.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Ninguém ligado a esta empresa ainda.")}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {ficha.vinculos.map((v) => {
              const d = detalheDe(v.id);
              const ativo = d?.ativo ?? true;
              return (
                <tr key={v.id} className={`border-b border-border/60 ${ativo ? "" : "opacity-60"}`}>
                  <td className="py-2">
                    <div className="font-medium">{v.people?.full_name ?? t("Pessoa sem nome")}</div>
                    <div className="text-xs text-text-muted">{telefonesDe(v.person_id) || t("Sem WhatsApp ligado")}</div>
                  </td>
                  <td className="py-2">
                    {podeEditarVinculo ? (
                      <select
                        value={d?.papel ?? "outro"}
                        data-testid={`vinculo-papel-${v.id}`}
                        onChange={(e) => atualizar.mutate({ id: v.id, corpo: { papel: e.target.value } })}
                        className={CAMPO}
                      >
                        {PAPEIS_DO_VINCULO.map((p) => (
                          <option key={p} value={p}>
                            {rotuloDoPapel(p, t)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      rotuloDoPapel(d?.papel ?? "outro", t)
                    )}
                  </td>
                  <td className="py-2 text-xs text-text-muted">
                    {(d?.areas ?? []).length > 0
                      ? d!.areas.map((a) => ficha.areas.find((x) => x.slug === a)?.rotulo ?? a).join(", ")
                      : t("Todas as áreas")}
                  </td>
                  <td className="py-2 text-right">
                    {podeEditarVinculo ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={`vinculo-ativo-${v.id}`}
                        onClick={() => atualizar.mutate({ id: v.id, corpo: { ativo: !ativo } })}
                      >
                        {ativo ? t("Desativar") : t("Reativar")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {podeGerenciar ? <LigarContato companyId={companyId} chave={chave} /> : null}
    </section>
  );
}

function LigarContato({ companyId, chave }: { companyId: string; chave: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [contatoId, setContatoId] = useState("");
  const [papel, setPapel] = useState<PapelDoVinculo>("socio");

  const contatos = useQuery({
    queryKey: ["carteira", "contatos", busca],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Contato[] }>(
          `/api/v1/contacts?${new URLSearchParams({ search: busca.trim(), limit: "10" })}`,
        )
      ).data,
    enabled: busca.trim().length >= 2,
  });

  const ligar = useMutation({
    mutationFn: () =>
      apiClient.post(`/api/v1/carteira/empresas/${companyId}/vinculos`, { contact_id: contatoId, papel }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chave });
      setBusca("");
      setContatoId("");
    },
    onError: showApiError,
  });

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Buscar contato (nome ou telefone)")}
        <input
          value={busca}
          data-testid="vinculo-busca"
          onChange={(e) => setBusca(e.target.value)}
          className={`w-56 ${CAMPO}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Contato")}
        <select
          value={contatoId}
          data-testid="vinculo-contato"
          onChange={(e) => setContatoId(e.target.value)}
          className={`w-56 ${CAMPO}`}
        >
          <option value="">{t("Escolha")}</option>
          {(contatos.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {rotuloDoContato(c, t)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Papel")}
        <select
          value={papel}
          data-testid="vinculo-novo-papel"
          onChange={(e) => setPapel(e.target.value as PapelDoVinculo)}
          className={CAMPO}
        >
          {PAPEIS_DO_VINCULO.map((p) => (
            <option key={p} value={p}>
              {rotuloDoPapel(p, t)}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        disabled={!contatoId || ligar.isPending}
        data-testid="vinculo-ligar"
        onClick={() => ligar.mutate()}
      >
        {t("Ligar à empresa")}
      </Button>
    </div>
  );
}

function Responsaveis({
  companyId,
  ficha,
  podeGerenciar,
  chave,
}: {
  companyId: string;
  ficha: Ficha;
  podeGerenciar: boolean;
  chave: string[];
}) {
  const t = useT();
  const qc = useQueryClient();

  const equipe = useQuery({
    queryKey: ["team", "assignable"],
    queryFn: async () => (await apiClient.get<{ data: Membro[] }>("/api/v1/team/assignable")).data,
    // `agent`+ lê a equipe (spec 13 §4); para `viewer` a leitura é recusada e o nome cai no
    // genérico — a ficha continua dizendo QUE há responsável, só não quem.
    retry: false,
  });
  const nomeDe = (userId: string): string =>
    equipe.data?.find((m) => m.user_id === userId)?.full_name ?? t("Membro da equipe");

  const definir = useMutation({
    mutationFn: ({ area, userId }: { area: string; userId: string }) =>
      apiClient.post(`/api/v1/carteira/empresas/${companyId}/responsaveis`, { area, user_id: userId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });
  const encerrar = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/carteira/responsaveis/${id}/encerrar`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chave }),
    onError: showApiError,
  });

  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("Quem cuida da empresa em cada área")}</h2>
      <table className="w-full text-sm">
        <tbody>
          {ficha.areas.map(({ slug: area, rotulo }) => {
            const atual = ficha.responsaveis.find((r) => r.area === area);
            return (
              <tr key={area} className="border-b border-border/60">
                <td className="py-2 font-medium">{rotulo}</td>
                <td className="py-2">
                  {podeGerenciar ? (
                    <select
                      value={atual?.user_id ?? ""}
                      data-testid={`responsavel-${area}`}
                      onChange={(e) => {
                        if (e.target.value) definir.mutate({ area, userId: e.target.value });
                        else if (atual) encerrar.mutate(atual.id);
                      }}
                      className={CAMPO}
                    >
                      <option value="">{t("Ninguém")}</option>
                      {(equipe.data ?? []).map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name ?? t("Membro da equipe")}
                        </option>
                      ))}
                    </select>
                  ) : atual ? (
                    nomeDe(atual.user_id)
                  ) : (
                    <span className="text-text-muted">{t("Ninguém")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
