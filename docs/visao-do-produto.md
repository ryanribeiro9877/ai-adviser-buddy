# Gestor de Tráfego IA — visão completa do produto

Documento de produto. Descreve a ideia, o que o sistema é hoje e tudo o que ele faz, sem cadastro, números ou particularidades de nenhuma empresa cliente.

---

## 1. O que é

O **Gestor de Tráfego IA** é o painel e o agente responsáveis pela mídia paga da operação.

Não é um assistente que responde perguntas. É o profissional de tráfego da casa: lê os dados reais da conta, diagnostica, recomenda, prepara criativos e — só com aprovação humana — executa na Meta.

O produto cobre o ciclo inteiro:

1. Coletar estrutura e desempenho das contas de anúncios.
2. Mostrar o estado da operação num painel.
3. Conversar com o gestor sobre esses dados.
4. Propor atos concretos (pausar, criar, escalar, ajustar).
5. Executar o que um humano aprovou.
6. Auditar o que aconteceu.

A plataforma de mídia em operação hoje é a **Meta Ads**. O produto foi desenhado para várias empresas no mesmo sistema, cada uma isolada da outra.

Nome na interface: **Gestor de Tráfego · IA**.

---

## 2. A ideia

Fazer a operação captar mais e melhor pelo menor custo sustentável — sem comprar volume barato que não vira resultado de negócio, sem arriscar a conta de anúncios, sem queimar números de WhatsApp, sem degradar página e perfil que sustentam a entrega, e sem transformar base sem consentimento em público de mídia.

O gestor humano decide. O agente mede, explica, propõe e executa o que foi autorizado. Nenhuma alteração de campanha, orçamento, anúncio ou configuração sai sozinha.

### Hierarquia quando duas coisas boas se contradizem

1. Não causar dano irreversível (conta, WhatsApp, ativo orgânico, exposição regulatória).
2. Verdade sobre o dado — lacuna declarada vale mais que número bonito.
3. Proteger o custo (tetos, gasto sob controle).
4. Volume e escala — depois das três acima.
5. Elegância da análise — nunca acima de nenhuma das quatro.

### Doutrina que o produto impõe (não é estilo: é regra)

- Toda afirmação declara de qual empresa fala, a categoria regulatória e o nível (conta, campanha, conjunto ou anúncio).
- Toda recomendação de ação traz evidência, mecanismo, critério de sucesso, prazo de leitura e como desfazer.
- Uma decisão por leitura. Mexer em três coisas ao mesmo tempo impede aprender qual funcionou.
- Custo alto não é culpa do criativo até prova. Antes: entrega, público, saturação, calendário, página.
- Amostra pequena vira pergunta, não conclusão.
- Lead não é contrato. Custo por lead é proxy e o produto declara isso.
- Empresas não se cruzam na análise: tetos, produtos e categorias regulatórias são diferentes.
- Conta em quarentena é somente leitura, mesmo com a trava da empresa ligada.
- Conta sem dono declarado não existe para o agente.

---

## 3. Para quem

- **Gestor de tráfego (humano)** — conversa no chat Operação, aprova ou recusa cards, define tetos, lê o painel.
- **Equipe** — vê o mesmo estado da conta, sem poder executar.
- **Administrador** — cadastra empresas e contas, liga/desliga execução, reexecuta rotinas, edita metas.

Papéis no sistema: **administrador** e **visualizador**. O padrão de todo o produto é **somente leitura**. Escrita na Meta exige trava ligada na empresa **e** aprovação explícita de um administrador.

---

## 4. Como o produto está organizado

### Multi-empresa

Uma instalação serve várias empresas. Cada conversa, painel, alerta, teto, integração e ato de execução pertence a **uma** empresa. O seletor no topo do app escolhe o recorte; a URL carrega a empresa (compartilhável). Trocar de empresa troca o universo inteiro — dados, chat, recomendações, WhatsApp, metas.

O agente recusa analisar, comparar ou agir sobre conta que não pertence à empresa da conversa.

### Contas e estado operacional

Cada empresa pode ter várias contas de anúncios. O produto distingue:

| Estado | Significado |
|---|---|
| Conectada | Integração verificada e operacional |
| Não verificada | Registrada, ainda sem handshake com a plataforma |
| Erro na conexão | A plataforma recusou |
| Acesso revogado | Token/permissão caiu |
| Não operacional | Cadastrada, mas nunca operou (sem campanha, gasto nem sync) — invisível para análise e inelegível a ação |
| Em quarentena | Somente leitura; a quarentena vence a flag de execução da empresa |
| Desconectada | Sem integração |

Conta fantasma (nome igual ao provedor, sem ID externo) é sintoma de cadastro sem handshake — não é dado.

### Linhas de produto e vozes de marca

Uma empresa pode ter mais de uma linha (marca, produto, canal). O produto trata isso como identidade: copy, pasta de criativos, destino de WhatsApp, Instagram, teto de custo e compliance **não se misturam** entre linhas. Cruzar linha na criação ou na análise é recusa, não “quase certo”.

### Categoria regulatória

Empresas de crédito (e equivalentes de categoria especial na Meta) herdam doutrina de compliance financeiro. Empresas que não são de crédito **não** herdam. A categoria é declarada por pessoa no cadastro; o agente não presume.

---

## 5. O painel

Aplicação web autenticada (e-mail e senha). Quem já está logado cai no dashboard. Layout com barra lateral (desktop) e drawer (mobile), seletor de empresa e sino de notificações em todas as telas.

### 5.1 Dashboard executivo

Visão consolidada da empresa selecionada.

- KPIs de investimento, cliques, formulários, conversas de WhatsApp, CTR e — quando existir — receita/vendas.
- Filtro por conta de anúncios e por tipo de campanha (tráfego, mensagem, leadgen, vendas, engajamento, alcance, vídeo, app, outro).
- Gráfico de investimento por tipo.
- Tabela de contas (tipo dominante, gasto, resultados) e tabela de campanhas.
- Contas sem dado histórico aparecem como dormentes, não como conta zerada.
- Relatório semanal (segunda a domingo da semana anterior): investimento, formulários, conversas, cliques no link, custo por resultado **com a base correta de cada campanha** (formulário não se mistura com conversa). Lista o que **não** está disponível em vez de omitir. Cópia e exportação em planilha.

O custo por resultado **não** é “gasto total ÷ leads genéricos”. Cada campanha declara a base (formulários, conversas, cliques no link) e o custo vem dessa base. Somar bases diferentes numa conta inflava o número; o produto separa.

### 5.2 Empresas e contas

Cadastro de empresas e vínculo de contas de anúncios.

- Criar empresa.
- Ver integrações por provedor, com o estado real (não um “conectado” de mentira).
- Verificar conexão (handshake com a plataforma).
- Listar contas disponíveis no Business Manager e vincular à empresa.
- Uma conta não se vincula a duas empresas.

Provedor em operação na UI: **Meta Ads**. GA4, Search Console e Tag Manager existem no vocabulário de cadastro, mas estão ocultos: não há integração real.

### 5.3 Campanhas

Lista de campanhas da empresa, com filtros globais de período, status e tipo.

- Gasto, impressões, alcance, cliques, formulários, conversas, CTR, custo pela base da campanha.
- Status (ativa, pausada, arquivada).
- Pedido de pausa / ativação / escala: o visualizador pede; o administrador autoriza. Nada vai direto à Meta por esta tela — vira solicitação de aprovação.

### 5.4 Conjuntos e públicos

Cards por conjunto:

- Status, orçamento e estratégia (ABO/CBO).
- Resumo do targeting (idade, geo, interesses) em chips.
- Sinal de Advantage+.
- Gasto, resultados, CTR.

Filtros globais iguais aos de campanhas.

### 5.5 Anúncios e criativos

Cards por anúncio:

- Miniatura, nome, tipo de objeto, CTA.
- Gasto, formulários, conversas e CTR — **separados** (não existe “lead” genérico no anúncio).
- Link para o anúncio na Meta.
- Filtros globais.

### 5.6 Funil e conversões

Régua: impressões → cliques → cliques no link → formulários (e conversas, quando o recorte é de mensagem). Cada etapa tem glossário de origem. Respeita os mesmos filtros globais. Não inventa taxa quando o denominador é zero.

### 5.7 Alertas

Alertas gerados pelas rotinas diárias, ordenados por gravidade (crítico → baixo).

- Resolver (administrador).
- Destaque quando se chega pelo sino (`?item=`).
- Gravidade em português, não no código do banco.

### 5.8 Tarefas agendadas

Painel das rotinas automáticas (sync, alertas, digest, tokens, Drive, recomendações…).

Três grupos, de propósito: atrasada de verdade; rodou e não tinha trabalho; ainda não chegou a hora. “Nunca rodou” não é automaticamente vermelho.

Desfechos: concluída · rodou, nada a fazer · falhou · em andamento.

Administrador pode disparar de novo. Tarefa HTTP não termina no clique: o resultado aparece quando a conferência fecha o registro.

### 5.9 WhatsApp

Duas superfícies na mesma tela.

**Cloud API / WABA (somente leitura)**

- Inventário de números vivos (qualidade, tier de mensagem, status, WABA).
- Histórico de qualidade (leitura diária — o produto declara a data, não finge tempo real).
- Separação honesta: número Cloud ≠ destino Click-to-WhatsApp de anúncio (`wa.me`).
- Cascas legadas / duplicatas **não** entram no inventário operacional.
- Exportação em planilha.

**Infobip (disparos)**

- Importação de planilha de disparos.
- Volume, status, visto, custo, MAU.
- Recortes por período (30 / 90 / todos / intervalo).
- Exportação.

### 5.10 Metas e tetos

Tetos de custo por métrica da empresa (e, quando cadastrado, por marca/linha).

Métricas típicas: custo por formulário, custo por conversa, custo por lead na LP, custo do motor de alertas.

Cada teto declara a **fonte**: derivado do histórico (percentil do próprio passado), comando do gestor, ou edição manual. “Dentro do teto” significa consistência com o passado — **não** rentabilidade. O produto corrige se alguém tratar teto como meta de negócio.

Administrador edita. Editar recalibra os alertas na próxima avaliação (cron diário) ou na reavaliação imediata.

### 5.11 Operação (chat, aprovações e recomendações)

Tela central do produto. Três abas.

**Chat** — conversa com o agente sobre os dados reais da empresa selecionada. Ver seção 6.

**Aprovações** — fila dos cards emitidos pelo agente (e pedidos das telas). Aprovar, recusar, ver falha da última execução, reexecutar. Pedido sem decisão expira (padrão 24 h).

**Recomendações** — sinais detectados pelas rotinas (custo, fadiga, dica da Meta, etc.). Aceitar, descartar, abrir no chat com o prompt sugerido. Famílias e evidências visíveis; a redação da IA não inventa métrica que a evidência não tem.

O menu “Aprovações pendentes” está oculto (a fila vive dentro de Operação); a rota antiga continua acessível por URL.

### 5.12 Histórico e auditoria

Últimos eventos autenticados da empresa: quem fez o quê, em qual alvo, com qual detalhe. Pausar, aprovar, resolver alerta, editar meta, etc. entram aqui.

### 5.13 Configurações

- Perfil (e-mail, papel).
- Lembrete de que o modo padrão é somente leitura.
- Preferências de notificação (alertas por e-mail, novas recomendações, aprovações) — interruptor visível; efetivo para administrador.
- Atalho para conectar contas em Empresas.

### 5.14 Notificações (sino)

Presente em todas as telas autenticadas. Agrega alertas abertos e aprovações pendentes. Clique leva à tela e ao item. Toasts em tempo real, agrupados quando vários alertas nascem juntos (os crons da manhã). Urgência sobe quando a aprovação está perto de expirar.

### Filtros globais (campanhas, conjuntos, anúncios, funil)

- Período: tudo, 7 dias, 30 dias, mês corrente, intervalo.
- Status: todas, ativas, pausadas.
- Tipo de campanha.
- Persistidos na URL.

Campanhas e funil filtram a série diária. Anúncios e conjuntos mostram totais acumulados; o período ali é sinal, não recorte da série.

---

## 6. O chat Operação

É a superfície principal do agente. Fala com o gestor em linguagem de operação, sem jargão de implementação (nada de nome de função, tabela, token, versão).

### Como se conversa

- Texto.
- **Ditado por voz** (gravação → transcrição → o texto entra no campo).
- **Anexos**: imagem, PDF, planilha, texto (até 4 arquivos, teto de tamanho por arquivo).
- Várias conversas por empresa; criar, continuar, apagar.
- Markdown na resposta (tabelas, listas, ênfase).
- Continuação automática quando a resposta veio cortada ou o turno ainda não fechou o pedido.

### Dois modos de esforço

- **Turno síncrono** (`traffic-chat`): pergunta direta, leitura, card. O agente chama ferramentas, lê o retorno e responde na mesma conversa.
- **Análise profunda** (`traffic-agent-job`): pedido largo (avaliação completa, varredura de criativos, “supergestor”). Roda em segundo plano com card de progresso. O esforço escala com a pergunta (leve / padrão / fundo) — classificação no código, não no modelo. O gestor pode pedir profundo explicitamente pelo toggle.

O agente **não** diz “vou ler e te falo”. Se a pergunta pede veredito, a resposta traz veredito, evidência e recomendação — ou declara o buraco.

### Memória da conversa

O fio guarda o que já foi apurado (retornos de ferramenta, peças escolhidas, legendas, slate de um lote). Pedido seguinte não recomeça do zero. Conjuntos, anúncios e peças em construção ficam amarrados ao recorte certo (não misturar CONJ.2 com CONJ.4, nem linha A com linha B).

### Cards de ação no fio

Quando o agente propõe um ato, o card aparece **dentro do chat**: o que vai mudar, por quê, como desfazer, prazo de leitura. O administrador aprova ou recusa ali. Depois da aprovação, o executor corre; o card mostra se executou, se falhou, e se dá para tentar de novo. ID inventado na prosa é recusado: card só existe se foi gravado.

---

## 7. O que o agente sabe fazer

O agente não “sabe tudo de cabeça”. Ele tem ferramentas. Sem ferramenta, ele não inventa número. Se a leitura falha, o turno continua com catálogo local — pior resultado possível é o modelo responder de memória.

As capacidades abaixo existem hoje. Estão agrupadas pelo trabalho, não pelo nome interno da ferramenta.

### 7.1 Ler desempenho e estrutura

- Panorama da conta (gasto, resultados, contas ativas).
- Detalhe de campanha, conjunto e anúncio, com série diária.
- Ranking de anúncios (gasto, alcance, conversas, impressões, custo).
- Estrutura dos conjuntos (orçamento, geo, status) paginada.
- Funil de mídia e funil específico de crédito (quando a empresa é dessa categoria).
- Conteúdo criativo no ar (copy, mídia, status) — ativos separados de pausados/apagados. Anúncio excluído ou arquivado **sai** da memória operacional.
- Origem no Drive de um anúncio já publicado (qual pasta, qual arquivo).
- Panorama de UTMs dos anúncios.
- Instagram vinculado aos anúncios de uma campanha.
- WhatsApp da página (número usado no Click-to-WhatsApp) versus saúde dos números Cloud.
- Dicas da própria Meta (concorda / discorda / não aplicável), com a data em que a dica apareceu.
- Leitura direta do conector de mídia (Pipeboard) quando o dado canônico do banco não basta — o agente lista o catálogo e chama a ferramenta certa; não improvisar Graph na mão.

### 7.2 Diagnosticar

- Decompor custo (CPM, CTR, conversão da página) no anúncio certo.
- Avaliar fadiga criativa com sinais objetivos, não palpite.
- Avaliar se um conjunto aguenta escala (custo marginal, aprendizado, volume).
- Pacing do dia contra a meta de volume.
- Decidir sobre conjunto (manter / mexer / matar) com a régua da conta.
- Dizer se pausar por custo é defensável naquele anúncio.
- Casar peça do Drive com o desempenho do anúncio correspondente.
- Perfil vencedor (o que está funcionando agora) — computar e ler versões.

### 7.3 Criativos, copy e acervo

- Inventário do Google Drive da operação (pastas por linha/formato).
- Acervo pronto para virar anúncio (o que já foi para a biblioteca da Meta, o que ainda não).
- Análise visual das peças (nota, aptidão).
- Gerar legendas na voz da marca/linha, com o objetivo pedido, opcionalmente a partir da peça.
- Guardar, no fio, o slate do lote (quais peças, de qual conjunto).
- Registrar veredito humano sobre peça em revisão (liberar / ajustar / não usar) — registro, não assinatura.
- Subir mídia do Drive para a biblioteca da Meta (imagem ou vídeo; teto = o da Meta). **Não** cria anúncio sozinho.
- Checar se texto e peça combinam (linha, conjunto, campanha destino).

### 7.4 Conformidade

- Validar copy (e peça) antes de submeter: crédito aprovado, resultado garantido, atributo pessoal, categoria especial.
- Auditar campanha financeira já no ar (categoria especial declarada ou não).
- Portão de compliance **incapaz de aprovar por omissão**: se não conseguiu verificar, não libera. Silêncio não é verde.
- Proposta de publicar campanha de crédito declara quando a categoria **não** está verificada no sistema e depende de conferência humana.
- Base sem procedência de consentimento não vira público de mídia.

### 7.5 Identidade, destino e geo

- Identidade da marca (voz, restrições, destinos).
- Destino de URL / landing por produto.
- Busca de geolocalização na Meta (bairro, cidade, região, CEP).
- Presets jurídicos de geo quando a linha exige.
- WhatsApp e Instagram oficiais da linha — o anúncio não “escolhe um número qualquer”.

### 7.6 Saúde da plataforma

- Saúde das integrações (sync recente, snapshots, relógios).
- Saúde dos tokens (validade, data access, escopos, veredito).
- Score de prontidão para criar e executar anúncios (configuração, integração viva, postura de criação, identidade, destino, Drive).
- Custo de LLM no período (o próprio sistema, para o gestor ver o quanto a conversa custa).
- Entregas de digest (o que foi enviado por e-mail, e se falhou).
- Alertas e recomendações abertos.
- Aprovações pendentes.

### 7.7 Conhecimento e régua

- Consultar a base de conhecimento curada (otimização, unidade econômica, métricas, criativos, compliance, API, criação, evolução…) — o tema entra barato no prompt; o conteúdo só carrega quando pedido. Conteúdo vencido é “não confirmado”.
- Teto vigente de uma métrica: qual régua governa, valor, autor, data, se é meta de negócio ou consistência histórica, divergências.

### 7.8 Propor e executar atos na Meta

Tudo abaixo **emite card**. Nada publica sem aprovação (e sem as travas da empresa).

| Família | Atos |
|---|---|
| Liga / desliga | Pausar e ativar campanha, conjunto ou anúncio |
| Dinheiro | Alterar orçamento; escalar criativo; escalar por duplicação |
| Nome | Renomear campanha, conjunto ou anúncio (nome livre; homônimos pelo ID da Meta) |
| Targeting | Alterar geo do conjunto publicado (cidades/bairros); ajustar posicionamentos |
| Identidade | Vincular Instagram oficial nos anúncios da campanha; alterar categoria especial |
| Criação | Criar campanha; criar conjunto a partir de um molde; criar anúncio a partir de peça + copy |
| Biblioteca | Upload de mídia (pré-requisito de criação, também via card/rotina) |

Criação em lote é **degrau**, não rajada: o agente parte em etapas (limite de chamada da API + reinício de aprendizado). Pedido de “cria 6 agora” vira plano fatiado.

Antes de emitir criação, o pedido pode ser validado contra o **contrato de execução** daquela ação (campos obrigatórios, evidência, destino, linha). Card malformado não sai.

Excluir objeto na Meta **não** existe como ação do produto. O sync marca `DELETED`; a leitura deixa de mostrar.

### 7.9 O que o agente recusa

- Gastar dinheiro ou publicar sozinho.
- Contornar trava desligada.
- Agir em conta em quarentena ou conta de outra empresa.
- Inventar número, arredondar para o lado bonito, ou chamar estimativa de medição.
- Dizer “não temos esse dado” sem ter consultado.
- Dizer “não existe” quando a consulta veio incompleta.
- Prometer resultado.
- Tratar CPL como lucro.
- Escrever copy que sugira crédito aprovado, garantia ou característica pessoal conhecida.
- Analisar plataforma além da Meta (o sistema não tem esse dado).
- Falar de implementação com o gestor.
- Política de crédito, esteira bancária, atendimento humano, decisão de produto — fora de escopo; o agente diz a quem pertence.

---

## 8. Como a execução realmente acontece

Quatro camadas, e elas não se misturam:

| Camada | Responde | Onde vive |
|---|---|---|
| Persona | Quem o agente é, o que recusa, hierarquia de decisão | Prompt |
| Estilo | Como escreve (blocos, tabelas, ênfase, ressalvas) | Banco, editável sem deploy |
| Conhecimento | O que sabe fazer (temas com validade) | Banco |
| Travas | O que pode executar | Código + configuração **por empresa** + estado **por conta** |

Fluxo de um ato:

1. O gestor pede (chat) ou uma tela/rotina gera o pedido.
2. O agente (ou a tela) emite um **card** com justificativa, mecanismo, métrica de sucesso, janela de leitura e reversa.
3. O card entra na fila, com prazo.
4. Um administrador aprova ou recusa. Sem decisão, expira.
5. Aprovação dispara o executor (`meta-actions`), que fala com a Meta (via conector e/ou Graph).
6. O resultado volta ao card. Falha fica visível, com motivo para o gestor e se é reexecutável.
7. Tudo entra na auditoria.

Travas típicas por empresa (ligadas por humano, não pelo agente):

- Master de execução.
- Flag por tipo de ação.
- Dry-run.
- Rate limit.
- Compliance de texto bloqueante na pré-submissão de criativo e de modelo de mensagem.

Conta em quarentena vence a flag da empresa.

---

## 9. Coleta, rotinas e o que roda sozinho

O painel mostra o que já foi coletado. Por trás, rotinas diárias (e algumas horárias / a cada poucos minutos) alimentam o banco. A tela **Tarefas agendadas** é a vitrine disso.

Famílias de rotina hoje:

**Estrutura e métricas da Meta**

- Espelhar campanhas, conjuntos e anúncios (status, nomes, targeting).
- Série diária de métricas (gasto, impressões, cliques, formulários, conversas…).
- Snapshot diário de configuração de campanha (foto — mudança feita e revertida no mesmo dia é invisível; o produto declara essa limitação).
- Breakdowns (quando a rotina está ligada).
- Espelho de status e saúde do Business Manager / contas.

**WhatsApp**

- Sync dos números Cloud (qualidade, tier, modelos).
- Alertas de qualidade crítica / tier.

**Tokens e saúde**

- Monitor de validade e escopos dos tokens Meta.
- Vigia de frescor do dado (se a coleta atrasou, o buraco é declarado — não se finge que o número de ontem é de agora).

**Drive e biblioteca**

- Varredura das pastas de criativos.
- Escoamento horário de imagens e vídeos pendentes para a biblioteca da Meta (teto por hora; se não há pendente, a rotina registra “nada a fazer”).

**Inteligência**

- Avaliação de alertas contra os tetos.
- Perfil de criativos vencedores.
- Sinais de recomendação (diário e semanal).
- Redação das recomendações da IA a partir dos sinais (sem inventar métrica).
- Relatório diário no chat.
- Digest por e-mail (horários configurados por empresa) e dreno de alertas críticos.
- Expirar aprovações e jobs de chat órfãos.
- Validade do conhecimento do agente (conteúdo que passou da data de revalidar).

Toda rotina passa por um registro de execução: sucesso, vazio, falha. Cron que só “enfileirou o POST” não conta como concluída até a conferência.

---

## 10. Integrações

| Integração | Papel no produto |
|---|---|
| **Meta Ads** (Graph + conector Pipeboard) | Fonte de estrutura, métricas, escrita (criar/pausar/renomear/geo/orçamento), identidade, WhatsApp da página, CAPI de teste |
| **WhatsApp Cloud API (WABA)** | Qualidade, tier, templates, números oficiais |
| **Google Drive** | Acervo de criativos; origem das peças que viram anúncio |
| **OpenRouter (LLM)** | Chat, job profundo, redação de recomendações, legendas, transcrição auxiliar |
| **Resend** | Digest e alertas críticos por e-mail |
| **Infobip** | Importação manual de disparos (não é sync automático) |
| **Supabase Auth** | Login, papéis, RLS |

Há endpoints de sonda e saúde (token, identidade, BM, secrets, verificação de integração, acesso ao Drive, transcrição de áudio, CAPI em modo teste). Servem operação e diagnóstico — não são telas do gestor.

Um servidor MCP interno expõe leitura de métricas e estado para automações da casa, com a mesma autenticação das rotinas.

**Fora do recorte operacional hoje:** Google Ads, GA4, Search Console e Tag Manager não coletam. Outro canal de mídia, discagem ou disparo sem gasto no sistema implica **atribuição disputada**: custo por resultado daqui é da Meta, não de “todos os canais”.

Não há CRM no produto: receita, proposta e contrato **não** entram. CPL é proxy declarado. Não há perfil demográfico (idade/gênero) para análise.

---

## 11. Princípios de dado (o produto mente menos que a média)

- **Falha de carga ≠ lista vazia.** Empresa que não carregou não vira “nenhuma empresa cadastrada”. Consulta incompleta não vira “não existe”.
- **Lacuna declarada.** Relatório e digest listam o que não está disponível.
- **Data da leitura.** Qualidade de WhatsApp, tier, status de modelo e configuração de campanha são foto diária. Decisão que depende disso cita a data.
- **Denominador honesto.** Custo sem entrega é “—”, não zero. Formulário e conversa não se somam num “lead”.
- **Isolamento.** Token, Drive, teto, doutrina e conversa são da empresa. Empréstimo de token entre empresas é falha, não fallback.
- **Fail closed.** Portão de compliance, prontidão para criar, conta sem dono, trava desligada: na dúvida, não executa.
- **O teste cobra raciocínio, não um número congelado.** Número de operação envelhece; o produto não deve “consertar o agente” para casar com um teste velho.

---

## 12. O que o produto deliberadamente não é

- Não é CRM, esteira de crédito, nem ferramenta de atendimento.
- Não é gerenciador genérico de todas as plataformas de anúncio — é Meta, com honestidade sobre o que falta.
- Não é robô que liga campanha sozinho. Autonomia sem trava humana seria mudança de doutrina, não um interruptor escondido.
- Não substitui o Gerenciador da Meta para conferência de categoria especial enquanto esse campo não estiver coletado de ponta a ponta.
- Não mede saldo da conta de anúncios nem capacidade de pagamento (o agente pergunta ao humano).
- Não é a fonte da verdade de canais que gastam fora da Meta.

---

## 13. Mapa das telas

| Rota | O que o usuário encontra |
|---|---|
| `/` | Landing (se autenticado, vai ao dashboard) |
| `/auth` | Entrar / criar conta |
| `/dashboard` | KPIs, contas, campanhas, relatório semanal |
| `/empresas` | Empresas, contas, verificação de integração |
| `/campanhas` | Lista operacional + pedido de ato |
| `/conjuntos` | Conjuntos, públicos, orçamento |
| `/anuncios` | Criativos no ar |
| `/funil` | Conversão por etapa |
| `/alertas` | Fila de alertas |
| `/tarefas` | Rotinas automáticas |
| `/whatsapp` | Saúde WABA + Infobip |
| `/metas` | Tetos de custo |
| `/recomendacoes` | Operação: chat, aprovações, recomendações |
| `/aprovacoes` | Fila (URL; menu oculto) |
| `/auditoria` | Log de ações humanas |
| `/configuracoes` | Perfil, papel, preferências |

---

## 14. Stack (para localizar o produto, não para operar)

- **Front:** React, TanStack Start/Router, Vite, Tailwind. Publicado na Vercel a partir do `main`.
- **Dados e auth:** Supabase (Postgres, RLS, Auth).
- **Agente e rotinas:** Edge Functions (chat, job profundo, executor Meta, syncs, digest, WABA, Drive, transcrição).
- **LLM:** via OpenRouter, com roteamento de modelo e tetos de custo/tempo.
- **Mídia:** Meta Graph + Pipeboard; criativos no Google Drive.

O Vercel não publica as edges: mudança de agente ou de sync exige deploy da function. Mudança de banco exige migration no projeto remoto.

---

## 15. Em uma frase

O Gestor de Tráfego IA é o sistema em que a operação **vê** a Meta com dados honestos, **conversa** com um gestor de tráfego que não inventa, **aprova** cada real e cada publicação, e **executa** só o que um humano autorizou — empresa por empresa, linha por linha, com teto, compliance e WhatsApp no mesmo recorte.
