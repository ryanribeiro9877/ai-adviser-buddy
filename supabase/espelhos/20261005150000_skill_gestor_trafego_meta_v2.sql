-- Skill gestor-trafego-meta v2 (05/10/2026) — GERADO por scripts/gerar_skill_gestor_trafego.ts
-- Fonte: supabase/conhecimento/gestor-trafego-meta/*.md. Nao edite aqui: edite o .md e gere de novo.
--
-- O que muda: a skill local (10 referencias) era mais nova que a importada em 10/09 (8 principios).
-- Entram 9 temas novos de METODO com validade propria e o tema mestre reescrito. Os temas antigos
-- vencidos (otimizacao, metricas, criacao, compliance, api, diagnostico_especialista) NAO tem a
-- data reaberta: o metodo novo nao confirma limiar de plataforma, e os limiares nos temas novos
-- estao escritos como ponto de partida a confirmar.

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'gestor_trafego_meta',
  $d$Skill mestra v2 do Super Gestor: escopo, hierarquia de decisao, principios, recomendacao com cinco partes, formato da resposta, mapa de temas, ferramentas do sistema, fluxos e anti-alucinacao. Comece AQUI em pedido de METODO.$d$,
  $conteudo$# Skill mestra — Gestor de Tráfego Meta (v2)

Pacote `gestor-trafego-meta` revisado e importado em 05/10/2026. Isto é MÉTODO, não persona e não número desta conta. Os detalhes vivem nos temas listados em "Quando carregar cada tema". Números de plataforma (limiares da Meta) são ponto de partida com data, nunca regra universal.

## Escopo

- DENTRO: campanha, conjunto, anúncio, criativo, orçamento, lance, público, posicionamento, pixel/CAPI, métrica, política Meta, planejamento e relatório de mídia.
- FORA: esteira interna, política de crédito, bancos parceiros, atendimento humano, decisão de produto. CRM (proposta, contrato) não existe no sistema: custo por conversa/formulário é PROXY, nunca lucro. Diga a quem pertence a pergunta fora de escopo e siga.
- Compliance de crédito (CREDIT, CET, FIN-*) só quando ESTA empresa for de crédito. COHAPM (jurídico, imóvel, ocular) não é de crédito.
- Só Meta. Atribuição de outros canais é disputada; custo por resultado daqui é da Meta.

## Hierarquia de decisão

Quando duas recomendações boas puxam para lados diferentes, resolva nesta ordem e diga qual critério venceu:

1. Não causar dano irreversível — conta de anúncios, número de WhatsApp, página/perfil, exposição regulatória.
2. Verdade sobre o dado — lacuna declarada vale mais que número bonito.
3. Proteger o custo — tetos e gasto sob controle.
4. Volume e escala — só depois das três acima.
5. Elegância da análise — nunca acima de nenhuma das quatro.

## Princípios

1. **Declare o recorte.** Empresa, categoria (crédito ou não), nível (conta, campanha, conjunto, anúncio) e janela. CBO/Advantage+ budget → julgue a CAMPANHA. Vários anúncios ou posicionamentos automáticos → julgue o CONJUNTO.
2. **Marginal > médio.** A Meta otimiza o custo do PRÓXIMO resultado. Nunca pause segmento só por custo médio maior no breakdown.
3. **Uma decisão por leitura.** Mexer em três coisas ao mesmo tempo impede saber qual funcionou. Pedido de várias mudanças vira sequência, com o porquê.
4. **Custo alto não é culpa do criativo até prova.** Ordem: entrega → público → frequência → calendário → destino → criativo (tema `doutrina_diagnostico`).
5. **Amostra pequena vira pergunta.** Poucos resultados, poucos dias, uma peça: hipótese + quanto dado falta para decidir.
6. **Status real, não espelho.** "Ativa" no banco não prova entrega. Confirme status efetivo antes de diagnosticar queda.
7. **Período antes de tendência.** Média longa esconde inflexão; ordem das datas antes de causalidade.
8. **Empresas e linhas não se cruzam.** Tetos, produtos, voz, WhatsApp de destino e categoria são de cada linha. Cruzar é recusa.
9. **Escrita só por card.** Todo ato na Meta vira card (`propose_action`) aprovado por humano. Excluir não é ato; pausar é.

## Recomendação de ato

Toda recomendação traz as cinco partes; falta uma, é opinião, não recomendação:

| Parte | Responde |
|---|---|
| Evidência | o número, na base certa, com nível e janela |
| Mecanismo | por que o ato muda o resultado |
| Critério de sucesso | qual métrica, em que direção e quanto |
| Prazo de leitura | data ou volume de resultados para reavaliar |
| Reversa | como desfazer em um passo |

Atos de dinheiro e criação declaram também a exposição financeira no pior caso até a leitura.

## Formato da resposta

- O formato que o gestor pediu vence o modelo da casa. Pediu análise → entregue análise; tabela só quando ele pedir tabela ou quando ela for a própria evidência.
- Sem pedido de formato: Recorte → O que o dado diz → Diagnóstico (hipótese, evidência, o que foi descartado) → Recomendação (uma por leitura, com as cinco partes) → O que não sei.
- Veredito primeiro. Não narre intenção ("vou ler…"): entregue veredito, evidência e recomendação, ou declare o buraco.
- Linguagem de operação. Proibido falar de função, tabela, token ou versão com o gestor.
- Alcance em "contas" (nunca "pessoas"). "Cliques" nunca sozinho: cliques (todos) ou cliques no link.

## Quando carregar cada tema

| Situação | Tema (`get_conhecimento`) |
|---|---|
| Método geral — comece aqui | `gestor_trafego_meta` |
| Custo alto, fadiga, manter/mexer/matar, escala, pacing | `doutrina_diagnostico` |
| Meta de volume E teto de custo ao mesmo tempo; tendência em janela curta | `metas_conjuntas` |
| Calcular ou nomear métrica; relatório; teto | `metricas_bases` |
| Aprendizado, leilão, breakdown, CBO×ABO, lance, flutuação | `mecanica_meta` |
| Propor qualquer ato (card) | `contrato_card` |
| Click-to-WhatsApp, número WABA, página, Instagram | `whatsapp_ativos` |
| Auditoria de conta, prontidão, relatório semanal | `auditoria_meta` |
| Lições de produção antes de criar ou propor | `armadilhas_operacao` |
| Empresa de crédito: copy, peça, Fair Lending | `compliance_credito` |
| Detalhe histórico (alguns vencidos — declare) | `otimizacao`, `metricas`, `criacao`, `api`, `diagnostico_especialista`, `unidade_economica` |
| Criativo (hook, formato, mecânica, voz) | `criativo_hooks`, `criativo_formatos`, `criativo_mecanicas`, `criativo_voz` |

## Ferramentas do sistema

O agente lê pelas ferramentas da casa; Graph direto não é caminho do agente.

| Preciso de | Ferramenta |
|---|---|
| Panorama da conta | `get_overview`, `get_funnel` |
| Campanha → conjuntos → anúncios com série diária | `get_detalhe_anuncios`, `get_campaign_detail`, `get_estrutura_conjuntos` |
| Ranking de peças | `get_ads_ranking` (atenção ao efeito de breakdown) |
| Diagnóstico pronto | `diagnosticar_custo`, `avaliar_fadiga`, `avaliar_escala`, `avaliar_pacing`, `decidir_sobre_conjunto`, `pode_pausar_por_custo` |
| Teto vigente da métrica | `teto_vigente` |
| Perfil vencedor | `ler_perfil_vencedor`, `computar_perfil_vencedor` |
| WhatsApp | `get_waba_status`, `get_whatsapp_da_pagina` |
| Dicas da Meta (com data) | `get_meta_dicas` |
| Leitura direta do conector quando o banco não basta | `ler_pipeboard` (liste antes com `listar_ferramentas_pipeboard`) |
| Propor ato | `propose_action` (card) |
| Compliance | `check_compliance`, `checar_par_texto_e_peca`, `auditar_compliance_financeira` |

Leitura incompleta não é inexistência: diga "consulta incompleta". Retorno vazio por erro não é lista vazia.

## Fluxos neste sistema

**Diagnosticar:** status real e entrega → nível de avaliação → aprendizado → decompor o custo (CPM, CTR de link, conversão pós-clique) e dizer qual fator moveu → hipótese com o que foi descartado → uma recomendação.

**Meta de volume com teto de custo:** tema `metas_conjuntas` — viabilidade (meta × teto contra verba e custo atuais) antes de qualquer opinião sobre criativo.

**Propor ato:** tema `contrato_card`; uma decisão por leitura; objeto criado nasce pausado.

**Criar anúncio:** mesma linha (peça, copy, conjunto, destino); compliance do par peça + copy antes do card; diversidade real (formato × ângulo), não cinco versões da mesma ideia.

**Reportar:** resumo (3 achados) → recorte e janela de atribuição → aprendizado → funil de mídia → diagnóstico → recomendações com cinco partes → o que não está disponível.

## Anti-alucinação

- Não invente métrica, benchmark ou "média de mercado" sem fonte e data.
- Toda contagem declara filtro (status, período, gasto > 0).
- Não misture janelas de atribuição nem bases de resultado na mesma conta.
- Custo sem entrega é "—", não zero. Denominador zero não vira taxa.
- "Não temos esse dado" só depois de consultar. "Não existe" só quando a consulta veio completa.
- Tema com validade vencida: use como método e declare que o número de plataforma precisa ser reverificado.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'doutrina_diagnostico',
  $d$Ordem de investigacao do custo alto (entrega, publico, frequencia, calendario, destino, criativo), decomposicao do custo, fadiga com tres sinais, manter/mexer/matar, escala por custo marginal, pacing, perfil vencedor e quando a resposta e pergunta.$d$,
  $conteudo$# Doutrina de diagnóstico

Como chegar a um veredito defensável sobre custo, fadiga, escala e pacing — na ordem em que um gestor experiente olha, não na ordem em que o painel mostra. Limiares numéricos aqui são PONTO DE PARTIDA: a régua é o histórico da própria conta, e a decisão declara qual régua usou.

## Ordem de investigação do custo

O criativo é o último suspeito. Percorra na ordem, pare na causa dominante e **declare o que foi descartado**.

| # | Camada | Perguntas | Sinais |
|---|---|---|---|
| 1 | Entrega | Aprendizado? Aprendizado limitado? Anúncio rejeitado ou restrito? Gastou o orçamento? | Status de entrega, gasto vs orçamento, data da última edição significativa |
| 2 | Público | Tamanho, sobreposição entre conjuntos, exclusões, quente vs frio | Alcance acumulado vs tamanho; dois conjuntos disputando o mesmo leilão |
| 3 | Saturação | Frequência subindo com CTR caindo? Alcance estagnou? | Compare com o histórico da própria peça |
| 4 | Calendário | Fim de mês, feriado, evento, sazonalidade, leilão mais caro para todos | CPM da conta inteira subiu junto → não é a peça |
| 5 | Destino | LP lenta, formulário quebrado, wa.me errado, UTM quebrando | CTR ok e conversão pós-clique caiu → problema depois do clique |
| 6 | Criativo | Só agora: hook, formato, mensagem, aptidão ao posicionamento | Compare peças no mesmo conjunto e na mesma janela |

## Decomposição do custo

custo por resultado ≈ (CPM ÷ 1000) ÷ (CTR de link × conversão pós-clique)

Diga qual dos três fatores moveu e quanto:
- CPM subiu → leilão, calendário ou público (não é a peça, salvo relevância baixa).
- CTR de link caiu → peça, saturação ou posicionamento.
- Conversão pós-clique caiu → página, formulário, wa.me, UTM.

## Fadiga criativa

Fadiga é hipótese que exige três sinais concorrentes na MESMA peça:
1. Frequência crescendo ao longo da janela.
2. CTR de link caindo em relação à média da própria peça nas primeiras semanas.
3. CPM ou custo por resultado subindo SEM alta equivalente na conta inteira.

Um sinal → observar. Dois → preparar substituto. Três → propor troca (card), mantendo a peça antiga até o substituto sair do aprendizado. Peça com poucos dias de vida não tem fadiga: tem aprendizado.

## Manter mexer ou matar

| Situação | Decisão | Por quê |
|---|---|---|
| Em aprendizado, poucos resultados | Manter | Julgar agora é ler ruído; editar reinicia o aprendizado |
| Fora do aprendizado, dentro do teto, volume estável | Manter | Funciona; mexer é risco sem ganho |
| Fora do teto, amostra pequena | Manter e datar | Diga em que data/volume a amostra permite decidir |
| Fora do teto com amostra suficiente e uma causa clara | Mexer uma coisa | Um ajuste, um prazo, uma leitura |
| Fora do teto, sem causa clara, sangrando há mais de duas leituras | Matar (pausar) | Pausar é reversível; continuar não devolve o gasto |
| Custo bom e volume insuficiente para a meta | Ir ao tema `metas_conjuntas` | É conta de viabilidade, não de corte |

"Amostra suficiente" parte de dezenas de resultados no nível julgado (historicamente ~50 na janela de aprendizado — confirme na Central de Ajuda da Meta e cite a data). "Matar" é pausar; excluir não é ato do produto.

## Escala

Antes de propor aumento de orçamento ou duplicação:
- **Custo marginal:** os últimos dias custaram mais por resultado que a média? Então escalar compra resultado ainda mais caro.
- **Aprendizado:** aumentos grandes de orçamento tendem a reiniciar o aprendizado (ponto de partida: degraus de ~20% — confirme).
- **Volume:** conjunto com poucos resultados por dia escala em ruído.
- **Público:** alcance perto do tamanho estimado → não há para onde escalar sem ampliar.
- **Teto:** o custo escalado ainda cabe no teto?

Duplicar preserva o original e é reversível por pausa; subir orçamento é mais simples, mas contamina a leitura do original.

## Pacing do dia

Compare gasto acumulado com orçamento × fração do dia, e resultados acumulados com meta × a mesma fração.
- Gastou rápido e converteu na proporção → ok.
- Gastou rápido e converteu menos → custo subindo intradiário; leia posicionamento e horário antes de mexer.
- Gastou menos → entrega limitada (público, lance, aprendizado, rejeição).

Dia em aberto não entra em veredito de custo. Pacing intradiário é sinal para amanhã, não decisão de agora.

## Perfil vencedor

"O que funciona agora" vem de peças com amostra suficiente na janela recente, comparadas pela MESMA base e no MESMO tipo de campanha, com data. Serve para orientar a próxima peça e o próximo público — nunca para justificar segmentação proibida.

## Quando a resposta é pergunta

- Amostra pequena.
- Dado com mais de um dia de atraso quando a decisão é de hoje.
- Fontes divergentes (conector vs banco vs Gerenciador) sem reconciliação.
- Meta de negócio não declarada (custo "bom" em relação a quê?).
- Saldo ou forma de pagamento da conta.

Formule a pergunta com o que falta e o que você fará com a resposta.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'metas_conjuntas',
  $d$Meta de volume E teto de custo ao mesmo tempo: conta de viabilidade (meta x teto vs verba e custo atuais), tendencia em janela curta, criativo que estreia no meio da janela, onde buscar o volume e como responder.$d$,
  $conteudo$# Metas conjuntas — volume e teto de custo ao mesmo tempo

Lacuna da skill original, escrita em 05/10/2026 a partir de um pedido real ("107 conversas por dia, no máximo R$ 7,00 cada"). Quando o gestor dá meta de VOLUME e teto de CUSTO juntos, a primeira pergunta não é "qual criativo é melhor": é "a conta fecha?".

## Conta de viabilidade

Faça a conta antes de opinar, e mostre-a:

1. **Verba máxima compatível** = meta de volume × teto de custo. Ex.: 107 × R$ 7,00 = R$ 749/dia.
2. **Volume que a verba atual compra no custo atual** = orçamento/dia ÷ custo atual por resultado.
3. **Redução de custo necessária** = 1 − (teto ÷ custo atual).
4. Compare: orçamento atual vs verba máxima; volume comprado vs meta.

Leituras possíveis:
- Orçamento ≈ verba máxima e custo acima do teto → o problema é CUSTO; mais verba não resolve e estoura o teto.
- Orçamento < verba máxima e custo dentro do teto → o problema é VERBA ou ENTREGA; escala com os gates de `doutrina_diagnostico`.
- Custo atual muito acima do teto (ex.: 3×) → a meta não fecha com a estrutura atual nesta janela; diga isso com o número e o que precisaria mudar.

## Tendência com janela curta

- Tendência compara o COMEÇO com o FIM da janela (metade × metade), nunca a média.
- Dia em aberto fica fora da média e do custo; pode ser citado como "até agora".
- Com menos de ~4 dias fechados, "tendência" é hipótese — diga quantos dias faltam para confirmar.
- Campanha nova está em aprendizado: volume subindo nos primeiros dias é o algoritmo achando entrega, não prova de criativo vencedor.
- Volume subindo com custo subindo junto é comprar conversa mais cara, não melhorar. Diga as duas direções.

## Criativo que estreia no meio da janela

- Conte a peça a partir do primeiro dia com gasto; dia antes de existir não é dia zero.
- Variação de 0 → 1 resultado por dia é ruído, não tendência.
- Compare peças no mesmo conjunto (mesmo público e orçamento); entre conjuntos, a comparação é de conjunto.

## Onde buscar o volume que falta

Na ordem, cada uma com as cinco partes da recomendação:
1. **Realocar dentro do que já existe:** verba de conjunto/peça que estoura o teto sem causa clara para o que entrega dentro ou perto do teto — respeitando aprendizado e custo marginal.
2. **Cortar o que sangra:** peça com gasto relevante e zero resultado em duas leituras.
3. **Atacar o fator do custo:** decompor (CPM, CTR de link, conversão pós-clique) e mexer no fator que moveu — destino/wa.me antes de peça nova.
4. **Testar peça nova** no conjunto com melhor custo, quando o diagnóstico apontar o criativo.
5. **Rever a meta:** se a conta mostra que a meta não fecha nem com o melhor custo observado, diga com o número.

## Como responder

1. Veredito em 2–4 linhas: fecha ou não fecha, e o número que decide.
2. Critério de volume: média dos dias fechados, distância da meta, direção da tendência.
3. Critério de custo: custo atual vs teto, por campanha, conjunto e peça; sem resultado = "sem resultado", nunca custo zero.
4. A conta de viabilidade.
5. Ações que fecham a conta, uma por leitura, com efeito esperado em volume e custo.
6. Ressalvas que mudam a decisão (dias fechados, aprendizado).
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'metricas_bases',
  $d$Metricas pela base honesta: base por tipo de campanha, nomenclatura (cliques todos x no link, alcance em contas), funil, janelas e datas, tetos com fonte e comparacoes que nao valem.$d$,
  $conteudo$# Métricas e bases honestas

O erro mais comum em relatório de tráfego é somar bases diferentes numa conta só.

## Base por campanha

| Tipo de campanha | Base de resultado | Custo por resultado |
|---|---|---|
| Leadgen (formulário instantâneo / LP) | Formulários | Gasto ÷ formulários |
| Mensagem (Click-to-WhatsApp, Messenger) | Conversas iniciadas | Gasto ÷ conversas |
| Tráfego | Cliques no link | Gasto ÷ cliques no link |
| Vendas / conversões | Compras (ou evento declarado) | Gasto ÷ compras |
| Engajamento / alcance / vídeo | Engajamentos, alcance, ThruPlays | Gasto ÷ base — sem chamar de "lead" |

- Formulário NÃO se soma com conversa. Não existe "lead genérico".
- Conta com bases diferentes tem vários custos por resultado, um por base, ou nenhum consolidado.
- Custo sem entrega é "—", não zero.
- CPL, CPA e custo por conversa são PROXY. Sem CRM, receita e contrato não entram; "dentro do teto" não é "rentável".

## Nomenclatura

| Campo bruto | Como escrever |
|---|---|
| clicks | Cliques (todos) |
| inline_link_clicks | Cliques no link |
| ctr | CTR (todos) |
| inline_link_click_ctr | CTR de link |
| reach | Alcance (contas — nunca "pessoas") |
| frequency | Frequência |
| cpm | CPM |
| cpc | CPC (todos) ou CPC de link — especifique |
| messaging_conversation_started_7d | Conversas iniciadas |
| lead / lead_grouped | Formulários |
| spend | Investimento |

"Cliques" sozinho é proibido na prosa.

## Funil

Impressões → cliques (todos) → cliques no link → formulários ou conversas. Taxa entre etapas só quando o denominador existe. Proposta e contrato estão fora do funil de mídia.

## Janelas e datas

- Série diária para tendência; totais da janela para comparar peças e conjuntos.
- Declare a data da última coleta. Dado de ontem não é de agora; dia em aberto é parcial.
- Configuração é foto diária: mudança feita e desfeita no mesmo dia é invisível.
- Janela de atribuição (1 dia clique, 7 dias clique, visualização) muda o número; declare qual.

## Tetos

Cada teto declara a fonte:
- **Histórico** — percentil do passado da própria empresa: "consistente com o que a conta já fez", não "rentável".
- **Comando do gestor** — meta declarada por humano (ex.: "no máximo R$ 7,00 por conversa").
- **Edição manual** — ajuste administrativo.

Teto avalia a métrica na base certa: teto de custo por formulário não avalia campanha de mensagem.

## Comparações que não valem

- Empresa A vs empresa B.
- Campanha de formulário vs campanha de conversa pelo "custo por lead".
- Peça no conjunto X vs peça no conjunto Y sem controlar público e orçamento.
- Semana com feriado vs semana cheia sem declarar.
- Meta vs "todos os canais".
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'mecanica_meta',
  $d$Mecanica da Meta: leilao, fase de aprendizado, efeito de breakdown (marginal x medio), pacing, CBO x ABO, Advantage+, relevancia, lance, frequencia e flutuacao. Limiares sao ponto de partida — confirme na fonte oficial.$d$,
  $conteudo$# Mecânica da Meta

Para não ler errado o que o algoritmo faz. Baseado na documentação pública da Meta e em material aberto de praticantes. Números de plataforma envelhecem: quando a decisão depender de um limiar, trate-o como ponto de partida, confirme na fonte oficial e cite a data.

## Leilão

Cada impressão é um leilão; vence o maior valor total (lance × taxa estimada de ação + qualidade/relevância).
- CPM alto na conta inteira → pressão de leilão (calendário, concorrência), não a peça.
- CPM alto só numa peça → relevância baixa ou público mal casado.
- Conjuntos da mesma conta com público sobreposto disputam entre si → sinal para consolidar, não para criar mais conjuntos.

## Fase de aprendizado

- Conjunto novo ou com edição significativa entra em aprendizado; sai após volume mínimo de resultados numa janela curta (historicamente ~50 em 7 dias — confirme).
- Durante o aprendizado: custo mais alto e resultados instáveis, NÃO indicativos.
- Edições significativas (orçamento, público, criativo, otimização, lance) reiniciam o aprendizado.
- "Aprendizado limitado": não alcança volume → consolidar conjuntos, ampliar público, subir orçamento ou trocar evento.

Não julgue nem edite durante o aprendizado; quando pedirem decisão, conte quantos resultados faltam.

## Efeito de breakdown

A Meta otimiza custo MARGINAL, não custo médio por segmento. Segmento com média alta pode estar absorvendo volume que custaria ainda mais em outro lugar.

| Automação | Nível de avaliação |
|---|---|
| Orçamento de campanha (CBO / Advantage+ budget) | Campanha |
| Posicionamentos automáticos sem CBO | Conjunto |
| Vários anúncios num conjunto | Conjunto |

- Nunca recomendar pausa de segmento só por custo médio maior no breakdown.
- Corte de segmento é hipótese testável com sucesso medido no AGREGADO.
- Breakdown serve para sinal criativo, detectar vazamento (cliques com zero conversão) e compliance.

## Pacing

A Meta distribui o orçamento diário ao longo do dia buscando o menor custo. Gasto irregular intradiário é normal; gasto muito abaixo do orçamento indica entrega limitada. O gasto diário pode passar do orçamento num dia e compensar na semana — declare antes de alarmar.

## CBO e ABO

- CBO (orçamento na campanha): a Meta distribui pelo marginal; boa para escala, ruim para teste controlado.
- ABO (orçamento por conjunto): controle e teste; muitos conjuntos pequenos ficam mais tempo em aprendizado.

Escolha pela pergunta (escala vs teste), não por preferência.

## Advantage+

Público e posicionamentos Advantage+ ampliam a busca; ligar não é falha nem virtude — é decisão testável. Criativo flexível (Advantage+ creative) pode não expor a estrutura completa pela API: atenção ao escolher molde para clonar.

## Relevância

Rankings de qualidade, engajamento e conversão (acima/abaixo da média) explicam CPM alto de uma peça. Conversão abaixo da média com qualidade ok → problema pós-clique ou promessa descasada do destino.

## Lance

- Menor custo (padrão): gasta o orçamento buscando o menor custo, sem teto.
- Limite/meta de custo: pode limitar a entrega se irreal.
- Limite de lance: para quem sabe o valor do resultado.

Mudar lance é edição significativa.

## Frequência

Frequência alta não é fadiga por si só (remarketing convive com ela). É fadiga quando vem com queda de CTR e alta de custo na mesma peça. A régua é o histórico da conta.

## Flutuação

Em conjuntos pequenos, variação diária de custo de ±20–30% é ruído (ponto de partida). Leia em janelas móveis de 7 dias antes de reagir; com menos dias, declare a limitação.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-01-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'contrato_card',
  $d$Contrato do card de aprovacao: campos obrigatorios, familias de ato e reversa, ciclo de vida, travas, criacao em lote e linguagem do card para o gestor.$d$,
  $conteudo$# Contrato do card de aprovação

Todo ato na Meta passa por um card (`propose_action`). Sem card gravado, não houve proposta; sem aprovação humana, não há execução. Não descreva como "emitido" um card que não foi gravado.

## Campos obrigatórios

| Campo | Responde | Falta → |
|---|---|---|
| Empresa / linha | De quem é o ato | Card não sai |
| Conta (ID externo) | Onde | Card não sai |
| Alvo (com ID da Meta) | Em que objeto (homônimos se resolvem por ID) | Card não sai |
| Ato | O que muda, exatamente (valor atual → valor novo) | Card não sai |
| Evidência | Qual dado motivou, com data da leitura | Card não sai |
| Mecanismo | Por que o ato muda o resultado | Card não sai |
| Critério de sucesso | Métrica, base, direção e magnitude | Card não sai |
| Prazo de leitura | Data ou volume de resultados | Card não sai |
| Reversa | Como desfazer | Card não sai |
| Exposição financeira | Pior caso de gasto até a leitura | Obrigatório em dinheiro e criação |
| Compliance | Aprovado / não verificável / bloqueado | Obrigatório em criação e copy/peça |
| Validade | Prazo na fila (padrão 24 h) | Assume padrão |

## Famílias de ato

| Família | Atos | Reversa típica |
|---|---|---|
| Liga / desliga | Pausar, ativar | Inverter |
| Dinheiro | Orçamento; escalar; duplicar | Restaurar orçamento; pausar duplicata |
| Nome | Renomear | Renomear de volta |
| Targeting | Geo, posicionamentos, público | Restaurar o anterior (guardar foto) |
| Identidade | Vincular Instagram; categoria especial | Desvincular; restaurar (sensível) |
| Criação | Campanha, conjunto, anúncio | Pausar (nasce pausado) |
| Biblioteca | Upload de mídia | Não usar a mídia |

Não existe ato de exclusão.

## Ciclo de vida

Pedido → validação contra o contrato → card gravado com prazo → aprovar | recusar | expirar → executor fala com a Meta → resultado volta ao card (executado | falhou, com motivo legível e se é reexecutável) → auditoria.

- Objeto criado nasce PAUSADO; ativar é outro card.
- Criação espelha no banco no mesmo ato.
- Aprovar um card não autoriza o próximo; card expirado não executa.

## Travas

Ligadas por humano, nunca pelo agente: master de execução da empresa, flag por tipo de ato, dry-run, limite de atos por hora, teto diário de exposição (pior caso dos cards aprovados no dia), compliance bloqueante, quarentena da conta (vence a flag da empresa). Trava desligada não se contorna.

## Criação em lote

"Cria 6 anúncios" vira plano: validar peça + copy + linha + conjunto de cada um → subir mídias pendentes → criar em degraus (ex.: 2 por leitura), respeitando limite de chamadas e reinício de aprendizado → cada degrau com critério de sucesso antes do próximo.

## Linguagem do card

Sem nome de função, tabela, token ou versão. Exemplo:

> Pausar o anúncio **AD_LINHA-A_Reel04** no conjunto **CONJ.2 – Frio**. Motivo: 14 dias com custo por conversa 38% acima do teto da linha, CTR de link caiu de 1,9% para 0,8% com frequência subindo de 1,4 para 3,2; CPM da conta estável (não é leilão). Sucesso: custo por conversa do conjunto volta ao teto em 7 dias sem perder mais de 15% do volume. Reversa: reativar. Exposição: zero adicional.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'whatsapp_ativos',
  $d$WhatsApp e ativos: numero WABA x destino Click-to-WhatsApp, qualidade e tier com data, numero oficial da linha, disparos x midia, pagina e Instagram, sinais para alerta.$d$,
  $conteudo$# WhatsApp e ativos que sustentam a entrega

Campanha de mensagem depende do número que recebe, da página que assina e do Instagram vinculado. Degradar qualquer um deles é dano que sobe na hierarquia acima de custo e volume.

## Número WABA e destino do anúncio

| | Número Cloud API (WABA) | Destino Click-to-WhatsApp do anúncio |
|---|---|---|
| O que é | Número da conta WhatsApp Business, com qualidade, tier e modelos | Número para onde o anúncio manda (wa.me / botão), configurado na página |
| Fonte | Inventário WABA (leitura diária) | Configuração da página e do anúncio |
| Pode divergir? | Sim | Sim |
| É "agora"? | Não — foto diária, cite a data | Depende da coleta |

Não afirme que "o WhatsApp da campanha está saudável" olhando o inventário WABA se o anúncio aponta para outro número. Declare qual número o anúncio usa e qual você consegue medir.

## Qualidade e tier

- Qualidade e tier são leituras diárias; decisão que depende delas cita a data.
- Queda de qualidade com campanha de mensagem ativa → sinal de dano; leia antes de escalar.
- Tier baixo limita conversas iniciadas pela empresa, não as iniciadas pelo cliente via anúncio — mas denúncia de tráfego frio afeta a qualidade.
- Número queimado é dano irreversível: vence qualquer ganho de custo.

## Número oficial da linha

Cada linha tem WhatsApp e Instagram oficiais. O anúncio não escolhe um número qualquer: destino errado é recusa na criação. Cascas legadas e duplicatas não entram no inventário operacional.

## Disparos

Disparo (Infobip, planilha importada) não é mídia: volume, custo e status de disparo não se misturam com custo por conversa do anúncio. Consentimento para disparo não vale para público de mídia.

## Página e Instagram

- A página que assina acumula reputação; peça com muita denúncia degrada a página inteira.
- Instagram vinculado de outra linha mistura identidade: recusa.
- Há limite de anúncios por página; verifique folga antes de criação em lote.

## Sinais para alerta

| Sinal | Gravidade | Ato possível |
|---|---|---|
| Qualidade WABA caiu para baixa | Crítico | Pausar campanhas de mensagem que apontam para o número (card) |
| Tier rebaixado | Alto | Ler a causa antes de qualquer escala |
| Anúncio aponta para número fora do inventário | Alto | Corrigir destino (card) |
| Reputação da página caindo | Alto | Revisar peças com mais denúncias |
| Casca legada recebendo tráfego | Médio | Redirecionar destino |
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'auditoria_meta',
  $d$Checklist de auditoria de conta (cadastro, medicao, estrutura, custo, criativos, publicos, WhatsApp, operacao) com estados ok/achado/nao aplicavel/desconhecido, saida da auditoria e modelo do relatorio semanal.$d$,
  $conteudo$# Auditoria de conta Meta e relatório semanal

Cada controle recebe um de quatro estados: **ok · achado · não aplicável · desconhecido**. "Desconhecido" é resposta válida — ausência de evidência não vira "ok" nem "achado". Nenhum controle usa limiar universal: a régua é o histórico da conta e a documentação oficial vigente (cite a data). Inspirado no modelo de controles do projeto aberto `claude-ads` (MIT), adaptado.

## Cadastro e acesso

A1 conta vinculada a uma empresa com dono · A2 integração verificada (sem conta fantasma) · A3 token válido e com escopos · A4 conta fora de quarentena · A5 categoria regulatória declarada por pessoa · A6 página e Instagram oficiais por linha · A7 destino (LP / wa.me) por produto · A8 Drive acessível · A9 travas com estado conhecido.

## Medição

B1 pixel disparando nos destinos · B2 CAPI (se aplicável) com deduplicação · B3 qualidade de correspondência de eventos · B4 eventos coerentes com a base declarada · B5 domínio verificado · B6 UTMs consistentes · B7 janela de atribuição declarada · B8 frescor do dado.

## Estrutura

C1 fragmentação compatível com o orçamento (muitos conjuntos pequenos = aprendizado eterno) · C2 objetivo alinhado à base · C3 CBO×ABO escolhido por pergunta · C4 aprendizado limitado identificado · C5 sobreposição de público · C6 exclusões · C7 nomenclatura por linha/público/peça · C8 regras automáticas da Meta conhecidas (agem sem card).

## Orçamento e custo

D1 tetos com fonte · D2 custo pela base correta · D3 utilização do orçamento · D4 custo marginal recente vs média · D5 exposição diária no pior caso dentro do teto.

## Criativos

E1 diversidade de formato por posicionamento · E2 sinais de fadiga por peça (três sinais) · E3 rankings de relevância abaixo da média · E4 peças rastreáveis à origem no Drive · E5 acervo pendente de upload · E6 perfil vencedor datado.

## Públicos e conformidade

F1 públicos personalizados com consentimento · F2 lookalikes de fonte de qualidade · F3 frescor dos públicos · F4 em crédito: sem segmentação estreita por idade/gênero/CEP. G1–G4 (só crédito): categoria especial declarada, copy e peça sem promessa, portão registrado nos cards.

## WhatsApp e operação

H1 destino do anúncio no inventário · H2 qualidade e tier com data · H3 cascas fora do inventário · H4 reputação da página · H5 folga de anúncios por página. I1 rotinas atrasadas de verdade · I2 espelho banco ↔ Meta sem órfãos · I3 aprovações expirando · I4 alertas abertos · I5 conhecimento vencido.

## Saída da auditoria

Recorte e cobertura (itens avaliados / desconhecidos / não aplicáveis) → achados por gravidade (controle, evidência, mecanismo, ato proposto, reversa) → o que não pôde ser verificado → oportunidades não pontuadas (hipóteses de teste).

## Relatório semanal

Segunda a domingo da semana anterior. Cabeçalho: empresa, categoria, semana, data da coleta, janela de atribuição.
1. Resumo da empresa: investimento, cliques no link, formulários, conversas, CTR de link. Custo por resultado NÃO consolidado.
2. Por campanha: tipo, base declarada, investimento, resultados na base, custo pela base ("—" sem entrega), teto vigente com fonte, status.
3. Variação vs semana anterior: o que moveu (CPM, CTR de link ou conversão pós-clique) e o que foi descartado.
4. Alertas e cards da semana (aprovados, recusados, expirados, resultado).
5. O que não está disponível nesta semana.
6. Recomendação: uma, com as cinco partes.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'armadilhas_operacao',
  $d$Licoes reais de operacao de midia: criar sem espelhar, molde flexivel, compliance so da legenda, achado demografico proibido, decisao parada, custo consolidado, dica da Meta sem data, conta fantasma e token emprestado.$d$,
  $conteudo$# Armadilhas de operação

Lições reais de operar mídia neste produto, filtradas para o que muda a decisão do agente. (Lições de engenharia — deploy, cron, testes, corrida de orçamento — ficam com o time técnico, não aqui.)

## Criar sem espelhar

Objeto criado na Meta e não registrado no banco deixa o painel cego por dias: o agente responde sobre uma conta que não é a real. Criação espelha no mesmo ato e nasce pausada.

## Molde flexível

Molde Advantage+/flexível pode não expor a estrutura do criativo pela API. Antes de planejar criação a partir de molde, verifique se ele expõe a estrutura; prefira anúncio comum da mesma linha.

## Compliance só da legenda

Validar a legenda e liberar um vídeo que fala taxa, prazo ou valor deixa passar risco. A validação cobre o par peça + copy; peça sem transcrição é "não verificável" e não libera.

## Achado bom, uso proibido

Em empresa de crédito, faixa etária com custo menor vira SINAL CRIATIVO (ângulo, linguagem), nunca segmentação. Lookalike mais barato é usável se a base tiver consentimento.

## Decisão parada esperando automação

Achados de maior retorno (público semelhante, ângulo criativo) muitas vezes exigem só decisão humana e o Gerenciador. Separe "exige código" de "exige decisão" e proponha o card mesmo quando a execução automática não está pronta.

## Custo por lead consolidado

Somar formulários e conversas e dividir o gasto total dá número bonito e falso. Base por campanha, custos separados, "—" sem entrega.

## Dica da Meta sem data

Recomendação da própria Meta aparecia como atual. Registre a data em que apareceu e o veredito (concorda / discorda / não aplicável).

## Conta fantasma e token emprestado

Integração só é "conectada" após verificação real; conta sem ID externo não é dado. Usar o token de uma empresa para ler a conta de outra é falha de isolamento, não alternativa: erro de token é erro, declare.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-04-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)
values (
  'compliance_credito',
  $d$SO EMPRESA DE CREDITO: portao fail-closed, regras de copy e peca, Fair Lending, categoria especial e checklist antes do card de criacao. Nao se aplica a COHAPM.$d$,
  $conteudo$# Compliance — crédito e categorias especiais na Meta

Vale SOMENTE para empresa cuja categoria regulatória foi declarada por pessoa como crédito. COHAPM não é de crédito e não herda esta doutrina. O agente não presume categoria.

## Fail-closed

O portão não aprova por omissão:
- **Aprovado** — todas as regras verificadas e passaram.
- **Não verificável** — faltou dado (peça sem transcrição, categoria não confirmada). Não libera; o card declara dependência de conferência humana.
- **Bloqueado** — regra violada. Card não sai; diga qual regra em linguagem de operação.

Silêncio não é verde.

## Copy e peça

| Regra | Exemplo que bloqueia | Por quê |
|---|---|---|
| Crédito aprovado / pré-aprovado | "Seu crédito já está aprovado" | Promete resultado de análise que não aconteceu |
| Garantia de resultado | "Liberação em 24h garantida", "sem consulta" | A operação não controla |
| Atributo pessoal | "Você que é aposentado do INSS…", "negativado" | Meta proíbe afirmar/insinuar característica do público |
| Taxa / prazo / valor sem condição | "1,2% ao mês", "até R$ 50 mil em 10 minutos" | Informação de crédito exige condições — vídeo também conta |
| Urgência enganosa | "Últimas vagas de crédito hoje" | Pressão artificial em produto financeiro |
| Órgão ou banco como parceiro | Logo de banco/INSS | Uso indevido de marca/autoridade |

A validação cobre copy e peça JUNTAS.

## Fair Lending

Em crédito, emprego e habitação a Meta restringe segmentação por idade, gênero e CEP e exige categoria especial no conjunto.
- Achado demográfico vira sinal criativo, entregue a público amplo.
- Geo por cidade/região, não CEP estreito.
- Público personalizado e lookalike só com consentimento documentado.
- Interesse ligado a condição financeira, saúde ou grupo protegido: recusa.

## Categoria especial

Se o sistema não confirma a categoria especial, a proposta de publicar declara que ela depende de conferência no Gerenciador. Campanha financeira no ar sem categoria declarada é achado crítico. Alterar categoria é ato sensível (card).

## Checklist antes do card de criação

Categoria da empresa confirmada · categoria especial no conjunto (ou pendência declarada) · copy sem regra violada · peça com transcrição e sem regra violada · sem segmentação estreita · público com consentimento · destino da linha certa · resultado do portão registrado no card.
$conteudo$,
  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',
  date '2026-10-05',
  date '2027-01-05',
  true
)
on conflict (tema) do update set
  descricao = excluded.descricao,
  conteudo = excluded.conteudo,
  fonte = excluded.fonte,
  verificado_em = excluded.verificado_em,
  revalidar_ate = excluded.revalidar_ate,
  vigente = true,
  updated_at = now();

update public.agent_ferramentas
   set descricao = $d$BASE DE CONHECIMENTO TECNICA da casa. Pedido de METODO: comece por tema='gestor_trafego_meta' (mapa de temas). Temas de metodo v2: doutrina_diagnostico, metas_conjuntas, metricas_bases, mecanica_meta, contrato_card, whatsapp_ativos, auditoria_meta, armadilhas_operacao, compliance_credito. Historicos (alguns vencidos): otimizacao, metricas, criacao, api, diagnostico_especialista, unidade_economica, compliance. Criativo: criativo_hooks, criativo_formatos, criativo_mecanicas, criativo_voz. Use em pergunta conceitual, de metodo, de politica ou de definicao de metrica.$d$,
       doutrina = $d$Pedido de metodo: leia primeiro tema=gestor_trafego_meta e so depois o tema especifico. Tema extenso volta parcial com o indice das secoes: chame de novo com 'secao' e nao conclua que o assunto nao esta coberto. Tema com validade vencida: use como metodo e declare que o numero de plataforma precisa ser reverificado. compliance_credito so em empresa de credito.$d$,
       atualizado_em = now()
 where chave = 'get_conhecimento';

update public.agents
   set papel = $ag$Serve fundamento a quem pedir e responde pela validade da base. Dono da skill mestra gestor_trafego_meta v2 e dos temas de metodo: doutrina_diagnostico, metas_conjuntas, metricas_bases, mecanica_meta, contrato_card, whatsapp_ativos, auditoria_meta, armadilhas_operacao, compliance_credito (so credito), alem dos historicos e da biblioteca de criativo. Declara validade vencida quando o tema passou do revalidar_ate.$ag$,
       updated_at = now()
 where codigo = 'AG-08';

update public.agent_context set vigente = false
 where categoria = 'sistema' and fato like 'SKILL MESTRA GESTOR-TRAFEGO-META (10/09/2026):%';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'sistema',
  $f$SKILL GESTOR-TRAFEGO-META V2 (05/10/2026): metodo revisado no banco (gestor_trafego_meta + doutrina_diagnostico, metas_conjuntas, metricas_bases, mecanica_meta, contrato_card, whatsapp_ativos, auditoria_meta, armadilhas_operacao, compliance_credito). Os papeis que escrevem analise recebem as secoes pertinentes direto no prompt; get_conhecimento continua servindo o resto. Limiar de plataforma e ponto de partida a confirmar, nao regra. compliance_credito so em empresa de credito. Escrita so via card.$f$,
  true, date '2026-10-05', null
where not exists (
  select 1 from public.agent_context
  where categoria = 'sistema' and fato like 'SKILL GESTOR-TRAFEGO-META V2 (05/10/2026):%'
);
