-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804193925
-- name: drive_sincroniza_liberacao_contra_a_fonte
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CONSERTO DE DEFEITO MEU, achado na propria prova.
--
-- O QUE EU FIZ ERRADO: ao propagar a liberacao para as linhas de analise, filtrei
-- "WHERE aprovado_pelo_gestor IS NULL". As 5 linhas da base thumbnail/criterio-v2.4 nasceram com
-- FALSE (default da coluna), nao NULL - entao o UPDATE nao as alcancou. E a minha conferencia
-- contou "linhas sem camada humana" procurando NULL, entao reportou ZERO enquanto cinco linhas
-- afirmavam que o gestor NAO liberou pecas que ele liberou.
-- FALSE E PIOR QUE NULL: nulo e ausencia, falso e afirmacao errada.
--
-- LICAO: sincronizar coluna derivada deve comparar com a FONTE, nunca procurar um valor especifico
-- que se supoe estar la. O predicado certo e "diferente da fonte", nao "e nulo".

UPDATE public.drive_midia_analises a
   SET aprovado_pelo_gestor = l.liberado,
       aprovacao_fonte = l.fonte
  FROM public.drive_pecas_liberadas l
 WHERE l.company_id = a.company_id
   AND l.drive_file_id = a.drive_file_id
   AND (a.aprovado_pelo_gestor IS DISTINCT FROM l.liberado
        OR a.aprovacao_fonte IS DISTINCT FROM l.fonte);

-- E a coluna deixa de ter default: valor derivado nao deve nascer com opiniao propria.
-- Sem a peca na tabela de liberacao, o gatilho nao preenche e o NULO diz a verdade - "nao ha
-- decisao humana registrada" - em vez de FALSE dizer "o gestor recusou", que e outra coisa.
ALTER TABLE public.drive_midia_analises ALTER COLUMN aprovado_pelo_gestor DROP DEFAULT;

COMMENT ON COLUMN public.drive_midia_analises.aprovado_pelo_gestor IS
  'DERIVADO de drive_pecas_liberadas por gatilho - NAO edite aqui. TRES ESTADOS DISTINTOS: true = o gestor liberou a peca; false = o gestor RECUSOU a peca; NULL = nao ha decisao humana registrada para ela. Nunca trate NULL como false: um e ausencia de decisao, o outro e recusa. Para mudar a decisao, altere drive_pecas_liberadas.';