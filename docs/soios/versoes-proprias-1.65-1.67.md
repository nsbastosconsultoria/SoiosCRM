# Versões próprias do fork Soios (1.65.0 a 1.67.0)

Até 2026-10-07 o fork publicava versões com numeração própria, que colidia com a do
original (DeskcommCRM): a 1.65.0 a 1.67.0 daqui NÃO são as do original. Na sincronização
com o DeskcommCRM 1.80.0 o fork passou a seguir a numeração do original, e o `CHANGELOG.md`
passou a ser o dele. Este arquivo guarda as notas das versões próprias, como foram publicadas.

A cobrança dos tenants da 1.65.0 (módulo `cobranca`, tabelas `billing_*`) foi substituída
pela cobrança do original (`cobranca_*`, Asaas) na sincronização.

## Soios [1.67.0] — 2026-10-07

### Adicionado

- **Implantação de clientes — início automático, aviso de atraso e assistente** Com o módulo **Implantação de clientes** instalado:

  - **Início automático:** em **Configurações › Implantação**, escolha o funil comercial. Quando um
    negócio for ganho nesse funil, a implantação da empresa começa sozinha, com o modelo padrão. A
    empresa vem do contato do negócio e só é usada quando ele representa uma empresa só. Um mesmo
    negócio nunca abre duas implantações.
  - **Aviso de atraso na Central:** uma vez por dia, de manhã, cada implantação com item vencido
    gera um aviso, que mostra quantos itens estão com a equipe, com o cliente e com terceiros. Não é
    aberto um segundo aviso enquanto o primeiro estiver aberto.
  - **Assistente de IA:** a nova capacidade "Ver o que falta o cliente entregar na implantação",
    no pacote **Não perder o cliente**, responde ao cliente o que ainda falta mandar. Ela mostra só os itens
    que estão com o cliente e não marca nada como recebido: quem confere é a equipe.

  Inclui uma atualização no banco que permite o novo tipo de aviso. Ela não muda nada para quem não
  usa a implantação.

- **Implantação de clientes — módulo instalável (base de dados)** Novo módulo opcional **Implantação de clientes**, para quem implanta o cliente antes de atendê-lo
  de rotina (contabilidade, TI gerenciada, agência). Ele depende da **Carteira de empresas**: em
  **Modo administrador › Módulos**, o botão **Instalar** só fica disponível depois que a Carteira
  estiver instalada, e a tela mostra essa exigência. Quem não instala não carrega nenhuma tabela, e
  nada muda.

  Esta versão traz a base do módulo:

  - modelos de checklist, com grupo, de quem é a vez em cada item (escritório, cliente ou terceiro),
    área, prazo, obrigatoriedade e se o item exige evidência;
  - uma implantação por empresa, com os itens copiados do modelo no início;
  - a regra de ativação: a empresa só passa a cliente ativo na Carteira quando todos os itens
    obrigatórios estão concluídos ou dispensados com motivo.

  As telas de implantação, o cartão na ficha da Carteira e o início automático pelo negócio ganho
  chegam nas próximas versões do módulo.

- **Implantação de clientes — telas, checklist e ativação pela ficha** Com o módulo **Implantação de clientes** instalado:

  - **Na ficha da empresa, na Carteira:** o novo cartão **Implantação** mostra o progresso dos itens
    obrigatórios e tem o botão **Iniciar implantação**. Ao iniciar, a empresa passa a "em
    implantação", e cada item ganha prazo e responsável, que é quem cuida daquela área na Carteira.
  - **Implantação de clientes**, no hub do CRM: a lista das implantações em andamento, com quatro
    filtros (todas, minhas, com item vencido e esperando o cliente).
  - **Ficha da implantação:** os itens por grupo, cada um com responsável, prazo, observação e
    evidência.
    - Itens que exigem evidência só são concluídos com ela.
    - Dispensar um item pede motivo e é permitido só a gestores.
    - **Concluir implantação e ativar o cliente** só fica disponível quando todos os itens
      obrigatórios estão fechados, e a empresa vira cliente ativo na Carteira.
    - A implantação também pode ser cancelada, com motivo, e a empresa pode ser marcada como inativa.
  - **Configurações › Implantação:** os modelos de checklist, criados a partir de um modelo pronto
    (escritório de contabilidade ou genérico) e editáveis. Mudar um modelo não altera implantações já
    começadas.
  - **Na Carteira:** ativar direto uma empresa que tem implantação em andamento, com itens
    obrigatórios abertos, passa a ser permitido só a administradores, e mesmo assim pede confirmação.

## Soios [1.66.0] — 2026-10-06

### Adicionado

- **Carteira de empresas — módulo instalável (base de dados)** Novo módulo opcional **Carteira de empresas**, para quem atende empresas recorrentes por um único
  número de WhatsApp (contabilidade, agência, TI gerenciada). Instale em
  **Modo administrador › Módulos**. Quem não instala não carrega nenhuma tabela, e nada muda.

  Esta versão traz a base do módulo. Ela usa o vínculo entre pessoa e empresa que o CRM já tem e
  acrescenta o papel de cada pessoa (sócio, financeiro, RH…) e as áreas que ela recebe. Registra se
  cada empresa é prospect, cliente ativo, suspensa ou inativa, e desde quando é cliente. Guarda
  também o grupo empresarial, matriz e filial, quem cuida da empresa em cada área e de qual empresa
  é cada conversa, com histórico de troca.

  A tela da carteira, a empresa da conversa na caixa de entrada e as ferramentas do assistente de IA
  chegam na próxima versão do módulo.

- **Carteira de empresas — a tela e a API** Com o módulo **Carteira de empresas** instalado, o CRM ganha a tela **CRM › Carteira de empresas**.

  Ela lista as empresas atendidas, com filtro por estado (prospect, cliente ativo, suspenso, inativo…)
  e busca por nome ou CNPJ. Uma empresa entra na carteira pelo CNPJ: se ainda não existe no CRM, é
  criada e completada pela Receita, como na tela de Empresas. Marque **Já é cliente** para carregar
  quem já é cliente há tempo.

  A ficha de cada empresa mostra:

  - o estado do relacionamento, com botões só para as mudanças permitidas, e desde quando é cliente;
  - as pessoas que representam a empresa, com o WhatsApp de cada uma e o papel (sócio, financeiro,
    RH…). Ligar um contato à empresa usa o mesmo vínculo da tela de Pessoas;
  - quem da equipe cuida da empresa em cada área;
  - a linha do tempo de tudo o que mudou.

  Quem tem papel de leitura só vê. Editar o papel de uma pessoa vale para atendentes. Pôr empresa na
  carteira, mudar o estado, ligar contatos e definir responsáveis exige gestor.

- **Carteira de empresas no atendimento — roteador, assistente e caixa de entrada** Com o módulo **Carteira de empresas** instalado, o atendimento passa a saber quem já é cliente.

  - **Roteador:** o novo quadro **Quem já é cliente** manda o cliente ativo direto para a intenção
    escolhida, em geral o atendimento, mesmo que a mensagem pareça comercial. Se o cliente pedir outra
    coisa com clareza, como abrir outra empresa, ele segue para a intenção pedida. Dá para desligar
    esse desvio. Sem o quadro preenchido, o roteador funciona como antes.
  - **Assistente de IA:** três capacidades novas no pacote de atendimento. Ver as empresas de quem
    está na conversa, registrar de qual empresa é a conversa e procurar uma empresa da carteira pelo
    nome ou pelo CNPJ. O assistente só registra empresas ligadas à pessoa no cadastro, e o CNPJ
    aparece para ele só pelos 4 últimos dígitos.
  - **Caixa de entrada:** o cabeçalho da conversa mostra de qual empresa ela trata, com troca num
    clique e um atalho para a ficha da empresa. Trocar a empresa vale daqui para frente: o que já foi
    tratado não muda de empresa.

  Inclui uma atualização no banco que permite registrar essas decisões do roteador. Ela não muda nada
  para quem não usa a carteira.

- **Protocolos — falar com o cliente pela ficha, com a IA levando a mensagem** Com o módulo **Protocolos** instalado, a ficha do protocolo ganha **Falar com o cliente**:

  - **Pedir informação ao cliente:** a IA leva a pergunta pela conversa, e o protocolo fica
    aguardando o cliente, com o prazo pausado. Quando o cliente responde, a resposta aparece na linha
    do tempo do protocolo e o prazo volta a correr sozinho.
  - **Avisar que resolveu:** a IA avisa o cliente, e o protocolo passa para resolvido.

  A ação não aparece para protocolos sem conversa. Ela é recusada quando a conversa está com uma
  pessoa da equipe (nesse caso, responda pela inbox) ou quando já existe um chamado aberto na
  conversa. Para a resposta do cliente voltar ao protocolo, o agente precisa estar com a capacidade
  de chamados ligada.

  Inclui uma atualização no banco que permite registrar casos abertos a partir de um protocolo. Ela
  não muda nada para quem não usa protocolos.

- **Protocolos — a fila, a ficha e a configuração** Com o módulo **Protocolos** instalado, o atendimento ganha a tela **Protocolos**. Ela abre pela
  busca (⌘K), e a empresa pode pôr a tela no menu lateral em **Configurações › Interface**. O menu
  tem limite de itens, por isso a tela não entra nele sozinha.

  - **A fila:** quatro visões. *Minha fila*, *Fila da área* (com o botão *Assumir*), *Vencendo* e
    *Todos*. Cada protocolo mostra o número, a prioridade e quanto falta para o prazo de resolução.
  - **Abrir um protocolo:** escolha a categoria e a subcategoria e descreva o pedido. Informe a
    competência quando a categoria pedir e, se houver, o prazo dado pelo cliente. A prioridade sai da
    categoria e sobe sozinha quando o prazo do cliente está perto: hoje ou vencido vira P1, e até 2
    dias úteis vira P2. Se já existe um protocolo aberto para o mesmo pedido da mesma empresa, a
    informação nova entra nele em vez de abrir outro.
  - **Distribuição:** o protocolo vai para quem cuida da empresa naquela área, pela Carteira de
    empresas. Se ninguém cuida, vai para a fila da área. Se a área não tem fila, vai para o líder.
  - **A ficha:** responsável, prazos de primeira resposta e de resolução e só os botões de estado
    permitidos. Tem também a mudança de prioridade com motivo (baixar a prioridade é só para gestor),
    as notas internas e a linha do tempo. Enquanto o protocolo espera o cliente, o prazo de resolução
    fica pausado.

  Em **Configurações › Protocolos** (administrador): aplique o modelo **Escritório de contabilidade**
  para criar as áreas e as categorias com um clique. Depois defina o expediente, os prazos por
  prioridade, quem atende cada fila e os feriados. Os prazos começam em branco: cada escritório define
  os seus.

- **Protocolos no atendimento — assistente de IA, avisos de prazo e atalho na conversa** Com o módulo **Protocolos** instalado:

  - **Assistente de IA:** quatro capacidades novas no pacote de atendimento. Ver as categorias,
    abrir um protocolo, consultar os protocolos do cliente e acrescentar informação a um protocolo.
    Ao abrir, o assistente informa o número ao cliente e nunca promete prazo de conclusão. Quando a
    categoria pede uma pessoa, como numa notificação ou intimação, a conversa passa para a equipe
    na mesma hora. "Abrir protocolo" é uma capacidade crítica e precisa ser ligada no agente uma a
    uma.
  - **Avisos de prazo na Central:** quando o prazo de primeira resposta ou de resolução chega a 80%,
    vence ou passa muito do prazo, a equipe recebe um aviso na Central, um por etapa. Protocolo
    parado numa fila sem ninguém também gera aviso.
  - **Atalho na conversa:** o cabeçalho da conversa ganha "Abrir protocolo", que já traz o contato e
    a empresa da conversa.

  Inclui uma atualização no banco que permite esses dois novos tipos de aviso. Ela não muda nada para
  quem não usa protocolos.

- **Protocolos — módulo instalável (base de dados)** Novo módulo opcional **Protocolos**, para as demandas dos clientes atuais: número por ano,
  categoria, competência, prioridade de P1 a P4, fila por área, responsável e prazos de primeira
  resposta e de resolução (SLA). Instale em **Modo administrador › Módulos**. Quem não instala não
  carrega nenhuma tabela, e nada muda.

  Esta versão traz a base do módulo: numeração, as regras de mudança de estado e o histórico de cada
  protocolo. Ao anonimizar um contato, os textos que ele escreveu nos protocolos também são
  anonimizados. A tela de protocolos, as filas, os prazos e o assistente de IA abrindo protocolos
  chegam nas próximas versões do módulo.

## Soios [1.65.3] — 2026-10-03

### Corrigido

- **A mensagem por IA de um fluxo de follow-up não inventa mais promessa nem ignora a resposta do cliente** O passo "mensagem por IA" de um fluxo de follow-up dizia ao agente que ele tinha
  combinado retornar e que o cliente não havia escrito — mesmo num fluxo de lead
  novo, e mesmo no ramo que roda justamente porque o cliente respondeu. Agora o
  agente sabe que o contato vem de um fluxo da empresa, recebe a resposta do
  cliente em destaque quando ela existe, e a orientação que você escreveu no passo
  vale mais que a instrução genérica de retomar a conversa. Com o Operador ligado,
  o follow-up e a resposta a um caso interno também deixaram de mandar o agente
  usar ferramentas que ele não tem.

- **Criações protegidas contra duplicação param quando a reserva falha** Nas criações com chave de idempotência (respostas rápidas, mensagens, rascunhos, agendamentos e pagamento de parcelas), uma falha ao ler, reservar ou retomar a chave agora interrompe a operação antes do efeito. Isso evita criar sem a proteção contra duplicação quando o banco recusa a reserva. Crédito: @nsbastosconsultoria.

## Soios [1.65.2] — 2026-10-01

### Corrigido

- **Conectar de novo o mesmo número de WhatsApp leva as conversas antigas junto** Quando o WhatsApp caía e o canal era excluído e conectado de novo como canal novo, as conversas
  antigas ficavam presas ao canal excluído. Todo follow-up dessas conversas parava com o aviso "canal
  arquivado", e a Central mostrava "Job descartado após esgotar tentativas" e "Um fluxo de follow-up
  parou de tentar" para leads que só estavam em silêncio.

  Agora, assim que o número é lido no canal novo, as conversas do canal excluído com o mesmo número
  passam para ele, e os follow-ups seguem por ali. Instalações que já passaram pela troca recebem o
  conserto ao atualizar. Conversa de quem já voltou a escrever pelo canal novo continua separada,
  com o histórico antigo preservado, e grupos não mudam de canal.

## Soios [1.65.1] — 2026-09-30

### Corrigido

- **Resumo do turno com formato inválido não faz mais o agente refazer o atendimento** Depois de responder ao cliente, o agente faz uma segunda chamada ao modelo para gravar o resumo da
  conversa (compromissos, objeções e próxima ação). Com alguns modelos da OpenAI, esse resumo às vezes
  vinha com o formato quebrado, e o sistema refazia o turno inteiro: outra chamada de IA paga para uma
  resposta que o cliente já tinha recebido.

  Agora o resumo é lido de forma mais tolerante (texto em volta, dois blocos, vírgula sobrando). Se
  ainda assim vier ilegível, só o resumo é pedido de novo, uma vez. Na segunda falha, o atendimento
  segue com a memória anterior da conversa, sem refazer o turno e sem gasto extra.

- **O agente não consegue mais prometer "vou encaminhar para análise" sem abrir um caso** O agente podia dizer ao cliente "vou encaminhar seu caso com prioridade para análise" e não fazer
  nada: nenhum caso aberto, nenhuma pessoa avisada, e a conversa ficava parada esperando. A trava que
  impede promessa de atendimento humano sem caso aberto só reconhecia frases com "equipe", "setor",
  "atendente" e parecidos.

  Agora ela reconhece também "encaminhar para análise/avaliação", "seu caso vai para análise" e
  promessas envolvendo advogado ou doutor(a). Quando o agente tenta prometer isso sem abrir o caso, a
  mensagem é segurada até o caso existir. Pedidos ao cliente, como "pode me enviar os documentos para
  análise?", continuam liberados.

  A trava vale para agentes com **"Pedir ajuda sem sair da conversa"** ligado (**IA › Agentes ›**
  o agente **› Quando ele entra em ação**).

## Soios [1.65.0] — 2026-09-30

### Adicionado

- **Cobrança dos tenants — planos, faturas e corte automático por falta de pagamento** Novo módulo opcional **Cobrança dos tenants**, para quem opera a instalação e cobra as empresas que
  atende. Instale em **Modo administrador › Módulos**; quem não instala não carrega tabela nenhuma e
  nada muda.

  Com o módulo instalado, a tela **Modo administrador › Cobrança** cria planos (preço, periodicidade
  e dias de teste grátis), assina cada empresa num plano e lança as faturas, com o "como pagar" (Pix,
  link ou linha digitável) colado à mão. Dar baixa numa fatura registra o pagamento.

  Uma rotina diária marca a fatura vencida como em atraso. O administrador da empresa vê uma faixa em
  todas as telas, com o valor, a data de suspensão e como pagar. Passados **7 dias** de carência, a
  empresa é suspensa: perde o acesso às telas, mas o WhatsApp e a IA continuam atendendo. A tela de
  conta suspensa mostra a fatura em aberto. Dar baixa (ou cancelar a fatura) reativa na hora — e
  só desfaz a suspensão que a cobrança fez, nunca uma suspensão manual.

  Nesta fase não há integração com gateway de pagamento: a baixa é manual.

- **Confirmação de conta e nova senha saem pelo servidor de e-mail da instalação** Na instalação com Supabase na nuvem, os e-mails de confirmação de conta e de redefinir senha
  saíam pelo remetente embutido do Supabase ("Supabase Auth", com limite baixo de envio) ou pelo
  que alguém tivesse configurado à mão no painel do Supabase — trocar o servidor em
  **Modo administrador › E-mail** mudava convites e avisos de LGPD, mas nunca esses dois e-mails.

  Agora o `marca-emails.sh`, que o `update.sh` já roda a cada atualização, grava no Supabase o mesmo
  servidor de e-mail da tela, com o seu remetente. Sem servidor configurado, nada muda. Para aplicar
  antes da próxima atualização: `bash hostgator-setup-kit/marca-emails.sh` com
  `SUPABASE_ACCESS_TOKEN` exportado.

  No Supabase próprio, apagar os campos da tela de E-mail passa a voltar ao servidor do arquivo de
  instalação, como o resto do sistema; antes os e-mails de acesso ficavam sem servidor.

- **Parcela de honorários ganha "como pagar", e o assistente passa a mandar o boleto** Em **Análise › Dinheiro › Honorários**, cada parcela pendente ganha **"Informar como pagar"**: o
  escritório cola ali o link do boleto, o Pix copia-e-cola ou a linha digitável daquela parcela.
  O assistente com a capacidade **"Ver as parcelas de honorários"** passa a receber esse texto e o
  repassa ao cliente exatamente como está — e, quando a parcela não tem instrução, diz que o time
  vai enviar em vez de inventar um link.

  Só quem é gerente ou administrador edita, e parcela já paga não muda. O sistema não gera boleto:
  o texto é o que o escritório cadastrou.

  Quem já tinha o módulo de Honorários instalado recebe o campo na atualização, sem passo manual.

### Alterado

- **As atualizações passam a vir das versões da Soios** O kit de instalação e atualização passa a apontar para o SoiosCRM: as imagens vêm de
  `ghcr.io/nsbastosconsultoria` e as versões, das releases do repositório `nsbastosconsultoria/SoiosCRM`.
  Com isso, o botão **"Atualizar agora"** e o `update.sh` levam o servidor para a última versão da
  Soios, e não mais para a do DeskcommCRM original.

  Numa instalação que já existia, falta um passo único: apontar o código do servidor para o
  repositório da Soios (`git remote set-url origin …`), descrito em
  `docs/runbooks/soios-atualizacao-do-fork.md`. Até lá, use a atualização manual do mesmo guia.

### Corrigido

- **Os e-mails de confirmação de conta e de nova senha passam a usar a marca salva na tela** Na instalação com Supabase na nuvem, o e-mail de confirmação de conta e o de redefinir senha
  chegavam com o nome do produto ("Confirme seu e-mail — DeskcommCRM") mesmo depois de a marca ter
  sido trocada em **Modo administrador › Marca**: o `marca-emails.sh`, que grava esses dois e-mails
  no Supabase, lia só o `.env`, e o `.env` quase nunca é atualizado depois da instalação.

  Agora ele lê primeiro a marca salva na tela e só usa o `.env` quando o banco não responde ou não
  tem marca salva. A próxima atualização já grava os e-mails com a marca certa; para aplicar antes
  disso, rode `bash hostgator-setup-kit/marca-emails.sh` com `SUPABASE_ACCESS_TOKEN` exportado.

- **Salvar o servidor de e-mail não apaga mais a senha, e limpar a tela volta ao arquivo** Em **Modo administrador › E-mail**, quando os dados do servidor vinham do arquivo de instalação,
  a tela dizia "Já existe uma senha gravada. Deixe em branco para mantê-la" — mas salvar sem digitar
  a senha gravava a configuração sem senha, e a partir daí todo e-mail da instalação falhava na
  autenticação. Agora a senha do arquivo é guardada junto.

  Apagar os campos da tela também volta a usar o arquivo de instalação, como a tela promete; antes a
  instalação ficava sem e-mail. E o botão "Salvar" não mostra mais "Salvando…" enquanto quem espera
  é o "Testar conexão".

  Quem já salvou a tela nessa situação: digite a senha de novo em **E-mail** e salve.

- **Entrada, cadastro e configuração inicial passam a mostrar o nome salvo em Marca** As telas de entrar, criar conta, criar a organização, a configuração inicial (onboarding) e as
  páginas de termos e privacidade mostravam o nome gravado no arquivo de instalação do servidor —
  "DeskcommCRM" quando ele estava em branco — mesmo depois de a marca ter sido trocada em
  **Modo administrador › Marca**. O resto do sistema (aba do navegador, menus, e-mails) já usava o
  nome salvo na tela.

  Agora todas essas telas usam o nome salvo na tela, e o arquivo de instalação só vale quando nada
  foi salvo. O aviso da tela de Marca, que dizia que essas telas mudariam "na próxima atualização",
  foi corrigido: nada as atualizava.

