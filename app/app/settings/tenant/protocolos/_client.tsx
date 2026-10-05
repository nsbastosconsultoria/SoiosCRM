"use client";
/**
 * Configuração de protocolos — seis blocos, cada um salva sozinho.
 *
 * Os prazos (SLA) nascem EM BRANCO e o modelo de nicho não os preenche: prazo é compromisso do
 * escritório, e um número sugerido aqui viraria promessa sem ninguém ter decidido.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { PRIORIDADES, type Prioridade } from "@/lib/protocolos/prioridade";

import { rotuloDaPrioridade } from "@/app/app/protocolos/_rotulos";

type Categoria = {
  id: string;
  parent_id: string | null;
  nome: string;
  slug: string;
  area: string;
  prioridade_padrao: Prioridade;
  exige_competencia: boolean;
  exige_handoff: boolean;
  ativa: boolean;
};
type Politica = {
  id: string;
  prioridade: Prioridade;
  categoria_id: string | null;
  primeira_resposta_min: number;
  resolucao_min: number;
  em_horario_util: boolean;
};
type Membro = { id: string; area: string; user_id: string; papel: "membro" | "lider" };
type Feriado = { id: string; data: string; descricao: string };
type Expediente = { fuso: string; dias: number[]; inicio: string; fim: string } | null;
type Config = {
  categorias: Categoria[];
  politicas: Politica[];
  membros: Membro[];
  feriados: Feriado[];
  expediente: Expediente;
  areas: Array<{ slug: string; rotulo: string }>;
};
type Pessoa = { user_id: string; full_name: string | null };

const CAMPO = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";
const CHAVE = ["protocolos", "config"];

function useConfig() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Config }>("/api/v1/protocolos/config")).data,
    retry: false,
  });
}

function useSalvar<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
    onError: showApiError,
  });
}

function Bloco({ titulo, children, ajuda }: { titulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {ajuda ? <p className="text-xs text-text-muted">{ajuda}</p> : null}
      {children}
    </section>
  );
}

export function ConfiguracaoDeProtocolos() {
  const t = useT();
  const config = useConfig();
  const equipe = useQuery({
    queryKey: ["team", "assignable"],
    queryFn: async () => (await apiClient.get<{ data: Pessoa[] }>("/api/v1/team/assignable")).data,
    retry: false,
  });

  if (config.isError) return <p className="text-sm text-danger">{t("Não foi possível carregar a configuração.")}</p>;
  if (!config.data) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  const c = config.data;
  const pessoas = equipe.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Modelo />
      <BlocoDeExpediente atual={c.expediente} />
      <Prazos politicas={c.politicas} />
      <Filas areas={c.areas} membros={c.membros} pessoas={pessoas} />
      <Categorias categorias={c.categorias} areas={c.areas} />
      <Feriados feriados={c.feriados} />
    </div>
  );
}

function Modelo() {
  const t = useT();
  const aplicar = useSalvar((modelo: "contabilidade" | "generico") =>
    apiClient.post("/api/v1/protocolos/config/modelo", { modelo }),
  );
  return (
    <Bloco
      titulo={t("Começar por um modelo")}
      ajuda={t("Cria as áreas e as categorias que faltam. Não apaga nada do que já existe e não define prazos.")}
    >
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={aplicar.isPending} onClick={() => aplicar.mutate("contabilidade")} data-testid="modelo-contabilidade">
          {t("Escritório de contabilidade")}
        </Button>
        <Button size="sm" variant="outline" disabled={aplicar.isPending} onClick={() => aplicar.mutate("generico")} data-testid="modelo-generico">
          {t("Genérico")}
        </Button>
      </div>
    </Bloco>
  );
}

const DIAS: Array<[number, string]> = [
  [1, "Seg"],
  [2, "Ter"],
  [3, "Qua"],
  [4, "Qui"],
  [5, "Sex"],
  [6, "Sáb"],
  [7, "Dom"],
];

function BlocoDeExpediente({ atual }: { atual: Expediente }) {
  const t = useT();
  const [dias, setDias] = useState<number[]>(atual?.dias ?? [1, 2, 3, 4, 5]);
  const [inicio, setInicio] = useState(atual?.inicio ?? "08:00");
  const [fim, setFim] = useState(atual?.fim ?? "18:00");
  const [fuso, setFuso] = useState(atual?.fuso ?? "America/Sao_Paulo");
  const salvar = useSalvar((e: Expediente) => apiClient.put("/api/v1/protocolos/config/expediente", e));
  const rotulo = (d: string) => {
    switch (d) {
      case "Seg":
        return t("Seg");
      case "Ter":
        return t("Ter");
      case "Qua":
        return t("Qua");
      case "Qui":
        return t("Qui");
      case "Sex":
        return t("Sex");
      case "Sáb":
        return t("Sáb");
      default:
        return t("Dom");
    }
  };

  return (
    <Bloco
      titulo={t("Expediente")}
      ajuda={
        atual
          ? t("Os prazos em horário útil só correm dentro deste expediente, fora de feriados.")
          : t("Sem expediente definido, os prazos correm 24 horas por dia.")
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {DIAS.map(([n, d]) => (
            <label key={n} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={dias.includes(n)}
                onChange={(e) => setDias((v) => (e.target.checked ? [...v, n].sort() : v.filter((x) => x !== n)))}
              />
              {rotulo(d)}
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Início")}
          <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Fim")}
          <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Fuso")}
          <input value={fuso} onChange={(e) => setFuso(e.target.value)} className={`w-48 ${CAMPO}`} />
        </label>
        <Button size="sm" disabled={salvar.isPending || dias.length === 0} onClick={() => salvar.mutate({ fuso, dias, inicio, fim })} data-testid="salvar-expediente">
          {t("Salvar expediente")}
        </Button>
        {atual ? (
          <Button size="sm" variant="ghost" disabled={salvar.isPending} onClick={() => salvar.mutate(null)}>
            {t("Usar 24 horas")}
          </Button>
        ) : null}
      </div>
    </Bloco>
  );
}

function Prazos({ politicas }: { politicas: Politica[] }) {
  const t = useT();
  return (
    <Bloco
      titulo={t("Prazos por prioridade (SLA)")}
      ajuda={t("Em horas. Prioridade sem prazo fica sem relógio. O assistente nunca informa estes prazos ao cliente.")}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="py-1">{t("Prioridade")}</th>
            <th className="py-1">{t("Primeira resposta (h)")}</th>
            <th className="py-1">{t("Resolução (h)")}</th>
            <th className="py-1">{t("Só em horário útil")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {PRIORIDADES.map((p) => (
            <LinhaDePrazo key={p} prioridade={p} atual={politicas.find((x) => x.prioridade === p && x.categoria_id === null)} />
          ))}
        </tbody>
      </table>
    </Bloco>
  );
}

function LinhaDePrazo({ prioridade, atual }: { prioridade: Prioridade; atual?: Politica }) {
  const t = useT();
  const [primeira, setPrimeira] = useState(atual ? String(atual.primeira_resposta_min / 60) : "");
  const [resolucao, setResolucao] = useState(atual ? String(atual.resolucao_min / 60) : "");
  const [util, setUtil] = useState(atual?.em_horario_util ?? true);
  const salvar = useSalvar(() =>
    apiClient.put("/api/v1/protocolos/config/politicas", {
      prioridade,
      primeira_resposta_min: Math.round(Number(primeira.replace(",", ".")) * 60),
      resolucao_min: Math.round(Number(resolucao.replace(",", ".")) * 60),
      em_horario_util: util,
    }),
  );
  const valido = Number(primeira.replace(",", ".")) > 0 && Number(resolucao.replace(",", ".")) > 0;
  return (
    <tr className="border-t border-border/60">
      <td className="py-2">{rotuloDaPrioridade(prioridade, t)}</td>
      <td className="py-2">
        <input value={primeira} inputMode="decimal" onChange={(e) => setPrimeira(e.target.value)} className={`w-20 ${CAMPO}`} data-testid={`prazo-primeira-${prioridade}`} />
      </td>
      <td className="py-2">
        <input value={resolucao} inputMode="decimal" onChange={(e) => setResolucao(e.target.value)} className={`w-20 ${CAMPO}`} data-testid={`prazo-resolucao-${prioridade}`} />
      </td>
      <td className="py-2">
        <input type="checkbox" checked={util} onChange={(e) => setUtil(e.target.checked)} aria-label={t("Só em horário útil")} />
      </td>
      <td className="py-2 text-right">
        <Button size="sm" variant="outline" disabled={!valido || salvar.isPending} onClick={() => salvar.mutate(undefined)} data-testid={`salvar-prazo-${prioridade}`}>
          {t("Salvar")}
        </Button>
      </td>
    </tr>
  );
}

function Filas({ areas, membros, pessoas }: { areas: Config["areas"]; membros: Membro[]; pessoas: Pessoa[] }) {
  const t = useT();
  const nome = (id: string) => pessoas.find((p) => p.user_id === id)?.full_name ?? t("Membro da equipe");
  const remover = useSalvar((id: string) => apiClient.delete(`/api/v1/protocolos/config/membros/${id}`));
  const adicionar = useSalvar((v: { area: string; user_id: string; papel: "membro" | "lider" }) =>
    apiClient.post("/api/v1/protocolos/config/membros", v),
  );
  return (
    <Bloco
      titulo={t("Filas por área")}
      ajuda={t("Quem atende a fila de cada área. O líder recebe o protocolo quando a área não tem ninguém na fila.")}
    >
      {areas.map((a) => (
        <FilaDaArea
          key={a.slug}
          area={a}
          membros={membros.filter((m) => m.area === a.slug)}
          pessoas={pessoas}
          nome={nome}
          onRemover={(id) => remover.mutate(id)}
          onAdicionar={(user_id, papel) => adicionar.mutate({ area: a.slug, user_id, papel })}
        />
      ))}
    </Bloco>
  );
}

function FilaDaArea({
  area,
  membros,
  pessoas,
  nome,
  onRemover,
  onAdicionar,
}: {
  area: { slug: string; rotulo: string };
  membros: Membro[];
  pessoas: Pessoa[];
  nome: (id: string) => string;
  onRemover: (id: string) => void;
  onAdicionar: (userId: string, papel: "membro" | "lider") => void;
}) {
  const t = useT();
  const [pessoa, setPessoa] = useState("");
  const [papel, setPapel] = useState<"membro" | "lider">("membro");
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-sm">
      <span className="w-40 font-medium">{area.rotulo}</span>
      {membros.length === 0 ? <span className="text-text-muted">{t("Ninguém")}</span> : null}
      {membros.map((m) => (
        <span key={m.id} className="flex items-center gap-1 rounded-md bg-surface-elevated px-2 py-0.5">
          {nome(m.user_id)}
          {m.papel === "lider" ? <span className="text-xs text-text-muted">({t("líder")})</span> : null}
          <button type="button" className="text-text-muted hover:text-danger" aria-label={t("Remover")} onClick={() => onRemover(m.id)}>
            ×
          </button>
        </span>
      ))}
      <select value={pessoa} onChange={(e) => setPessoa(e.target.value)} className={CAMPO} aria-label={t("Pessoa")}>
        <option value="">{t("Adicionar…")}</option>
        {pessoas
          .filter((p) => !membros.some((m) => m.user_id === p.user_id))
          .map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.full_name ?? t("Membro da equipe")}
            </option>
          ))}
      </select>
      <select value={papel} onChange={(e) => setPapel(e.target.value as "membro" | "lider")} className={CAMPO} aria-label={t("Papel na fila")}>
        <option value="membro">{t("Membro")}</option>
        <option value="lider">{t("Líder")}</option>
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={!pessoa}
        onClick={() => {
          onAdicionar(pessoa, papel);
          setPessoa("");
        }}
      >
        {t("Adicionar")}
      </Button>
    </div>
  );
}

function slugDe(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(s) ? s.slice(0, 40) : `c_${s}`.slice(0, 40);
}

function Categorias({ categorias, areas }: { categorias: Categoria[]; areas: Config["areas"] }) {
  const t = useT();
  const raizes = categorias.filter((c) => c.parent_id === null);
  const alternar = useSalvar((c: Categoria) => apiClient.patch(`/api/v1/protocolos/config/categorias/${c.id}`, { ativa: !c.ativa }));
  const [nome, setNome] = useState("");
  const [pai, setPai] = useState("");
  const [area, setArea] = useState(areas[0]?.slug ?? "");
  const [prioridade, setPrioridade] = useState<Prioridade>("P3");
  const criar = useSalvar(() =>
    apiClient.post("/api/v1/protocolos/config/categorias", {
      nome: nome.trim(),
      slug: slugDe(nome),
      area,
      parent_id: pai || null,
      prioridade_padrao: prioridade,
    }),
  );
  const rotuloDaArea = (slug: string) => areas.find((a) => a.slug === slug)?.rotulo ?? slug;

  return (
    <Bloco titulo={t("Categorias")} ajuda={t("Categoria usada não se apaga: desative para tirá-la da abertura de protocolos.")}>
      <ul className="flex flex-col gap-1 text-sm">
        {raizes.map((r) => (
          <li key={r.id} className="border-b border-border/60 py-1">
            <LinhaDeCategoria c={r} area={rotuloDaArea(r.area)} onAlternar={() => alternar.mutate(r)} />
            <ul className="ml-6">
              {categorias
                .filter((s) => s.parent_id === r.id)
                .map((s) => (
                  <li key={s.id}>
                    <LinhaDeCategoria c={s} area={rotuloDaArea(s.area)} onAlternar={() => alternar.mutate(s)} />
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Nova categoria")}
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={`w-56 ${CAMPO}`} data-testid="nova-categoria-nome" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Dentro de")}
          <select value={pai} onChange={(e) => setPai(e.target.value)} className={CAMPO}>
            <option value="">{t("Nenhuma (categoria principal)")}</option>
            {raizes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Área")}
          <select value={area} onChange={(e) => setArea(e.target.value)} className={CAMPO}>
            {areas.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Prioridade padrão")}
          <select value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)} className={CAMPO}>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {rotuloDaPrioridade(p, t)}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={!nome.trim() || !area || criar.isPending}
          onClick={() => {
            criar.mutate(undefined);
            setNome("");
          }}
          data-testid="nova-categoria-criar"
        >
          {t("Criar")}
        </Button>
      </div>
    </Bloco>
  );
}

function LinhaDeCategoria({ c, area, onAlternar }: { c: Categoria; area: string; onAlternar: () => void }) {
  const t = useT();
  return (
    <div className={`flex items-center justify-between gap-2 ${c.ativa ? "" : "opacity-60"}`}>
      <span>
        {c.nome}{" "}
        <span className="text-xs text-text-muted">
          · {area} · {rotuloDaPrioridade(c.prioridade_padrao, t)}
          {c.exige_competencia ? ` · ${t("pede competência")}` : ""}
          {c.exige_handoff ? ` · ${t("passa para humano")}` : ""}
        </span>
      </span>
      <Button size="sm" variant="ghost" onClick={onAlternar}>
        {c.ativa ? t("Desativar") : t("Reativar")}
      </Button>
    </div>
  );
}

function Feriados({ feriados }: { feriados: Feriado[] }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const adicionar = useSalvar(() => apiClient.post("/api/v1/protocolos/config/feriados", { data, descricao: descricao.trim() }));
  const remover = useSalvar((id: string) => apiClient.delete(`/api/v1/protocolos/config/feriados/${id}`));
  return (
    <Bloco titulo={t("Feriados")} ajuda={t("Nos feriados o relógio dos prazos em horário útil não corre.")}>
      <ul className="flex flex-col gap-1 text-sm">
        {feriados.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2">
            <span>
              {new Date(`${f.data}T12:00:00`).toLocaleDateString(tagDoIdioma)} · {f.descricao}
            </span>
            <Button size="sm" variant="ghost" onClick={() => remover.mutate(f.id)}>
              {t("Remover")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={CAMPO} aria-label={t("Data")} />
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={t("Descrição")} className={`w-56 ${CAMPO}`} />
        <Button
          size="sm"
          variant="outline"
          disabled={!data || !descricao.trim() || adicionar.isPending}
          onClick={() => {
            adicionar.mutate(undefined);
            setData("");
            setDescricao("");
          }}
        >
          {t("Adicionar feriado")}
        </Button>
      </div>
    </Bloco>
  );
}
