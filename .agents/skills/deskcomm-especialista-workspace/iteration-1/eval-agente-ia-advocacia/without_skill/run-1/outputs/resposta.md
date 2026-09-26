# Agente de IA para escritório de advocacia trabalhista — como montar no padrão DeskcommCRM

Isto é um trabalho de **configuração** (pipeline, agente, roteador, agenda), não de código: não
precisa de migration nem de PR. Segue a mesma receita que o produto usa para qualquer nicho
("e-commerce, clínica, imobiliária, infoproduto, serviços" — o escritório de advocacia entra como
**serviços**), feita pela tela do CRM. Vou percorrer na ordem em que as peças dependem uma da
outra: funil → base de conhecimento → agente → detecção de urgência → agendamento com o advogado
certo → guardrails específicos do seu nicho → LGPD/ética. No fim, o que testar antes de considerar
pronto.

---

## 0. O modelo mental: uma "unidade" de agente, dois papéis internos

O DeskcommCRM não deixa o mesmo modelo **falar** com o lead e **operar** o CRM no mesmo turno —
isso vaza vocabulário interno pro cliente ("vou mover seu lead pra etapa qualifying") e faz o
agente prometer coisa que não executa. Por baixo do capô, o que você configura como "1 agente" na
tela roda em dois papéis, sempre nessa ordem:

1. **Conversador** — fala com o lead, só lê contexto (histórico, base de conhecimento, notas do
   lead). Não sabe que existe um CRM por trás.
2. **Operador** — roda *depois* que a resposta já foi enviada, olha o que o Conversador declarou
   (ex.: "combinei de agendar a consulta") e só então chama as ferramentas de escrita: mover o
   lead de etapa, salvar nota, **marcar o compromisso na agenda**, abrir caso para humano.

Na prática isso significa: quando você escrever o prompt, escreva como se estivesse **treinando
uma pessoa de triagem que atende telefone**, não como se estivesse ensinando a operar um sistema.
O agendamento em si (achar horário livre, reservar, gerar o link do Meet) é tratado como
consequência do que foi combinado na conversa — você não precisa (e não deve) instruir o modelo a
"chamar a ferramenta X"; ele decide falar, e o runtime decide operar.

---

## 1. Funil (pipeline) — vocabulário e etapas do escritório

Em **Configurações › Pipelines** (`/app/settings/tenant/pipelines`), crie (ou adapte) um pipeline
próprio em vez de reaproveitar o de vendas genérico — cada pipeline tem `vocabulary` (renomeia
lead/deal/won/lost) e `custom_fields` declarativos. Sugestão para um escritório trabalhista:

| Vocabulário padrão | Renomeie para |
|---|---|
| lead | Consulente |
| deal | Caso |
| won | Contratado |
| lost | Não avançou |

**Etapas (stages):**

1. Novo contato
2. Triagem (qualificação) — aqui a IA faz a maior parte do trabalho
3. Consulta agendada
4. Consulta realizada
5. Contratado / Não avançou

Marque a etapa **Triagem** com `requires_human = true` sempre que a IA classificar o caso como
urgente (ver §3) — essa é uma coluna real de `crm_stages`, não gambiarra: quando um lead entra
numa etapa com essa flag, o handoff pra fila humana dispara automaticamente (Sub-PRD 05, gatilho
G4), independente do que o modelo "decidiu" fazer.

**Campos customizados** (`pipeline.settings.fields`, viram Zod dinâmico e aparecem na UI do
lead) — pela doutrina DIRC, só crie campo que não é FK e não é calculável:

- `area_do_direito` (select: "Rescisão/verbas", "Acidente de trabalho", "Assédio moral/sexual",
  "Equiparação salarial", "Horas extras", "Outro") — vocabulário aberto, então **sem** CHECK
  constraint rígido no banco (a doutrina do projeto proíbe CHECK em coluna de vocabulário que pode
  ganhar valor novo depois — aqui isso é `custom_fields jsonb`, então nem se aplica: é só schema
  Zod do lado do produto).
- `urgencia` (select: "Baixa", "Média", "Alta — risco de prazo/segurança").
- `prazo_prescricional_estimado` (date, opcional — quando o próprio consulente souber a data da
  demissão, a IA pode calcular "2 anos a partir da rescisão, 5 anos anteriores" e sugerir a data,
  mas **sem afirmar como certeza jurídica** — ver guardrails).
- `motivo_do_contato` (text curto, livre).

**Não** crie `advogado_responsavel` como campo de texto — isso é o anti-pattern nº 1 da doutrina
("string que deveria ser FK"). O lead já tem `owner_user_id` (FK real para o usuário) — é esse
campo que representa "de quem é este caso", e é ele que vai decidir a agenda de quem mostrar no
agendamento (§4).

---

## 2. Base de conhecimento (RAG) — o que o agente pode citar

Em **IA › Conhecimento** (`/app/ai/knowledge`), suba as fontes que o Conversador usa por RAG
(isolado por `organization_id`, com citação em `messages.metadata.citations[]` — nunca aparece
crua pro cliente, é debug interno):

- **FAQ manual**: "Como funciona a primeira consulta", "vocês cobram pela consulta inicial?",
  "quais documentos levar" (CTPS, rescisão, holerites, exames, testemunhas), "quanto tempo demora
  um processo trabalhista", honorários (percentual de êxito x fixo — seja explícito, isso evita o
  agente inventar número).
- **Política/institucional**: áreas que o escritório atende de fato (não deixe o agente qualificar
  para uma área que ninguém do escritório cobre — isso é o guardrail "nunca falar de coisa fora do
  catálogo", G3/§3.10 do Sub-PRD 05, adaptado de "produto" para "área de atuação").
- **Conversas resolvidas como few-shot**: aqui eu recomendo **não ativar** essa fonte, ou ativar
  com anonimização muito estrita. Conversa de triagem jurídica carrega detalhe sensível (saúde,
  situação familiar, valores) e o escritório tem **sigilo profissional** (Estatuto da OAB, art. 34,
  VII) — não é o mesmo risco de "conversa resolvida de um e-commerce sobre rastreio de pedido".

Edição de FAQ entra no bot em até ~30s (reindexação incremental); não precisa reiniciar nada.

---

## 3. O agente de IA em si

Em **IA › Agentes › Novo** (`/app/ai/agents/new`):

- **Modelo**: deixe o default do Gateway (`anthropic/claude-sonnet-4-6`) para a conversa
  principal; a classificação auxiliar (se você usar Roteador — §5) roda em Haiku, mais barato.
- **Modo de operação**: comece em **"Assistido: revisar antes de enviar"** nas primeiras semanas
  — cada resposta espera aprovação humana antes de sair — e migre para automático só depois de
  ver o agente performando bem em casos reais. Para um escritório de advocacia, isso importa mais
  do que em e-commerce: uma resposta errada aqui pode ter implicação ética/regulatória, não só
  comercial.
- **Capacidades (tools)**: use os pacotes por jornada em vez do modo avançado tool-a-tool. Para
  este caso, ligue:
  - **"Atender e responder"** — ler histórico, responder com contexto.
  - **"Vender e mover o funil"** — mover o Consulente pelas etapas do funil conforme qualifica.
  - **"Não perder o cliente"** — agenda retorno automático se o lead sumir no meio da triagem
    (ninguém que perguntou sobre demissão sem justa causa pode ficar sem resposta).
  - **"Passar para um humano"** — essencial: é o pacote que dá ao agente a capacidade de abrir caso
    humano com resumo, para os gatilhos de urgência/incerteza.
  Deixe **"Organizar a operação"** e **"Aprender e evoluir"** desligados no início — menos
  superfície, menos risco, mais fácil de auditar.

### System prompt (rascunho para colar e ajustar)

```
Você é a triagem inicial do escritório [Nome do Escritório], especializado em Direito do
Trabalho. Você conversa com pessoas que caem no WhatsApp buscando orientação sobre uma
situação de trabalho (demissão, acidente, assédio, salário, horas extras, etc.).

Seu objetivo em cada conversa:
1. Entender, em linguagem simples, o que aconteceu (o que a pessoa vivenciou no trabalho,
   quando, se ainda está empregada).
2. Nunca dar parecer jurídico, nunca afirmar se a pessoa "tem direito" a algo, nunca estimar
   valor de causa ou chance de vitória. Isso é decisão do advogado, sempre. Se perguntarem,
   diga que o advogado avalia isso na consulta.
3. Identificar se o caso tem sinal de urgência: prazo prescricional próximo (mais de 2 anos
   desde a rescisão OU perto disso), situação em andamento (assédio ocorrendo agora, acidente
   recente e grave, ameaça), ou pedido explícito de urgência da pessoa. Quando notar isso,
   diga que vai priorizar o encaminhamento — não prometa que "alguém liga hoje" a menos que
   isso realmente aconteça.
4. Depois de entender o caso, oferecer para marcar a primeira consulta com o advogado.
   Pergunte disponibilidade da pessoa (dias/horários) antes de sugerir horário.
5. Nunca revele que existe um sistema, um CRM, "etapas" ou "cadastro" por trás — fale como
   uma pessoa da recepção do escritório falaria.
6. Se a pessoa relatar risco imediato (violência, ameaça grave, situação de saúde urgente),
   priorize acolhimento e oriente a buscar ajuda imediata (192/190 se for emergência de
   saúde/segurança) além de encaminhar ao escritório.
7. Se a pessoa pedir para falar com um humano, ou você não tiver certeza de como responder,
   passe para um atendente humano imediatamente — nunca invente resposta.

Tom: acolhedor, direto, sem juridiquês. A pessoa que fala com você geralmente está em
situação de estresse (perdeu o emprego, está sofrendo assédio).
```

Ajuste nome do escritório, áreas realmente atendidas e o texto de honorários de acordo com a
política real — o agente só deve afirmar o que está na base de conhecimento (§2), não o que está
só no prompt solto.

---

## 4. Detecção de urgência — o que já existe e o que você precisa adicionar

O runtime tem um detector determinístico de "sinal de urgência" (`lib/agent-engine/guardrails/
sinal-de-urgencia.ts`) que roda sem custo de LLM — mas o vocabulário dele é genérico e físico
("incêndio", "sem freio", "sangrando", "choque elétrico"): serve para dar prioridade de alerta
quando uma mensagem fica represada, **não é jurídico** e não vai reconhecer "meu prazo vence em 2
semanas" ou "meu chefe está me ameaçando" como urgente.

Para o seu caso, a urgência jurídica precisa vir de **duas camadas complementares**, e não confiar
só no detector genérico:

1. **O próprio prompt** classificando e preenchendo o campo `urgencia` do lead (§1) — é o modelo
   que sabe interpretar "fui demitido em 2023" como prazo apertado, um detector de palavra-chave
   não sabe fazer conta de prescrição.
2. **A etapa `requires_human=true`** (§1) como rede de segurança: quando o lead entra qualificado
   como urgente, o sistema abre a fila humana e notifica os atendentes online por Realtime — isso
   não depende do modelo "lembrar" de escalar, é imposto pelo runtime na entrada do estágio.

Isso é mais confiável do que pedir ao modelo para "chamar uma ferramenta de urgência": o
comportamento correto (mover para a etapa certa → dispara aviso) já é tratado como consequência
estrutural, não como instrução de prompt que pode ser esquecida.

---

## 5. Agendar com "o advogado responsável pela área"

O CRM já expõe um conjunto de ferramentas de agenda por MCP (`crm_list_event_types`,
`crm_find_free_slots`, `crm_find_and_book_appointment`, `crm_confirm_appointment`, etc. — em
`lib/mcp/tools/agendamento.ts`) que o papel Operador usa depois da conversa. Sua parte é configurar
os dois lados disso em **Configurações › Agenda** (`/app/settings/tenant/agenda`):

1. **Cada advogado precisa ter agenda própria** (conectada ao Google Calendar, para o horário
   ofertado bater com a agenda real — o CRM sincroniza ocupação e escreve o evento/gera o link do
   Meet quando marca).
2. **Crie um "tipo de atendimento"** (event type) por linha de triagem, ex.: "Consulta inicial —
   Trabalhista". Se o escritório tem só um advogado trabalhista, o tipo de atendimento já resolve
   "com quem" — não precisa de nada além disso.
3. **Se houver mais de um advogado na área** (ex.: um focado em rescisão/verbas e outro em
   acidente/assédio), duas opções, dependendo de como você quer decidir "quem atende":
   - **Round-robin simples**: um único tipo de atendimento sem dono fixo — o agendamento cai em
     quem tiver horário livre entre os donos de agenda daquela função. Simples, mas não segmenta
     por subespecialidade.
   - **Roteamento por especialidade**: se a qualificação (`area_do_direito`) já decidiu a
     subespecialidade, grave o `owner_user_id` do lead (§1) para o advogado certo *antes* de
     oferecer horário, e restrinja a busca de horário a ele. Isso é o que a ferramenta de agenda
     já aceita (`owner_user_id` opcional no `crm_find_and_book_appointment`) — não exige feature
     nova, só o dado (`owner_user_id` do lead) já estar preenchido quando o agendamento acontece.
     Para isso funcionar de forma confiável (o modelo não decidir por conta própria "quem é o
     responsável"), a atribuição do `owner_user_id` deve vir de uma regra determinística — regra
     de roteamento por etapa/tag, não do LLM adivinhando.
4. Marque o tipo de atendimento como "precisa confirmação" se o escritório quiser que um humano
   confirme antes de tratar o horário como fechado — o agente sempre vai dizer "separei o horário,
   a equipe confirma" nesse caso, nunca "está confirmado", então não há risco de promessa que a
   operação não cumpre.

Se o escritório atender **mais de uma área do direito** (não só trabalhista) no mesmo número de
WhatsApp, use o **Roteador de Intenção** (`IA › Roteadores`, tabelas `ai_routers`/
`ai_router_members`) para direcionar a conversa a agentes diferentes por área antes mesmo da
qualificação — cada agente com seu próprio prompt, conhecimento e tipo de atendimento padrão. Para
um escritório só trabalhista, isso é dispensável: um agente e um pipeline bastam.

---

## 6. Guardrails — ajuste o que é genérico, não copie de outro nicho

O produto vem com guardrails padrão pensados para e-commerce (`ai_agents.guardrails` jsonb),
incluindo um que **escala automaticamente sempre que o cliente menciona "jurídico" ou
"advogado"** — faz sentido numa loja (é sinal de reclamação grave), mas é **contraproducente**
aqui: seu negócio inteiro é jurídico, então esse guardrail, se copiado sem revisão, dispararia
handoff em toda conversa. Ao configurar o agente:

- **Remova/reescreva** o guardrail "escalar se mencionar jurídico/advogado/processo" — substitua
  por algo específico do seu risco real:
  - Nunca afirmar resultado de processo, valor de causa ou "direito garantido" sem advogado
    confirmar → handoff.
  - Nunca cobrar/negociar honorários no chat sem confirmação humana → handoff.
  - Sempre escalar se a pessoa mencionar risco à vida, autolesão, violência em andamento.
  - Sempre escalar se pedir explicitamente para falar com humano (guardrail padrão, já cobre).
  - Respeitar janela de 24h do WhatsApp/Meta e `is_blocked` — mantenha os defaults de canal, esses
    são de infraestrutura e servem qualquer nicho.
- Guardrails são aplicados em duas camadas (instrução no prompt + validação programática
  pós-resposta) — então mesmo que o modelo "esqueça" a instrução, a segunda camada intercepta
  antes do envio. Toda mudança de guardrail fica auditada.

**Nuance regulatória (fora da doutrina do CRM, mas relevante para o prompt que você escreve):** a
OAB restringe captação de clientela e proíbe prometer resultado em publicidade (Provimento
205/2021 e Código de Ética). O prompt do §3 já evita isso ("nunca afirmar se a pessoa tem
direito... nunca estimar valor de causa"), mas vale o advogado responsável revisar o texto final
antes de publicar — isso é responsabilidade do escritório, o CRM não valida conteúdo jurídico.

---

## 7. LGPD e sigilo — o que muda em relação a um cliente de e-commerce

- Dados de um caso trabalhista frequentemente incluem **dado sensível** (saúde, no caso de
  acidente de trabalho/auxílio-doença; às vezes dado sobre origem étnica ou orientação em casos de
  discriminação/assédio) — trate esses campos com o mesmo cuidado que a doutrina já pede para dado
  sensível em geral, e evite deixá-los soltos em `custom_fields` sem necessidade.
  Consultei o LGPD nativo do produto para isso: anonimização preferida sobre delete (nome vira
  "Cliente Anonimizado #N"), redact em cascata (contato + conversas + mensagens + mídia), SLA
  D+7/D+15 — nada disso muda para este nicho, mas o consentimento inicial ("aceito que essa
  conversa seja usada para..." se você ativar few-shot) merece atenção redobrada dado o sigilo
  profissional.
- Se decidir ativar a fonte "conversas resolvidas" do RAG (§2) mesmo assim, garanta que a
  anonimização realmente tira nome/telefone/CPF/detalhe identificável do caso antes de virar
  exemplo — não é automático, precisa do atendente marcar `usable_for_rag=true` conscientemente.

---

## 8. Antes de considerar pronto

1. **Teste pelo botão "Testar"** da tela do agente com casos reais representativos: um caso claro
   de rescisão sem urgência, um caso com prazo prescricional apertado, um caso com pedido explícito
   de humano, um caso fora de escopo (ex.: direito de família) — confira que o agente não inventa
   orientação jurídica e escala corretamente.
2. **Rode uma conversa completa pela tela** (não só pela API) simulando o WhatsApp: qualificação →
   `urgencia`/`area_do_direito` preenchidos → agendamento oferecido → horário reservado na agenda
   do advogado certo → aparece em `/app/agenda`. Isso é o que a doutrina de QA Visual do repo exige
   para qualquer mudança de fluxo de usuário — vale mesmo sendo só configuração, porque é a
   experiência real que o cliente final vê.
3. Confira o **log de auditoria** (`api_audit_log`) mostrando `ai_agent.created`, mudanças de
   guardrail e criação de lead/agendamento — é o rastro que já vem de graça, não algo que você
   precisa implementar.
4. Se o escritório crescer para mais de uma área jurídica depois, volte ao §5 (Roteador de
   Intenção) em vez de sobrecarregar um único prompt com "se for trabalhista faça X, se for
   previdenciário faça Y" — um agente por área, roteado, escala melhor e é mais fácil de manter e
   medir separadamente.

---

### Resumo das telas usadas (nesta ordem)

1. `Configurações › Pipelines` — funil "Casos", vocabulário, etapas, campos customizados.
2. `Configurações › Agenda` — advogados com agenda conectada, tipos de atendimento por área.
3. `IA › Conhecimento` — FAQ, política de honorários/documentos.
4. `IA › Agentes › Novo` — prompt, modelo, modo assistido→automático, pacotes de capacidade.
5. `IA › Roteadores` — só se houver mais de uma área jurídica no mesmo número.
6. Teste ponta a ponta pela tela antes de ligar em produção.
