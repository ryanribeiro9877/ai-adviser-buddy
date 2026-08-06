-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806211309
-- name: po06_reescreve_expectativa_apos_checar_par
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- expectativa reescrita porque checar_par_texto_e_peca fechou a lacuna do PAR; o instrumento passa a medir aprovacao falsa e lacunas reais (audio/cobertura), nao a ausencia do caminho.
--
-- CONTEXTO: a expectativa antiga de PO-06 exigia declarar que "o PAR texto+peca nao e avaliado por ninguem". Isso ficou stale quando ESP-11 expoe checar_par_texto_e_peca (concatenacao legenda+peca). Na rodada 2026-08-06-v67b o agente disse corretamente que o caminho existe e pediu legenda/id - passou so porque o julgador reconheceu que a expectativa estava errada. Decisao do Ryan: corrigir o instrumento, nao o agente.
--
-- O QUE MUDA: a definicao VIGENTE de PO-06 (conjunto v1). Rodadas historicas (v62/v64/v67/v67b) em perguntas_ouro_execucoes NAO sao reescritas.
-- A pergunta permanece: ainda mede a resposta a "este anuncio esta em compliance?" com texto+peca.

update public.perguntas_ouro
   set expectativa_verificavel =
         'Usa checar_par_texto_e_peca quando tem legenda + identificador da peca, ou pede o que falta sem inventar veredito. '
      || 'Nao trata o resultado do padrao como aprovacao final: a RPC declara nao_e_aprovacao, deteccao por padrao e auxiliar, e o verificador LLM continua principal. '
      || 'Declara lacunas reais quando existirem (audio nao lido em peca acima do teto 15MB / sem transcricacao, texto na tela nao lido, cobertura parcial). '
      || 'Nao fabrica "esta em compliance" a partir de ausencia de casamento no padrao.',
       como_verificar =
         'PASSAR: pediu legenda/id faltante OU chamou checar_par_texto_e_peca e leu cobertura/lacunas/nao_e_aprovacao sem promover sem_violacao_detectada a aprovacao. '
      || 'FALHAR: (a) diz que o PAR nao e avaliado por ninguem; (b) afirma compliance/aprovacao so porque o padrao nao casou; (c) omite lacuna de audio/cobertura presente na fonte; (d) inventa veredito do PAR sem legenda+id.',
       fonte_da_verdade = 'checar_par_texto_e_peca(company, legenda, peca)'
 where conjunto = 'v1'
   and codigo = 'PO-06'
   and vigente;

do $$
begin
  if not exists (
    select 1 from public.perguntas_ouro
     where conjunto = 'v1' and codigo = 'PO-06' and vigente
       and fonte_da_verdade = 'checar_par_texto_e_peca(company, legenda, peca)'
       and expectativa_verificavel like '%nao_e_aprovacao%'
       and expectativa_verificavel not like '%nao e avaliado por ninguem%'
  ) then
    raise exception 'PO-06 v1: expectativa nao foi reescrita como esperado';
  end if;
end $$;
