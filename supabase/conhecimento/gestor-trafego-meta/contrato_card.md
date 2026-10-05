# Contrato do card de aprovação

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
