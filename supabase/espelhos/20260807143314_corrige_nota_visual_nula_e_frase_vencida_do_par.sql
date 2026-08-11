-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807143314
-- name: corrige_nota_visual_nula_e_frase_vencida_do_par
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Dois defeitos no pedido_de_anuncio_completo, achados rodando o payload real em 07/08.
--
-- 1. NOTA VISUAL SAINDO NULA. A linha chama nota_visual_da_peca(p_company_id, v_drive), e v_drive
--    esta NULO quando o pedido informa meta_video_id em vez de drive_file_id: a resolucao do drive
--    acontece para a checagem de bloqueio e nao volta para a variavel que alimenta a nota. Sintoma
--    medido: peca_identificada true, drive_file_id presente em peca_em_revisao, e
--    nota_visual_da_peca null. Consequencia: o card vai ao gestor SEM a leitura visual da peca -
--    justamente o que ele deveria ver antes de aprovar.
--    Conserto: cair no drive_file_id que a propria checagem de bloqueio ja resolveu.
--
-- 2. FRASE VENCIDA sobre o par texto+peca. A mensagem afirmava "NENHUM DOS DOIS AVALIA O PAR ...
--    nao existe caminho para isso hoje". checar_par_texto_e_peca existe desde 06/08.
--    E a simetria importa: essa e EXATAMENTE a afirmacao que fez o PO-06 ser reescrito, porque a
--    pergunta-ouro premiava o agente por negar um caminho que passou a existir. A pergunta foi
--    corrigida e a frase ficou hardcoded aqui. Enquanto ela existir, o agente le o card, repete a
--    lacuna falsa, e o PO-06 v2 o reprova por uma frase que veio da funcao.
--    Conserto: dizer o que e verdade hoje, e declarar a lacuna que RESTA - o audio, que so foi
--    transcrito em parte do acervo e em nenhuma das pecas em revisao.

do $$
declare
  v_def text; v_novo text;
  v_ant1 text := 'v_nota := coalesce(public.nota_visual_da_peca(p_company_id, v_drive), '''');';
  v_sub1 text := 'v_nota := coalesce(public.nota_visual_da_peca(p_company_id, coalesce(v_drive, v_bloq->>''drive_file_id'')), '''');';
  v_ant2 text := 'NENHUM DOS DOIS AVALIA O PAR texto mais peca junto - nao existe caminho para isso hoje, e prometer que existe seria pior que a lacuna.';
  v_sub2 text := 'O PAR texto mais peca PODE ser avaliado: existe checar_par_texto_e_peca, que julga a concatenacao da legenda com o texto que a peca mostra na tela - e regra condicional muda de resposta no conjunto, entao citar taxa sem CET viola, mas se o CET estiver na legenda e o numero na peca o par esta conforme. LACUNA QUE RESTA E O AUDIO: so parte do acervo foi transcrita, e NENHUMA das pecas em revisao esta entre as transcritas - o que e FALADO nelas segue nao avaliado por ninguem.';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='pedido_de_anuncio_completo' limit 1;

  if v_def is null then
    raise exception 'funcao nao encontrada - nada alterado';
  end if;
  if position(v_ant1 in v_def) = 0 then
    raise exception 'a linha da nota visual nao esta como esperado - nada alterado';
  end if;
  if position(v_ant2 in v_def) = 0 then
    raise exception 'a frase do par nao esta como esperado - nada alterado';
  end if;

  v_novo := replace(replace(v_def, v_ant1, v_sub1), v_ant2, v_sub2);

  if v_novo = v_def then
    raise exception 'substituicao sem efeito - abortado';
  end if;
  if v_novo !~* '^\s*CREATE OR REPLACE FUNCTION' then
    raise exception 'definicao inesperada - nao vou executar as cegas';
  end if;

  execute v_novo;
  raise notice 'dois defeitos corrigidos';
end $$;

-- ---------------------------------------------------------------------------
-- MIGRACAO INTERMEDIARIA ABSORVIDA - nao tem (nem deve ter) arquivo em
-- supabase/migrations/.
--
-- Era um patch cirurgico (replace de duas strings em pg_get_functiondef) sobre
-- pedido_de_anuncio_completo. Os dois consertos foram absorvidos por
-- 20260807230808_esp11_par_chamado_na_emissao_e_estado_do_audio_derivado.sql:
--   1) a linha da nota visual ja nasce com
--      coalesce(v_drive, v_bloq->>'drive_file_id');
--   2) a frase sobre o par deixou de ser declarativa: a 230808 CHAMA
--      checar_par_texto_e_peca na emissao e deriva a mensagem do resultado.
-- Versionar este arquivo em migrations/ faria o replace procurar strings que
-- o corpo atual da funcao ja nao tem (falharia alto) ou, pior, tentaria
-- remendar um corpo que ja foi reescrito varias vezes depois - replay fora
-- de ordem e sem efeito novo.
-- ---------------------------------------------------------------------------
