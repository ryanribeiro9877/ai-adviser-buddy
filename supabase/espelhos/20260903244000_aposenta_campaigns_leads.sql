-- Aposenta campaigns.leads, a coluna que existia e mentia (03/09/2026)
--
-- QUANDO PAROU E POR QUE, apurado no proprio banco:
--
--   `campaigns.leads` so tem valor em campanhas criadas ate 21/07/2026 (20 campanhas). A
--   primeira campanha com resultado real e leads = 0 nasceu em 03/08/2026, e hoje sao 7.
--   A causa nao foi um bug de calculo: foi TROCA DE PIPELINE. Quem escrevia a coluna era
--   `sync_ingest_windsor`, aposentada em 14/08/2026 (migration 20260814123000). O pipeline
--   que a substituiu, `rollup_metric_snapshots_from_ads` (chamado por pipeboard-metrics-sync),
--   atualiza `public.campaigns` com spend, impressions, reach, clicks, link_clicks,
--   form_leads, messaging_started, landing_page_views e frequency — e NAO com leads. A coluna
--   ficou orfa: nenhum caminho vivo escreve nela, e o valor de julho continua la, parado.
--
--   Conferencia de que nao ha escritor vivo:
--     select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prosrc ~* 'update[[:space:]]+(public\.)?campaigns'
--        and p.prosrc ~* '\mleads\M';
--   devolve so `sync_ingest_windsor` (aposentada) e `rollup_metric_snapshots_from_ads`, que
--   cita leads apenas no insert de metric_snapshots, nunca no update de campaigns.
--
-- POR QUE APOSENTAR EM VEZ DE VOLTAR A ALIMENTAR:
--
--   Nao existe conteudo honesto para essa coluna. O valor que o Windsor gravava era
--   form_leads + messaging_started somados — formulario e conversa no mesmo balde, sem base
--   declarada. E exatamente o "CPL sem denominador" que a camada canonica proibe: com R$ 300,
--   5 formularios e 10 conversas, `leads = 15` produz R$ 20,00 de custo, um numero que nao
--   corresponde a nenhum resultado que o gestor possa comprar. Voltar a preencher seria
--   restaurar a mistura de bases que a frente de 03/09/2026 acabou de desmontar.
--
--   O conteudo util ja existe em coluna com base declarada: campaigns.form_leads,
--   campaigns.messaging_started e campaigns.link_clicks, todas atualizadas pelo rollup vivo.
--   Nada se perde no DROP; some a mistura.
--
-- O QUE MORRE JUNTO: `v_campaign_breakdown.cpl` era `spend / leads` — o SEXTO denominador do
-- sistema, e o unico que chegava direto na tela do painel. As duas views passam a expor a base
-- declarada e o custo dela, com o gasto separado por base no agregado por conta (o mesmo erro
-- de numerador que inflou o custo por formulario da Legal e Viver em 5,4x).
--
-- O QUE NAO MORRE, e por que: `metric_snapshots.leads` NAO e removida aqui. Ela e lida por
-- traffic-chat/index.ts:1249 e traffic-agent-job/index.ts:746, arquivos sob medicao de
-- latencia em producao que esta rodada nao pode tocar. Remover a coluna quebraria as duas
-- edges com erro 42703 no PostgREST. A coluna fica com comentario declarando o estado e o
-- diff das duas linhas vai no relatorio, pronto para a rodada seguinte.

-- ============================================================================
-- 1) v_campaign_breakdown: base declarada no lugar de leads e cpl
-- ============================================================================

drop view if exists public.v_campaign_breakdown;

create view public.v_campaign_breakdown with (security_invoker = true) as
select
  c.company_id,
  co.name as empresa,
  c.external_account_id as account_id,
  i.account_name,
  c.id as campaign_id,
  c.name as campanha,
  c.objective,
  c.category as tipo,
  c.status,
  c.spend,
  c.impressions,
  c.reach,
  c.frequency,
  c.clicks,
  c.link_clicks,
  c.landing_page_views,
  c.messaging_started,
  c.form_leads,
  c.sales,
  c.revenue,
  b.base as base_de_resultado,
  public.rotulo_da_base(b.base) as rotulo_do_custo,
  public.unidade_da_base(b.base) as unidade_do_resultado,
  public.resultados_da_base(b.base, c.form_leads, c.messaging_started, c.link_clicks) as resultados,
  -- BRUTO, sem round: quem exibe arredonda uma vez so, como manda _shared/metrica_canonica.ts.
  public.custo_por_resultado(c.spend, c.form_leads, c.messaging_started, b.base, c.link_clicks) as custo_por_resultado,
  case when c.link_clicks > 0 then c.spend / c.link_clicks::numeric end as cpc_link,
  c.last_synced_at
from public.campaigns c
cross join lateral (select public.base_de_resultado_da_campanha(c.id) as base) b
left join public.companies co on co.id = c.company_id
left join public.integrations i
  on i.provider = 'meta_ads'::public.integration_provider
 and i.external_id = c.external_account_id;

grant select on public.v_campaign_breakdown to anon, authenticated, service_role;

comment on view public.v_campaign_breakdown is
'Campanha com a BASE DE RESULTADO declarada. Substituiu leads (coluna orfa desde a aposentadoria do Windsor) e cpl (= gasto / leads, o sexto denominador do sistema) por base_de_resultado, resultados e custo_por_resultado. custo_por_resultado vem BRUTO: arredondar e do lado de quem exibe.';

-- ============================================================================
-- 2) v_account_breakdown: gasto separado por base no lugar de leads
-- ============================================================================

drop view if exists public.v_account_breakdown;

create view public.v_account_breakdown with (security_invoker = true) as
with per_cat as (
  select c.external_account_id as account_id, c.category, sum(c.spend) as spend
    from public.campaigns c
   group by c.external_account_id, c.category
), dominant as (
  select distinct on (per_cat.account_id) per_cat.account_id, per_cat.category as account_type
    from per_cat
   order by per_cat.account_id, per_cat.spend desc nulls last
), tot as (
  select
    c.external_account_id as account_id,
    count(*) as campaigns,
    sum(c.spend) as spend,
    sum(c.clicks) as clicks,
    sum(c.link_clicks) as link_clicks,
    sum(c.landing_page_views) as landing_page_views,
    sum(c.messaging_started) as messaging_started,
    sum(c.form_leads) as form_leads,
    sum(c.sales) as sales,
    sum(c.revenue) as revenue,
    -- O gasto vai separado por base porque o custo por resultado da conta divide o gasto
    -- DAQUELA base, nunca o total. Somar o gasto de tres bases e dividir pelos formularios
    -- foi o defeito que inflou o indicador da Legal e Viver em 5,4x.
    sum(c.spend) filter (where public.base_de_resultado_da_campanha(c.id) = 'formularios') as gasto_em_formulario,
    sum(c.spend) filter (where public.base_de_resultado_da_campanha(c.id) = 'conversas') as gasto_em_conversa,
    sum(c.spend) filter (where public.base_de_resultado_da_campanha(c.id) = 'cliques_no_link') as gasto_em_trafego
  from public.campaigns c
  group by c.external_account_id
)
select
  i.external_id as account_id,
  i.account_name,
  i.company_id,
  coalesce(d.account_type, 'sem_dados'::text) as tipo_conta,
  coalesce(t.campaigns, 0::bigint) as campaigns,
  coalesce(t.spend, 0::numeric) as spend,
  coalesce(t.clicks, 0::numeric) as clicks,
  coalesce(t.link_clicks, 0::numeric) as link_clicks,
  coalesce(t.landing_page_views, 0::numeric) as landing_page_views,
  coalesce(t.messaging_started, 0::numeric) as messaging_started,
  coalesce(t.form_leads, 0::numeric) as form_leads,
  coalesce(t.gasto_em_formulario, 0::numeric) as gasto_em_formulario,
  coalesce(t.gasto_em_conversa, 0::numeric) as gasto_em_conversa,
  coalesce(t.gasto_em_trafego, 0::numeric) as gasto_em_trafego,
  coalesce(t.sales, 0::numeric) as sales,
  coalesce(t.revenue, 0::numeric) as revenue
from public.integrations i
left join tot t on t.account_id = i.external_id
left join dominant d on d.account_id = i.external_id
where i.provider = 'meta_ads'::public.integration_provider;

grant select on public.v_account_breakdown to anon, authenticated, service_role;

comment on view public.v_account_breakdown is
'Conta de anuncio agregada. Perdeu a coluna leads (soma de uma coluna orfa) e ganhou gasto_em_formulario, gasto_em_conversa e gasto_em_trafego: o custo por resultado da conta divide o gasto DA BASE, nunca o total.';

-- ============================================================================
-- 3) A coluna sai. Ler dela passa a falhar, em vez de devolver julho.
-- ============================================================================

alter table public.campaigns drop column leads;

comment on table public.campaigns is
'Campanhas. A coluna `leads` foi REMOVIDA em 03/09/2026: era escrita pelo sync_ingest_windsor (aposentado em 14/08/2026), nenhum caminho vivo a atualizava desde entao, e o valor parado de julho era lido como resultado atual - campanha com 83 conversas aparecia com leads = 0. O conteudo dela existe com base declarada em form_leads, messaging_started e link_clicks, atualizadas pelo rollup vivo. Para resultado e custo use public.base_de_resultado_da_campanha, public.resultados_da_base e public.custo_por_resultado.';

comment on column public.metric_snapshots.leads is
'EM APOSENTADORIA, nao usar. Mesma mistura de bases da extinta campaigns.leads (formulario + conversa no mesmo balde, sem denominador declarado) e igualmente desatualizada: em setembro/2026, 9 linhas com resultado real trazem leads = 0. Nao foi removida junto porque traffic-chat/index.ts:1249 e traffic-agent-job/index.ts:746 ainda a selecionam, e esses arquivos estao sob medicao de latencia. Use form_leads, messaging_started e link_clicks.';

comment on column public.ads.leads is
'EM APOSENTADORIA, nao usar. Sem base declarada e sem escritor vivo (nenhuma funcao faz update de ads gravando leads). Use form_leads e messaging_started, e a base da campanha via public.base_de_resultado_do_anuncio.';

comment on column public.ad_sets.leads is
'EM APOSENTADORIA, nao usar. Sem base declarada e sem escritor vivo. Use form_leads e messaging_started, e a base via public.base_de_resultado_do_conjunto.';

-- O escritor antigo passa a estar quebrado, e isso fica dito nele. Nao ha cron chamando
-- sync_ingest_windsor desde 14/08/2026 (conferido em cron.job); se alguem a ressuscitar, o
-- erro aparece na cara em vez de gravar mistura de bases numa coluna que nao existe mais.
do $aviso$
declare v_oid oid;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_ingest_windsor'
   limit 1;
  if v_oid is not null then
    execute format(
      'comment on function %s is %L',
      v_oid::regprocedure,
      'APOSENTADA em 14/08/2026 e QUEBRADA desde 03/09/2026: faz insert em public.campaigns gravando a coluna leads, que foi removida. Era ela quem alimentava a coluna; o pipeline vivo e pipeboard-metrics-sync -> rollup_metric_snapshots_from_ads. Nao ressuscitar sem reescrever para bases declaradas.'
    );
  end if;
end $aviso$;

-- ============================================================================
-- 4) Conferencia
-- ============================================================================

do $conferencia$
declare v_ref int; v_orfa int;
begin
  -- Ninguem pode ter sobrado apontando para a coluna que saiu.
  select count(*) into v_ref
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.prosrc ~* '(c|camp|campaigns)\.leads\M';
  if v_ref > 0 then
    raise exception '% funcao(oes) ainda leem campaigns.leads depois do drop', v_ref;
  end if;

  select count(*) into v_orfa
    from information_schema.columns
   where table_schema = 'public' and table_name = 'campaigns' and column_name = 'leads';
  if v_orfa > 0 then
    raise exception 'campaigns.leads continua existindo';
  end if;

  raise notice 'campaigns.leads removida; metric_snapshots.leads segue viva por dependencia de arquivo bloqueado';
end $conferencia$;
