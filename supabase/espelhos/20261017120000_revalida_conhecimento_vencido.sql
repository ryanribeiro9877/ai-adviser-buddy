-- espelho para git — NÃO re-executar. Aplicado em gestão_marketing via apply_migration
-- 20261017120000_revalida_conhecimento_vencido
--
-- SQL fiel ao arquivo em supabase/migrations/.
-- 20261017120000_revalida_conhecimento_vencido
--
-- Seis temas de agent_knowledge estavam vencidos desde 29/08/2026 (pacote Skills 28/07/2026) e o
-- cron valida-conhecimento-semanal abria 'Conhecimento tecnico vencido' toda segunda. Decisao do
-- gestor em 17/10/2026, apos comparar cada tema com a skill v2 e com a documentacao da Meta:
--   APOSENTAR (vigente=false), porque a v2 ja cobre: diagnostico_especialista, otimizacao, api,
--     metricas (Seguidores de Instagram e janelas de atribuicao vao para metricas_bases) e criacao
--     (Comentario do post nao e ato vai para contrato_card).
--   REVALIDAR: compliance, reescrito. O traffic-chat chama tema=compliance pelo nome, e o texto
--     antigo tinha 3 erros: CREDIT (substituido por FINANCIAL_PRODUCTS_SERVICES em jan/2025),
--     categoria 'obrigatoria' (a Meta so obriga EUA, Canada e partes da Europa) e verificacao
--     financeira obrigatoria no Brasil (nenhuma pagina da Meta confirma).
--   vigia_de_regua: constantes reconfirmadas pelo gestor, validade ate 31/01/2027.
-- Regra da casa decidida em 17/10/2026: empresa de credito declara a categoria especial mesmo
-- com publico so no Brasil.
-- Os .md da v2 sao a fonte de gestor_trafego_meta, metricas_bases, contrato_card e
-- compliance_credito (doutrina_conteudo.gen.ts regerado com --so-ts).

update public.agent_knowledge
   set vigente = false, updated_at = now()
 where tema in ('diagnostico_especialista', 'otimizacao', 'api', 'metricas', 'criacao')
   and vigente;

update public.agent_knowledge
   set descricao = $d$Politica da Meta para produtos financeiros (conferida em 17/10/2026) e pratica da casa em empresa de credito: politica de produtos e servicos financeiros, categoria especial FINANCIAL_PRODUCTS_SERVICES (vive na campanha; a Meta so obriga EUA, Canada e partes da Europa; a casa declara em credito), atributos pessoais, rejeicao e apelacao, LGPD e saude da conta. O portao e o checklist estao em compliance_credito.$d$,
       conteudo = $conteudo$# Política da Meta para produtos financeiros — referência para empresa de crédito

Conferido em 17/10/2026 na Central de Transparência da Meta (padrões de anúncios: "Produtos e serviços financeiros e de seguro", alterada em 30/04/2026; "Práticas discriminatórias"; "Violações de privacidade e atributos pessoais") e na documentação "Special Ad Categories" da Marketing API. Vale SOMENTE para empresa de crédito. Hoje é a Legal é Viver, com dois produtos (consignado INSS e consignado CLT, com calendário e elegibilidade diferentes): declare qual. COHAPM não é de crédito. O portão da casa (fail-closed, copy e peça, checklist) está em `compliance_credito`; aqui fica o que a Meta diz e a prática da casa que depende disso, marcada como tal.

## Arquitetura das políticas

1. Proibido: nunca roda (golpe, prática enganosa, produto financeiro proibido).
2. Restrito: roda com condições. Crédito, empréstimo, cartão e seguro estão aqui.
3. Forma e qualidade: atributo pessoal, sensacionalismo, destino que não entrega o que o anúncio promete.
4. Categoria especial: camada de segmentação restrita.

A revisão é majoritariamente automática e pode voltar a qualquer momento, inclusive em anúncio já aprovado e rodando.

## Política de produtos e serviços financeiros

O que a Meta exige (verificado 17/10/2026):
- Cartão de crédito, empréstimo de longo prazo (mais de 90 dias) e seguro: público 18+, divulgações exigidas por lei e nenhum pedido direto de dado pessoal ou financeiro no anúncio (dado bancário, cartão).
- Proibido anunciar: empréstimo de até 90 dias, empréstimo para o dia do pagamento, adiantamento salarial, fiança, opções binárias, CFD, ICO e leilão de centavos.
- Licença: em alguns países a veiculação exige autorização do regulador. A Meta pode analisar a licença e pedir verificação de identidade comercial ou pessoal; a política não lista os países.
- Permitido sem essas condições: anúncio de marca de banco, notícia, conteúdo educativo sobre crédito, menção a produto sem forma de contratar.
- Verificação de anunciante financeiro no Brasil: em 17/10/2026 nenhuma página da Meta confirma exigência geral. Se o Gerenciador pedir verificação, é bloqueio de lançamento até concluir. Não afirme que a conta está ou não verificada sem ter visto.

Claims que a casa bloqueia em consignado (prática da casa, apoiada na política de práticas enganosas):
- "aprovado", "crédito garantido", "aprovação na hora para todos";
- "sem consulta" como isca de aprovação certa;
- "dinheiro na conta em X minutos" sem condição;
- urgência falsa recorrente, juros omitidos, esconder que é empréstimo;
- imitar comunicação oficial de banco, INSS ou governo (logo, layout de comunicado, "convocação"): além de reprovação, é o padrão clássico de golpe.

Taxa citada é real e qualificada ("a partir de"), com as condições na página de destino. As regras FIN-* dão o veredito do `check_compliance`; divergência entre elas e este tema se resolve atualizando a regra, nunca afrouxando o portão.

## Categoria especial

- Vive na CAMPANHA (`special_ad_categories`); conjuntos e anúncios herdam.
- Valor para crédito: `FINANCIAL_PRODUCTS_SERVICES` (produtos e serviços financeiros), que substituiu `CREDIT` em janeiro de 2025.
- Quem a Meta obriga a declarar: anunciante dos EUA ou com público nos EUA, no Canadá ou em partes da Europa. O Brasil não está na lista (verificado 17/10/2026).
- Regra da casa (17/10/2026): campanha de empresa de crédito declara a categoria mesmo com público só no Brasil. Campanha financeira no ar sem ela é achado crítico da casa; diga que é regra da casa, não exigência da Meta.
- Com a categoria declarada, a Meta trava: idade 18 a 65+; sem escolha de gênero; sem CEP, bairro ou exclusão de local, com raio mínimo em torno de cidade ou endereço; sem segmentação por comportamento ou demografia e sem exclusão de interesse (interesse só da lista aprovada); sem lookalike e sem público salvo; sem multiplicador de lance. Público personalizado continua permitido se a lista for elegível.
- Alterar a categoria é ato sensível: card `alterar_categoria_especial_campanha`.

## Atributos pessoais

A Meta proíbe anúncio que afirme ou insinue, direta ou indiretamente, atributo pessoal de quem vê, incluindo situação financeira vulnerável, saúde e idade (verificado 17/10/2026).
- ❌ "Você que está endividado e é aposentado..."
- ❌ "Sua dívida está te sufocando?"
- ✅ "Aposentados e pensionistas do INSS podem contratar com desconto em folha" (fala do produto e da elegibilidade, não do indivíduo).

Trocar a segunda pessoa acusatória pela terceira pessoa descritiva resolve a maioria dos casos.

## Rejeição, correção e apelação

Prática da casa:
1. Ler o motivo exato no Gerenciador (qualidade da conta / suporte para empresas). Não adivinhar.
2. Violação real: corrigir peça ou destino e reenviar. Falso positivo: pedir revisão sem editar o anúncio enquanto ela corre (editar dispara análise nova).
3. Reprovações em série do mesmo tipo: parar de reenviar variações e rever o conceito.
4. Nunca: conta ou portfólio novo para contornar restrição, destino diferente para o revisor, trocar o destino depois de aprovado.
5. Conta restrita: contestação pelo fluxo oficial e lançamentos congelados até resolver.

## LGPD em público e eventos

Prática da casa:
- Quem pediu para sair não entra em público personalizado nem em evento enviado à Meta. O filtro de opt-out e de base legal vem ANTES do hash: SHA-256 pseudonimiza, não anonimiza.
- CPF não sai da empresa em nenhuma integração de mídia.
- O aviso de privacidade da página de destino cobre pixel/CAPI e a finalidade publicitária.

## Saúde da conta

Antes de escalar, confira: status da conta, anúncios reprovados, avisos de qualidade da conta, limite de gasto, domínio e pixel. Meta de operação da casa: nenhum anúncio reprovado ativo por mais de 24 h.
$conteudo$,
       fonte = $f$Central de Transparencia da Meta (padroes de anuncios: Produtos e servicos financeiros e de seguro, alterada em 30/04/2026; Praticas discriminatorias; Violacoes de privacidade e atributos pessoais) e Marketing API Special Ad Categories, conferidos em 17/10/2026 | pratica da casa marcada no texto | substitui o texto do pacote Skills 28/07/2026$f$,
       verificado_em = date '2026-10-17',
       revalidar_ate = date '2027-01-17',
       vigente = true,
       updated_at = now()
 where tema = 'compliance';

update public.agent_knowledge
   set conteudo = $conteudo$# Skill mestra — Gestor de Tráfego Meta (v2)

Pacote `gestor-trafego-meta` revisado e importado em 05/10/2026. Isto é MÉTODO, não persona e não número desta conta. Os detalhes vivem nos temas listados em "Quando carregar cada tema". Números de plataforma (limiares da Meta) são ponto de partida com data, nunca regra universal.

## Escopo

- DENTRO: campanha, conjunto, anúncio, criativo, orçamento, lance, público, posicionamento, pixel/CAPI, métrica, política Meta, planejamento e relatório de mídia.
- FORA: esteira interna, política de crédito, bancos parceiros, atendimento humano, decisão de produto. CRM (proposta, contrato) não existe no sistema: custo por conversa/formulário é PROXY, nunca lucro. Diga a quem pertence a pergunta fora de escopo e siga.
- Compliance de crédito (categoria especial financeira, CET, FIN-*) só quando ESTA empresa for de crédito. COHAPM (jurídico, imóvel, ocular) não é de crédito.
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
| Empresa de crédito: política da Meta para produtos financeiros, categoria especial | `compliance` |
| Unidade econômica e protocolo de evolução (pacote de 28/07/2026) | `unidade_economica`, `evolucao` |
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
       fonte = $f$skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026) | revisao de 17/10/2026: absorve trechos dos temas aposentados e corrige a categoria especial contra a documentacao da Meta$f$,
       updated_at = now()
 where tema = 'gestor_trafego_meta';

update public.agent_knowledge
   set conteudo = $conteudo$# Métricas e bases honestas

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
- Desde 12/01/2026 a Meta não devolve 7 nem 28 dias de visualização (seguem 1/7/28 dias clique e 1 dia visualização; verificado 17/10/2026). Série antiga com essas janelas não se compara sem declarar.

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

## Seguidores de Instagram

Campo `instagram_profile_follow` (Ads Insights; no Gerenciador, seguidores do Instagram): follows do perfil **atribuídos pela Meta ao anúncio** na janela da conta, por campanha, conjunto e anúncio. Existe desde 07/07/2025 (verificado 10/09/2026).
- NÃO é saldo líquido do @ no período (orgânico + Explore + outros posts + pago), nem incrementalidade. Clique no perfil, cliques (todos) ou CTR não servem de proxy.
- Funil e ranking não coletam o campo: ausência ali não é zero. Leia com `get_seguidores_instagram_ads`.
- Insight do perfil (`follower_count`) mistura origens e exige permissão de insights do Instagram no conector; token anterior a 04/05/2026 precisa ser reconectado.
$conteudo$,
       fonte = $f$skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026) | revisao de 17/10/2026: absorve trechos dos temas aposentados e corrige a categoria especial contra a documentacao da Meta$f$,
       updated_at = now()
 where tema = 'metricas_bases';

update public.agent_knowledge
   set conteudo = $conteudo$# Contrato do card de aprovação

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

## Comentário do post não é ato

Desligar comentário é interruptor do **conteúdo** (post no Instagram ou no Meta Business Suite), não de campanha, conjunto ou anúncio. O impulsionamento herda o post: pausar para o gasto e **não** fecha comentário. Não existe card para comentário (verificado 10/09/2026): não invente card nem pause no lugar do interruptor. Se o gestor pedir para parar a entrega, aí sim é pausa.

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
       fonte = $f$skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026) | revisao de 17/10/2026: absorve trechos dos temas aposentados e corrige a categoria especial contra a documentacao da Meta$f$,
       updated_at = now()
 where tema = 'contrato_card';

update public.agent_knowledge
   set conteudo = $conteudo$# Compliance — crédito e categorias especiais na Meta

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

Com a categoria especial declarada (crédito, emprego, habitação), a Meta trava a segmentação: idade 18 a 65+, sem gênero, sem CEP nem bairro, sem lookalike e interesse só da lista aprovada. A casa segue a mesma régua em crédito mesmo onde a Meta não obriga.
- Achado demográfico vira sinal criativo, entregue a público amplo.
- Geo por cidade/região, não CEP estreito.
- Público personalizado e lookalike só com consentimento documentado.
- Interesse ligado a condição financeira, saúde ou grupo protegido: recusa.

## Categoria especial

A categoria vive na CAMPANHA (`FINANCIAL_PRODUCTS_SERVICES`, que substituiu `CREDIT` em jan/2025); conjuntos e anúncios herdam. A Meta só obriga anunciante dos EUA ou com público nos EUA, Canadá ou partes da Europa — o Brasil não está na lista (verificado 17/10/2026). Regra da casa (17/10/2026): campanha de empresa de crédito declara a categoria mesmo com público só no Brasil, e campanha financeira no ar sem ela é achado crítico — diga que é regra da casa, não exigência da Meta. Se o sistema não confirma a categoria, a proposta de publicar declara que ela depende de conferência no Gerenciador. Alterar categoria é ato sensível (card). Política da Meta em detalhe: tema `compliance`.

## Checklist antes do card de criação

Categoria da empresa confirmada · categoria especial na campanha (ou pendência declarada) · copy sem regra violada · peça com transcrição e sem regra violada · sem segmentação estreita · público com consentimento · destino da linha certa · resultado do portão registrado no card.
$conteudo$,
       fonte = $f$skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026) | revisao de 17/10/2026: absorve trechos dos temas aposentados e corrige a categoria especial contra a documentacao da Meta$f$,
       updated_at = now()
 where tema = 'compliance_credito';

-- vigia_de_regua: so a confirmacao muda; o bloco <!--constantes --> fica intacto.
update public.agent_knowledge
   set conteudo = replace(conteudo,
         'Constantes confirmadas pelo gestor em 2026-10-01:',
         'Constantes confirmadas pelo gestor em 2026-10-01 e reconfirmadas sem mudanca em 2026-10-17:'),
       fonte = 'confirmacao do gestor, 2026-10-01; reconfirmada em 2026-10-17',
       verificado_em = date '2026-10-17',
       revalidar_ate = date '2027-01-31',
       updated_at = now()
 where tema = 'vigia_de_regua';

update public.agent_ferramentas
   set descricao = replace(descricao,
         'Historicos (alguns vencidos): otimizacao, metricas, criacao, api, diagnostico_especialista, unidade_economica, compliance.',
         'Politica da Meta para produtos financeiros (so credito): compliance. Herdados do pacote de 28/07/2026: unidade_economica, evolucao.'),
       atualizado_em = now()
 where chave = 'get_conhecimento';

update public.agents
   set papel = replace(papel,
         'alem dos historicos e da biblioteca de criativo.',
         'alem de compliance (politica da Meta, so credito), unidade_economica, evolucao e da biblioteca de criativo.'),
       updated_at = now()
 where codigo = 'AG-08';

-- Os alertas semanais abertos ficam resolvidos: a causa (temas vencidos) deixa de existir aqui.
update public.alerts
   set resolved = true,
       description = description || ' [RESOLVIDO EM 17/10/2026: diagnostico_especialista, otimizacao, api, metricas e criacao aposentados (a skill v2 cobre; trechos uteis migrados para metricas_bases e contrato_card); compliance reescrito e conferido contra a documentacao da Meta, validade ate 17/01/2027.]'
 where title = 'Conhecimento tecnico vencido'
   and not resolved;
