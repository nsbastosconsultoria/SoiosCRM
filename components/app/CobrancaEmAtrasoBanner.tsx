/**
 * A FATURA ESTÁ EM ATRASO — a faixa da carência (módulo `cobranca`).
 *
 * Aparece em toda tela de `/app` enquanto a assinatura está `past_due`, e diz o que acontece e
 * quando: "o acesso às telas será suspenso em DD/MM". Sem ela, a suspensão do 8º dia chegaria
 * como surpresa — e a carência só tem valor se quem paga souber que ela está correndo.
 *
 * Só para o papel `admin` da organização: é quem responde pelo pagamento. Mostrar dívida da
 * empresa ao atendente não ajuda a pagá-la.
 *
 * Client pela mesma razão de `ConexaoCaidaBanner`: fica dentro do `IdiomaProvider` e lê o papel
 * de `useAuth`; os dados chegam prontos do layout.
 */
"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { ROLE_RANK } from "@/lib/auth/types";
import type { AvisoDeCobranca } from "@/lib/cobranca/aviso";
import { formatarData, formatarValor } from "@/lib/cobranca/formato";

export function CobrancaEmAtrasoBanner({ aviso }: { aviso: AvisoDeCobranca | null }) {
  const t = useT();
  const { activeOrg } = useAuth();
  if (!aviso || aviso.situacao !== "past_due") return null;
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) return null;

  return (
    <div
      role="status"
      data-testid="faixa-cobranca-em-atraso"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warning-bg px-4 py-2 text-sm text-warning-fg"
    >
      <span className="font-medium">
        {t("Fatura em atraso")}: {formatarValor(aviso.valorCents, aviso.moeda)} · {t("venceu em")}{" "}
        {formatarData(aviso.vencimento)}.
      </span>
      {aviso.suspendeEm && (
        <span>
          {t("Sem o pagamento, o acesso às telas será suspenso em")} {formatarData(aviso.suspendeEm)}.
        </span>
      )}
      {aviso.instrucao && (
        <span className="min-w-0 break-all">
          {t("Como pagar")}: <span className="font-mono">{aviso.instrucao}</span>
        </span>
      )}
    </div>
  );
}
