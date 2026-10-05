"use client";
/**
 * "Quem já é cliente" — a regra de relacionamento do roteador (spec 21 §7), com o módulo carteira.
 *
 * Com um número só, a pergunta antes de "o que a pessoa quer" é "quem está escrevendo": cliente
 * ativo vai direto para a intenção escolhida aqui (em geral, o Atendimento), mesmo que a mensagem
 * pareça comercial. Salva sozinha, em `config.relacionamento` — o PATCH do roteador mescla o
 * `config`, então isto não toca classificador, sticky nem confiança mínima.
 *
 * Aponta pelo NOME da intenção, e só oferece intenções JÁ SALVAS: uma recém-digitada ainda não
 * existe no roteador, e o motor ignora nome que não é de nenhum membro.
 */
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useUpdateRouter } from "@/hooks/ai/useRouters";
import { useT } from "@/hooks/i18n/useT";

type Regra = { cliente_ativo?: string; permite_reclassificar?: boolean };

function regraDe(config: Record<string, unknown> | null | undefined): Regra {
  const bruto = config?.relacionamento;
  return bruto !== null && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Regra) : {};
}

const CAMPO = "w-full rounded-md border border-border bg-background p-2 text-sm";

export function RegraDeRelacionamento({
  routerId,
  config,
  intencoesSalvas,
  podeGerenciar,
}: {
  routerId: string;
  config: Record<string, unknown> | null | undefined;
  intencoesSalvas: readonly string[];
  podeGerenciar: boolean;
}) {
  const t = useT();
  const salva = regraDe(config);
  const [intencao, setIntencao] = React.useState(salva.cliente_ativo ?? "");
  const [reclassificar, setReclassificar] = React.useState(salva.permite_reclassificar ?? true);
  const atualizar = useUpdateRouter(routerId);

  const mudou =
    intencao !== (salva.cliente_ativo ?? "") || reclassificar !== (salva.permite_reclassificar ?? true);

  async function salvar() {
    try {
      await atualizar.mutateAsync({
        config: {
          relacionamento: intencao ? { cliente_ativo: intencao, permite_reclassificar: reclassificar } : null,
        },
      });
      toast.success(t("Regra de clientes salva."));
    } catch (err) {
      showApiError(err);
    }
  }

  return (
    <Card className="space-y-3 p-4" data-testid="regra-de-relacionamento">
      <h3 className="text-sm font-medium">{t("Quem já é cliente")}</h3>
      <p className="text-xs text-muted-foreground">
        {t(
          "Pela carteira de empresas, o roteador reconhece quem já é cliente antes de olhar a mensagem e manda direto para a intenção escolhida.",
        )}
      </p>
      <div className="space-y-1">
        <Label htmlFor="router-cliente-ativo">{t("Cliente ativo vai para")}</Label>
        <select
          id="router-cliente-ativo"
          value={intencao}
          disabled={!podeGerenciar}
          data-testid="router-cliente-ativo"
          onChange={(e) => setIntencao(e.target.value)}
          className={CAMPO}
        >
          <option value="">{t("Não usar — classificar a mensagem como sempre")}</option>
          {intencoesSalvas.map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={reclassificar}
          disabled={!podeGerenciar || !intencao}
          data-testid="router-permite-reclassificar"
          onChange={(e) => setReclassificar(e.target.checked)}
          className="mt-1"
        />
        <span>
          {t("Se o cliente pedir outra coisa com clareza (ex.: abrir outra empresa), seguir a intenção dele")}
        </span>
      </label>
      {podeGerenciar ? (
        <Button size="sm" disabled={!mudou || atualizar.isPending} onClick={() => void salvar()}>
          {t("Salvar regra de clientes")}
        </Button>
      ) : null}
    </Card>
  );
}
