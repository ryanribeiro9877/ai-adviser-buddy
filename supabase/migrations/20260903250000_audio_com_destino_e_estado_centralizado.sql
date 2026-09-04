-- AUDIO COM DESTINO, E "SEM FALA" DEIXA DE SER CONFUNDIDO COM "NAO AVALIADO"
--
-- POR QUE. A apuracao de 03/09/2026 mostrou que transcrever nao custava nada (US$ 0,47 para
-- escoar 172 videos) e que o impedimento era outro: a transcricao nao tinha destino.
-- `get_acervo_para_anuncio` carregava `transcricao_audio` por CINCO CTEs (dedup -> enriq ->
-- marc_global -> filtrado -> marc) e nunca a emitia no jsonb final. Quem escolhe criativo
-- nunca viu o audio de peca nenhuma, nem das 19 que ja estavam transcritas. Pagar pela
-- transcricao antes de abrir a saida seria comprar texto que ninguem le.
--
-- CONSERTO 1. A peca passa a levar `transcricao_do_audio` e `estado_do_audio`.
--
-- TRUNCAGEM, com criterio medido e nao por precaucao. A resposta desta funcao para a COHAPM
-- ja tem 95.458 chars (medido em 03/09/2026); as transcricoes medem 519 chars em media
-- (min 346, max 717 nas 19 medidas) e os videos dos 172 sao mais longos. Emitir tudo em
-- leitura total somaria ~122 mil chars e DOBRARIA a resposta. Entao: em LEITURA TOTAL o
-- texto sai cortado em 110 chars - o mesmo teto que `analise_visual` (left(motivo,110)) ja
-- usa nesta funcao, para nao inventar padrao novo - e INTEIRO quando o chamador passa
-- `drive_file_ids`, que e o caminho de slate conhecido que a propria funcao ja recomenda em
-- `como_usar`. Isso nao enfraquece compliance: o portao (`checar_par_texto_e_peca`) le a
-- COLUNA direto, nunca esta funcao.
--
-- CONSERTO 2. `sem_fala_util` era contado como "fala nao avaliada por ninguem" em dois
-- lugares, e sao coisas diferentes para quem le: video sem locucao JA foi conferido e nao
-- tem risco de fala; video nao avaliado e lacuna aberta. Os 5 Reels do Sistema Ocular
-- (3, 7, 10, 18, 19.mp4) cairam no balde errado, e a COHAPM recebia "0 de 153 videos tem
-- transcricao" quando 5 deles estavam conferidos.
--
-- A logica estava COPIADA em dois lugares (`checar_par_texto_e_peca` e
-- `pedido_de_anuncio_completo_sem_estado_destino`), e a edge grava TRES rotulos distintos
-- (`sem_fala_util:`, `sem_fala_detectada:`, `sem_audio_ou_corrompido:`). Remendar nos dois
-- deixaria o terceiro consumidor futuro repetir o erro, entao a leitura do estado do audio
-- passa a ser UMA funcao canonica, no mesmo espirito de `base_de_resultado`.
--
-- Falha tecnica NAO virou "conferido": arquivo corrompido ou acima do teto da OpenAI e
-- lacuna, nao ausencia de fala. Sao tres estados distintos, de proposito.

-- ============================ ESTADO CANONICO DO AUDIO ============================
create or replace function public.estado_do_audio_da_peca(
  p_transcricao text,
  p_fonte text,
  p_mime text
)
returns text
language sql
immutable
as $function$
  select case
    -- imagem/vetor nao tem faixa de audio: nao e lacuna, e inaplicavel.
    when coalesce(p_mime,'') not like 'video%'                then 'nao_se_aplica'
    when coalesce(btrim(p_transcricao),'') <> ''              then 'transcrito'
    -- conferido e sem locucao. `sem_fala_util` e o rotulo dos 5 Reels do Sistema Ocular;
    -- `sem_fala_detectada` e o que a edge grava quando o transcritor devolve texto vazio.
    when coalesce(p_fonte,'') like 'sem_fala_util%'
      or coalesce(p_fonte,'') like 'sem_fala_detectada%'      then 'sem_fala'
    -- audio inacessivel por defeito do arquivo: lacuna, e nao ausencia de fala.
    when coalesce(p_fonte,'') like 'sem_audio_ou_corrompido%' then 'falha_tecnica'
    else 'nao_avaliado'
  end;
$function$;

comment on function public.estado_do_audio_da_peca(text, text, text) is
  'Estado do audio de uma peca do Drive: nao_se_aplica (nao e video), transcrito, sem_fala '
  '(conferido, sem locucao), falha_tecnica (arquivo sem audio extraivel) ou nao_avaliado. '
  'Fonte unica: nao reimplemente a leitura de transcricao_fonte em consumidor novo.';

create or replace function public.audio_conferido(
  p_transcricao text,
  p_fonte text,
  p_mime text
)
returns boolean
language sql
immutable
as $function$
  -- Conferido = alguem de fato ouviu. Transcrito e "sem fala" contam; falha tecnica nao.
  select public.estado_do_audio_da_peca(p_transcricao, p_fonte, p_mime)
         in ('transcrito', 'sem_fala');
$function$;

comment on function public.audio_conferido(text, text, text) is
  'Verdadeiro quando a fala da peca ja foi avaliada - inclusive quando o veredito foi '
  '"nao ha fala". Falso para falha tecnica e para nunca avaliado, que sao lacunas abertas.';

-- ==================== CONSERTO 1: a transcricao chega a quem escolhe ====================
CREATE OR REPLACE FUNCTION public.get_acervo_para_anuncio(p_company_id uuid, p_produto text DEFAULT NULL::text, p_incluir_inaptas boolean DEFAULT true, p_drive_file_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with dedup as (
  select distinct on (d.drive_file_id)
    d.drive_file_id, d.nome, d.caminho, d.mime,
    d.produto_detectado, d.aproveitavel, d.motivo, d.texto_visivel,
    d.base_da_analise, d.transcricao_audio, d.transcricao_fonte, d.company_id
  from public.drive_midia_analises d
  where d.company_id = p_company_id
  order by d.drive_file_id,
           (d.base_da_analise like '%criterio%') desc,
           d.analisado_em desc nulls last
),
enriq as (
  select
    x.drive_file_id, x.nome, x.caminho,
    case when x.mime ilike 'video%' then 'video'
         when x.mime ilike 'image%' then 'imagem'
         else coalesce(x.mime,'?') end as tipo,
    (x.mime ilike 'video%') as e_video,
    case when x.caminho ~* 'carrossel' then x.caminho else null end as grupo_carrossel,
    case
      when x.mime ilike 'video%' and x.caminho ~* 'educa' then 'video_educacao_financeira'
      when x.mime ilike 'video%' and x.caminho ~* 'triste|caminho' then 'video_caminho_triste_feliz'
      when x.caminho ~* 'educa' and x.caminho ~* 'capa' then 'capa_de_video'
      when x.caminho ~* 'carrossel' then 'slide_carrossel'
      when lower(x.caminho) = 'cards' or x.caminho ~* '^cards/' then 'card_instrucional'
      when x.caminho ~* 'fixado' and x.caminho ~* 'cards' then 'card_fixado'
      when x.mime ilike 'video%' then 'video_outro'
      when x.mime ilike 'image%' then 'imagem_outra'
      else 'outro'
    end as familia_drive,
    case
      when lower(x.caminho) = 'cards' or x.caminho ~* '^cards/' then
        'mecanismo_instrucional: atrai com pergunta/tema e manda ler a legenda'
      when x.caminho ~* 'fixado' and x.caminho ~* 'cards' then
        'card_fixado_institucional_ou_educativo'
      when x.caminho ~* 'educa' and x.caminho ~* 'capa' then
        'capa_usada_nos_videos_de_educacao_financeira'
      else null
    end as papel_criativo,
    x.produto_detectado, x.aproveitavel, x.motivo, x.texto_visivel,
    x.base_da_analise, x.transcricao_audio, x.transcricao_fonte,
    -- Estado do audio pela funcao canonica, para nao reimplementar a leitura dos rotulos.
    public.estado_do_audio_da_peca(x.transcricao_audio, x.transcricao_fonte, x.mime) as estado_audio,
    mup.meta_video_id,
    mup.meta_image_hash,
    (mup.meta_video_id is not null or mup.meta_image_hash is not null) as na_biblioteca_meta,
    r.motivo as rev_motivo, r.regra_code as rev_regra, r.bloqueia_uso as rev_bloqueia,
    r.aberto_em as rev_aberto_em, r.aberto_por as rev_aberto_por, r.evidencia as rev_evidencia,
    r.veredito as rev_veredito,
    exists(select 1 from public.approval_requests ar
       where ar.company_id = x.company_id and ar.action = 'criar_anuncio_a_partir_de'
         and ar.payload->>'drive_file_id' = x.drive_file_id
         and ar.executed_at is not null and (ar.execution_result->>'ok') = 'true') as ja_virou_anuncio
  from dedup x
  left join lateral (
    select mu.meta_video_id, mu.meta_image_hash
      from public.media_uploads mu
     where mu.drive_file_id = x.drive_file_id
       and mu.company_id = x.company_id
       and mu.status = 'enviado'
       and (mu.meta_video_id is not null or mu.meta_image_hash is not null)
     order by mu.enviado_em desc nulls last
     limit 1
  ) mup on true
  left join lateral (
    select pr.motivo, pr.regra_code, pr.bloqueia_uso, pr.aberto_em, pr.aberto_por, pr.evidencia, pr.veredito
      from public.pecas_em_revisao pr
     where pr.company_id = x.company_id and pr.drive_file_id = x.drive_file_id and pr.bloqueia_uso is true
     order by pr.aberto_em desc limit 1
  ) r on true
),
marc_global as (
  select e.*,
    (e.rev_motivo is not null) as em_revisao,
    coalesce(e.rev_bloqueia,false) as bloqueada,
    (e.na_biblioteca_meta and not coalesce(e.rev_bloqueia,false)) as apta
  from enriq e
),
filtrado as (
  select * from marc_global
   where (p_drive_file_ids is null or cardinality(p_drive_file_ids) = 0 or drive_file_id = any(p_drive_file_ids))
     and (
       p_produto is null
       or produto_detectado ilike '%'||p_produto||'%'
       or caminho ilike '%'||p_produto||'%'
       or nome ilike '%'||p_produto||'%'
       or familia_drive ilike '%'||p_produto||'%'
     )
),
marc as (
  select * from filtrado
),
itens as (
  select m.*, jsonb_strip_nulls(jsonb_build_object(
    'nome', m.nome,
    'drive_file_id', m.drive_file_id,
    'caminho', m.caminho,
    'tipo', m.tipo,
    'familia_drive', m.familia_drive,
    'papel_criativo', m.papel_criativo,
    'legivel', true,
    'apta', m.apta,
    'na_biblioteca_da_meta', m.na_biblioteca_meta,
    'meta_video_id', m.meta_video_id,
    'meta_image_hash', m.meta_image_hash,
    'grupo_carrossel', m.grupo_carrossel,
    'uso_como_imagem_estatica', case when (m.familia_drive in ('slide_carrossel','capa_de_video','card_instrucional','card_fixado')) and m.tipo = 'imagem' then true else null end,
    'formato_carrossel_meta', case when m.familia_drive = 'slide_carrossel' then
      'use child_attachments (2-10 image_hash) para carrossel Meta real'
      else null end,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'fora da biblioteca da Meta - chame upload_midia'
                          when m.bloqueada then 'bloqueada por revisao de compliance'
                          else null end,
    'produto', coalesce(m.produto_detectado,'nao classificado'),
    'analise_visual', left(m.motivo, 110),
    -- O QUE A PECA FALA. Cortado em 110 chars (o mesmo teto de analise_visual) na leitura
    -- total, inteiro quando o chamador recorta por drive_file_ids. Ver nota no topo.
    'transcricao_do_audio', case
        when coalesce(btrim(m.transcricao_audio),'') = '' then null
        when (p_drive_file_ids is null or cardinality(p_drive_file_ids) = 0)
             and length(m.transcricao_audio) > 110
          then left(m.transcricao_audio, 110) || '...'
        else m.transcricao_audio end,
    -- Distingue "conferido e sem fala" de "fala nunca avaliada": ausencia de transcricao
    -- nao e ausencia de risco, mas video sem locucao tambem nao e lacuna.
    'estado_do_audio', nullif(m.estado_audio, 'nao_se_aplica'),
    'bloqueada_por_compliance', case when m.em_revisao then jsonb_build_object(
        'bloqueia_uso', m.bloqueada, 'motivo', left(m.rev_motivo,200), 'regra', m.rev_regra,
        'veredito', m.rev_veredito) else null end,
    'ja_usada_em_anuncio', m.ja_virou_anuncio
  )) as item
  from marc m
  where p_incluir_inaptas or m.apta
)
select jsonb_build_object(
  'produto_filtrado', p_produto,
  'drive_file_ids_filtro', p_drive_file_ids,
  'leitura_total', p_drive_file_ids is null or cardinality(p_drive_file_ids) = 0,
  'total_no_acervo_apos_filtro', (select count(*) from marc),
  'taxonomia_drive', jsonb_build_object(
     'videos_total', (select count(*) from marc_global where tipo = 'video'),
     'videos_educacao_financeira', (select count(*) from marc_global where familia_drive = 'video_educacao_financeira'),
     'videos_caminho_triste_feliz', (select count(*) from marc_global where familia_drive = 'video_caminho_triste_feliz'),
     'capas_de_video', (select count(*) from marc_global where familia_drive = 'capa_de_video'),
     'carrosseis', (select count(distinct grupo_carrossel) from marc_global where familia_drive = 'slide_carrossel'),
     'slides_carrossel', (select count(*) from marc_global where familia_drive = 'slide_carrossel'),
     'cards_instrucionais', (select count(*) from marc_global where familia_drive = 'card_instrucional'),
     'mapa', '19 videos + Capas + 9 Carrosseis + Cards; use drive_file_ids para slate conhecido'
  ),
  'inventario_global', jsonb_build_object(
     'arquivos_unicos', (select count(*) from marc_global),
     'videos', (select count(*) from marc_global where tipo = 'video'),
     'imagens', (select count(*) from marc_global where tipo = 'imagem'),
     'aptas_agora', (select count(*) from marc_global where apta)
  ),
  -- COBERTURA DE AUDIO no topo, e nao so por peca, por dois motivos: da o retrato da
  -- empresa em uma linha, e sobrevive a compactacao por item que o traffic-chat aplica
  -- (compactarAcervoParaAgente reescreve cada item com lista fixa de campos, mas preserva
  -- as chaves de topo por spread).
  'cobertura_de_audio', (select jsonb_build_object(
     'videos', count(*) filter (where tipo = 'video'),
     'com_transcricao', count(*) filter (where estado_audio = 'transcrito'),
     'conferidos_sem_fala', count(*) filter (where estado_audio = 'sem_fala'),
     'falha_tecnica_no_audio', count(*) filter (where estado_audio = 'falha_tecnica'),
     'fala_nao_avaliada', count(*) filter (where estado_audio = 'nao_avaliado'),
     'como_ler', 'conferidos_sem_fala NAO e lacuna: alguem ouviu e nao ha locucao. '
                 'fala_nao_avaliada e lacuna aberta - ausencia de leitura nao e ausencia de risco. '
                 'falha_tecnica e arquivo sem audio extraivel, que tambem nao foi ouvido.'
   ) from marc_global),
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta)),
  'como_usar', 'Com slate conhecido passe drive_file_ids: alem do payload menor, transcricao_do_audio vem INTEIRA (na leitura total ela vem cortada em 110 chars). Sem filtro = leitura total. Carrossel via child_attachments.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$function$;

-- ============== CONSERTO 2a: o portao para de chamar "sem fala" de lacuna ==============
CREATE OR REPLACE FUNCTION public.checar_par_texto_e_peca(p_company_id uuid, p_legenda text, p_drive_file_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_nome text; v_base text; v_mime text;
  v_texto_visivel text; v_motivo text; v_transcricao text; v_fonte text;
  v_estado_audio text;
  v_numeros text;
  v_texto_peca text := '';
  v_par text;
  v_res_legenda jsonb; v_res_peca jsonb; v_res_par jsonb;
  v_tem_peca boolean := false;
begin
  if p_company_id is null then
    raise exception 'checar_par_texto_e_peca exige p_company_id';
  end if;

  if p_drive_file_id is not null then
    select nome, base_da_analise, mime, texto_visivel, motivo, transcricao_audio, transcricao_fonte
      into v_nome, v_base, v_mime, v_texto_visivel, v_motivo, v_transcricao, v_fonte
      from public.drive_midia_analises
     where drive_file_id = p_drive_file_id and company_id = p_company_id
     order by (base_da_analise like '%criterio%') desc, analisado_em desc
     limit 1;
    v_tem_peca := found;
  end if;

  v_estado_audio := public.estado_do_audio_da_peca(v_transcricao, v_fonte, v_mime);

  v_numeros := substring(coalesce(v_motivo,'') from 'MENCIONA VALOR/TAXA/PRAZO:[^]]*');

  if v_tem_peca then
    v_texto_peca := coalesce(v_texto_visivel,'') || ' ' || coalesce(v_numeros,'')
                 || ' ' || coalesce(v_transcricao,'');
  end if;

  v_par := coalesce(p_legenda,'') || ' ' || v_texto_peca;

  v_res_legenda := public.checar_promessas_proibidas(p_legenda);
  v_res_peca    := public.checar_promessas_proibidas(nullif(btrim(v_texto_peca),''));
  v_res_par     := public.checar_promessas_proibidas(nullif(btrim(v_par),''));

  return jsonb_build_object(
    'veredito', case
        when jsonb_array_length(coalesce(v_res_par->'bloqueios','[]'::jsonb)) > 0 then 'reprova'
        when jsonb_array_length(coalesce(v_res_par->'atencoes','[]'::jsonb)) > 0 then 'atencao'
        when not coalesce((v_res_par->>'avaliado')::boolean, false) then 'nada_a_avaliar'
        else 'sem_violacao_detectada' end,
    'PAR', v_res_par,
    'so_a_legenda', v_res_legenda,
    'so_a_peca', v_res_peca,
    'peca', case when not v_tem_peca then null else jsonb_build_object(
        'nome', v_nome, 'base_da_analise', v_base, 'mime', v_mime,
        'caracteres_de_texto_na_tela', length(coalesce(v_texto_visivel,'')),
        'numeros_extraidos', v_numeros,
        'estado_do_audio', nullif(v_estado_audio, 'nao_se_aplica')) end,
    'cobertura', jsonb_build_object(
        'legenda_lida', (coalesce(btrim(p_legenda),'') <> ''),
        'texto_da_peca_lido', (v_tem_peca and coalesce(v_texto_visivel,'') <> ''),
        -- audio_lido agora significa "a fala foi avaliada", e video sem locucao conta como
        -- avaliado: era o defeito que punha os 5 Reels sem fala no balde de lacuna.
        'audio_lido', (v_tem_peca and public.audio_conferido(v_transcricao, v_fonte, v_mime)),
        'peca_encontrada', v_tem_peca),
    'lacunas', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'AUDIO NAO LIDO: nao ha transcricao para esta peca, entao o que e FALADO no video nao foi avaliado por ninguem. Isto nao e ausencia de risco.' as l
         where v_tem_peca and v_estado_audio = 'nao_avaliado'
        union all
        select 'AUDIO INACESSIVEL: a extracao de audio desta peca falhou (arquivo sem faixa de audio extraivel, ou acima do teto do transcritor), entao a fala tambem nao foi avaliada. Isto e diferente de video sem locucao.'
         where v_tem_peca and v_estado_audio = 'falha_tecnica'
        union all
        select 'PECA NAO ENCONTRADA nesta empresa: so a legenda foi avaliada. Ausencia de leitura da peca nao e aprovacao da peca.'
         where p_drive_file_id is not null and not v_tem_peca
        union all
        select 'NENHUMA PECA INFORMADA: este veredito cobre so o texto.'
         where p_drive_file_id is null
        union all
        select 'A peca nao tem texto visivel registrado: pode ser peca sem texto, ou leitura que nao capturou. As duas coisas parecem iguais aqui.'
         where v_tem_peca and coalesce(v_texto_visivel,'') = ''
      ) z),
    -- Conferido-e-sem-fala NAO entra em 'lacunas' de proposito: e cobertura completa, e
    -- listar como lacuna faria o emissor do card declarar falta que nao existe.
    'audio_sem_fala', case when v_estado_audio = 'sem_fala'
        then 'AUDIO CONFERIDO E SEM FALA: o transcritor rodou nesta peca e nao ha locucao (video so com texto na tela). A cobertura de audio esta completa aqui - nao ha lacuna a declarar.'
        else null end,
    'como_ler', 'O veredito vale sobre a CONCATENACAO de legenda + peca, porque regra condicional muda de resposta conforme o conjunto: citar taxa sem CET viola, mas se o CET estiver na legenda e o numero na peca, o par esta conforme. Por isso so_a_legenda e so_a_peca sao informativos - quem decide e PAR.',
    'nao_e_aprovacao', 'Deteccao por padrao de texto sobre a evidencia existente. O verificador por LLM continua sendo o principal, e ausencia de casamento aqui NAO e aprovacao.'
  );
end;
$function$;

-- ==================== CONSERTO 2b: o contador do pedido de anuncio ====================
-- POR QUE POR SUBSTITUICAO E NAO POR CREATE OR REPLACE INTEIRO. Esta funcao tem 16.629
-- chars e ha outros agentes trabalhando no repositorio agora. Reescrever o corpo inteiro a
-- mao arriscaria (a) erro de transcricao em 16 mil chars que nada tem a ver com este
-- conserto, e (b) desfazer em silencio alteracao concorrente de outro agente. Aqui cada
-- trecho e trocado por substituicao EXATA e verificada: se o trecho nao existir mais, a
-- migration ABORTA em vez de aplicar algo pela metade. O espelho registra o estado final
-- legivel da funcao, lido do banco depois de aplicar.
do $patch$
declare
  v_def text;
  v_novo text;
  v_trocas text[] := array[
    -- 1. o contador passa a usar a funcao canonica em vez de "tem texto ou nao".
    --    ATENCAO ao caixa: o corpo VIVO desta funcao esta em minusculas, e nao como no
    --    arquivo de 20260807230808 (que era maiusculo). A primeira tentativa abortou por
    --    isso - o guarda pegou, que era exatamente para o que ele serve.
    'count(*) filter (where mime like ''video%'' and coalesce(btrim(transcricao_audio),'''') <> '''')',
    'count(*) filter (where mime like ''video%'' and public.audio_conferido(transcricao_audio, transcricao_fonte, mime))',
    -- 2. a subconsulta precisa carregar transcricao_fonte para a funcao canonica ler o rotulo.
    'select distinct on (drive_file_id) drive_file_id, mime, transcricao_audio',
    'select distinct on (drive_file_id) drive_file_id, mime, transcricao_audio, transcricao_fonte',
    -- 3. cobertura total: "tem transcricao" ficou impreciso, porque video sem locucao esta
    --    conferido sem estar transcrito.
    'videos do acervo ja tem transcricao, entao o que e FALADO neles entra no compliance do par - inclusive as pecas em revisao estao entre as transcritas.',
    'videos do acervo ja tiveram a fala conferida (transcrita, ou ouvida e sem locucao), entao o que e FALADO neles entra no compliance do par - inclusive as pecas em revisao.',
    -- 4. cobertura parcial: o restante deixa de incluir quem ja foi ouvido e nao fala.
    'videos tem transcricao; nos '' || (v_videos_total - v_videos_transc)::text || '' restantes a fala ainda nao foi avaliada por ninguem',
    'videos tiveram a fala conferida (transcrita, ou ouvida e sem locucao); nos '' || (v_videos_total - v_videos_transc)::text || '' restantes a fala ainda nao foi avaliada por ninguem'
  ];
  i int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'pedido_de_anuncio_completo_sem_estado_destino';

  if v_def is null then
    raise exception 'pedido_de_anuncio_completo_sem_estado_destino nao existe - nada a consertar';
  end if;

  v_novo := v_def;
  i := 1;
  while i < array_length(v_trocas, 1) loop
    if position(v_trocas[i] in v_novo) = 0 then
      raise exception 'trecho esperado nao encontrado, abortando sem aplicar: %',
        left(v_trocas[i], 90);
    end if;
    v_novo := replace(v_novo, v_trocas[i], v_trocas[i + 1]);
    i := i + 2;
  end loop;

  if v_novo = v_def then
    raise exception 'substituicao nao mudou nada - o conserto nao teria efeito';
  end if;

  execute v_novo;
end
$patch$;

-- NOTA sobre o nome da variavel: `v_videos_transc` agora conta "audio conferido", nao
-- "transcrito". O nome nao foi trocado de proposito - renomear exigiria reescrever o corpo
-- inteiro, que e exatamente o risco que esta abordagem evita. O comentario fica aqui e no
-- espelho para o proximo leitor nao se enganar.
