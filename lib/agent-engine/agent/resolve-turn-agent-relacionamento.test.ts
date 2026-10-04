/**
 * REGRA 0 DO ROTEADOR — o relacionamento do contato decide antes do classificador (spec 21 §7).
 *
 * Com um número só, cliente ativo vai para quem atende cliente mesmo que a mensagem pareça
 * comercial; quem não é cliente segue a classificação de sempre. Os casos medem também o que a
 * regra NÃO pode fazer: mudar algo sem `config.relacionamento`, calar o turno quando o resolvedor
 * falha, reiniciar o roteiro a cada turno, e puxar de volta ao Atendimento um cliente que acabou
 * de ser reclassificado para o Comercial.
 */
import { describe, expect, it, vi } from 'vitest';

import type { SituacaoDeRelacionamento } from '@/lib/carteira/resolvedor';

import { resolveTurnAgent } from './resolve-turn-agent';
import type { PublishedAgentConfig } from './agent-config';
import type { LoadedRouter } from './router-config';
import { lerRegraDeRelacionamento } from './router-config';

function fakeConfig(agentId: string): PublishedAgentConfig {
  return { agentId, versionId: `v-${agentId}` } as PublishedAgentConfig;
}

const membros = [
  {
    agentId: 'agent-comercial',
    intentName: 'comercial',
    intentDescription: 'quer contratar',
    examples: [],
    flowPointerId: 'roteiro-comercial',
  },
  {
    agentId: 'agent-atendimento',
    intentName: 'atendimento',
    intentDescription: 'cliente pedindo algo',
    examples: [],
    flowPointerId: 'roteiro-atendimento',
  },
];

function roteador(relacionamento: LoadedRouter['relacionamento']): LoadedRouter {
  return {
    id: 'router-1',
    name: 'Contabilidade',
    classifierModel: null,
    classifierProvider: null,
    sticky: true,
    minConfidence: 0.6,
    fallbackAgentId: null,
    members: membros,
    relacionamento,
  };
}

const CLIENTE_ATIVO_VAI_AO_ATENDIMENTO = {
  membros: { cliente_ativo: 'atendimento' },
  permiteReclassificar: true,
} as const;

function deps(opcoes: {
  router: LoadedRouter;
  situacao?: SituacaoDeRelacionamento | Error;
  veredito?: { intentName: string | null; confidence: number } | null;
}) {
  const classifyIntent = vi.fn().mockResolvedValue(opcoes.veredito ?? null);
  const resolverRelacionamento = vi.fn(async () => {
    if (opcoes.situacao instanceof Error) throw opcoes.situacao;
    return opcoes.situacao ?? 'desconhecido';
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    classifyIntent,
    resolverRelacionamento,
    log,
    deps: {
      log,
      agenteDaCampanha: vi.fn().mockResolvedValue(null),
      loadActiveRouter: vi.fn().mockResolvedValue(opcoes.router),
      loadPublishedAgentConfigById: vi.fn(async (_db: unknown, _org: unknown, id: string) => fakeConfig(id)),
      loadPublishedAgentConfig: vi.fn().mockResolvedValue(null),
      classifyIntent,
      consultarJev: vi.fn(() => ({
        estado: Promise.resolve('desligada'),
        escolha: Promise.resolve(null),
        observar: vi.fn(),
      })),
      resolverRelacionamento,
    } as never,
  };
}

const entrada = (sobrescrever: Record<string, unknown> = {}) => ({
  tenantId: 'org-1',
  leadId: 'lead-1',
  jobId: 'job-1',
  channelSessionId: 'sess-1',
  conversationId: 'conv-1',
  signal: 'quanto custa a contabilidade?',
  stickyAgentId: null,
  stickyIntent: null,
  ...sobrescrever,
});

describe('regra 0 — relacionamento antes do classificador', () => {
  it('cliente ativo com mensagem que PARECE comercial vai ao Atendimento', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: 'cliente_ativo',
      veredito: { intentName: 'atendimento', confidence: 0.4 },
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('relationship');
    expect(out.config?.agentId).toBe('agent-atendimento');
    expect(out.intentName).toBe('atendimento');
    expect(d.resolverRelacionamento).toHaveBeenCalledWith({}, 'org-1', 'conv-1');
  });

  it('cliente ativo com OUTRA intenção clara vai ao membro dela (cross-sell)', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: 'cliente_ativo',
      veredito: { intentName: 'comercial', confidence: 0.9 },
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada({ signal: 'quero abrir outra empresa' }), d.deps);
    expect(out.outcome).toBe('relationship_overridden');
    expect(out.config?.agentId).toBe('agent-comercial');
    expect(out.confidence).toBe(0.9);
  });

  it('outra intenção com confiança BAIXA não tira o cliente do Atendimento', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: 'cliente_ativo',
      veredito: { intentName: 'comercial', confidence: 0.3 },
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('relationship');
    expect(out.config?.agentId).toBe('agent-atendimento');
  });

  it('sem reclassificação permitida, o classificador nem roda', async () => {
    const d = deps({
      router: roteador({ membros: { cliente_ativo: 'atendimento' }, permiteReclassificar: false }),
      situacao: 'cliente_ativo',
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('relationship');
    expect(d.classifyIntent).not.toHaveBeenCalled();
  });

  it('quem não é cliente segue a classificação de sempre', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: 'desconhecido',
      veredito: { intentName: 'comercial', confidence: 0.9 },
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('classified');
    expect(out.config?.agentId).toBe('agent-comercial');
  });

  it('roteador SEM regra de relacionamento: o resolvedor nem é chamado (instalação sem o módulo)', async () => {
    const d = deps({ router: roteador(null), veredito: { intentName: 'comercial', confidence: 0.9 } });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('classified');
    expect(d.resolverRelacionamento).not.toHaveBeenCalled();
  });

  it('resolvedor que falha não cala o turno: vira desconhecido, com aviso', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: new Error('relation "carteira_perfis" does not exist'),
      veredito: { intentName: 'comercial', confidence: 0.9 },
    });
    const out = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(out.outcome).toBe('classified');
    expect(out.config?.agentId).toBe('agent-comercial');
    expect(d.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('relacionamento não lido'),
      expect.objectContaining({ routerId: 'router-1' }),
    );
  });

  it('cliente reclassificado para o Comercial NÃO volta ao Atendimento na mensagem seguinte sem intenção clara', async () => {
    const d = deps({
      router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO),
      situacao: 'cliente_ativo',
      veredito: { intentName: null, confidence: 0.2 },
    });
    const out = await resolveTurnAgent(
      {} as never,
      {} as never,
      entrada({ signal: 'é no ramo de marketing', stickyAgentId: 'agent-comercial', stickyIntent: 'comercial' }),
      d.deps,
    );
    expect(out.outcome).toBe('sticky');
    expect(out.config?.agentId).toBe('agent-comercial');
  });

  it('a regra 0 repetida turno a turno não reinicia o roteiro do Atendimento', async () => {
    const d = deps({ router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO), situacao: 'cliente_ativo' });
    const primeiro = await resolveTurnAgent({} as never, {} as never, entrada(), d.deps);
    expect(primeiro.flowPointerId).toBe('roteiro-atendimento');
    const seguinte = await resolveTurnAgent(
      {} as never,
      {} as never,
      entrada({ stickyAgentId: 'agent-atendimento', stickyIntent: 'atendimento' }),
      d.deps,
    );
    expect(seguinte.outcome).toBe('relationship');
    expect(seguinte.flowPointerId).toBeNull();
  });

  it('follow-up (sem mensagem) de cliente ativo vai ao membro da situação, sem classificar', async () => {
    const d = deps({ router: roteador(CLIENTE_ATIVO_VAI_AO_ATENDIMENTO), situacao: 'cliente_ativo' });
    const out = await resolveTurnAgent({} as never, {} as never, entrada({ signal: null }), d.deps);
    expect(out.outcome).toBe('relationship');
    expect(d.classifyIntent).not.toHaveBeenCalled();
  });
});

describe('lerRegraDeRelacionamento — leitura defensiva do config', () => {
  const intencoes = ['comercial', 'atendimento'];

  it('lê situação → intenção e o padrão de reclassificar (ligado)', () => {
    expect(lerRegraDeRelacionamento({ cliente_ativo: 'atendimento' }, intencoes)).toEqual({
      membros: { cliente_ativo: 'atendimento' },
      permiteReclassificar: true,
    });
  });

  it('intenção que não é de nenhum membro é ignorada; nada sobrando = sem regra', () => {
    expect(lerRegraDeRelacionamento({ cliente_ativo: 'sumiu' }, intencoes)).toBeNull();
  });

  it('forma errada não derruba: vira sem regra', () => {
    for (const ruim of [null, undefined, 'x', 3, [], { cliente_ativo: 42 }]) {
      expect(lerRegraDeRelacionamento(ruim, intencoes)).toBeNull();
    }
  });

  it('respeita permite_reclassificar = false', () => {
    expect(
      lerRegraDeRelacionamento({ cliente_ativo: 'atendimento', permite_reclassificar: false }, intencoes)
        ?.permiteReclassificar,
    ).toBe(false);
  });
});
