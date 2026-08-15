create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- Dicas da Meta (recommendations) -- coleta + julgamento deterministico.
-- Fonte: Graph fields=recommendations em campaign/adset/ad (Marketing API classica).
-- Opportunity Score (API nova) fica como fase 2 -- doutrina declara a lacuna.
-- Julgamento NAO e opiniao do LLM: roteia por blame_field/codigo -> RPC/doutrina.

create table if not exists public.meta_recommendations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  object_type text not null check (object_type in ('campaign', 'adset', 'ad')),
  object_external_id text not null,
  object_name text,
  campaign_external_id text,
  campaign_name text,
  adset_external_id text,
  ad_external_id text,
  recommendation_code text,
  title text not null,
  message text,
  importance text,
  confidence text,
  blame_field text,
  payload_raw jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  first_seen_on date not null default ((timezone('America/Sao_Paulo', now()))::date),
  last_seen_on date not null default ((timezone('America/Sao_Paulo', now()))::date),
  last_seen_at timestamptz not null default now(),
  veredito text not null default 'sem_regua'
    check (veredito in ('concorda', 'discorda', 'nao_aplicavel', 'sem_regua')),
  veredito_motivo text,
  rpc_usada text,
  evidence_json jsonb not null default '{}'::jsonb,
  ai_recommendation_id uuid,
  alert_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_recommendations_dedupe_uidx
  on public.meta_recommendations (company_id, dedupe_key);

create index if not exists meta_recommendations_company_seen_idx
  on public.meta_recommendations (company_id, last_seen_on desc);

create index if not exists meta_recommendations_veredito_idx
  on public.meta_recommendations (company_id, veredito, last_seen_on desc);

alter table public.meta_recommendations enable row level security;

drop policy if exists meta_reco_members_read on public.meta_recommendations;
create policy meta_reco_members_read on public.meta_recommendations
  for select to authenticated
  using (
    company_id in (
      select cm.company_id from public.company_members cm where cm.user_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin')
  );

revoke all on public.meta_recommendations from anon, authenticated;
grant select on public.meta_recommendations to authenticated;
grant all on public.meta_recommendations to service_role;

-- ---------------------------------------------------------------------------
-- Classificador de familia da dica (texto + blame_field)
-- ---------------------------------------------------------------------------
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
  v text := lower(coalesce(p_title,'') || ' ' || coalesce(p_message,'') || ' ' || coalesce(p_blame_field,''));
begin
  if v ~ 'reprovad|unavailable|not available|nao esta disponivel|rejected|disapproved|policy|politica' then
    return 'mecanica';
  end if;
  if v ~ 'campaign budget|orcamento da campanha|cbo|budget sharing|is_adset_budget|advantage campaign budget' then
    return 'cbo';
  end if;
  if v ~ 'advantage\+|advantage audience|publico advantage|dynamic creative|criativo dinamico' then
    return 'advantage';
  end if;
  if v ~ 'combin|merge|consolid|juntar conjunto|combine similar' then
    return 'fundir';
  end if;
  if coalesce(p_blame_field,'') in ('daily_budget','lifetime_budget','budget','bid_amount','bid_strategy')
     or v ~ 'aumente (seu )?orcamento|increase (your )?budget|raise (your )?budget|orcamento diario|spend more' then
    return 'orcamento';
  end if;
  return 'outro';
end;
$$;

revoke all on function private.classificar_familia_dica_meta(text,text,text,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Julgamento deterministico de uma linha
-- ---------------------------------------------------------------------------
create or replace function public.julgar_meta_recomendacao(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.meta_recommendations%rowtype;
  v_fam text;
  v_veredito text;
  v_motivo text;
  v_rpc text;
  v_ev jsonb := '{}'::jsonb;
  v_escala jsonb;
  v_teto jsonb;
  v_adset text;
  v_metric text;
begin
  select * into r from public.meta_recommendations where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_encontrada');
  end if;

  v_fam := private.classificar_familia_dica_meta(r.title, r.message, r.blame_field, r.recommendation_code);
  v_adset := coalesce(r.adset_external_id, case when r.object_type = 'adset' then r.object_external_id end);

  if v_fam = 'mecanica' then
    v_veredito := 'concorda';
    v_motivo := 'Dica mecanica (entrega/reprovacao/midia indisponivel): nao ha debate de regua -- corrija o bloqueio.';
    v_rpc := 'classificador:mecanica';
  elsif v_fam = 'cbo' then
    v_veredito := 'discorda';
    v_motivo := 'CBO/orcamento na campanha redistribui verba entre conjuntos e inviabiliza teste de publico/criativo controlado. A operacao trabalha em ABO quando o objetivo e comparar bracos.';
    v_rpc := 'doutrina:cbo';
  elsif v_fam = 'advantage' then
    v_veredito := 'discorda';
    v_motivo := 'Advantage+/publico Advantage ou criativo dinamico altera o desenho controlado e costuma impedir copia/molde de peca. So aceitar se o gestor pedir explicitamente esse modo.';
    v_rpc := 'doutrina:advantage';
  elsif v_fam = 'fundir' then
    v_veredito := 'discorda';
    v_motivo := 'Fundir/combinar conjuntos apaga a variavel do teste -- a Meta otimiza entrega, nao o desenho experimental da operacao.';
    v_rpc := 'doutrina:fundir';
  elsif v_fam = 'orcamento' then
    if v_adset is not null then
      begin
        select public.avaliar_escala(r.company_id, v_adset) into v_escala;
      exception when others then
        v_escala := jsonb_build_object('erro', SQLERRM);
      end;
      v_rpc := 'avaliar_escala';
      v_ev := coalesce(v_escala, '{}'::jsonb);
      if coalesce((v_escala->>'apto_a_escalar')::boolean, false) then
        v_veredito := 'concorda';
        v_motivo := 'avaliar_escala marcou apto a escalar -- a dica de aumentar verba alinhou com a regua interna (com teto e degrau).';
      elsif v_escala ? 'erro' then
        v_veredito := 'sem_regua';
        v_motivo := 'Nao consegui rodar avaliar_escala neste conjunto: ' || coalesce(v_escala->>'erro','erro');
      else
        v_veredito := 'discorda';
        v_motivo := coalesce(
          v_escala->>'porque_nao',
          v_escala->>'mensagem_para_o_gestor',
          'avaliar_escala recusou escala -- aumentar orcamento agora tende a piorar o custo vs teto.'
        );
      end if;
    else
      -- Sem conjunto: tenta teto vs gasto recente da campanha (proxy fraco)
      v_metric := 'custo_por_conversa';
      begin
        select public.teto_vigente(r.company_id, v_metric) into v_teto;
      exception when others then
        begin
          select public.teto_vigente(r.company_id, 'custo_por_formulario') into v_teto;
          v_metric := 'custo_por_formulario';
        exception when others then
          v_teto := jsonb_build_object('erro', SQLERRM);
        end;
      end;
      v_rpc := 'teto_vigente';
      v_ev := jsonb_build_object('teto', v_teto, 'metric', v_metric, 'nota', 'sem adset -- julgamento so com teto, sem escala');
      v_veredito := 'sem_regua';
      v_motivo := 'Dica de orcamento sem conjunto identificavel: sem avaliar_escala nao afirmo concorda/discorda. Use teto_vigente + detalhe do conjunto.';
    end if;
  else
    v_veredito := 'sem_regua';
    v_motivo := 'Nenhuma doutrina/RPC cobre este tipo de dica ainda. A dica foi guardada; nao vira concordancia por omissao.';
    v_rpc := 'classificador:outro';
  end if;

  update public.meta_recommendations set
    veredito = v_veredito,
    veredito_motivo = v_motivo,
    rpc_usada = v_rpc,
    evidence_json = coalesce(v_ev, '{}'::jsonb) || jsonb_build_object('familia_dica', v_fam, 'julgado_em', now()),
    updated_at = now()
  where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'familia', v_fam,
    'veredito', v_veredito,
    'motivo', v_motivo,
    'rpc_usada', v_rpc
  );
end;
$$;

revoke all on function public.julgar_meta_recomendacao(uuid) from public, anon, authenticated;
grant execute on function public.julgar_meta_recomendacao(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Upsert em lote a partir da edge (coleta Graph)
-- ---------------------------------------------------------------------------
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
    if v_obj_type not in ('campaign', 'adset', 'ad') then
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

    -- Rejulga sempre (regua pode ter mudado)
    v_julgado := public.julgar_meta_recomendacao(v_id);
    select veredito, veredito_motivo into v_veredito, v_motivo
      from public.meta_recommendations where id = v_id;

    -- Espelha na aba Operacao (ai_recommendations) com familia meta_dica
    v_desc :=
      'Dica da Meta coletada em ' || to_char(v_hoje, 'DD/MM/YYYY') ||
      ' | objeto ' || v_obj_type || ' "' || coalesce(v_obj_name, v_obj_id) || '"' ||
      case when v_camp_name is not null then ' | campanha "' || v_camp_name || '"' else '' end ||
      E'.\n\n' || coalesce(v_msg, '(sem mensagem)') ||
      E'\n\nVeredito interno: ' || upper(v_veredito) ||
      ' -- ' || coalesce(v_motivo, '') ||
      E'\nFonte: Graph recommendations (pipeboard/meta-campaign-status).';

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
      -- nao derruba a coleta se o espelho falhar
      null;
    end;

    -- Alerta quando HIGH + discorda (novo no dia)
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

-- ---------------------------------------------------------------------------
-- Leitura para o agente / UI
-- ---------------------------------------------------------------------------
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
      (m.last_seen_on = v_hoje) as ainda_ativa_hoje
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
    'nota', 'Dicas da Meta (Graph recommendations) com julgamento interno. concorda/discorda vem de RPC/doutrina, nao de opiniao do modelo. sem_regua = ainda sem classificador. first_seen_on = primeiro dia coletado; last_seen_on = ultima vez que a Graph ainda mostrava a dica. Objeto referencia campanha/conjunto/anuncio.'
  );
end;
$$;

revoke all on function public.get_meta_dicas(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.get_meta_dicas(uuid, integer, text) to authenticated, service_role;

insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'execucao',
  'DICAS DA META TEM VEREDITO INTERNO (15/08/2026). A Graph devolve recommendations (title/message/importance/blame_field/code) em campanha, conjunto e anuncio -- coletadas diariamente por meta-campaign-status e gravadas em meta_recommendations com first_seen_on/last_seen_on e referencia do objeto. O agente le via get_meta_dicas. E PROIBIDO repetir a dica da Meta como se fosse nossa: sempre cite o veredito (concorda|discorda|nao_aplicavel|sem_regua) e o motivo. Discordar e esperado -- a Meta otimiza o objetivo dela, nao a regua do cliente. sem_regua nao vira concorda por omissao. Opportunity Score (API nova mid-flight) ainda nao e coletado nesta versao -- declare a lacuna se o usuario perguntar por dicas que so existem la.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'DICAS DA META TEM VEREDITO INTERNO%'
);
