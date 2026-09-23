-- 23/09/2026. "emita os proximos cards" saia um por janela: o segundo
-- propose morria como "nao foi lido" depois do primeiro card.
-- O modelo passa a emitir o lote na mesma resposta (minimo 3, teto 4).

update public.agent_ferramentas
   set descricao = case
         when descricao like '%minimo 3%' then descricao
         else descricao || ' Pedido de varios cards: varias chamadas nesta mesma resposta, uma por peca (minimo 3, teto 4 por bloco). Nao feche o bloco com um card so.'
       end,
       doutrina = case
         when coalesce(doutrina, '') like '%minimo 3%' then doutrina
         else coalesce(doutrina, '') || $n$

Lote de cards: se o gestor pediu varios ("os proximos cards"), chame propose_action varias vezes na MESMA resposta, uma por peca pronta no slate. Minimo 3, teto 4 por bloco. O segundo card nao espera a janela seguinte.$n$
       end,
       atualizado_em = now()
 where chave = 'propose_action';
