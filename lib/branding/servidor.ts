import { resolveBranding, type Branding } from "@/lib/branding";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";
import { camadaDaInstalacao, camadaDoAmbiente, resolverMarca } from "@/lib/branding/resolve";
import { env } from "@/lib/env";

/**
 * A marca da INSTALAÇÃO para server components que não recebem a do layout raiz.
 *
 * `branding()` lê só o `.env` (`process.env` no servidor). Login, cadastro,
 * `/get-started`, a casca e as boas-vindas da configuração inicial e o texto
 * legal usavam ela — e numa instalação que trocou o nome em `/admin/marca` sem
 * mexer no `APP_NAME` do `.env`, essas telas seguiam dizendo "DeskcommCRM"
 * enquanto a aba, os menus e os e-mails já diziam o nome certo. O aviso da tela
 * de marca prometia que isso se acertava "na próxima atualização da stack", mas
 * nada no kit copia o nome do banco para o `.env`: não se acertava nunca.
 *
 * Mesma pilha do layout raiz e de `marcaDaSaida(null)`: banco acima do `.env`.
 * `marcaDaInstalacao()` é memoizada por TTL no processo, então chamar isto de
 * mais de um componente na mesma requisição não custa consulta a mais.
 *
 * NUNCA lança (CLAUDE.md, "Resolvedor NUNCA lança"): no pior caso devolve o
 * `.env` puro, como estas telas faziam antes, e a tela de entrada — a única por
 * onde se chega para corrigir a marca — continua de pé. O piso é
 * `resolveBranding(env…)`, e não `branding()`: esta, fora do servidor, lê
 * `window.__PUBLIC_ENV__`, e o piso de um resolvedor de servidor não pode
 * depender de onde ele foi importado.
 */
export async function brandingDoServidor(): Promise<Branding> {
  try {
    const marca = resolverMarca(
      [camadaDaInstalacao(await marcaDaInstalacao()), camadaDoAmbiente(env)],
      REGUA_DO_PRODUTO,
    );
    return {
      name: marca.name,
      logoUrl: marca.logoUrl,
      logoDarkUrl: marca.logoDarkUrl,
      initial: marca.initial,
    };
  } catch {
    return resolveBranding(env.APP_NAME, env.APP_LOGO_URL);
  }
}
