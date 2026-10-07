"use client";
/**
 * Configuração da implantação: modelo de nicho, modelos (padrão e ativo) e os itens de cada um.
 * Tudo `admin`. O modelo padrão é o usado quando ninguém escolhe (e no início automático pelo
 * negócio ganho).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { VEZ_DE, type VezDe } from "@/lib/implantacao/vocabulario";

import { rotuloDaVez } from "../../../implantacoes/_rotulos";

type Modelo = { id: string; nome: string; padrao: boolean; ativo: boolean };
type ItemDeModelo = {
  id: string;
  modelo_id: string;
  grupo: string;
  titulo: string;
  orientacao: string | null;
  posicao: number;
  obrigatorio: boolean;
  vez_de: VezDe;
  area: string | null;
  prazo_dias: number | null;
  exige_evidencia: boolean;
};
type Configuracao = {
  modelos: Modelo[];
  itens: ItemDeModelo[];
  areas: Array<{ slug: string; rotulo: string }>;
  funis: Array<{ id: string; name: string }>;
  funil_comercial_id: string | null;
};

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";
const CHAVE = ["implantacao", "config"];

export function ConfiguracaoDaImplantacao() {
  const t = useT();
  const qc = useQueryClient();
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const config = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Configuracao }>("/api/v1/implantacao/config")).data,
    retry: false,
  });
  const recarregar = () => void qc.invalidateQueries({ queryKey: CHAVE });

  const aplicar = useMutation({
    mutationFn: (modelo: "contabilidade" | "generico") =>
      apiClient.post<{ data: { criado: boolean; modelo_id: string } }>("/api/v1/implantacao/config/modelo", { modelo }),
    onSuccess: (r) => {
      setSelecionado(r.data.modelo_id);
      recarregar();
    },
    onError: showApiError,
  });
  const salvarModelo = useMutation({
    mutationFn: (m: Partial<Modelo> & { nome: string }) => apiClient.post("/api/v1/implantacao/config/modelos", m),
    onSuccess: () => {
      setNovoNome("");
      recarregar();
    },
    onError: showApiError,
  });

  if (config.error instanceof ApiError) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {config.error.message}
      </p>
    );
  }
  if (!config.data) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;

  const c = config.data;
  const atual = c.modelos.find((m) => m.id === selecionado) ?? c.modelos.find((m) => m.padrao) ?? c.modelos[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-border p-3">
        <h2 className="mb-1 text-sm font-semibold">{t("Começar por um modelo")}</h2>
        <p className="mb-2 text-xs text-text-muted">
          {t("Cria um modelo pronto com os itens do nicho. Se já existir um modelo com o mesmo nome, nada muda.")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={aplicar.isPending} onClick={() => aplicar.mutate("contabilidade")}>
            {t("Escritório de contabilidade")}
          </Button>
          <Button size="sm" variant="outline" disabled={aplicar.isPending} onClick={() => aplicar.mutate("generico")}>
            {t("Genérico")}
          </Button>
        </div>
      </section>

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("Modelos")}</h2>
        {c.modelos.length === 0 ? (
          <p className="mb-2 text-sm text-text-muted">{t("Nenhum modelo ainda. Comece por um modelo acima ou crie um vazio.")}</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {c.modelos.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelecionado(m.id)}
                  className={`text-left text-sm ${atual?.id === m.id ? "font-semibold underline" : ""}`}
                >
                  {m.nome}
                  {m.padrao ? <span className="ml-2 text-xs text-success">{t("padrão")}</span> : null}
                  {!m.ativo ? <span className="ml-2 text-xs text-text-muted">{t("desativado")}</span> : null}
                </button>
                <div className="flex flex-wrap gap-2">
                  {!m.padrao && m.ativo ? (
                    <Button size="sm" variant="outline" onClick={() => salvarModelo.mutate({ id: m.id, nome: m.nome, ativo: m.ativo, padrao: true })}>
                      {t("Usar como padrão")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => salvarModelo.mutate({ id: m.id, nome: m.nome, ativo: !m.ativo, padrao: m.ativo ? false : m.padrao })}>
                    {m.ativo ? t("Desativar") : t("Reativar")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (novoNome.trim()) salvarModelo.mutate({ nome: novoNome.trim(), padrao: c.modelos.length === 0 });
          }}
        >
          <input
            id="implantacao-novo-modelo"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            maxLength={80}
            placeholder={t("Nome do novo modelo")}
            className={CAMPO}
          />
          <Button size="sm" type="submit" disabled={!novoNome.trim() || salvarModelo.isPending}>
            {t("Criar modelo")}
          </Button>
        </form>
      </section>

      <InicioAutomatico funis={c.funis} atual={c.funil_comercial_id} temPadrao={c.modelos.some((m) => m.padrao && m.ativo)} onFeito={recarregar} />

      {atual ? (
        <ItensDoModelo modelo={atual} itens={c.itens.filter((i) => i.modelo_id === atual.id)} areas={c.areas} onFeito={recarregar} />
      ) : null}
    </div>
  );
}

/**
 * O funil cujo negócio ganho inicia a implantação (spec 23 §5.1). Sem modelo padrão o início
 * automático não tem o que copiar — a tela diz isso em vez de deixar falhar calado.
 */
function InicioAutomatico({
  funis,
  atual,
  temPadrao,
  onFeito,
}: {
  funis: Array<{ id: string; name: string }>;
  atual: string | null;
  temPadrao: boolean;
  onFeito: () => void;
}) {
  const t = useT();
  const salvar = useMutation({
    mutationFn: (pipelineId: string | null) => apiClient.put("/api/v1/implantacao/config/funil", { pipeline_id: pipelineId }),
    onSuccess: onFeito,
    onError: showApiError,
  });
  return (
    <section className="rounded-md border border-border p-3" data-testid="implantacao-inicio-automatico">
      <h2 className="mb-1 text-sm font-semibold">{t("Início automático")}</h2>
      <p className="mb-2 text-xs text-text-muted">
        {t("Quando um negócio é ganho neste funil, a implantação da empresa começa sozinha, com o modelo padrão. A empresa vem do contato do negócio e só é usada quando ele representa uma empresa só.")}
      </p>
      <select
        id="implantacao-funil-comercial"
        aria-label={t("Funil comercial")}
        className={CAMPO}
        value={atual ?? ""}
        disabled={salvar.isPending}
        onChange={(e) => salvar.mutate(e.target.value || null)}
      >
        <option value="">{t("Desligado")}</option>
        {funis.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {atual && !temPadrao ? (
        <p className="mt-2 text-xs text-warning">{t("Escolha um modelo padrão abaixo: sem ele, o início automático não acontece.")}</p>
      ) : null}
    </section>
  );
}

function ItensDoModelo({
  modelo,
  itens,
  areas,
  onFeito,
}: {
  modelo: Modelo;
  itens: ItemDeModelo[];
  areas: Array<{ slug: string; rotulo: string }>;
  onFeito: () => void;
}) {
  const t = useT();
  const vazio = {
    grupo: "",
    titulo: "",
    vez_de: "escritorio" as VezDe,
    area: "",
    prazo_dias: "",
    obrigatorio: true,
    exige_evidencia: false,
  };
  const [novo, setNovo] = useState(vazio);

  const salvar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) => apiClient.post("/api/v1/implantacao/config/itens", corpo),
    onSuccess: () => {
      setNovo(vazio);
      onFeito();
    },
    onError: showApiError,
  });
  const remover = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/implantacao/config/itens?id=${id}`),
    onSuccess: onFeito,
    onError: showApiError,
  });

  return (
    <section className="rounded-md border border-border p-3" data-testid="implantacao-itens-do-modelo">
      <h2 className="mb-2 text-sm font-semibold">{`${t("Itens do modelo")}: ${modelo.nome}`}</h2>
      {itens.length === 0 ? (
        <p className="mb-2 text-sm text-text-muted">{t("Este modelo ainda não tem itens.")}</p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-1 pr-2">{t("Grupo")}</th>
                <th className="py-1 pr-2">{t("Item")}</th>
                <th className="py-1 pr-2">{t("Vez de")}</th>
                <th className="py-1 pr-2">{t("Prazo (dias)")}</th>
                <th className="py-1 pr-2">{t("Obrigatório")}</th>
                <th className="py-1 pr-2">{t("Exige evidência")}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-1 pr-2">{i.grupo}</td>
                  <td className="py-1 pr-2">{i.titulo}</td>
                  <td className="py-1 pr-2">{rotuloDaVez(i.vez_de, t)}</td>
                  <td className="py-1 pr-2 tabular-nums">{i.prazo_dias ?? "—"}</td>
                  <td className="py-1 pr-2">
                    <input
                      id={`modelo-item-obrigatorio-${i.id}`}
                      type="checkbox"
                      aria-label={t("Obrigatório")}
                      checked={i.obrigatorio}
                      onChange={(e) => salvar.mutate({ ...semNulos(i), obrigatorio: e.target.checked })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      id={`modelo-item-evidencia-${i.id}`}
                      type="checkbox"
                      aria-label={t("Exige evidência")}
                      checked={i.exige_evidencia}
                      onChange={(e) => salvar.mutate({ ...semNulos(i), exige_evidencia: e.target.checked })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button type="button" className="text-xs text-text-muted underline" onClick={() => remover.mutate(i.id)}>
                      {t("Remover")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="grid gap-2 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!novo.grupo.trim() || !novo.titulo.trim()) return;
          salvar.mutate({
            modelo_id: modelo.id,
            grupo: novo.grupo.trim(),
            titulo: novo.titulo.trim(),
            vez_de: novo.vez_de,
            area: novo.area || null,
            prazo_dias: novo.prazo_dias === "" ? null : Number(novo.prazo_dias),
            obrigatorio: novo.obrigatorio,
            exige_evidencia: novo.exige_evidencia,
            posicao: itens.length,
          });
        }}
      >
        <input id="novo-item-grupo" value={novo.grupo} maxLength={60} onChange={(e) => setNovo({ ...novo, grupo: e.target.value })} placeholder={t("Grupo")} className={CAMPO} />
        <input id="novo-item-titulo" value={novo.titulo} maxLength={120} onChange={(e) => setNovo({ ...novo, titulo: e.target.value })} placeholder={t("Item")} className={CAMPO} />
        <select id="novo-item-vez" value={novo.vez_de} onChange={(e) => setNovo({ ...novo, vez_de: e.target.value as VezDe })} className={CAMPO} aria-label={t("Vez de")}>
          {VEZ_DE.map((v) => (
            <option key={v} value={v}>
              {rotuloDaVez(v, t)}
            </option>
          ))}
        </select>
        <select id="novo-item-area" value={novo.area} onChange={(e) => setNovo({ ...novo, area: e.target.value })} className={CAMPO} aria-label={t("Área")}>
          <option value="">{t("Sem área")}</option>
          {areas.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.rotulo}
            </option>
          ))}
        </select>
        <input
          id="novo-item-prazo"
          type="number"
          min={0}
          max={365}
          value={novo.prazo_dias}
          onChange={(e) => setNovo({ ...novo, prazo_dias: e.target.value })}
          placeholder={t("Prazo (dias)")}
          className={CAMPO}
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input id="novo-item-obrigatorio" type="checkbox" checked={novo.obrigatorio} onChange={(e) => setNovo({ ...novo, obrigatorio: e.target.checked })} />
            {t("Obrigatório")}
          </label>
          <label className="flex items-center gap-1">
            <input id="novo-item-evidencia" type="checkbox" checked={novo.exige_evidencia} onChange={(e) => setNovo({ ...novo, exige_evidencia: e.target.checked })} />
            {t("Exige evidência")}
          </label>
        </div>
        <div className="md:col-span-3">
          <Button size="sm" type="submit" disabled={!novo.grupo.trim() || !novo.titulo.trim() || salvar.isPending}>
            {t("Acrescentar item")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** O item como a API o aceita de volta: sem os campos que o Zod estrito recusa. */
function semNulos(i: ItemDeModelo) {
  return {
    id: i.id,
    modelo_id: i.modelo_id,
    grupo: i.grupo,
    titulo: i.titulo,
    orientacao: i.orientacao,
    posicao: i.posicao,
    obrigatorio: i.obrigatorio,
    vez_de: i.vez_de,
    area: i.area,
    prazo_dias: i.prazo_dias,
    exige_evidencia: i.exige_evidencia,
  };
}
