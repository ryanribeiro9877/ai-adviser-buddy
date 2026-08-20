-- v28.31 (20/08/2026): acervo com filtro por drive_file_ids + imagens contam como na biblioteca.
-- Sem isto: (1) agente re-dumpa inventario inteiro ao emitir slate conhecido;
-- (2) pedido_de_anuncio_completo so olhava meta_video_id e recusava capa/carrossel ja enviados.

-- 1) Biblioteca Meta: video OU imagem
create or replace function public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id uuid, p_pedido jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_falta text[] := '{}';
  v_tipo text;
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_drive text := nullif(trim(coalesce(p_pedido->>'drive_file_id','')),'');
  v_video text := nullif(trim(coalesce(p_pedido->>'meta_video_id','')),'');
  v_img text := nullif(trim(coalesce(p_pedido->>'meta_image_hash','')),'');
  v_carr boolean := (jsonb_typeof(p_pedido->'child_attachments') = 'array'
                     and jsonb_array_length(coalesce(p_pedido->'child_attachments','[]'::jsonb)) >= 2);
  v_molde text := coalesce(nullif(trim(coalesce(p_pedido->>'creative_id','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_nome','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_conjunto text := coalesce(
    nullif(trim(coalesce(p_pedido->>'conjunto_destino_external_id','')),''),
    nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'')
  );
  v_conta text := nullif(trim(coalesce(p_pedido->>'conta_destino','')),'');
  v_midia text;
  v_ns_campo text; v_ns_recusa text; v_ns_msg text;
  v_risco text; v_produto text; v_base text; v_nome_peca text;
  v_ja_na_meta boolean; v_video_resolvido text; v_hash_resolvido text;
  v_bloq jsonb := jsonb_build_object('bloqueada', false);
  v_msg text := ''; v_nota text := '';
  v_par jsonb; v_cob jsonb;
  v_par_regras text; v_par_numeros text; v_par_seguro text; v_par_frase text := '';
  v_videos_total int := 0; v_videos_transc int := 0; v_regras_ativas int := 0;
  v_audio_frase text;
begin
  select c.campo, c.recusa_nomeada, c.mensagem_de_recusa
    into v_ns_campo, v_ns_recusa, v_ns_msg
    from public.contrato_de_execucao c
   where c.acao = 'criar_anuncio_a_partir_de' and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo)
   order by c.campo
   limit 1;
  if v_ns_campo is not null then
    return jsonb_build_object(
      'completo', false,
      'recusa', coalesce(v_ns_recusa, 'campo_nao_suportado'),
      'campo_nao_suportado', v_ns_campo,
      'tipo_de_pedido', nullif(trim(coalesce(p_pedido->>'tipo_de_pedido','')),''),
      'faltando', to_jsonb(array['um formato de anuncio que esta executora saiba publicar (video novo, imagem, carrossel, ou replicacao)']),
      'mensagem_para_o_gestor', coalesce(v_ns_msg,
        'Este pedido usa ' || v_ns_campo || ', que o executor nao suporta. O card nao foi emitido.'));
  end if;

  v_midia := coalesce(v_drive, v_video, v_img, case when v_carr then 'carrossel' else null end);

  v_tipo := case
    when nullif(trim(coalesce(p_pedido->>'tipo_de_pedido','')),'') is not null then p_pedido->>'tipo_de_pedido'
    when v_midia is not null then 'peca_nova'
    when v_molde is not null then 'replicacao_pura'
    else null end;

  if v_tipo is null then
    return jsonb_build_object('completo', false, 'tipo_de_pedido', null,
      'faltando', to_jsonb(array['saber que anuncio voce quer: replicar um que ja roda, ou publicar uma peca nova']),
      'mensagem_para_o_gestor', 'Nao consegui entender o pedido. Existem duas coisas diferentes: REPLICAR um anuncio que ja roda para outro conjunto (escalar o que funciona), ou publicar uma PECA NOVA do acervo. Diga qual, porque as duas exigem informacoes diferentes.');
  end if;
  if v_tipo not in ('replicacao_pura','peca_nova') then
    return jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo,
      'mensagem_para_o_gestor', 'Tipo de pedido desconhecido. Os validos sao replicar anuncio existente ou publicar peca nova.');
  end if;

  if nullif(trim(coalesce(p_pedido->>'nome_novo','')),'') is null then v_falta := array_append(v_falta,'nome do anuncio'); end if;
  if v_conjunto is null then v_falta := array_append(v_falta,'conjunto de destino (conjunto_destino_external_id)'); end if;
  if v_conta is null then v_falta := array_append(v_falta,'a conta de anuncios onde o anuncio nasce (conta_destino, formato act_<id>)'); end if;

  if v_molde is null then
    if v_tipo = 'replicacao_pura' then
      v_falta := array_append(v_falta, 'qual anuncio existente replicar (creative_id do molde)');
    else
      if nullif(trim(coalesce(p_pedido->>'page_id','')),'') is null then
        v_falta := array_append(v_falta, 'page_id da Pagina emissora (sem molde nao ha de onde herdar)');
      end if;
      if nullif(trim(coalesce(p_pedido->>'call_to_action_type','')),'') is null then
        v_falta := array_append(v_falta, 'call_to_action_type (ex.: LEARN_MORE; sem molde nao ha CTA a herdar)');
      end if;
      if nullif(trim(coalesce(p_pedido->>'destino_url','')),'') is null
         and nullif(trim(coalesce(p_pedido->'destino_do_anuncio'->>'url_final','')),'') is null then
        v_falta := array_append(v_falta, 'destino_url (URL de destino; sem molde so CLT tem LP canonica)');
      end if;
    end if;
  end if;

  if v_tipo = 'peca_nova' then
    if v_midia is null then v_falta := array_append(v_falta,'a peca criativa (arquivo do Drive ou midia ja enviada)'); end if;
    if v_legenda is null then v_falta := array_append(v_falta,'a LEGENDA do anuncio'); end if;
    if v_fonte is null then
      v_falta := array_append(v_falta,'de onde vem a legenda (legenda_fonte)');
    elsif v_fonte not in ('humano','herdada_do_molde','agente') then
      v_falta := array_append(v_falta,'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)');
    elsif v_fonte = 'agente' and (v_refs is null or jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) then
      v_falta := array_append(v_falta,'em quais anuncios existentes voce se baseou para escrever a legenda');
    end if;

    if v_drive is not null then
      select coalesce(m.meta_video_id, m.meta_image_hash), m.meta_video_id, coalesce(m.meta_image_hash, v_img), d.nome
        into v_hash_resolvido, v_video_resolvido, v_img, v_nome_peca
        from drive_midia_analises d
        left join media_uploads m
          on m.drive_file_id = d.drive_file_id and m.company_id = d.company_id and m.status='enviado'
         and (m.meta_video_id is not null or m.meta_image_hash is not null)
       where d.drive_file_id = v_drive and d.company_id = p_company_id
       order by m.enviado_em desc nulls last
       limit 1;
      v_ja_na_meta := (v_hash_resolvido is not null);
      if v_ja_na_meta is not true then
        v_falta := array_append(v_falta,'a peca enviada para a biblioteca da conta (ela esta no Drive e ainda nao foi enviada)');
      end if;
    elsif v_img is not null then
      v_ja_na_meta := exists (
        select 1 from media_uploads m
         where m.company_id = p_company_id and m.status = 'enviado' and m.meta_image_hash = v_img);
      if not v_ja_na_meta then
        v_falta := array_append(v_falta,'a peca enviada para a biblioteca da conta (meta_image_hash informado nao esta em media_uploads)');
      end if;
    elsif v_carr then
      v_ja_na_meta := (
        select bool_and(exists (
          select 1 from media_uploads m
           where m.company_id = p_company_id and m.status = 'enviado'
             and m.meta_image_hash = nullif(btrim(coalesce(s->>'image_hash', s->>'meta_image_hash','')),'')
        ))
        from jsonb_array_elements(p_pedido->'child_attachments') s
      );
      if v_ja_na_meta is not true then
        v_falta := array_append(v_falta,'a peca enviada para a biblioteca da conta (slides do carrossel sem image_hash em media_uploads)');
      end if;
    elsif v_video is not null then
      v_ja_na_meta := true;
      v_video_resolvido := v_video;
    else
      v_ja_na_meta := true;
    end if;

    v_bloq := public.peca_bloqueada_por_revisao(p_company_id, v_drive, coalesce(v_video, v_video_resolvido), v_img);
    if (v_bloq->>'bloqueada')::boolean is true then
      v_falta := array_append(v_falta,'o veredito do responsavel sobre esta peca, que esta em revisao de compliance e marcada para nao ser usada');
    end if;
  end if;

  if array_length(v_falta,1) is not null then
    v_msg := 'Nao emiti o card porque falta informacao ou condicao que eu NAO contorno. Preciso de: ' || array_to_string(v_falta,'; ') || '.';
    if 'a LEGENDA do anuncio' = any(v_falta) then
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda de um anuncio que ja roda, ou me pede para escrever uma com base nos que ja rodaram.';
    end if;
    if 'a peca criativa (arquivo do Drive ou midia ja enviada)' = any(v_falta) then
      v_msg := v_msg || ' Se a sua intencao era ESCALAR um anuncio que ja funciona para outro conjunto, isso e outro pedido e nao precisa de peca nova - diga qual anuncio replicar.';
    end if;
    if v_drive is not null and v_ja_na_meta is not true then
      v_msg := v_msg || ' Sobre a peca ' || coalesce(v_nome_peca, v_drive) || ': ela existe no Drive e foi analisada, mas NAO esta na biblioteca da conta - e sem isso o anuncio nao tem o que publicar. Um card assim seria aprovado e falharia na execucao, e aprovar card de anuncio e o ato que inicia o gasto. Envie a midia primeiro.';
    end if;
    if (v_bloq->>'bloqueada')::boolean is true then
      v_msg := v_msg || ' ' || coalesce(v_bloq->>'mensagem','');
    end if;
    return jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo, 'faltando', to_jsonb(v_falta),
                              'peca_ja_na_biblioteca', v_ja_na_meta,
                              'peca_em_revisao', v_bloq,
                              'mensagem_para_o_gestor', v_msg);
  end if;

  if v_tipo = 'peca_nova' and v_legenda is not null and v_drive is not null then
    v_par := public.checar_par_texto_e_peca(p_company_id, v_legenda, v_drive);
    v_cob := coalesce(v_par->'cobertura','{}'::jsonb);
    if coalesce((v_cob->>'peca_encontrada')::boolean, false)
       and coalesce((v_cob->>'texto_da_peca_lido')::boolean, false) then
      if (v_par->>'veredito') = 'reprova' then
        select string_agg(distinct b->>'regra', ', '),
               string_agg(distinct nullif(btrim(coalesce(b->>'seguro','')),''), ' ')
          into v_par_regras, v_par_seguro
          from jsonb_array_elements(coalesce(v_par->'PAR'->'bloqueios','[]'::jsonb)) b;
        v_par_numeros := nullif(btrim(coalesce(v_par->'peca'->>'numeros_extraidos','')),'');
        return jsonb_build_object(
          'completo', false,
          'tipo_de_pedido', v_tipo,
          'recusa', 'par_texto_e_peca_reprova',
          'faltando', to_jsonb(array['o CET na legenda da publicacao, para o par legenda+peca ficar conforme']),
          'peca_ja_na_biblioteca', v_ja_na_meta,
          'peca_em_revisao', v_bloq,
          'par_texto_e_peca', v_par,
          'mensagem_para_o_gestor',
            'NAO emiti o card: avaliei o PAR - a legenda da publicacao somada ao que a peca MOSTRA na tela (e FALA, quando transcrita) - com checar_par_texto_e_peca, e ele REPROVOU. '
            || 'Regra que pegou: ' || coalesce(v_par_regras, '(sem regra nomeada vigente)') || '. '
            || case when v_par_numeros is not null
                    then 'A peca exibe ' || v_par_numeros || ', e a legenda nao traz a informacao que a regra condiciona. '
                    else 'A peca exibe valor/taxa/prazo e a legenda nao traz a informacao que a regra condiciona. ' end
            || 'O veredito vale sobre a CONCATENACAO, entao o que resolve e completar a LEGENDA DA PUBLICACAO (a parte que e nossa): '
            || coalesce(nullif(v_par_seguro,''), 'inclua o CET (ex.: consulte o CET na sua simulacao) e a ressalva de analise de credito.')
            || ' Com isso na legenda o mesmo par fica conforme. Sem isso, uma peca liberada sob condicao viraria anuncio com a condicao nao cumprida - por isso recuso aqui, antes do card.');
      end if;
      v_par_frase := ' O PAR legenda+peca FOI avaliado agora na emissao (checar_par_texto_e_peca, sobre a concatenacao): veredito ' || coalesce(v_par->>'veredito','?') || ' - o card so sai porque nao reprovou (numero na peca com CET na legenda esta conforme; sem o CET, reprovaria).';
    else
      v_par_frase := ' O PAR legenda+peca NAO pode ser fechado neste pedido porque falta um dos lados ('
        || coalesce((select string_agg(x, ' ') from jsonb_array_elements_text(coalesce(v_par->'lacunas','[]'::jsonb)) x), 'peca sem texto lido')
        || '): declaro a lacuna em vez de aprovar por omissao. Ausencia de leitura NAO e aprovacao.';
    end if;
  else
    v_par_frase := ' O PAR legenda+peca (checar_par_texto_e_peca) roda quando ha peca nova com texto e legenda; neste pedido esse par nao se aplica'
      || case when v_tipo = 'replicacao_pura' then ' (o criativo vem do molde).' else '.' end;
  end if;

  select count(*) filter (where mime like 'video%'),
         count(*) filter (where mime like 'video%' and coalesce(btrim(transcricao_audio),'') <> '')
    into v_videos_total, v_videos_transc
    from (select distinct on (drive_file_id) drive_file_id, mime, transcricao_audio
            from public.drive_midia_analises
           where company_id = p_company_id
           order by drive_file_id, analisado_em desc) q;

  select count(*) into v_regras_ativas from public.compliance_rules where coalesce(active, true);

  v_audio_frase := case
    when v_videos_total = 0 then
      'Sobre o AUDIO: nao ha video analisado no acervo desta empresa, entao nao ha fala a transcrever por ora.'
    when v_videos_transc >= v_videos_total then
      'Sobre o AUDIO: os ' || v_videos_total::text || ' videos do acervo ja tem transcricao, entao o que e FALADO neles entra no compliance do par - inclusive as pecas em revisao estao entre as transcritas.'
    else
      'Sobre o AUDIO: ' || v_videos_transc::text || ' de ' || v_videos_total::text || ' videos tem transcricao; nos ' || (v_videos_total - v_videos_transc)::text || ' restantes a fala ainda nao foi avaliada por ninguem, e a lacuna e declarada peca a peca.'
  end;

  v_nota := coalesce(public.nota_visual_da_peca(p_company_id, coalesce(v_drive, v_bloq->>'drive_file_id')), '');

  return jsonb_build_object(
    'completo', true, 'tipo_de_pedido', v_tipo,
    'legenda_fonte', case when v_tipo='replicacao_pura' then 'herdada_do_molde' else v_fonte end,
    'conjunto_destino_external_id', v_conjunto,
    'conta_destino', v_conta,
    'creative_id', v_molde,
    'compliance_de_texto_obrigatorio', true,
    'peca_ja_na_biblioteca', v_ja_na_meta,
    'peca_em_revisao', v_bloq,
    'meta_video_id_resolvido', v_video_resolvido,
    'par_texto_e_peca', v_par,
    'nota_visual_da_peca', nullif(v_nota,''),
    'mensagem_para_o_gestor',
      case v_tipo
        when 'replicacao_pura' then
          'Este pedido REPLICA um anuncio que ja roda para outro conjunto - e escalar o que funciona, nao publicar peca nova. O anuncio nasce IDENTICO ao original, criativo e texto inclusive, e isso e o proposito. A legenda vem do proprio anuncio de origem e passa pelo compliance de texto de novo mesmo assim.'
        else
          case v_fonte
            when 'humano' then 'A legenda e sua e sera publicada como escrita. Ela AINDA passa pelo compliance de texto: quem escreveu nao muda a exposicao regulatoria de um anuncio de credito.'
            when 'herdada_do_molde' then 'A legenda e reuso do texto de um anuncio que ja rodou, mas a PECA e nova - entao passa pelo compliance de texto de novo.'
            when 'agente' then 'Eu escrevi esta legenda a partir dos anuncios que voce ve nas referencias. Leia antes de aprovar: autoria minha nao substitui sua decisao.'
          end
      end
      || ' O QUE E AVALIADO E O QUE NAO E, seja explicito com o gestor: o compliance avalia a LEGENDA, por ' || v_regras_ativas::text || ' regras com fonte juridica, e pode BLOQUEAR. Quando ha peca do acervo, ela tem avaliacao visual propria, que vai como nota.'
      || v_par_frase
      || ' ' || v_audio_frase
      || coalesce(v_nota,''));
end $function$;

-- 2) Acervo: filtro opcional por drive_file_ids
drop function if exists public.get_acervo_para_anuncio(uuid, text, boolean);

create or replace function public.get_acervo_para_anuncio(
  p_company_id uuid,
  p_produto text default null,
  p_incluir_inaptas boolean default true,
  p_drive_file_ids text[] default null
) returns jsonb
language sql stable security definer set search_path = public as $$
with dedup as (
  select distinct on (d.drive_file_id)
    d.drive_file_id, d.nome, d.caminho, d.mime,
    d.produto_detectado, d.aproveitavel, d.motivo, d.texto_visivel,
    d.base_da_analise, d.transcricao_audio, d.company_id
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
    x.base_da_analise, x.transcricao_audio,
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
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta)),
  'como_usar', 'Com slate conhecido passe drive_file_ids. Sem filtro = leitura total. Carrossel via child_attachments.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean, text[]) from public, anon, authenticated;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean, text[]) to service_role;
