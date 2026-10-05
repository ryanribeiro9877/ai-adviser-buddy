# Doutrina de diagnóstico

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
