create table if not exists public.agent_knowledge (
  tema text primary key,
  descricao text not null,
  conteudo text not null,
  fonte text,
  verificado_em date not null default current_date,
  revalidar_ate date,
  vigente boolean not null default true,
  chars int generated always as (length(conteudo)) stored,
  updated_at timestamptz not null default now()
);

alter table public.agent_knowledge enable row level security;

comment on table public.agent_knowledge is
  'Base de conhecimento consultavel do agente, lida pela tool get_conhecimento(tema) no traffic-chat v24+. Progressive disclosure: a descricao entra no prompt (barata), o conteudo so e carregado quando o tema e pedido. revalidar_ate implementa o protocolo de evolucao - conteudo vencido deve ser rebaixado para "nao confirmado".';

insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate) values
('otimizacao',
 'Otimizacao, diagnostico e escala: triagem de 60s (status real, saldo, rejeicoes, mudancas), BREAKDOWN EFFECT e nivel de avaliacao correto, fase de aprendizado e aprendizado limitado, arvore de diagnostico CPL = CPM / (CTR x CVR_LP x 1000), fadiga criativa com 3 sinais objetivos, flutuacao normal x preocupante, gates matar/manter/escalar, como escalar e sazonalidade do consignado no Brasil.',
$conteudo$# Otimização, diagnóstico e escala

> Verificado até jan/2026. Créditos conceituais: Breakdown Effect e leitura marginal derivam da documentação oficial do sistema de entrega da Meta; formalização em skill por Mathias Chu (meta-ads-analyzer, MIT).

## 0. Antes de olhar qualquer métrica (triagem de 60 segundos)
1. **Status real**: `effective_status` de campanha/conjunto/anúncio na Graph API. "Ativa" no banco/planilha local não prova entrega. Queda de resultado com data marcada = primeiro suspeito é pausa/rejeição naquela data.
2. **Dinheiro**: saldo, método de cobrança, `account_status` (3 = UNSETTLED/pendência de pagamento) e limite de gasto da conta.
3. **Rejeições/restrições**: anúncios DISAPPROVED, conta em análise, checkpoint de identidade.
4. **Mudanças recentes**: alguém editou algo? Learning resetou?
Só depois disso os números merecem interpretação.

## 1. Nível de avaliação correto (Breakdown Effect)
| Configuração | Nível de julgamento |
|---|---|
| CBO / Advantage+ budget | CAMPANHA |
| Posicionamentos automáticos (sem CBO) | CONJUNTO |
| Vários anúncios num conjunto | CONJUNTO |

O sistema aloca por **custo marginal** (custo do próximo resultado), não médio. Exemplo clássico: Posicionamento A com CPA médio R$10 e B com R$15 — o sistema despeja verba em B porque o custo do PRÓXIMO lead em A já passou de R$15 (A saturou). Pausar B "porque é mais caro na média" AUMENTA o custo total.

Regra dura: **nunca recomendar pausar/reduzir um segmento com base apenas em CPA/CPM médio de breakdown**. Breakdown serve para entender, não para prescrever. Prescrição exige teste isolado ou tendência temporal do marginal.

## 2. Learning phase
- Sai com ~50 eventos de otimização por conjunto em 7 dias; durante learning: CPA mais alto e instável — não julgar.
- **Learning limited**: conjunto não alcança volume → consolidar (juntar conjuntos/subir orçamento/evento de otimização mais frequente no funil), não fatiar mais.
- Overlap de leilão entre conjuntos do mesmo anunciante: sintoma = subentrega + learning limited simultâneos; solução = consolidar ou desligar o conjunto redundante.

## 3. Árvore de diagnóstico (CPL/CPA alto)
```
CPL = CPM ÷ (CTR_link × CVR_LP × 1000)   ← decompor SEMPRE
│
├─ CPM subiu?  → competição/sazonal (leilão), frequência alta, ranking de qualidade baixo,
│                público estreito demais (CREDIT já restringe — não estreitar mais)
├─ CTR caiu?   → fadiga criativa (ver §4), ângulo esgotado, mismatch público×mensagem,
│                ranking de engajamento "abaixo da média"
├─ CVR_LP caiu?→ LP lenta (connect rate <70-80%), quebra de promessa anúncio→LP,
│                formulário longo, tracking quebrado (ver EMQ/CAPI), tráfego de pior intenção
└─ Tudo estável mas contrato caro? → problema é QUALIDADE do lead, não custo:
                 ler funil lead→proposta→pago por utm_campaign/utm_content
```

## 4. Fadiga criativa — critérios objetivos
Comparar com a baseline da PRIMEIRA semana estável do criativo:
- Frequência subindo (>2,5-3 em prospecção como alerta heurístico) E
- CTR_link caindo >=25-30% vs baseline E
- CPA marginal subindo por 5-7 dias.
Um sinal isolado não é fadiga. Ação: novo CONCEITO (não variação cosmética); manter o fatigado ativo até o novo sair de learning, depois pausar.

## 5. Flutuação: normal x preocupante
| Normal | Preocupante |
|---|---|
| Variação diária de CPA até 20-30% | Alta sustentada >50% por vários dias |
| Fim de semana != dia útil | Entrega caindo a ~zero sem edição |
| Instabilidade em learning | CVR caindo com gasto subindo |
| Oscilação por pacing | Degradação após "nenhuma mudança" (procurar a mudança: houve) |
Ler custo no PERÍODO da campanha, não no snapshot diário — pacing segura verba de propósito.

## 6. Decisão matar x manter x escalar (gates por dinheiro, não por vaidade)
Pré-condição: fora de learning + janela mínima 3-4 dias + atribuição declarada.
```
MATAR anúncio:  gastou >= 2-3x CPL-alvo sem lead, OU CPL > 1,5x alvo por 5+ dias
                com ranking de qualidade "abaixo da média"  (calibrar ao histórico da conta)
MANTER/ITERAR:  CPL no alvo mas lead→proposta fraco → problema de ângulo/promessa, não de mídia
ESCALAR:        CPL <= alvo E custo por CONTRATO <= alvo E tendência estável >= 7 dias
```
O gate de escala usa o funil COMPLETO: CPL baixo com contrato caro é armadilha (anúncio "clickbait-compliant" que atrai curioso).

## 7. Como escalar
- **Vertical**: +15-20% de orçamento a cada 48-72h (heurística de mercado, não regra oficial); saltos grandes desestabilizam o lance efetivo.
- **Horizontal**: duplicar campanha vencedora para novo público/geo/objetivo de destino; novos criativos no mesmo conceito vencedor.
- **Cost cap**: ao escalar forte, considerar COST_CAP no CPL-alvo para segurar teto (aceitando possível subentrega) vs LOWEST_COST_WITHOUT_CAP (volume máximo, custo flutua).
- Ao escalar, monitorar 1a semana em D+1: CPM, frequência e CPL marginal.

## 8. Realocação de orçamento (rotina semanal)
1. Ranquear conjuntos/campanhas por custo por CONTRATO (não por CPL) na janela de 14-28d.
2. Mover verba do último quartil para o primeiro em passos <=20%.
3. Nunca zerar tudo de uma vez: manter exploração (~10-20% da verba em testes) — sem teste, a conta morre de fadiga em semanas.
4. Registrar cada movimento com hipótese e data (auditoria + leitura futura).

## 9. Sazonalidade do consignado (contexto Brasil)
Demanda e CPM variam com calendário de pagamento INSS, 13o (antecipações), liberações de margem e concorrência de grandes players em datas de crédito. Antes de culpar criativo por CPM alto, comparar com o MESMO período de meses anteriores (nunca com a média geral).$conteudo$,
 'pacote Skills 28/07/2026 - gestor-trafego-meta/references/otimizacao-diagnostico.md',
 date '2026-01-31', current_date + 180),

('unidade_economica',
 'Analise critica e unidade economica: CAC honesto (atribuido x blended), coorte por data do lead, margem por contrato e por que sem comissao nao existe unidade economica, qualidade de lead como fronteira de escopo, atribuicao x incrementalidade, catalogo de armadilhas de leitura e o FORMATO OBRIGATORIO de recomendacao (evidencia/mecanismo/hipotese/sucesso/leitura/reversa/risco).',
$conteudo$# Análise crítica e unidade econômica — pensar como dono, não como painel

## 1. CAC honesto (a conta mais errada do mercado)
- **Denominador certo**: contratos ATRIBUÍDOS ao canal (via UTM/CRM), não todos os contratos da empresa. Dividir gasto Meta por todos os contratos infla o denominador e SUBESTIMA o CAC — viés otimista pró-canal, agravado quando outros canais (TikTok, parceiros, orgânico) geram contrato fora da visão do sistema.
- Reportar SEMPRE em par: CAC_atribuído = gasto Meta ÷ contratos com UTM Meta (régua de decisão) e CAC_blended = gasto total ÷ contratos totais (sanidade). Divergência grande entre os dois = problema de atribuição, investigar antes de otimizar.
- Ciclo de venda entra na conta: contrato pago hoje nasceu de lead de semanas atrás → comparar gasto do período com contratos de COORTE (por data do lead), não do caixa. % de contratos "sem UTM" tende a ser efeito de coorte antiga quando a instrumentação é recente — verificar a data do lead antes de tratar como falha de tracking.

## 2. Unidade econômica (a pergunta no 1, acima de qualquer card técnico)
```
Margem por contrato = comissão/receita real do contrato − CAC_atribuído − custo operacional variável
```
- Sem a comissão POR BANCO/produto, não existe unidade econômica — existe fé. CAC de ~15-20% do valor financiado pode ser ótimo ou negativo dependendo da comissão; essa resposta vale mais que qualquer otimização de CPM.
- "Volume financiado sobre gasto" NÃO é ROAS nem lucro: valor financiado é o tamanho do contrato, não a receita da empresa. Usar como proxy só com o rótulo explícito e nunca para decidir escala.
- Meta de mídia deriva da margem: CPL-alvo = margem-alvo por contrato × taxa lead→contrato. Sem esses dois números, "CPL bom" é opinião.

## 3. Qualidade do lead (fronteira de escopo bem traçada)
- Dados de pipeline do CRM (score, fase, tentativas de contato, status) servem para CARACTERIZAR o tráfego: "campanha X traz lead que atende menos / converte menos em proposta". Isso É análise de mídia.
- O que NÃO é análise de mídia: recomendar mudança na operação de atendimento. Se o funil trava DEPOIS do lead de forma uniforme entre campanhas, o problema não é do tráfego — reportar o fato e parar aí.
- Teste de discriminação: a taxa lead→proposta varia POR CAMPANHA/CRIATIVO? Sim → alavanca de mídia (ângulo/promessa/destino). Não (uniforme) → fora do escopo.

## 4. Atribuição x incrementalidade
- Atribuição de plataforma responde "quem levou o crédito", não "o que causou a venda". Últimos-cliques de marca e retargeting inflam; topo de funil aparece "caro".
- Hierarquia de evidência: teste de incrementalidade (geo holdout) > conversion lift > MER/aMER como tendência > atribuição por clique > view-through.
- MER (receita total ÷ gasto total em mídia) como sanity check mensal: se ROAS de plataforma sobe e MER cai, a plataforma está roubando crédito de outro canal.
- Antes de grandes decisões de verba entre canais: rodar UMA leitura de incrementalidade, mesmo tosca (geo simples, 2-4 semanas), em vez de confiar em janelas de atribuição concorrentes.

## 5. Armadilhas de leitura (catálogo vivo)
| Armadilha | Antídoto |
|---|---|
| Média histórica longa mascarando inflexão recente | Segmentar por mês/semana ANTES de concluir tendência |
| Causalidade sem cronologia | Linha do tempo dos eventos antes de qualquer "porque" |
| Comparar janelas de atribuição diferentes | Declarar janela em todo número |
| Contagem sem filtro declarado ("17 campanhas ativas") | Toda contagem cita filtro: effective_status, período, gasto>0 |
| Otimizar CPL e piorar contrato | Gate de decisão sempre no funil completo |
| Confiar no espelho local desatualizado | Fonte da verdade = API; espelho tem timestamp de frescor e watchdog |
| "Dado não disponível" tratado como "não existe" | Distinguir: não coletado x não exposto x suprimido pela plataforma |
| Falso positivo de alerta rodando sobre dado ausente | Jobs em cadeia checam frescor do insumo antes de alertar |
| Sistema que monitora a conta mas não a si mesmo | Watchdog de frescor: alertar se snapshot de D-1 não existe ou job != 200 |
| Duplicata/off-by-one entre fonte e espelho ignorado | Investigar divergência de contagem antes de confiar em qualquer soma |

## 6. Estrutura de recomendação (formato obrigatório)
```
EVIDÊNCIA:   métrica + nível + janela + período + fonte
MECANISMO:   por que o sistema/mercado produz esse padrão
HIPÓTESE:    mudança proposta (uma variável)
SUCESSO:     métrica-alvo e limiar, no funil completo
LEITURA:     janela mínima e data de decisão
REVERSA:     como desfazer, quem desfaz, em quanto tempo
RISCO:       o que pode piorar e como detectamos cedo
```
Recomendação sem reversa definida não sobe para aprovação.$conteudo$,
 'pacote Skills 28/07/2026 - gestor-trafego-meta/references/analise-critica-unidade-economica.md',
 date '2026-01-31', current_date + 365)
on conflict (tema) do update set descricao=excluded.descricao, conteudo=excluded.conteudo,
  fonte=excluded.fonte, verificado_em=excluded.verificado_em, revalidar_ate=excluded.revalidar_ate, updated_at=now();
