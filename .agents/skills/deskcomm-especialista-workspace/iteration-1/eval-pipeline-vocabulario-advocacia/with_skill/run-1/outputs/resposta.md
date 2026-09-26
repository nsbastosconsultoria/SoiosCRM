## Briefing pré-implementação: pipeline dedicado para escritório de advocacia (etapas + vocabulário jurídico)

### O que muda
Nenhum código novo é necessário para o caso comum: `crm_pipelines.vocabulary` (jsonb) e
`crm_pipelines.settings.fields` (custom fields declarativos) já existem no schema exatamente
para isto — trocar `lead`/`deal`/`won`/`lost` por `cliente`/`caso`/`contrato assinado`/`perdido`
e desenhar etapas próprias é configuração pela tela **Configurações › Etapas do funil**
(`app/app/settings/tenant/pipelines/`), não uma feature nova. A única lacuna real é **criar um
funil ADICIONAL** (um segundo board, paralelo ao que já existe) — isso não tem botão na UI hoje,
só API. Duas rotas distintas dependendo do cenário — ver "Plano de implementação".

### Doutrina aplicável (o que foi lido, não o que foi lembrado)
- `CLAUDE.md` › Modelagem: `vocabulary jsonb em pipeline permite renomear lead/deal/won/lost` e
  `custom_fields jsonb com schema declarativo em pipeline.settings.fields; Zod construído
  dinamicamente` — é literalmente o mecanismo que resolve o pedido.
- `CLAUDE.md` › Doutrina DIRC: os campos jurídicos do caso (área do direito, número do processo,
  valor da causa) são **Integrar/Referenciar via `custom_fields`**, não colunas novas em
  `crm_leads` — não há nada nesta tarefa que justifique fugir do padrão declarativo já existente.
- `docs/doctrine/extensoes.md` (pergunta-teste): "se nenhuma organização ativar isto, a operação
  comum continua inteira?" — aplicada abaixo, em "Núcleo, extensão, ambos ou infraestrutura".
- Li também `docs/prd/04-prd-pipeline-attendance.md` (§3.2, "Multi-pipeline desde o schema") —
  ver divergência PRD-vs-implementado na próxima seção, é o achado mais importante desta leitura.

### Estado atual relevante
Não confiei em `docs/current-state.md`/`docs/harness-audit.md` de cabeça — abri os dois: ambos
são retratos datados (o primeiro de 2026-07-29, "789dfa6", 1000+ commits atrás) e dizem
explicitamente para remedir na fonte em vez de confiar na prosa. Nenhum dos dois fala de
pipelines/vocabulary especificamente, então remedi direto no código:

- **A tela de edição está completa e é o caminho certo.** `app/app/settings/tenant/pipelines/`
  lista TODOS os funis não-arquivados da org (`_client.tsx`), e por funil oferece:
  - `StagesSection` (`_stages.tsx`, 744 linhas): criar etapa, renomear, arquivar (não existe
    "excluir" — `crm_leads_stage_id_fkey` é `ON DELETE RESTRICT`, apagar perderia histórico),
    reordenar (setas, fractional indexing), e marcar o "papel" da etapa — `Aqui o cliente fecha`
    (`is_won`) ou `Aqui o cliente desiste` (`is_lost`). Exige **manager+**.
  - `PipelineEditor` dentro de `_client.tsx`: 4 campos de texto (`lead`, `deal`, `won`, `lost`) que
    gravam em `crm_pipelines.vocabulary`, mais um builder de custom fields (`key`, `label`, `type`
    — `text/textarea/number/date/select/multiselect/boolean/email/phone/url` — até 50 campos) e
    motivos de perda. Grava via `app/actions/settings/updatePipelineConfig.ts`. Exige **admin**
    (a action recusa no servidor mesmo que alguém force o request; a UI só renderiza a seção para
    quem tem o papel — "esconder o que a ação recusaria é honestidade, não permissão nova", cito o
    comentário do próprio arquivo).
- **Criar um funil NOVO não tem UI.** `POST /api/v1/pipelines` existe, exige **manager+**, recebe
  só `{ name, description }` e cria o funil com 4 etapas genéricas fixas (`Novo`, `Em andamento`,
  `Ganho`, `Perdido` — `ETAPAS_INICIAIS` em `lib/pipelines/pipeline-editing.ts`) e **sem**
  vocabulário nenhum (`vocabulary` fica com o que o baseline semeia por padrão, tipicamente os
  termos de e-commerce). Nenhum componente de tela chama essa rota — só existe em testes. O
  próprio comentário do `_client.tsx` avisa: *"Criar funil não é feito por nenhuma tela, rota ou
  action deste produto — só por script de instalação"*. Essa frase está um passo desatualizada
  (a rota REST existe), mas o efeito prático que ela descreve é real: **não há botão**.
- **`docs/prd/04-prd-pipeline-attendance.md` promete mais do que existe.** A spec diz
  literalmente: *"`manager`+ pode criar pipeline novo via UI (nome + vocabulary + stages + custom
  fields), com audit"*. O que está construído hoje cria só nome+etapas genéricas, sem vocabulary
  nem custom fields no ato da criação — quem quiser os dois preenche depois, na mesma tela de
  edição. Isso é uma divergência PRD-vs-código que vale registrar se este trabalho virar PR (item
  16 da Definition of Done), mas **não bloqueia** o pedido do usuário: dá pra chegar no resultado
  final, só que em dois passos (criar funil "pelado" + editar) em vez de um.
- **Nenhum caminho automático grava vocabulário.** Nem `POST /api/v1/pipelines`, nem o assistente
  de onboarding (`fn_aplicar_quadro_do_onboarding`, que só reescreve nome do funil e etapas) tocam
  a coluna `vocabulary`. Isso está documentado no próprio código-fonte
  (`lib/pipelines/pipeline-editing.ts`, comentário perto de `ETAPAS_INICIAIS`): "quem escreve é só
  a tela Etapas do funil, à mão". Ou seja: **não existe atalho** — o vocabulário jurídico
  (cliente/caso) sempre passa pela tela de configuração, manual, uma vez por funil.
- **Sugestão de onboarding já reconhece "advocacia".** `lib/onboarding/sugerir-funil.ts` tem uma
  regex de pistas que inclui `advocac|advogad` e cai no pacote `servicos` ("Serviços, agência ou
  obra": Pedido novo → Já respondi → Entendendo o projeto → Orçamento enviado → Negociando →
  Fechou/Não fechou). Isso só roda no **wizard de onboarding de uma organização nova** (passo
  "monte o quadro", chama a IA do agente publicado e cai nesse pacote como fallback se a IA
  falhar) — não é um caminho para adicionar um funil extra numa org que já opera. E mesmo esse
  caminho não seta vocabulário nem nomes exatamente iguais aos pedidos ("Consulta agendada",
  "Proposta enviada", "Contrato assinado") — a IA pode chegar perto se a descrição do negócio for
  detalhada, mas o pacote de fallback usa nomes genéricos de serviços, não os termos jurídicos.

### Padrões a seguir
- UI/UX: reaproveitar 100% dos componentes já existentes — `shadcn/ui` `Input`, `Select`,
  `Button`, `Card` já usados em `_stages.tsx`/`_client.tsx`; nenhuma tela nova, nenhum componente
  novo. `TIPOS_DE_CAMPO` deriva do `customFieldSchema.shape.type.options` — ao escolher tipos para
  os campos jurídicos, usar exatamente esses valores (`select` para "Área do direito",
  `text`/`number` para número do processo/valor da causa, `date` para prazos), nunca inventar um
  tipo novo sem primeiro estender o schema.
- Vocabulário: os 4 campos são fixos (`lead`, `deal`, `won`, `lost`) — não existe um quinto slot.
  "Cliente"/"Caso" mapeiam direto para `lead`/`deal`; `won`/`lost` seguem livres em texto
  (ex.: "Contrato assinado" / "Não fechou").
- Etapas: o "papel" de uma etapa (`Papel` type em `_stages.tsx`: `nenhum | won | lost`) é
  exclusivo — uma etapa não pode ser as duas coisas ao mesmo tempo, e a API recusa arquivar a
  última etapa `is_won` (erro `pipeline_no_won_stage`) porque isso deixaria o funil incapaz de
  fechar negócio. Ao desenhar "Consulta agendada → Proposta enviada → Contrato assinado", a
  etapa final ("Contrato assinado") é quem recebe o papel `won`; é preciso manter (ou criar) pelo
  menos uma etapa com papel `lost` também (ex.: "Não fechou"/"Caso perdido") — o funil de origem
  já tem uma, então normalmente basta renomeá-la em vez de apagá-la.

### Núcleo, extensão, ambos ou infraestrutura
**Núcleo**, sem ressalva. A pergunta de `docs/doctrine/extensoes.md` é "se nenhuma organização
ativar isto, a operação comum continua inteira?" — aqui não há nada para "ativar": vocabulário
por pipeline e custom fields por pipeline já são capacidade **sempre presente** do produto desde
o schema (toda organização tem `crm_pipelines.vocabulary` e `.settings.fields` disponíveis, com ou
sem uso). Configurar um funil jurídico para um tenant não muda comportamento de nenhum outro
tenant nem exige capacidade nomeada — é uso comum da tela de Configurações. Não há caso para
`deskcomm-extensao` aqui.

### Riscos de compatibilidade self-host/open-source
- **Sem migration, sem schema novo.** `vocabulary` e `settings.fields` já existem no baseline;
  nada aqui exige `ALTER TABLE` nem apêndice em `baseline.sql`.
- **Criar o funil via API sem UI é o único ponto de atrito real do self-host.** `POST
  /api/v1/pipelines` não está em `lib/auth/public-paths.ts` nem usa `lib/api/auth-dual.ts` — ou
  seja, o proxy só aceita **cookie de sessão**, não `Authorization: Bearer dsk_...`. Um dono de
  instalação leigo não tem como chamar essa rota por `curl` com um token de API; teria que estar
  logado no navegador e disparar o `fetch` manualmente (DevTools) ou pedir a alguém técnico.
  Isso não é um bloqueio para o cenário mais comum (reconfigurar o funil que a organização já
  tem), mas é um bloqueio real para quem precisa de um **segundo** funil paralelo. Se isso vier a
  incomodar de verdade, o conserto certo — fora do escopo desta tarefa, mas vale registrar — é uma
  tela "Criar funil" chamando a rota que já existe, o que fecharia também a divergência com o PRD
  (`docs/prd/04-prd-pipeline-attendance.md`) citada acima.
- **Nenhuma env var nova, nenhum Dockerfile/compose tocado.**
- **Sem tela nova, então sem entrada em `lib/navigation/catalogo.ts`** — a porta
  "Configurações › Etapas do funil" já existe e já está no catálogo.

### Plano de implementação
Dois casos, dependendo do que o usuário já tem hoje:

**Caso A — a organização só atende o escritório de advocacia (funil único a reconfigurar).**
Nenhuma chamada de API é necessária.
1. Entrar como **admin** em Configurações › Etapas do funil (`/app/settings/tenant/pipelines`).
2. Na seção **Etapas** do funil existente: renomear as etapas atuais e adicionar as que faltarem
   até formar a sequência desejada, por exemplo `Novo contato → Consulta agendada → Proposta
   enviada → Contrato assinado (papel: Aqui o cliente fecha) → Não fechou (papel: Aqui o cliente
   desiste)`. Usar os botões de seta para ordenar; "Adicionar etapa" para as novas.
3. Na seção **Vocabulário e campos** (só aparece para admin): preencher `Lead → Cliente`,
   `Deal → Caso`, `Won → Contrato assinado` (ou "Fechado"), `Lost → Não fechou`.
4. Adicionar os custom fields do caso jurídico em "Campos do lead neste funil": por exemplo
   `area_direito` (select: Cível, Trabalhista, Tributário, Família, Criminal…),
   `numero_processo` (text), `valor_causa` (number), `instancia` (select), `prazo_proximo` (date).
5. Salvar. A mudança é imediata e por tenant — não afeta outras organizações.

**Caso B — a organização já opera outro(s) negócio(s) e precisa de um funil PARALELO,
dedicado ao jurídico, sem mexer no que já existe.**
1. Criar o funil pela API (não há botão): `POST /api/v1/pipelines` com sessão de **manager+**
   autenticada por cookie, corpo `{ "name": "Casos jurídicos" }`. Nasce com 4 etapas genéricas e
   sem vocabulário.
2. A partir daqui, é o mesmo roteiro do Caso A: o funil novo aparece automaticamente na tela
   Configurações › Etapas do funil (a query já lista todos os não-arquivados) — repetir os passos
   2-5 nele.
3. Se este segundo funil também precisar aparecer no seletor de origem de um Webhook Source ou
   automação, checar `app/api/v1/pipelines/route.ts` (GET) — já devolve todos os funis da org, sem
   trabalho extra.

Em qualquer um dos dois casos, se o objetivo maior for "montar o cliente novo" por completo
(agente de IA, roteador, follow-ups, base de conhecimento — não só o quadro), o próximo passo
natural é carregar a skill `deskcomm-cliente-novo`, que cobre esse pacote inteiro na ordem certa;
esta tarefa cobre só a peça de pipeline/vocabulário que ela pediu.
