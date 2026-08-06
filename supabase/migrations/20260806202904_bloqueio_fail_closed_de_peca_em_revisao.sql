-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806202904
-- name: bloqueio_fail_closed_de_peca_em_revisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao
-- PROBLEMA QUE ISSO RESOLVE (provado em 06/08/2026): pecas_em_revisao.bloqueia_uso=true so
-- existia como TEXTO. nota_visual_da_peca escrevia "IMPEDIMENTO", mas pedido_de_anuncio_completo
-- devolvia completo=true, o card era emitido, aprovado, o gatilho chamava a executora e o pedido
-- chegava ao ULTIMO PASSO: audit_log meta_action_dry_run do approval
-- aaaaaaaa-0000-4000-8000-000000000022 registra SIMULADO com o video 926814049730973 (peca 22,
-- bloqueada) dentro do adcreative e flags_permitiriam master/flag_acao/rate_ok todas true. Com
-- dry_run=false aquilo teria criado o anuncio. Impedimento que so aparece em prosa nao e gate.

-- Fonte UNICA do bloqueio: mesmo criterio que nota_visual_da_peca usa para dizer IMPEDIMENTO
-- (bloqueia_uso e veredito ainda nao dado), para nota e gate nunca discordarem.
create or replace function public.peca_bloqueada_por_revisao(
  p_company_id uuid,
  p_drive_file_id text default null,
  p_meta_video_id text default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_drive text := nullif(trim(coalesce(p_drive_file_id,'')),'');
  v_video text := nullif(trim(coalesce(p_meta_video_id,'')),'');
  rev record;
begin
  -- O card pode carregar SO o meta_video_id: e por ele que a executora publica. Resolver de volta
  -- ao drive_file_id e o que impede contornar o bloqueio passando a midia ja enviada.
  if v_drive is null and v_video is not null then
    select m.drive_file_id into v_drive
      from public.media_uploads m
     where m.company_id = p_company_id
       and m.meta_video_id = v_video
       and m.drive_file_id is not null
     order by m.enviado_em desc nulls last
     limit 1;
  end if;

  -- Sem peca identificavel nao ha o que bloquear: replicacao pura nao carrega midia nova, e
  -- midia que nunca passou por media_uploads nao pode estar em pecas_em_revisao (a tabela e
  -- chaveada por drive_file_id). Declarado, nao escondido.
  if v_drive is null then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', false);
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and bloqueia_uso is true
     and veredito is null
   order by aberto_em desc
   limit 1;

  if not found then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', true, 'drive_file_id', v_drive);
  end if;

  return jsonb_build_object(
    'bloqueada', true, 'peca_identificada', true, 'drive_file_id', v_drive,
    'nome', rev.nome, 'motivo', rev.motivo, 'regra_code', rev.regra_code,
    'aberto_em', rev.aberto_em, 'aberto_por', rev.aberto_por,
    'mensagem', 'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
      ' esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito' ||
      case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end ||
      '. Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || coalesce(rev.aberto_por,'?') ||
      '. Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
      ' Isto NAO e ressalva para o gestor decidir no card: enquanto o responsavel nao der veredito,' ||
      ' a peca nao vai para anuncio. Para liberar, o veredito tem que ser registrado em' ||
      ' pecas_em_revisao - nao existe caminho por fora.');
end $function$;

comment on function public.peca_bloqueada_por_revisao(uuid,text,text) is
  'Fonte unica do bloqueio de peca em revisao de compliance (bloqueia_uso=true e sem veredito). Aceita drive_file_id ou meta_video_id (resolve via media_uploads). Consumida por pedido_de_anuncio_completo (antes do card) e pela executora meta-actions (defense-in-depth).';

grant execute on function public.peca_bloqueada_por_revisao(uuid,text,text) to authenticated, service_role;

-- pedido_de_anuncio_completo: o bloqueio passa a ser IMPEDIMENTO (completo=false), no ponto mais
-- cedo do fluxo - antes de existir card para aprovar. Unica mudanca; o resto do corpo e o de antes.
CREATE OR REPLACE FUNCTION public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_falta text[] := '{}';
  v_tipo text;
  v_fonte text := nullif(trim(coalesce(p_pedido->>'legenda_fonte','')),'');
  v_legenda text := nullif(trim(coalesce(p_pedido->>'legenda','')),'');
  v_refs jsonb := p_pedido->'legenda_referencias';
  v_drive text := nullif(trim(coalesce(p_pedido->>'drive_file_id','')),'');
  v_video text := nullif(trim(coalesce(p_pedido->>'meta_video_id','')),'');
  v_hash  text := nullif(trim(coalesce(p_pedido->>'meta_image_hash','')),'');
  v_molde text := coalesce(nullif(trim(coalesce(p_pedido->>'molde','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_nome','')),''),
                           nullif(trim(coalesce(p_pedido->>'molde_creative_id','')),''));
  v_midia text := coalesce(v_drive, v_video, v_hash);
  v_risco text; v_produto text; v_base text; v_nome_peca text;
  v_ja_na_meta boolean; v_video_resolvido text;
  v_bloq jsonb := jsonb_build_object('bloqueada', false);
  v_msg text := ''; v_nota text := '';
BEGIN
  v_tipo := CASE
    WHEN nullif(trim(coalesce(p_pedido->>'tipo_de_pedido','')),'') IS NOT NULL THEN p_pedido->>'tipo_de_pedido'
    WHEN v_midia IS NOT NULL THEN 'peca_nova'
    WHEN v_molde IS NOT NULL THEN 'replicacao_pura'
    ELSE NULL END;

  IF v_tipo IS NULL THEN
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', null,
      'faltando', to_jsonb(ARRAY['saber que anuncio voce quer: replicar um que ja roda, ou publicar uma peca nova']),
      'mensagem_para_o_gestor', 'Nao consegui entender o pedido. Existem duas coisas diferentes: REPLICAR um anuncio que ja roda para outro conjunto (escalar o que funciona), ou publicar uma PECA NOVA do acervo. Diga qual, porque as duas exigem informacoes diferentes.');
  END IF;
  IF v_tipo NOT IN ('replicacao_pura','peca_nova') THEN
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo,
      'mensagem_para_o_gestor', 'Tipo de pedido desconhecido. Os validos sao replicar anuncio existente ou publicar peca nova.');
  END IF;

  IF nullif(trim(coalesce(p_pedido->>'nome_novo','')),'') IS NULL THEN v_falta := array_append(v_falta,'nome do anuncio'); END IF;
  IF nullif(trim(coalesce(p_pedido->>'conjunto_destino','')),'') IS NULL THEN v_falta := array_append(v_falta,'conjunto de destino'); END IF;

  IF v_tipo = 'replicacao_pura' THEN
    IF v_molde IS NULL THEN v_falta := array_append(v_falta,'qual anuncio existente replicar'); END IF;
  ELSE
    IF v_midia IS NULL THEN v_falta := array_append(v_falta,'a peca criativa (arquivo do Drive ou midia ja enviada)'); END IF;
    IF v_legenda IS NULL THEN v_falta := array_append(v_falta,'a LEGENDA do anuncio'); END IF;
    IF v_fonte IS NULL THEN
      v_falta := array_append(v_falta,'de onde vem a legenda');
    ELSIF v_fonte NOT IN ('humano','herdada_do_molde','agente') THEN
      v_falta := array_append(v_falta,'uma procedencia valida para a legenda (gestor, herdada de anuncio existente, ou escrita pelo sistema)');
    ELSIF v_fonte = 'agente' AND (v_refs IS NULL OR jsonb_array_length(coalesce(v_refs,'[]'::jsonb)) = 0) THEN
      v_falta := array_append(v_falta,'em quais anuncios existentes voce se baseou para escrever a legenda');
    END IF;

    -- IMPEDIMENTO, nao aviso: sem midia na biblioteca o card nao pode dar certo.
    IF v_drive IS NOT NULL THEN
      SELECT m.meta_video_id, d.nome INTO v_video_resolvido, v_nome_peca
        FROM drive_midia_analises d
        LEFT JOIN media_uploads m ON m.drive_file_id = d.drive_file_id AND m.status='enviado'
       WHERE d.drive_file_id = v_drive AND d.company_id = p_company_id LIMIT 1;
      v_ja_na_meta := (v_video_resolvido IS NOT NULL);
      IF v_ja_na_meta IS NOT TRUE THEN
        v_falta := array_append(v_falta,'a peca enviada para a biblioteca da conta (ela esta no Drive e ainda nao foi enviada)');
      END IF;
    ELSE
      v_ja_na_meta := true;  -- veio identificador da Meta direto: ja esta la por definicao
    END IF;

    -- Peca em revisao de compliance com bloqueia_uso: IMPEDIMENTO, nao ressalva. Antes isto
    -- aparecia apenas como texto na nota e o pedido saia completo. Vale tambem quando o pedido
    -- traz so o meta_video_id: a RPC resolve a peca de volta por media_uploads.
    v_bloq := public.peca_bloqueada_por_revisao(p_company_id, v_drive, coalesce(v_video, v_video_resolvido));
    IF (v_bloq->>'bloqueada')::boolean IS TRUE THEN
      v_falta := array_append(v_falta,'o veredito do responsavel sobre esta peca, que esta em revisao de compliance e marcada para nao ser usada');
    END IF;
  END IF;

  IF array_length(v_falta,1) IS NOT NULL THEN
    v_msg := 'Nao emiti o card porque falta informacao ou condicao que eu NAO contorno. Preciso de: ' || array_to_string(v_falta,'; ') || '.';
    IF 'a LEGENDA do anuncio' = ANY(v_falta) THEN
      v_msg := v_msg || ' Sobre a legenda: ela nao esta guardada em lugar nenhum do sistema nem vem do Drive - ou voce me passa o texto, ou me autoriza a herdar a legenda de um anuncio que ja roda, ou me pede para escrever uma com base nos que ja rodaram.';
    END IF;
    IF 'a peca criativa (arquivo do Drive ou midia ja enviada)' = ANY(v_falta) THEN
      v_msg := v_msg || ' Se a sua intencao era ESCALAR um anuncio que ja funciona para outro conjunto, isso e outro pedido e nao precisa de peca nova - diga qual anuncio replicar.';
    END IF;
    IF v_drive IS NOT NULL AND v_ja_na_meta IS NOT TRUE THEN
      v_msg := v_msg || ' Sobre a peca ' || coalesce(v_nome_peca, v_drive) || ': ela existe no Drive e foi analisada, mas NAO esta na biblioteca da conta - e sem isso o anuncio nao tem o que publicar. Um card assim seria aprovado e falharia na execucao, e aprovar card de anuncio e o ato que inicia o gasto. Envie a midia primeiro.';
    END IF;
    IF (v_bloq->>'bloqueada')::boolean IS TRUE THEN
      v_msg := v_msg || ' ' || coalesce(v_bloq->>'mensagem','');
    END IF;
    RETURN jsonb_build_object('completo', false, 'tipo_de_pedido', v_tipo, 'faltando', to_jsonb(v_falta),
                              'peca_ja_na_biblioteca', v_ja_na_meta,
                              'peca_em_revisao', v_bloq,
                              'mensagem_para_o_gestor', v_msg);
  END IF;

  -- Nota visual: uma fonte unica (nota_visual_da_peca). Antes a construcao local
  -- omitia aproveitavel, motivo e a divergencia de universo que a funcao ja declara.
  v_nota := coalesce(public.nota_visual_da_peca(p_company_id, v_drive), '');

  RETURN jsonb_build_object(
    'completo', true, 'tipo_de_pedido', v_tipo,
    'legenda_fonte', CASE WHEN v_tipo='replicacao_pura' THEN 'herdada_do_molde' ELSE v_fonte END,
    'compliance_de_texto_obrigatorio', true,
    'peca_ja_na_biblioteca', v_ja_na_meta,
    'peca_em_revisao', v_bloq,
    'meta_video_id_resolvido', v_video_resolvido,
    'nota_visual_da_peca', nullif(v_nota,''),
    'mensagem_para_o_gestor',
      CASE v_tipo
        WHEN 'replicacao_pura' THEN
          'Este pedido REPLICA um anuncio que ja roda para outro conjunto - e escalar o que funciona, nao publicar peca nova. O anuncio nasce IDENTICO ao original, criativo e texto inclusive, e isso e o proposito. A legenda vem do proprio anuncio de origem e passa pelo compliance de texto de novo mesmo assim.'
        ELSE
          CASE v_fonte
            WHEN 'humano' THEN 'A legenda e sua e sera publicada como escrita. Ela AINDA passa pelo compliance de texto: quem escreveu nao muda a exposicao regulatoria de um anuncio de credito.'
            WHEN 'herdada_do_molde' THEN 'A legenda e reuso do texto de um anuncio que ja rodou, mas a PECA e nova - entao passa pelo compliance de texto de novo.'
            WHEN 'agente' THEN 'Eu escrevi esta legenda a partir dos anuncios que voce ve nas referencias. Leia antes de aprovar: autoria minha nao substitui sua decisao.'
          END
      END
      || ' O QUE E AVALIADO E O QUE NAO E, seja explicito com o gestor: o compliance avalia a LEGENDA, por 16 regras com fonte juridica, e pode BLOQUEAR. Quando ha peca do acervo, ela tem avaliacao visual propria, que vai como nota. NENHUM DOS DOIS AVALIA O PAR texto mais peca junto - nao existe caminho para isso hoje, e prometer que existe seria pior que a lacuna.'
      || coalesce(v_nota,''));
END $function$;
