-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260803182223
-- name: gt07_contrato_volta_a_nascer_pausado
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 03/08/2026 - DIVERGENCIA RESOLVIDA. O Ryan acatou o pedido do gestor: o contrato de ativacao
-- volta a ser "nasce PAUSADO, o gestor ativa no Gerenciador". A decisao de 31/07 (aprovar=ativar)
-- e REVERTIDA. Este fato substitui o de divergencia declarada gravado horas antes.
UPDATE agent_context SET
  desde = '2026-08-03',
  atualizado = now(),
  fato = 'CONTRATO DE ATIVACAO VIGENTE DESDE 03/08/2026 - O OBJETO NASCE PAUSADO. '
      || 'Toda acao na Meta passa por card de aprovacao decidido por ADMINISTRADOR. Aprovar o card faz o '
      || 'objeto SER CRIADO na Meta, e ele nasce PAUSADO. A ATIVACAO E UM SEGUNDO ATO, MANUAL, DO GESTOR '
      || 'NO GERENCIADOR - existe para ele conferir a arvore inteira antes de qualquer entrega comecar. '
      || 'DIGA ISSO COM TODAS AS LETRAS ao propor qualquer card: aprovar CRIA e NAO GASTA; quem liga a '
      || 'entrega e o gestor, depois de olhar. '
      || 'HISTORICO QUE VOCE NAO DEVE REPETIR: entre 31/07 e 03/08/2026 vigorou o contrato oposto '
      || '(aprovar = ativar, objeto nascia ACTIVE), decisao tecnica que NAO passou pelo gestor. Ele pediu '
      || 'a reversao por audio em 03/08 14:45 - "ela tem que nascer pausada para poder olhar e ativar ou '
      || 'nao" - e a reversao foi acatada pelo Ryan no mesmo dia. Se voce encontrar texto antigo afirmando '
      || 'que a aprovacao ativa, esse texto esta VENCIDO. '
      || 'O QUE NAO MUDOU: voce continua SEM nenhum caminho para ativar, pausar ou gastar por conta '
      || 'propria. E continua valendo, com forca maior: NUNCA afirme que executou, emitiu, criou ou '
      || 'VERIFICOU algo sem o retorno da ferramenta correspondente naquele turno.'
WHERE id = 49;

-- As tres campanhas de teste seguem ACTIVE na Meta, criadas sob o contrato antigo. O gestor pediu
-- que fiquem pausadas ate estarem completas. Registrado como pendencia operacional explicita.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('lacuna',
  'PENDENCIA OPERACIONAL ABERTA (03/08/2026): as tres campanhas [LEV][LP][LEADS][CLT][TESTE-A/B/C][AGO26] '
  || 'foram criadas ATIVAS em 31/07 sob o contrato antigo e SEGUEM ATIVAS na Meta, ainda que vazias - sem '
  || 'conjunto e sem anuncio elas nao entregam e nao gastam. O gestor pediu que fiquem PAUSADAS ate '
  || 'estarem completas. Enquanto o espelho mostrar status "active" nessas tres, declare que elas estao '
  || 'ativas e vazias e que pausar depende de acao humana no Gerenciador. NAO trate como se ja estivessem '
  || 'pausadas, e NAO afirme que foram pausadas sem ler o estado.',
  true, '2026-08-03', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');