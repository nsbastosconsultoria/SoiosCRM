/** Formatação de dinheiro e datas da tela de cobrança — puro, para o servidor e o cliente. */

export function formatarValor(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/**
 * "99,90", "1.234,56", "150" ou "150.5" → centavos. `null` quando não se lê.
 *
 * Com vírgula, ponto é milhar (o jeito brasileiro); sem vírgula, um ponto seguido de 1 ou 2
 * dígitos é decimal (quem digita "150.50" quer cento e cinquenta reais, não quinze mil).
 */
export function valorParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, "");
  if (limpo === "") return null;
  let normal: string;
  if (limpo.includes(",")) normal = limpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(limpo)) normal = limpo;
  else normal = limpo.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Math.round(Number(normal) * 100);
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`, sem passar por `Date` (data civil, sem fuso). */
export function formatarData(data: string | null | undefined): string {
  if (!data) return "—";
  const [y, m, d] = data.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : data;
}
