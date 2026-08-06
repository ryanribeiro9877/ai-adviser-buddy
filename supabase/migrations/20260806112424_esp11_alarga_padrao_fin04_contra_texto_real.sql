-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806112424
-- name: esp11_alarga_padrao_fin04_contra_texto_real
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-11 achado · o padrao da FIN-04 nao pegava o texto REAL das pecas.
--
-- COMO APARECEU: o teste do par contra o video 22, cujo texto na tela e "Valor liberado:
-- R$ 5.043,63 ... Valor da parcela: R$ 509,53; Prazo: 24x", voltou SEM VIOLACAO com legenda sem
-- CET. Deveria reprovar.
--
-- CAUSA: eu escrevi o padrao em 05/08 contra exemplos INVENTADOS por mim ("12x de R$ 250",
-- "taxa de 1,29%"). As pecas reais escrevem "parcela: R$ X" e "Prazo: 24x" - formas que o padrao
-- nao cobria. Falso negativo de deteccao, e o pior tipo: silencioso e com cara de aprovacao.
-- Licao repetida: padrao validado so contra exemplo sintetico nao esta validado.
--
-- O QUE ENTRA AGORA, todas as formas medidas nas 67 pecas: parcela seguida de R$ em ate 15
-- caracteres (cobre "parcela: R$", "parcela de R$", "Valor da parcela: R$"), prazo seguido de
-- Nx ou N meses, e Nx de R$. Mantidas as formas antigas.
--
-- CUIDADO COM FALSO POSITIVO, que aqui BLOQUEIA peca correta: nao incluo "valor liberado"
-- sozinho. Valor liberado e o principal, nao o custo - e a regra FIN-04 v2 fala de TAXA, PRAZO
-- e VALOR DE PARCELA. Alargar ate onde a regra diz, nem um caractere alem.

update public.promessas_proibidas
   set padrao = '[0-9]+[,.][0-9]+ ?%|taxa de [0-9]|[0-9]+ ?x de r\$|parcela[^.!?]{0,15}r\$|prazo[^.!?]{0,12}[0-9]+ ?x|prazo[^.!?]{0,12}[0-9]+ ?(mes|mês|meses)|em [0-9]+ ?x',
       observacao = coalesce(observacao,'')
         || ' PADRAO ALARGADO EM 06/08/2026: a versao de 05/08 foi escrita contra exemplos sinteticos e nao pegava "parcela: R$ X" nem "Prazo: 24x", que e como as pecas reais escrevem - falso negativo silencioso, achado pelo teste do ESP-11 contra o video 22. Nao inclui "valor liberado" sozinho: principal nao e custo, e a regra fala de taxa, prazo e parcela.'
 where proibido = 'taxa citada sem CET';