# Mecânica da Meta

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
