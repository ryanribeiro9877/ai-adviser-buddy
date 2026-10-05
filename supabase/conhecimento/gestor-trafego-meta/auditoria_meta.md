# Auditoria de conta Meta e relatório semanal

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
