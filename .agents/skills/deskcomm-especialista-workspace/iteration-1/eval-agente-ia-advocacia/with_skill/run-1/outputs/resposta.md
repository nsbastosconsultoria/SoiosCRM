# Briefing pré-implementação: agente de IA para escritório de advocacia trabalhista (qualificação + urgência + agenda com o advogado da área)

## O que muda

Nenhuma linha de código muda. Isto é uma **configuração de tenant** — o mesmo caminho que
`deskcomm-cliente-novo` percorre para clínica, imobiliária ou loja, só que para um nicho
("advocacia trabalhista") que ainda não tem pacote pronto em `references/nichos.md`. O
resultado é: um agente de IA publicado que faz o diagnóstico do caso trabalhista, decide a
urgência pelas respostas da própria conversa, e marca a "primeira reunião" já vinculada ao
advogado responsável pela área — usando mecanismo que o produto já tem (tipo de atendimento
com dono), não um recurso novo.

## Doutrina aplicável (o que foi lido, não o que foi lembrado)

- `CLAUDE.md` — Doutrina DIRC (antes de adicionar campo) e `custom_fields jsonb` com schema
  declarativo em `pipeline.settings.fields`: é o padrão que resolve "área do direito" e
  "urgência" sem tabela nova.
- `.agents/skills/deskcomm-cliente-novo/SKILL.md` + `references/triagem.md` +
  `references/nichos.md` + `references/pela-tela.md` + `references/prompt-do-agente.md` — o
  roteiro tela a tela e a anatomia do prompt. `nichos.md` **não tem** pacote de advocacia;
  o mais próximo é "Serviços, agência ou obra" (diagnóstico → orçamento → decisão) e o
  genérico "Outro tipo de negócio".
- Código lido diretamente (porque `docs/current-state.md` é retrato de julho/2026 e lista
  "templates por nicho" como **não iniciado** — desatualizado; o mecanismo abaixo já existe
  e está em uso):
  - `lib/agenda/consulta.ts` (coluna `default_owner_user_id` por tipo de atendimento) e
    `lib/mcp/tools/agendamento.ts` (`owner_user_id` opcional em `crm_book_appointment` /
    `crm_find_and_book_appointment` / `crm_find_free_slots`) — é como o produto já resolve
    "reunião com a pessoa certa".
  - `lib/mcp/tools/operacao.ts` (`crm_list_team_members`) — **não devolve nome nem e-mail**
    à IA, só `user_id`/papel. Consequência direta para o plano abaixo.
  - `lib/mcp/tools/leads.ts` (`crm_update_lead` aceita `custom_fields` como
    `z.record(z.string(), z.unknown())`) — é o que grava "área do direito" e "urgência".
  - `lib/mcp/tools/escalacao.ts` / `handoff.ts` (`crm_request_human_handoff`,
    `crm_close_human_case` etc.) — é a família de "casos" que a doutrina de sistema vivo
    exige para caso urgente não esperar a agenda.
  - `lib/leads/campos-do-funil.ts` + `lib/schemas/settings.ts`
    (`customFieldSchema`/`CustomFieldDef`) — o schema declarativo de campo personalizado.

## Estado atual relevante

`docs/current-state.md` (retrato de 2026-07-29, ele mesmo avisa que apodrece) lista
"templates por nicho (clínica, imobiliária, infoproduto, serviços)" em "Próximo no
roadmap — não iniciado". Isso é sobre o **pacote documentado** em `references/nichos.md`
(que de fato não cobre advocacia), não sobre a capacidade do produto: a leitura de código
acima confirma que agenda com dono por tipo de atendimento, campos personalizados por
pipeline e abertura de caso humano já existem e são usados por outros nichos hoje. Não há
gap de produto para cumprir o pedido — há um pacote de nicho que falta escrever, e isso é
justamente o papel desta sessão, feito como config, não como código.

## Padrões a seguir

**Agente de IA — contrato de nicho/prompt já estabelecido:**

- Funil próprio no vocabulário do nicho (`crm_pipelines`/`crm_stages`, exatamente uma etapa
  "ganhou" e uma "perdeu"), como os cinco pacotes existentes.
- Diagnóstico antes da oferta, uma pergunta por vez — não pular para "vamos marcar".
- **Área do direito e urgência viram `custom_fields` do lead**, não coluna nova (DIRC:
  "Calcular/Referenciar" antes de "Duplicar" — a doutrina de schema do `CLAUDE.md` proíbe
  exatamente o oposto disso). O agente pergunta na conversa e grava via `crm_update_lead`.
- **A reunião com "o advogado responsável pela área" é resolvida pelo *tipo de atendimento*,
  não pelo agente escolhendo uma pessoa por nome.** `crm_list_team_members` deliberadamente
  esconde nome/e-mail do modelo (comentário no código: "o agente precisa saber a quem
  direcionar, não a identidade pessoal de cada um"). O roteamento correto é: um tipo de
  atendimento por área (ex.: "Consulta – Rescisão e Verbas", "Consulta – Acidente de
  Trabalho e Insalubridade", "Consulta – Assédio Moral/Sexual", "Consulta – Horas
  Extras/Equiparação"), cada um com `default_owner_user_id` = o `user_id` do advogado
  daquela área, cadastrado por quem administra a organização em **Agenda ›
  Tipos de atendimento**. O agente lê `crm_list_event_types` (nome + descrição, nunca
  inventa slug), casa a área diagnosticada com o `event_type_slug` certo, e chama
  `crm_find_free_slots` / `crm_find_and_book_appointment` — o dono vem do tipo, não de o
  agente "saber" quem é o Dr. Fulano.
- Casos graves (prazo prescricional próximo, acidente em andamento, demissão iminente):
  **não é o agente que decide sozinho o que fazer com a urgência além de agendar** — a
  doutrina de sistema vivo (nenhuma demanda sem próximo passo garantido) pede que urgência
  alta também abra um `crm_request_human_handoff`/caso, para a Central de Avisos e a fila
  humana verem que existe algo que não pode esperar a data da reunião. Isso é a capacidade
  crítica "casos" ligada no agente (`pela-tela.md` passo 7), explicada à pessoa antes de
  ligar — nunca ligada por padrão sem ela entender o que abre.
- Prompt segue o esqueleto de `references/prompt-do-agente.md`: identidade, diagnóstico,
  decisão, situações, limites, estilo — **sem** repetir portões que o motor já impõe (não
  inventar preço, não confirmar agenda sem ferramenta, apresentar-se como assistente), e
  **sem** vocabulário interno (nunca "lead", "etapa qualificando", nomes de ferramenta).

**Esqueleto preenchido (ponto de partida — a triagem real com o escritório ainda decide os
detalhes: nome do escritório, áreas que atendem de fato, se fazem só trabalhista ou mais):**

```markdown
# Quem você é
Você atende quem procura {escritório}, especializado em Direito do Trabalho. Seu nome é
{nome}. Fale com clareza e sem juridiquês; quem escreve pode estar preocupado com o emprego
ou já ter saído dele.

# O que você faz primeiro
Antes de oferecer qualquer coisa, entenda, uma pergunta por vez:
- Qual é a situação, em poucas palavras (demissão, horas extras não pagas, acidente de
  trabalho, assédio, outro)?
- Quando aconteceu ou quando terminou o vínculo (mês/ano basta)?
- Já existe processo aberto sobre isso, ou é a primeira vez que procura orientação?
- Tem documentos à mão (carteira assinada, rescisão, atestados, mensagens, testemunhas)?

# Como você decide o próximo passo
- Situação identificada e não é urgente: ofereça horário de consulta inicial com o
  advogado responsável por aquela área e confirme nome completo e telefone.
- Prazo apertado (fato há perto de 2 anos, ou vínculo encerrado há mais de 2 anos), acidente
  de trabalho em andamento, ou demissão nos últimos dias: ofereça o horário mais próximo
  disponível E chame uma pessoa da equipe agora — isso não espera a data marcada.
- Fora da área trabalhista (cível, criminal, família): diga que o escritório não atua nisso
  e encerre com educação.

# Situações
- "Quanto eu tenho direito a receber?": não estime valor nenhum — isso é análise de caso;
  diga que o advogado calcula na consulta com os documentos.
- "Vou pensar": pergunte o que falta para decidir e ofereça registrar o horário sem
  compromisso de pagamento (a consulta inicial é sempre o primeiro passo).
- Pergunta sobre prazo (prescrição): não afirme prazo específico — diga que quanto antes
  melhor e ofereça o horário mais próximo.

# Limites
Você não dá parecer jurídico, não estima indenização ou verba, não promete resultado de
processo, não confirma se "tem direito" a nada. Chama uma pessoa da equipe quando: urgência
de prazo, acidente de trabalho em andamento, ameaça ou situação de risco, ou pedido
explícito de falar com um advogado.

# Estilo
Mensagens curtas, uma pergunta por vez, sem termos jurídicos sem explicação. Emoji: não.
```

## Núcleo, extensão, ambos ou infraestrutura

Nenhum dos quatro, no sentido da pergunta de `docs/doctrine/extensoes.md` ("se nenhuma
organização ativar isto, a operação comum continua inteira?") — porque **não há capacidade
nova sendo instalada**. É dado de configuração de UM tenant (funil, tipos de atendimento,
campos personalizados, prompt, follow-ups), gravado pelas telas que já existem e usadas
por qualquer organização hoje. Não compete com núcleo nem com extensão — é o mesmo
"pacote de nicho" que clínica/imobiliária/loja já usam, só que escrito para advocacia. Se,
ao aplicar, aparecer uma necessidade real que o produto não cobre (ver risco de
confidencialidade abaixo), **aí sim** vira uma decisão de núcleo vs. extensão — não hoje.

## Riscos de compatibilidade self-host/open-source

- **Sem migration.** Área do direito e urgência são `custom_fields` em
  `pipeline.settings.fields` (jsonb já existente); tipo de atendimento com dono usa coluna
  (`default_owner_user_id`) que já está no schema e já é exposta pela tela de Agenda. Nada
  aqui pede `ALTER TABLE`, então nada disto entra no apêndice do `baseline.sql`.
- **Sem env var nova, sem tela nova, sem rota nova** — logo nenhum item de packaging,
  navegação (`lib/navigation/catalogo.ts`) ou `.changes/` se aplica. Isto é dado de
  organização, não comportamento de produto.
- **Confidencialidade entre áreas não é resolvida pelo produto hoje.** `CLAUDE.md` é
  explícito: `user_pipeline_access` (permissão por pipeline) **não entra no MVP**. Isso
  significa que qualquer `agent`/`manager` com acesso ao funil "Consultas" enxerga **todos**
  os leads, de qualquer área — não há como restringir o advogado trabalhista de acidentes a
  ver só os casos de acidente. Para um escritório de advocacia isso é uma questão real de
  sigilo profissional/organização interna, não só preferência de UI. **Isto deve ser dito
  ao cliente antes de configurar**, não assumido como resolvido; se for bloqueante, é
  questão para levar ao dono do produto (issue), não para contornar com SQL ou RLS custom
  fora de migration.
- **Dados sensíveis (LGPD).** Situações como acidente de trabalho podem envolver dado de
  saúde — categoria sensível sob a LGPD. O prompt acima já limita o que o agente pergunta
  ao mínimo de triagem (não pede laudo, não pede detalhe médico), e a base de conhecimento/
  memória da organização deve conter só política do escritório (áreas atendidas, horário),
  nunca informação de caso de um cliente específico. Cascade de anonimização
  (`Cliente Anonimizado #N`) do `CLAUDE.md` se aplica normalmente se o titular pedir remoção.
- **`crm_list_team_members` não devolve nome.** Isto não é bug a contornar — é decisão de
  produto. O nome do advogado responsável chega ao cliente pelo **nome do tipo de
  atendimento** ou pela mensagem final de confirmação (texto fixo/gerado, não vocabulário
  interno), nunca por o agente "descobrir" identidade pela lista de time.
- **Janela de envio e anti-banimento** seguem a doutrina padrão (7h-22h, domingo liberado
  por default) — um escritório de advocacia pode querer restringir a domingo/feriado; isso
  é knob por canal, não pede código.

## Plano de implementação

Ordem que o schema impõe (`references/pela-tela.md`), com o que muda para este nicho:

1. **Equipe** — convidar os advogados responsáveis por cada área, com papel `agent` (ou
   `manager`, se também precisarem gerenciar funil/relatórios). É pré-requisito do passo 5:
   sem `user_id` de cada advogado, não há a quem apontar `default_owner_user_id`.
2. **Conexões** — número de WhatsApp do escritório com status WORKING.
3. **IA › Credenciais** — chave do provedor de IA escolhido + chave OpenAI (áudio e base de
   conhecimento), validadas.
4. **IA › Provedores** — modelo de atendimento (usa ferramentas) e modelo do classificador/
   follow-up (barato).
5. **Configurações › Funis** — criar funil "Consultas" (Novo contato → Já respondi →
   Entendendo o caso → Quer marcar consulta → Reunião agendada → Consulta realizada →
   Não vai marcar, com "Reunião agendada"→"Consulta realizada" mapeadas a exatamente um
   "ganhou" e "Não vai marcar" a "perdeu"); vocabulário (cliente = *cliente*, negócio =
   *consulta*); **campos personalizados**: "Área do direito" (select: Rescisão/Verbas,
   Horas Extras, Acidente de Trabalho, Assédio, Equiparação Salarial, Outro) e "Urgência"
   (select: Alta, Média, Baixa).
6. **Agenda › Tipos de atendimento** — um tipo por área (nome já legível para o cliente
   final, ex. "Consulta – Rescisão e Verbas Trabalhistas"), duração (ex. 45 min), local
   (presencial ou Google Meet), `owner` = o advogado daquela área.
7. **IA › Conhecimento** — FAQ institucional (áreas atendidas, forma de cobrança da
   consulta se houver, endereço, documentos que o cliente deve levar) — nunca dado de caso.
8. **IA › Follow-ups** — silêncio 24h após "Entendendo o caso"; no-show de reunião marcada
   (gatilho "falta a compromisso").
9. **IA › Agentes** — criar o agente com o prompt do esqueleto acima; funis: "Consultas";
   materiais: a FAQ; follow-ups armados; capacidades: pacote *vender* (agenda, conhecimento,
   notas, funil) + capacidade crítica **casos** ligada e explicada ao escritório (é o que
   torna "urgência alta" acionável de verdade, não só um rótulo no lead); palavras de
   passagem para humano incluindo "quero falar com o advogado", "é urgente".
10. **Testar** — rodar o roteiro: "fui demitido sem justa causa semana passada", "trabalhei
    2 anos sem carteira assinada e saí há 1 ano e meio", "sofri um acidente na empresa e
    estou afastado", "quanto eu tenho direito a receber?", "quero falar direto com o
    advogado". Conferir: pergunta de diagnóstico correta, urgência identificada nos casos 1
    e 3 (abre caso, não só agenda), tipo de atendimento certo oferecido, nenhuma estimativa
    de valor.
11. **Publicar.**
12. **IA › Memória** — regras da casa: áreas que não atendem, horário de atendimento,
    "sigilo profissional: nunca peça documento sensível por aqui, isso é feito na consulta".
13. **Roteador** — só necessário se o escritório quiser separar "triagem de novo cliente"
    de "cliente já em processo" (suporte processual) no mesmo número; para um agente único
    de captação, não é preciso.

Registrar tudo em `pacote-<escritorio>.md` (passo 1 de `deskcomm-cliente-novo`), incluindo
explicitamente o risco de confidencialidade entre áreas (seção acima) como item que o
escritório precisa aceitar ou escalar antes de publicar.
