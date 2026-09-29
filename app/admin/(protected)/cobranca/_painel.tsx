"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { formatarData, formatarValor, valorParaCentavos } from "@/lib/cobranca/formato";
import { cn } from "@/lib/utils";

export interface Plano {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  interval_months: number;
  trial_days: number;
  is_active: boolean;
}

export interface Assinatura {
  id: string;
  organization_id: string;
  plan_id: string;
  status: "trialing" | "active" | "past_due" | "suspended" | "canceled";
  trial_ends_at: string | null;
  current_period_end: string;
  grace_days: number;
  suspended_by_billing: boolean;
}

export interface Fatura {
  id: string;
  organization_id: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: "open" | "paid" | "overdue" | "canceled";
  paid_at: string | null;
  payment_note: string | null;
  instrucao_pagamento: string | null;
}

export interface Organizacao {
  id: string;
  display_name: string;
  status: string;
}

interface Props {
  planos: Plano[];
  assinaturas: Assinatura[];
  faturas: Fatura[];
  organizacoes: Organizacao[];
}

const SELECT = "w-full rounded-md border bg-background p-2 text-sm";

/** Chama uma rota da cobrança e devolve a mensagem de erro, ou `null` quando deu certo. */
async function chamar(url: string, metodo: "POST" | "PATCH", corpo: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (res.ok) return null;
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return json?.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return "Sem conexão com o servidor.";
  }
}

export function PainelDeCobranca({ planos, assinaturas, faturas, organizacoes }: Props) {
  const t = useT();
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();

  const executar = (url: string, metodo: "POST" | "PATCH", corpo: unknown, sucesso: string) =>
    iniciar(async () => {
      const erro = await chamar(url, metodo, corpo);
      if (erro) {
        toast.error(erro);
        return;
      }
      toast.success(sucesso);
      router.refresh();
    });

  const orgPorId = useMemo(() => new Map(organizacoes.map((o) => [o.id, o])), [organizacoes]);
  const planoPorId = useMemo(() => new Map(planos.map((p) => [p.id, p])), [planos]);
  const faturasPorOrg = useMemo(() => {
    const m = new Map<string, Fatura[]>();
    for (const f of faturas) m.set(f.organization_id, [...(m.get(f.organization_id) ?? []), f]);
    return m;
  }, [faturas]);

  const semAssinatura = organizacoes.filter(
    (o) => !assinaturas.some((a) => a.organization_id === o.id && a.status !== "canceled"),
  );
  const planosAtivos = planos.filter((p) => p.is_active);

  const rotuloDoStatus: Record<Assinatura["status"], string> = {
    trialing: t("Em teste"),
    active: t("Em dia"),
    past_due: t("Em atraso"),
    suspended: t("Suspensa"),
    canceled: t("Cancelada"),
  };
  const corDoStatus: Record<Assinatura["status"], string> = {
    trialing: "bg-info-bg text-info-fg",
    active: "bg-success-bg text-success-fg",
    past_due: "bg-warning-bg text-warning-fg",
    suspended: "bg-error-bg text-error-fg",
    canceled: "bg-muted text-muted-foreground",
  };
  const rotuloDaFatura: Record<Fatura["status"], string> = {
    open: t("Em aberto"),
    overdue: t("Vencida"),
    paid: t("Paga"),
    canceled: t("Cancelada"),
  };
  const periodicidade = (meses: number) =>
    meses === 1 ? t("Mensal") : meses === 3 ? t("Trimestral") : meses === 6 ? t("Semestral") : t("Anual");

  return (
    <div className="space-y-8">
      <SecaoDePlanos
        planos={planos}
        ocupado={ocupado}
        executar={executar}
        periodicidade={periodicidade}
      />

      <section className="space-y-3" data-testid="cobranca-assinaturas">
        <h2 className="text-lg font-semibold">{t("Assinaturas")}</h2>

        {assinaturas.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Nenhuma empresa tem assinatura ainda.")}</p>
        )}

        {assinaturas.map((a) => {
          const org = orgPorId.get(a.organization_id);
          const plano = planoPorId.get(a.plan_id);
          const lista = faturasPorOrg.get(a.organization_id) ?? [];
          return (
            <Card key={a.id} className="space-y-3 p-4" data-testid={`assinatura-${a.organization_id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{org?.display_name ?? a.organization_id}</p>
                  <p className="text-sm text-muted-foreground">
                    {plano ? `${plano.name} · ${formatarValor(plano.price_cents, plano.currency)}` : "—"}
                    {" · "}
                    {t("Próximo vencimento")}: {formatarData(a.current_period_end)}
                    {a.trial_ends_at && a.status === "trialing"
                      ? ` · ${t("Teste até")} ${formatarData(a.trial_ends_at)}`
                      : ""}
                  </p>
                </div>
                <span
                  className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", corDoStatus[a.status])}
                  data-testid="status-da-assinatura"
                >
                  {rotuloDoStatus[a.status]}
                </span>
              </div>

              {a.status !== "canceled" && (
                <LancarFatura
                  orgId={a.organization_id}
                  ocupado={ocupado}
                  executar={executar}
                  vencimento={a.current_period_end}
                />
              )}

              {lista.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-normal">{t("Vencimento")}</th>
                        <th className="py-1 pr-3 font-normal">{t("Valor")}</th>
                        <th className="py-1 pr-3 font-normal">{t("Situação")}</th>
                        <th className="py-1 font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((f) => (
                        <tr key={f.id} className="border-t" data-testid={`fatura-${f.id}`}>
                          <td className="py-1.5 pr-3">{formatarData(f.due_date)}</td>
                          <td className="py-1.5 pr-3">{formatarValor(f.amount_cents, f.currency)}</td>
                          <td className="py-1.5 pr-3">
                            {rotuloDaFatura[f.status]}
                            {f.status === "paid" && f.paid_at ? ` ${formatarData(f.paid_at)}` : ""}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {(f.status === "open" || f.status === "overdue") && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={ocupado}
                                  data-testid="dar-baixa"
                                  onClick={() =>
                                    executar(
                                      `/api/v1/admin/cobranca/faturas/${f.id}/pagar`,
                                      "POST",
                                      {},
                                      t("Pagamento registrado."),
                                    )
                                  }
                                >
                                  {t("Dar baixa")}
                                </Button>{" "}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={ocupado}
                                  onClick={() => {
                                    if (!window.confirm(t("Cancelar esta fatura?"))) return;
                                    executar(
                                      `/api/v1/admin/cobranca/faturas/${f.id}/cancelar`,
                                      "POST",
                                      {},
                                      t("Fatura cancelada."),
                                    );
                                  }}
                                >
                                  {t("Cancelar")}
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {a.status !== "canceled" && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
                  <Label htmlFor={`plano-${a.id}`} className="text-muted-foreground">
                    {t("Trocar plano")}
                  </Label>
                  <select
                    id={`plano-${a.id}`}
                    className={cn(SELECT, "w-auto")}
                    value={a.plan_id}
                    disabled={ocupado}
                    onChange={(e) =>
                      executar(
                        `/api/v1/admin/cobranca/tenants/${a.organization_id}/assinatura`,
                        "PATCH",
                        { plan_id: e.target.value },
                        t("Plano alterado."),
                      )
                    }
                  >
                    {planos
                      .filter((p) => p.is_active || p.id === a.plan_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={ocupado}
                    onClick={() => {
                      if (!window.confirm(t("Cancelar a assinatura? A empresa deixa de ser cobrada."))) return;
                      executar(
                        `/api/v1/admin/cobranca/tenants/${a.organization_id}/assinatura`,
                        "PATCH",
                        { cancelar: true },
                        t("Assinatura cancelada."),
                      );
                    }}
                  >
                    {t("Cancelar assinatura")}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}

        <NovaAssinatura
          organizacoes={semAssinatura}
          planos={planosAtivos}
          ocupado={ocupado}
          executar={executar}
        />
      </section>
    </div>
  );
}

type Executar = (url: string, metodo: "POST" | "PATCH", corpo: unknown, sucesso: string) => void;

function SecaoDePlanos({
  planos,
  ocupado,
  executar,
  periodicidade,
}: {
  planos: Plano[];
  ocupado: boolean;
  executar: Executar;
  periodicidade: (meses: number) => string;
}) {
  const t = useT();
  const [form, setForm] = useState({ name: "", preco: "", interval_months: "1", trial_days: "0" });

  const criar = () => {
    const price_cents = valorParaCentavos(form.preco);
    if (!form.name.trim() || price_cents === null) {
      toast.error(t("Informe o nome e o preço do plano."));
      return;
    }
    executar(
      "/api/v1/admin/cobranca/planos",
      "POST",
      {
        name: form.name.trim(),
        price_cents,
        interval_months: Number(form.interval_months),
        trial_days: Number(form.trial_days) || 0,
      },
      t("Plano criado."),
    );
    setForm({ name: "", preco: "", interval_months: "1", trial_days: "0" });
  };

  return (
    <section className="space-y-3" data-testid="cobranca-planos">
      <h2 className="text-lg font-semibold">{t("Planos")}</h2>
      {planos.length > 0 && (
        <Card className="divide-y">
          {planos.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className={cn(!p.is_active && "text-muted-foreground line-through")}>
                <span className="font-medium">{p.name}</span>
                {" · "}
                {formatarValor(p.price_cents, p.currency)} · {periodicidade(p.interval_months)}
                {p.trial_days > 0 ? ` · ${p.trial_days} ${t("dias de teste")}` : ""}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={ocupado}
                onClick={() =>
                  executar(
                    `/api/v1/admin/cobranca/planos/${p.id}`,
                    "PATCH",
                    { is_active: !p.is_active },
                    p.is_active ? t("Plano desativado.") : t("Plano reativado."),
                  )
                }
              >
                {p.is_active ? t("Desativar") : t("Reativar")}
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Card className="grid gap-3 p-4 sm:grid-cols-5 sm:items-end">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="plano-nome">{t("Nome do plano")}</Label>
          <Input
            id="plano-nome"
            data-testid="plano-nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("Ex.: Essencial")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plano-preco">{t("Preço (R$)")}</Label>
          <Input
            id="plano-preco"
            data-testid="plano-preco"
            inputMode="decimal"
            value={form.preco}
            onChange={(e) => setForm({ ...form, preco: e.target.value })}
            placeholder="199,90"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plano-intervalo">{t("Periodicidade")}</Label>
          <select
            id="plano-intervalo"
            className={SELECT}
            value={form.interval_months}
            onChange={(e) => setForm({ ...form, interval_months: e.target.value })}
          >
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={m}>
                {periodicidade(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plano-teste">{t("Dias de teste")}</Label>
          <Input
            id="plano-teste"
            data-testid="plano-teste"
            type="number"
            min={0}
            max={365}
            value={form.trial_days}
            onChange={(e) => setForm({ ...form, trial_days: e.target.value })}
          />
        </div>
        <Button className="sm:col-span-5 sm:justify-self-end" disabled={ocupado} onClick={criar} data-testid="criar-plano">
          {t("Criar plano")}
        </Button>
      </Card>
    </section>
  );
}

function NovaAssinatura({
  organizacoes,
  planos,
  ocupado,
  executar,
}: {
  organizacoes: Organizacao[];
  planos: Plano[];
  ocupado: boolean;
  executar: Executar;
}) {
  const t = useT();
  const [orgId, setOrgId] = useState("");
  const [planId, setPlanId] = useState("");
  const [vencimento, setVencimento] = useState("");

  if (planos.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Crie um plano para assinar empresas.")}</p>;
  }
  if (organizacoes.length === 0) return null;

  const criar = () => {
    if (!orgId || !planId) {
      toast.error(t("Escolha a empresa e o plano."));
      return;
    }
    executar(
      `/api/v1/admin/cobranca/tenants/${orgId}/assinatura`,
      "POST",
      { plan_id: planId, ...(vencimento ? { primeiro_vencimento: vencimento } : {}) },
      t("Assinatura criada."),
    );
    setOrgId("");
    setVencimento("");
  };

  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-4 sm:items-end" data-testid="nova-assinatura">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assinatura-org">{t("Empresa")}</Label>
        <select id="assinatura-org" className={SELECT} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          <option value="">{t("Escolha…")}</option>
          {organizacoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assinatura-plano">{t("Plano")}</Label>
        <select id="assinatura-plano" className={SELECT} value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">{t("Escolha…")}</option>
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assinatura-vencimento">{t("Primeiro vencimento")}</Label>
        <Input
          id="assinatura-vencimento"
          type="date"
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
        />
      </div>
      <Button disabled={ocupado} onClick={criar} data-testid="criar-assinatura">
        {t("Assinar")}
      </Button>
      <p className="text-xs text-muted-foreground sm:col-span-4">
        {t("Com dias de teste no plano, o primeiro vencimento é o fim do teste.")}
      </p>
    </Card>
  );
}

function LancarFatura({
  orgId,
  vencimento,
  ocupado,
  executar,
}: {
  orgId: string;
  vencimento: string;
  ocupado: boolean;
  executar: Executar;
}) {
  const t = useT();
  const [instrucao, setInstrucao] = useState("");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={`instrucao-${orgId}`} className="text-xs text-muted-foreground">
          {t("Como pagar (Pix, link ou linha digitável) — opcional")}
        </Label>
        <Input
          id={`instrucao-${orgId}`}
          value={instrucao}
          maxLength={1000}
          onChange={(e) => setInstrucao(e.target.value)}
        />
      </div>
      <Button
        size="sm"
        disabled={ocupado}
        data-testid="lancar-fatura"
        onClick={() => {
          executar(
            `/api/v1/admin/cobranca/tenants/${orgId}/faturas`,
            "POST",
            instrucao.trim() ? { instrucao_pagamento: instrucao.trim() } : {},
            t("Fatura lançada."),
          );
          setInstrucao("");
        }}
      >
        {t("Lançar fatura de")} {formatarData(vencimento)}
      </Button>
    </div>
  );
}
