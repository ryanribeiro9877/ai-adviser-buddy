-- Dicas da Meta: Opportunity Score / Recommendation Center (API de conta).
-- Ate v15 so sondavamos o campo classico `recommendations` em campaign/adset/ad —
-- que nesta frota nunca populou meta_recommendations (0 linhas em todas as empresas).
-- O badge "1 recomendacao" do Ads Manager vem do GET /act_{id}/recommendations
-- (mid_flight / Opportunity Score). Meta documenta que a API pode devolver MENOS
-- itens que a UI. Coleta: meta-campaign-status v16 (+ modo {modo:meta_dicas}).

alter table public.meta_recommendations
  drop constraint if exists meta_recommendations_object_type_check;

alter table public.meta_recommendations
  add constraint meta_recommendations_object_type_check
  check (object_type = any (array['campaign'::text, 'adset'::text, 'ad'::text, 'account'::text]));

create or replace function private.classificar_familia_dica_meta(
  p_title text,
  p_message text,
  p_blame_field text,
  p_code text
) returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_title,'') || ' ' || coalesce(p_message,'') || ' ' || coalesce(p_blame_field,'') || ' ' || coalesce(p_code,''));
begin
  if v ~ 'reprovad|unavailable|not available|nao esta disponivel|rejected|disapproved|policy|politica' then
    return 'mecanica';
  end if;
  if v ~ 'campaign budget|orcamento da campanha|cbo|budget sharing|is_adset_budget|advantage campaign budget|budget_rebalance|budget_shift' then
    return 'cbo';
  end if;
  if v ~ 'advantage\+|advantage audience|advantage_plus|aplusc|publico advantage|dynamic creative|criativo dinamico|autoflow|automatic_placements|standard_enhancements' then
    return 'advantage';
  end if;
  if v ~ 'combin|merge|consolid|juntar conjunto|combine similar|fragmentation' then
    return 'fundir';
  end if;
  if coalesce(p_blame_field,'') in ('daily_budget','lifetime_budget','budget','bid_amount','bid_strategy')
     or v ~ 'aumente (seu )?orcamento|increase (your )?budget|raise (your )?budget|orcamento diario|spend more|additional_budget' then
    return 'orcamento';
  end if;
  if v ~ 'creative|criativo|music|carousel|image|video|enhancement' then
    return 'criativo';
  end if;
  return 'outro';
end;
$$;

revoke all on function private.classificar_familia_dica_meta(text,text,text,text) from public, anon, authenticated;

-- upsert: mesma logica original + object_type account + fonte Opportunity Score no texto.
create or replace function public.upsert_meta_recomendacoes(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
  v_id uuid;
  v_is_new boolean;
  v_company uuid;
  v_dedupe text;
  v_title text;
  v_code text;
  v_obj_type text;
  v_obj_id text;
  v_obj_name text;
  v_camp_id text;
  v_camp_name text;
  v_adset_id text;
  v_ad_id text;
  v_msg text;
  v_imp text;
  v_conf text;
  v_blame text;
  v_payload jsonb;
  v_julgado jsonb;
  v_ai_id uuid;
  v_alert_id uuid;
  v_ins int := 0;
  v_upd int := 0;
  v_ai int := 0;
  v_alerts int := 0;
  v_veredito text;
  v_motivo text;
  v_desc text;
  v_impact text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return jsonb_build_object('ok', false, 'erro', 'p_deve_ser_array');
  end if;

  for item in select * from jsonb_array_elements(p)
  loop
    v_company := nullif(item->>'company_id', '')::uuid;
    v_obj_type := item->>'object_type';
    v_obj_id := nullif(trim(item->>'object_external_id'), '');
    v_title := coalesce(nullif(trim(item->>'title'), ''), 'Dica Meta sem titulo');
    if v_company is null or v_obj_type is null or v_obj_id is null then
      continue;
    end if;
    if v_obj_type not in ('campaign', 'adset', 'ad', 'account') then
      continue;
    end if;

    v_code := nullif(trim(item->>'recommendation_code'), '');
    v_obj_name := nullif(trim(item->>'object_name'), '');
    v_camp_id := nullif(trim(item->>'campaign_external_id'), '');
    v_camp_name := nullif(trim(item->>'campaign_name'), '');
    v_adset_id := nullif(trim(item->>'adset_external_id'), '');
    v_ad_id := nullif(trim(item->>'ad_external_id'), '');
    v_msg := item->>'message';
    v_imp := item->>'importance';
    v_conf := item->>'confidence';
    v_blame := item->>'blame_field';
    v_payload := coalesce(item->'payload_raw', item);

    v_dedupe := v_obj_type || '|' || v_obj_id || '|' || coalesce(v_code, md5(v_title || '|' || coalesce(v_blame,'')));

    select not exists (
      select 1 from public.meta_recommendations
       where company_id = v_company and dedupe_key = v_dedupe
    ) into v_is_new;

    insert into public.meta_recommendations as mr (
      company_id, object_type, object_external_id, object_name,
      campaign_external_id, campaign_name, adset_external_id, ad_external_id,
      recommendation_code, title, message, importance, confidence, blame_field,
      payload_raw, dedupe_key, first_seen_on, last_seen_on, last_seen_at
    ) values (
      v_company, v_obj_type, v_obj_id, v_obj_name,
      v_camp_id, v_camp_name, v_adset_id, coalesce(v_ad_id, case when v_obj_type='ad' then v_obj_id end),
      v_code, left(v_title, 300), v_msg, v_imp, v_conf, v_blame,
      v_payload, v_dedupe, v_hoje, v_hoje, now()
    )
    on conflict (company_id, dedupe_key) do update set
      object_name = coalesce(excluded.object_name, mr.object_name),
      campaign_external_id = coalesce(excluded.campaign_external_id, mr.campaign_external_id),
      campaign_name = coalesce(excluded.campaign_name, mr.campaign_name),
      adset_external_id = coalesce(excluded.adset_external_id, mr.adset_external_id),
      ad_external_id = coalesce(excluded.ad_external_id, mr.ad_external_id),
      message = excluded.message,
      importance = excluded.importance,
      confidence = excluded.confidence,
      blame_field = excluded.blame_field,
      payload_raw = excluded.payload_raw,
      last_seen_on = v_hoje,
      last_seen_at = now(),
      updated_at = now()
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.meta_recommendations
       where company_id = v_company and dedupe_key = v_dedupe;
    end if;

    if v_is_new then v_ins := v_ins + 1; else v_upd := v_upd + 1; end if;

    v_julgado := public.julgar_meta_recomendacao(v_id);
    select veredito, veredito_motivo into v_veredito, v_motivo
      from public.meta_recommendations where id = v_id;

    v_desc :=
      'Dica da Meta coletada em ' || to_char(v_hoje, 'DD/MM/YYYY') ||
      ' | objeto ' || v_obj_type || ' "' || coalesce(v_obj_name, v_obj_id) || '"' ||
      case when v_camp_name is not null then ' | campanha "' || v_camp_name || '"' else '' end ||
      E'.\n\n' || coalesce(v_msg, '(sem mensagem)') ||
      E'\n\nVeredito interno: ' || upper(v_veredito) ||
      ' -- ' || coalesce(v_motivo, '') ||
      E'\nFonte: Graph Opportunity Score /act_*/recommendations (meta-campaign-status).';

    v_impact := case
      when upper(coalesce(v_imp,'')) = 'HIGH' then 'high'
      when upper(coalesce(v_imp,'')) = 'LOW' then 'low'
      else 'medium'
    end;

    begin
      select (public.gravar_recomendacao(
        v_company,
        left('Meta: ' || v_title, 200),
        v_desc,
        v_impact,
        'meta_dica',
        'meta_dica',
        'meta.dica.' || coalesce(v_code, 'nocode'),
        v_obj_type,
        v_obj_id,
        coalesce(v_obj_name, v_camp_name),
        jsonb_build_object(
          'fonte', 'meta_recommendations',
          'meta_recommendation_id', v_id,
          'veredito', v_veredito,
          'first_seen_on', v_hoje,
          'campaign_name', v_camp_name,
          'importance', v_imp,
          'blame_field', v_blame
        ),
        'Quero analisar a dica da Meta "' || v_title || '" no ' || v_obj_type || ' ' || coalesce(v_obj_name, v_obj_id) || ' (veredito ' || v_veredito || ').',
        0,
        'graph:meta-recommendations',
        'meta_dica|' || v_dedupe || '|' || to_char(v_hoje, 'YYYYMMDD'),
        null
      ))->>'id' into v_ai_id;
      if v_ai_id is not null then
        update public.meta_recommendations set ai_recommendation_id = v_ai_id where id = v_id and ai_recommendation_id is null;
        v_ai := v_ai + 1;
      end if;
    exception when others then
      null;
    end;

    if v_is_new and upper(coalesce(v_imp,'')) = 'HIGH' and v_veredito = 'discorda' then
      begin
        insert into public.alerts (company_id, severity, title, description, resolved)
        values (
          v_company,
          'high',
          left('Dica Meta discordada: ' || v_title, 200),
          'Coletada em ' || to_char(v_hoje, 'DD/MM/YYYY') || ' em ' || v_obj_type || ' "' ||
            coalesce(v_obj_name, v_obj_id) || '". ' || coalesce(v_motivo, ''),
          false
        )
        returning id into v_alert_id;
        update public.meta_recommendations set alert_id = v_alert_id where id = v_id;
        v_alerts := v_alerts + 1;
      exception when others then
        null;
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'inseridas', v_ins,
    'atualizadas', v_upd,
    'espelhadas_ai_reco', v_ai,
    'alertas', v_alerts,
    'dia', v_hoje
  );
end;
$$;

revoke all on function public.upsert_meta_recomendacoes(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_meta_recomendacoes(jsonb) to service_role;

create or replace function public.get_meta_dicas(
  p_company_id uuid,
  p_dias integer default 14,
  p_veredito text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(1, least(coalesce(p_dias, 14), 90));
  v_desde date := (timezone('America/Sao_Paulo', now()))::date - v_dias;
  v_hoje date := (timezone('America/Sao_Paulo', now()))::date;
  v_dicas jsonb;
  v_counts jsonb;
  v_total int;
begin
  if p_company_id is null then
    return jsonb_build_object('erro', 'p_company_id e obrigatorio');
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    into v_dicas
  from (
    select
      m.id,
      m.first_seen_on,
      m.last_seen_on,
      m.object_type,
      m.object_name,
      m.object_external_id,
      m.campaign_name,
      m.campaign_external_id,
      m.adset_external_id,
      m.ad_external_id,
      m.title,
      m.message,
      m.importance,
      m.confidence,
      m.blame_field,
      m.recommendation_code,
      m.veredito,
      m.veredito_motivo,
      m.rpc_usada,
      (m.last_seen_on = v_hoje) as ainda_ativa_hoje,
      coalesce(m.payload_raw->>'fonte', 'graph') as fonte_api
    from public.meta_recommendations m
    where m.company_id = p_company_id
      and m.last_seen_on >= v_desde
      and (p_veredito is null or m.veredito = p_veredito)
    order by m.last_seen_on desc,
             case upper(coalesce(m.importance,'')) when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end
    limit 80
  ) x;

  select coalesce(jsonb_object_agg(veredito, cnt), '{}'::jsonb), coalesce(sum(cnt),0)
    into v_counts, v_total
  from (
    select veredito, count(*)::int as cnt
    from public.meta_recommendations
    where company_id = p_company_id
      and last_seen_on >= v_desde
      and (p_veredito is null or veredito = p_veredito)
    group by veredito
  ) s;

  return jsonb_build_object(
    'empresa', (select name from public.companies where id = p_company_id),
    'janela_dias', v_dias,
    'desde', v_desde,
    'total', v_total,
    'por_veredito', v_counts,
    'dicas', v_dicas,
    'nota', 'Dicas da Meta via Graph: (1) Opportunity Score GET /act_*/recommendations (badge Ads Manager / Recommendation Center); (2) campo classico recommendations em objetos, quando a Graph ainda o devolve. Julgamento interno nao e opiniao do modelo. A API pode listar MENOS itens que a coluna do Ads Manager (assimetria documentada pela Meta). Pipeboard nao e fonte destas dicas. get_recommendations = fila interna de custo de midia, nao o badge da Meta.'
  );
end;
$$;

revoke all on function public.get_meta_dicas(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.get_meta_dicas(uuid, integer, text) to service_role;

comment on function public.get_meta_dicas(uuid, integer, text) is
  'DICAS DA META COM VEREDITO INTERNO (20/08/2026). Fonte primaria: Opportunity Score / Recommendation Center (GET /act_{ad_account_id}/recommendations). Fonte secundaria: campo classico recommendations em campaign/adset/ad. Coleta diaria + refresh ao vivo no atalho do traffic-chat. Cite sempre o veredito. A UI do Ads Manager pode mostrar badge que a API ainda nao devolve.';

update public.agent_context
   set vigente = false
 where categoria = 'meta_dicas'
   and vigente = true;

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'meta_dicas',
  'DICAS / RECOMENDACOES DA META (20/08/2026). get_meta_dicas le meta_recommendations (Opportunity Score GET /act_*/recommendations + campo classico). get_recommendations e a FILA INTERNA de custo de midia (ai_recommendations) — NAO e o badge do Ads Manager. Nao abra Pipeboard para esta pergunta. Se a lista vier vazia apos sync fresco e o gestor vir badge na UI, declare a assimetria documentada pela Meta (API pode ter menos itens que Ads Manager) — nao invente o texto da dica.',
  true,
  (timezone('America/Sao_Paulo', now()))::date,
  null
);
