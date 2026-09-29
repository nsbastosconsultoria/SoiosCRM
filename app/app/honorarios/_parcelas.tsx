"use client";
/**
 * Parcelas de um contrato de honorários — o calendário de pagamento.
 *
 * Pagar NÃO cria uma tabela de "pagamento" própria do módulo (DIRC "integrar"):
 * a rota cria um `financial_entries` do caixa núcleo e liga por
 * `financial_entry_id`. Por isso pagar pede uma CONTA, a mesma lista do
 * catálogo financeiro usada em Faturamento.
 *
 * "Como pagar" (migration 0485) é o texto que o escritório cola — link do
 * boleto, Pix copia-e-cola ou linha digitável — e que o agente financeiro
 * repassa ao cliente sem alterar. Só parcela pendente se edita: a paga não
 * muda, e a RLS da 0480 é quem garante isso.
 */
import { Fragment, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { randomId } from "@/lib/random-id";

type Parcela = {
  id: string;
  contrato_id: string;
  numero: number;
  vencimento: string;
  valor_cents: number;
  financial_entry_id: string | null;
  status: "pendente" | "pago";
  /** Ausente quando o módulo ainda não foi reaplicado depois da migration 0485. */
  instrucao_pagamento?: string | null;
};

type Conta = { id: string; name: string };

export function Parcelas({
  contratoId,
  podeGerenciar,
}: {
  contratoId: string;
  podeGerenciar: boolean;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  const [contaId, setContaId] = useState("");

  const parcelas = useQuery({
    queryKey: ["honorarios", "parcelas", contratoId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Parcela[] }>(
          `/api/v1/honorarios/contratos/${contratoId}/parcelas`,
        )
      ).data,
  });

  const contas = useQuery({
    queryKey: ["financeiro", "catalogo", "contas"],
    queryFn: async () =>
      (await apiClient.get<{ data: Conta[] }>("/api/v1/financeiro/catalogo/contas")).data,
    enabled: podeGerenciar,
  });

  const recarregar = () =>
    qc.invalidateQueries({ queryKey: ["honorarios", "parcelas", contratoId] });

  const criar = useMutation({
    mutationFn: (corpo: Record<string, unknown>) =>
      apiClient.post(`/api/v1/honorarios/contratos/${contratoId}/parcelas`, corpo),
    onSuccess: recarregar,
    onError: showApiError,
  });

  // Uma chave por (parcela, conta) enquanto o pagamento não termina: o segundo
  // clique, ou o retry depois de a rede cair, leva a MESMA chave e o servidor
  // devolve o recibo do primeiro em vez de lançar de novo no caixa.
  const chavesDoPagamento = useRef(new Map<string, string>());
  const chaveDoPagamento = (id: string) => {
    const alvo = `${id}:${contaId}`;
    let chave = chavesDoPagamento.current.get(alvo);
    if (!chave) {
      chave = randomId();
      chavesDoPagamento.current.set(alvo, chave);
    }
    return chave;
  };

  const pagar = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(
        `/api/v1/honorarios/parcelas/${id}/pagar`,
        { account_id: contaId },
        { idempotencyKey: chaveDoPagamento(id) },
      ),
    onSuccess: (_resposta, id) => {
      chavesDoPagamento.current.delete(`${id}:${contaId}`);
      return recarregar();
    },
    onError: showApiError,
  });

  const [editando, setEditando] = useState<string | null>(null);
  const salvarInstrucao = useMutation({
    mutationFn: ({ id, texto }: { id: string; texto: string }) =>
      apiClient.patch(`/api/v1/honorarios/parcelas/${id}`, { instrucao_pagamento: texto }),
    onSuccess: () => {
      setEditando(null);
      return recarregar();
    },
    onError: showApiError,
  });

  const lista = parcelas.data ?? [];
  const proximoNumero = lista.reduce((max, p) => Math.max(max, p.numero), 0) + 1;

  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="mb-2 text-sm font-semibold">{t("Parcelas")}</h2>

      {podeGerenciar ? (
        <FormularioDeParcela
          proximoNumero={proximoNumero}
          criando={criar.isPending}
          onCriar={(corpo) => criar.mutate(corpo)}
        />
      ) : null}

      {podeGerenciar ? (
        <label className="mb-2 flex flex-col gap-1 text-xs text-text-muted">
          {t("Conta para receber o pagamento")}
          <select
            value={contaId}
            data-testid="parcela-conta"
            onChange={(e) => setContaId(e.target.value)}
            className="w-64 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          >
            <option value="">{t("Escolha")}</option>
            {(contas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {lista.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhuma parcela ainda.")}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {lista.map((p) => (
              <Fragment key={p.id}>
                <tr className="border-b border-border/60" data-testid={`parcela-${p.id}`}>
                  <td className="py-1 text-text-muted">#{p.numero}</td>
                  <td className="py-1">{new Date(p.vencimento).toLocaleDateString(tagDoIdioma)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCents(p.valor_cents, "BRL")}
                  </td>
                  <td className="py-1 text-right text-xs text-text-muted">
                    {p.status === "pago" ? t("pago") : t("pendente")}
                  </td>
                  <td className="w-24 py-1 text-right">
                    {podeGerenciar && p.status === "pendente" ? (
                      <button
                        type="button"
                        disabled={!contaId || pagar.isPending}
                        onClick={() => pagar.mutate(p.id)}
                        className="text-xs text-accent disabled:opacity-50"
                        data-testid={`pagar-parcela-${p.id}`}
                      >
                        {t("Pagar")}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {editando === p.id ? (
                  <tr className="border-b border-border/60">
                    <td colSpan={5} className="py-2">
                      <EditorDeInstrucao
                        inicial={p.instrucao_pagamento ?? ""}
                        salvando={salvarInstrucao.isPending}
                        onCancelar={() => setEditando(null)}
                        onSalvar={(texto) => salvarInstrucao.mutate({ id: p.id, texto })}
                      />
                    </td>
                  </tr>
                ) : p.instrucao_pagamento || (podeGerenciar && p.status === "pendente") ? (
                  <tr className="border-b border-border/60">
                    <td colSpan={5} className="pb-2 text-xs text-text-muted">
                      {p.instrucao_pagamento ? (
                        <span className="mr-2 break-all" data-testid={`instrucao-parcela-${p.id}`}>
                          {t("Como pagar")}: {p.instrucao_pagamento}
                        </span>
                      ) : null}
                      {podeGerenciar && p.status === "pendente" ? (
                        <button
                          type="button"
                          onClick={() => setEditando(p.id)}
                          className="text-accent"
                          data-testid={`editar-instrucao-${p.id}`}
                        >
                          {p.instrucao_pagamento ? t("Alterar") : t("Informar como pagar")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FormularioDeParcela({
  proximoNumero,
  criando,
  onCriar,
}: {
  proximoNumero: number;
  criando: boolean;
  onCriar: (corpo: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [numero, setNumero] = useState(String(proximoNumero));
  const [vencimento, setVencimento] = useState("");
  const [valor, setValor] = useState("");

  const cents = parseReaisToCents(valor);
  const pode = !criando && Number(numero) > 0 && vencimento !== "" && cents !== null;

  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-2 border-b border-border pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pode) return;
        onCriar({ numero: Number(numero), vencimento, valor_cents: cents });
        setNumero(String(proximoNumero + 1));
        setVencimento("");
        setValor("");
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Número")}
        <input
          value={numero}
          type="number"
          min={1}
          data-testid="parcela-numero"
          onChange={(e) => setNumero(e.target.value)}
          className="w-16 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Vencimento")}
        <input
          type="date"
          value={vencimento}
          data-testid="parcela-vencimento"
          onChange={(e) => setVencimento(e.target.value)}
          className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Valor")}
        <input
          value={valor}
          inputMode="decimal"
          placeholder="0,00"
          data-testid="parcela-valor"
          onChange={(e) => setValor(e.target.value)}
          className="w-28 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>

      <Button type="submit" disabled={!pode} data-testid="criar-parcela">
        {t("Adicionar parcela")}
      </Button>
    </form>
  );
}

/**
 * O texto vai como o escritório escreveu — sem máscara nem validação de
 * formato: link, Pix copia-e-cola e linha digitável são três formas diferentes,
 * e o agente só repassa. O teto de 1000 caracteres é o do CHECK da 0485.
 */
function EditorDeInstrucao({
  inicial,
  salvando,
  onCancelar,
  onSalvar,
}: {
  inicial: string;
  salvando: boolean;
  onCancelar: () => void;
  onSalvar: (texto: string) => void;
}) {
  const t = useT();
  const [texto, setTexto] = useState(inicial);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!salvando) onSalvar(texto);
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Como pagar esta parcela (link do boleto, Pix copia-e-cola ou linha digitável)")}
        <textarea
          value={texto}
          maxLength={1000}
          rows={3}
          data-testid="instrucao-pagamento"
          onChange={(e) => setTexto(e.target.value)}
          className="rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
        />
      </label>
      <p className="text-xs text-text-muted">
        {t(
          "O assistente envia este texto ao cliente exatamente como está. Deixe em branco para apagar.",
        )}
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={salvando} data-testid="salvar-instrucao">
          {t("Salvar")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar}>
          {t("Cancelar")}
        </Button>
      </div>
    </form>
  );
}
