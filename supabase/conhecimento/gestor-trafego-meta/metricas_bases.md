# Métricas e bases honestas

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
