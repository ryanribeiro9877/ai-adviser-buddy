-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807222646
-- name: registrar_veredito_peca_em_revisao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-07 complemento: caminho DECLARADO para o responsavel registrar veredito.
-- Antes so existia UPDATE a mao em pecas_em_revisao; a doutrina do projeto e que
-- veredito nao se da por fora. Esta RPC e a unica porta.
--
-- Efeito em bloqueia_uso (fonte unica do gate peca_bloqueada_por_revisao):
--   liberado_como_esta -> bloqueia_uso = false (executor passa a aceitar)
--   ajustar_peca / nao_usar -> bloqueia_uso = true (continua impedimento)
-- O gate deixa de exigir veredito IS NULL: passa a olhar so bloqueia_uso, para que
-- nao_usar/ajustar_peca nao 'desbloqueiem' por acidente ao fechar a revisao.

create or replace function public.registrar_veredito_peca_em_revisao(
  p_company_id uuid,
  p_drive_file_id text,
  p_veredito text,
  p_veredito_por text,
  p_nota text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_drive text := nullif(trim(coalesce(p_drive_file_id,'')),'');
  v_autor text := nullif(trim(coalesce(p_veredito_por,'')),'');
  v_ver text := nullif(trim(coalesce(p_veredito,'')),'');
  rev public.pecas_em_revisao%rowtype;
  v_bloqueia boolean;
begin
  if p_company_id is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_company_id';
  end if;
  if v_drive is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_drive_file_id';
  end if;
  if v_autor is null then
    raise exception 'registrar_veredito_peca_em_revisao exige p_veredito_por (decisao sem dono nao e decisao)';
  end if;
  if v_ver is null or v_ver not in ('liberado_como_esta','ajustar_peca','nao_usar') then
    raise exception 'veredito invalido: use liberado_como_esta | ajustar_peca | nao_usar';
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and veredito is null
   order by aberto_em desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'erro', 'nenhuma_revisao_aberta',
      'mensagem', 'Nao ha revisao aberta (veredito nulo) para esta peca nesta empresa. Nao invente veredito nem reabra por fora.');
  end if;

  v_bloqueia := (v_ver <> 'liberado_como_esta');

  update public.pecas_em_revisao
     set veredito = v_ver,
         veredito_em = current_date,
         veredito_por = v_autor,
         bloqueia_uso = v_bloqueia,
         motivo = case
           when nullif(trim(coalesce(p_nota,'')),'') is null then motivo
           else motivo || ' | VEREDITO (' || v_ver || ' por ' || v_autor || ' em ' || to_char(current_date,'DD/MM/YYYY') || '): ' || trim(p_nota)
         end
   where id = rev.id
   returning * into rev;

  return jsonb_build_object(
    'ok', true,
    'id', rev.id,
    'drive_file_id', rev.drive_file_id,
    'nome', rev.nome,
    'veredito', rev.veredito,
    'veredito_em', rev.veredito_em,
    'veredito_por', rev.veredito_por,
    'bloqueia_uso', rev.bloqueia_uso,
    'efeito', case
      when rev.bloqueia_uso then 'peca continua IMPEDIDA para anuncio (peca_bloqueada_por_revisao = bloqueada)'
      else 'peca LIBERADA para o executor (peca_bloqueada_por_revisao deixa de bloquear)'
    end,
    'mensagem', 'Veredito registrado. Caminho unico: esta RPC. Nao atualize pecas_em_revisao a mao.');
end;
$function$;

comment on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text) is
  'Porta unica para o responsavel fechar revisao de compliance em pecas_em_revisao. liberado_como_esta desliga bloqueia_uso; ajustar_peca/nao_usar mantem bloqueio. Nao use UPDATE direto.';

revoke all on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text) from public, anon;
grant execute on function public.registrar_veredito_peca_em_revisao(uuid, text, text, text, text) to authenticated, service_role;

-- Gate: bloqueia enquanto bloqueia_uso=true, com ou sem veredito ja dado.
-- Assim nao_usar/ajustar_peca nao abrem a porta ao fechar a revisao.
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
  if v_drive is null and v_video is not null then
    select m.drive_file_id into v_drive
      from public.media_uploads m
     where m.company_id = p_company_id
       and m.meta_video_id = v_video
       and m.drive_file_id is not null
     order by m.enviado_em desc nulls last
     limit 1;
  end if;

  if v_drive is null then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', false);
  end if;

  select * into rev
    from public.pecas_em_revisao
   where company_id = p_company_id
     and drive_file_id = v_drive
     and bloqueia_uso is true
   order by aberto_em desc
   limit 1;

  if not found then
    return jsonb_build_object('bloqueada', false, 'peca_identificada', true, 'drive_file_id', v_drive);
  end if;

  return jsonb_build_object(
    'bloqueada', true, 'peca_identificada', true, 'drive_file_id', v_drive,
    'nome', rev.nome, 'motivo', rev.motivo, 'regra_code', rev.regra_code,
    'aberto_em', rev.aberto_em, 'aberto_por', rev.aberto_por,
    'veredito', rev.veredito, 'veredito_em', rev.veredito_em, 'veredito_por', rev.veredito_por,
    'mensagem', case
      when rev.veredito is null then
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito' ||
        case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end ||
        '. Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || coalesce(rev.aberto_por,'?') ||
        '. Motivo: ' || coalesce(rev.motivo,'nao registrado') ||
        ' Isto NAO e ressalva para o gestor decidir no card: enquanto o responsavel nao der veredito,' ||
        ' a peca nao vai para anuncio. Para liberar, use registrar_veredito_peca_em_revisao - nao existe caminho por fora.'
      else
        'IMPEDIMENTO: a peca ' || coalesce(rev.nome, v_drive) ||
        ' tem veredito ' || rev.veredito || ' (em ' || to_char(rev.veredito_em,'DD/MM/YYYY') ||
        ' por ' || coalesce(rev.veredito_por,'?') || ') e permanece bloqueada para anuncio.' ||
        case when rev.regra_code is not null then ' Regra: ' || rev.regra_code || '.' else '' end ||
        ' Motivo: ' || coalesce(rev.motivo,'nao registrado')
    end);
end;
$function$;

comment on function public.peca_bloqueada_por_revisao(uuid,text,text) is
  'Fonte unica do bloqueio de peca em revisao (bloqueia_uso=true). Aceita drive_file_id ou meta_video_id. Apos veredito negativo o bloqueio permanece; so liberado_como_esta via registrar_veredito_peca_em_revisao desliga.';

-- Acervo: marca bloqueio por bloqueia_uso, nao so revisao aberta.
create or replace function public.get_acervo_para_anuncio(
  p_company_id uuid,
  p_produto text default null,
  p_incluir_inaptas boolean default true
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
    x.produto_detectado, x.aproveitavel, x.motivo, x.texto_visivel,
    x.base_da_analise, x.transcricao_audio,
    exists(select 1 from public.media_uploads m
            where m.drive_file_id = x.drive_file_id
              and (m.meta_video_id is not null or m.meta_image_hash is not null)) as na_biblioteca_meta,
    r.motivo as rev_motivo, r.regra_code as rev_regra, r.bloqueia_uso as rev_bloqueia,
    r.aberto_em as rev_aberto_em, r.aberto_por as rev_aberto_por, r.evidencia as rev_evidencia,
    r.veredito as rev_veredito,
    exists(select 1 from public.approval_requests ar
       where ar.company_id = x.company_id and ar.action = 'criar_anuncio_a_partir_de'
         and ar.payload->>'drive_file_id' = x.drive_file_id
         and ar.executed_at is not null and (ar.execution_result->>'ok') = 'true') as ja_virou_anuncio
  from dedup x
  left join lateral (
    select pr.motivo, pr.regra_code, pr.bloqueia_uso, pr.aberto_em, pr.aberto_por, pr.evidencia, pr.veredito
      from public.pecas_em_revisao pr
     where pr.company_id = x.company_id and pr.drive_file_id = x.drive_file_id and pr.bloqueia_uso is true
     order by pr.aberto_em desc limit 1
  ) r on true
),
filtrado as (
  select * from enriq
   where p_produto is null or produto_detectado ilike '%'||p_produto||'%'
),
marc as (
  select f.*,
    (f.rev_motivo is not null) as em_revisao,
    coalesce(f.rev_bloqueia,false) as bloqueada,
    (f.na_biblioteca_meta and not coalesce(f.rev_bloqueia,false)) as apta
  from filtrado f
),
itens as (
  select m.*, jsonb_strip_nulls(jsonb_build_object(
    'nome', m.nome,
    'drive_file_id', m.drive_file_id,
    'caminho', m.caminho,
    'tipo', m.tipo,
    'apta', m.apta,
    'na_biblioteca_da_meta', m.na_biblioteca_meta,
    'motivo_inapta', case when not m.na_biblioteca_meta
                          then 'fora da biblioteca da Meta (sem meta_video_id nem image_hash); publicar assim faria o card falhar'
                          when m.bloqueada then 'bloqueada por revisao de compliance'
                          else null end,
    'produto', coalesce(m.produto_detectado,'nao classificado'),
    'produto_fonte', case when m.e_video then 'inferido (transcricao+frames)' else 'leitura visual' end,
    'aproveitavel_visual', coalesce(m.aproveitavel,'nao classificado'),
    'analise_visual', left(m.motivo, 110),
    'texto_visivel', case when not m.e_video then nullif(left(coalesce(m.texto_visivel,''),110),'') else null end,
    'transcricao_ausente', case when m.e_video and (m.transcricao_audio is null or length(m.transcricao_audio)=0) then true else null end,
    'o_que_diz_no_audio', case when m.transcricao_audio is not null and length(m.transcricao_audio)>0
                               then left(m.transcricao_audio, 240) || case when length(m.transcricao_audio)>240 then ' […]' else '' end
                               else null end,
    'bloqueada_por_compliance', case when m.em_revisao then jsonb_build_object(
        'bloqueia_uso', m.bloqueada, 'motivo', left(m.rev_motivo,200), 'regra', m.rev_regra,
        'aberto_em', m.rev_aberto_em, 'aberto_por', m.rev_aberto_por,
        'veredito', m.rev_veredito) else null end,
    'ja_usada_em_anuncio', m.ja_virou_anuncio
  )) as item
  from marc m
  where p_incluir_inaptas or m.apta
)
select jsonb_build_object(
  'produto_filtrado', p_produto,
  'total_no_acervo_apos_filtro', (select count(*) from marc),
  'resumo', jsonb_build_object(
     'aptas_agora', (select count(*) from marc where apta),
     'bloqueadas_por_compliance', (select count(*) from marc where bloqueada),
     'fora_da_biblioteca_da_meta', (select count(*) from marc where not na_biblioteca_meta),
     'ja_usadas_em_anuncio', (select count(*) from marc where ja_virou_anuncio),
     'videos_sem_transcricao', (select count(*) from marc where e_video and (transcricao_audio is null or length(transcricao_audio)=0))),
  'como_usar', 'ACERVO do Drive disponivel para uso (peca que ainda NAO virou anuncio) - oposto de get_criativos_conteudo, que le so os anuncios JA no ar. Use para MONTAR anuncio novo/escolher peca por produto. apta=true = esta na biblioteca da Meta E sem bloqueio de compliance. Peca com bloqueada_por_compliance aparece SEMPRE marcada; nunca proponha sem declarar a revisao. o_que_diz_no_audio e a transcricao real; transcricao_ausente=true = lacuna, nao estime. Video: produto e INFERIDO (produto_fonte). ja_usada_em_anuncio = anuncio criado PELO SISTEMA. Antes de emitir card, leia nota_visual_da_peca da candidata.',
  'itens', coalesce((select jsonb_agg(item order by (item->>'apta')::boolean desc, item->>'nome') from itens), '[]'::jsonb)
);
$$;

revoke all on function public.get_acervo_para_anuncio(uuid, text, boolean) from public, anon;
grant execute on function public.get_acervo_para_anuncio(uuid, text, boolean) to authenticated, service_role;

-- Nota visual: declara revisao aberta OU bloqueio pos-veredito.
create or replace function public.nota_visual_da_peca(p_company_id uuid, p_drive_file_id text)
returns text
language plpgsql
stable
as $$
declare
  r record; rev record;
  v_universo text[] := array['consignado CLT','educacao financeira','seguranca'];
  v text := '';
begin
  if p_company_id is null or p_drive_file_id is null then
    return null;
  end if;

  select * into rev from public.pecas_em_revisao
   where company_id = p_company_id and drive_file_id = p_drive_file_id
     and (veredito is null or bloqueia_uso is true)
   order by aberto_em desc limit 1;

  if found then
    if rev.veredito is null then
      v := v || case when rev.bloqueia_uso
        then ' IMPEDIMENTO: esta peca esta EM REVISAO DE COMPLIANCE e marcada para nao ser usada ate haver veredito. '
        else ' ATENCAO - PECA EM REVISAO DE COMPLIANCE, sem veredito ate agora. Ela pode ser usada, mas o gestor precisa saber disto ANTES de aprovar. ' end
        || 'Aberta em ' || to_char(rev.aberto_em,'DD/MM/YYYY') || ' por ' || rev.aberto_por
        || '. Motivo: ' || rev.motivo
        || case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end
        || case when rev.evidencia is not null then ' Evidencia: "' || left(rev.evidencia, 240) || '".' else '' end
        || ' Para fechar, o responsavel usa registrar_veredito_peca_em_revisao - nao existe caminho por fora.';
    else
      v := v || ' IMPEDIMENTO POS-VEREDITO: esta peca recebeu veredito ' || rev.veredito
        || ' em ' || to_char(rev.veredito_em,'DD/MM/YYYY') || ' por ' || coalesce(rev.veredito_por,'?')
        || ' e permanece bloqueada para anuncio. Motivo: ' || rev.motivo
        || case when rev.regra_code is not null then ' (regra ' || rev.regra_code || ')' else '' end || '.';
    end if;
  end if;

  select produto_detectado, aproveitavel, riscos_compliance, motivo, base_da_analise, nome
    into r
    from public.drive_midia_analises
   where drive_file_id = p_drive_file_id and company_id = p_company_id
   order by (base_da_analise like '%criterio%') desc, analisado_em desc
   limit 1;

  if not found then
    return v || ' Esta peca nao tem leitura visual registrada nesta empresa - nao ha nota a dar, e '
             || 'ausencia de leitura nao e ausencia de risco.';
  end if;

  v := v || ' LEITURA VISUAL DESTA PECA (nao e veredito, e informacao para o gestor decidir; base '
    || coalesce(r.base_da_analise,'?') || '): produto detectado nos quadros: '
    || coalesce(r.produto_detectado,'nao classificado')
    || ', aproveitavel: ' || coalesce(r.aproveitavel,'nao classificado') || '.';

  if coalesce(r.riscos_compliance,'') not in ('','nenhum','NENHUM') then
    v := v || ' Risco anotado na leitura: "' || left(r.riscos_compliance, 400) || '".';
  else
    v := v || ' Nenhum risco especifico anotado na leitura.';
  end if;

  if coalesce(r.motivo,'') <> '' then
    v := v || ' Por que a leitura classificou assim: "' || left(r.motivo, 400) || '".';
  end if;

  if r.produto_detectado is not null and not (r.produto_detectado = any(v_universo)) then
    v := v || ' ATENCAO, DIVERGENCIA A DECLARAR AO GESTOR: esta peca esta liberada por decisao '
          || 'dele de 31/07/2026, que liberou o acervo inteiro inclusive o que a leitura marcou '
          || 'como nao ou incerto - mas o visual aparenta "' || r.produto_detectado
          || '", que esta FORA do universo da marca (credito CLT, educacao financeira, seguranca). '
          || 'Diga isso ao gestor com estas palavras e deixe a escolha com ele. NAO recuse a peca '
          || 'por este motivo: recusar contrariaria a decisao dele.';
  end if;

  return v;
end;
$$;