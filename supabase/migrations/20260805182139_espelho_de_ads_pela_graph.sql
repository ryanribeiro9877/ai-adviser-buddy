-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805182139
-- name: espelho_de_ads_pela_graph
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Espelho de OBJETO do anuncio a partir da lista da Graph.
--
-- Por que existe: o espelho de `ads` ficou parado de 27/07 a 05/08/2026. Duas causas medidas:
--   (1) os passos de objeto (ad_sets e ads) do windsor-sync vivem dentro de `if (!skipWide)` e o
--       cron diario manda skip_wide:true - logo `ads` nunca esteve na corrida diaria;
--   (2) o Windsor descarta anuncio sem sinal de entrega (mapAd/anySignal), entao 13 anuncios que
--       existem na Graph nunca poderiam entrar no espelho por essa rota, mesmo sem timeout.
-- A lista de anuncios e ESTADO, nao metrica: coleta-se pela lista da Graph, nao por insights.
-- E a mesma licao do GT-09, agora um nivel abaixo.
--
-- O que esta funcao NAO faz, de proposito:
--   - nao toca metrica de anuncio que ja existe (quem mantem isso e o windsor-sync);
--   - nao toca url_tags nem destino_url (isso e do GT-12);
--   - nao inventa status: campo ausente na resposta preserva o valor anterior.
create or replace function public.espelhar_ads_da_graph(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inseridos int := 0;
  atualizados int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'espelhar_ads_da_graph: p tem de ser um array jsonb, veio %', coalesce(jsonb_typeof(p), 'null');
  end if;

  with entrada as (
    select * from jsonb_to_recordset(p) as r(
      account_id text,
      ad_external_id text,
      name text,
      status text,
      adset_external_id text,
      campaign_external_id text,
      creative_id text
    )
  ),
  -- A Graph pagina; id repetido no mesmo lote faria o ON CONFLICT atualizar a mesma linha duas
  -- vezes no mesmo comando, o que o Postgres recusa.
  unica as (
    select distinct on (ad_external_id) *
    from entrada
    where ad_external_id is not null and ad_external_id <> ''
    order by ad_external_id
  ),
  mapeada as (
    select u.*, i.company_id, c.id as campaign_uuid
    from unica u
    left join public.integrations i
      on i.external_id = u.account_id and i.provider = 'meta_ads'
    left join public.campaigns c
      on c.external_id = u.campaign_external_id and c.provider = 'meta_ads'
  ),
  -- Metrica de anuncio NOVO nao e chutada: e a soma do que ja foi medido em ad_metric_snapshots.
  -- Anuncio que nunca entregou soma zero, e esse zero e verdadeiro - nao e zero com cara de
  -- medido. `sales` e `revenue` ficam no default porque ad_metric_snapshots nao tem as colunas.
  com_metrica as (
    select m.*, s.spend, s.impressions, s.reach, s.clicks, s.link_clicks,
           s.landing_page_views, s.messaging_started, s.form_leads
    from mapeada m
    left join lateral (
      select coalesce(sum(a.spend),0) as spend,
             coalesce(sum(a.impressions),0) as impressions,
             coalesce(sum(a.reach),0) as reach,
             coalesce(sum(a.clicks),0) as clicks,
             coalesce(sum(a.link_clicks),0) as link_clicks,
             coalesce(sum(a.landing_page_views),0) as landing_page_views,
             coalesce(sum(a.messaging_started),0) as messaging_started,
             coalesce(sum(a.form_leads),0) as form_leads
      from public.ad_metric_snapshots a
      where a.ad_external_id = m.ad_external_id
    ) s on true
  ),
  gravada as (
    insert into public.ads (
      company_id, provider, account_id, campaign_id, adset_external_id, external_id,
      name, creative_id, status,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads, leads, last_synced_at
    )
    select
      company_id, 'meta_ads', account_id, campaign_uuid, adset_external_id, ad_external_id,
      name, creative_id, status,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      messaging_started, form_leads,
      coalesce(messaging_started,0) + coalesce(form_leads,0),
      now()
    from com_metrica
    on conflict (provider, external_id) do update set
      -- coalesce(excluded, ads) em toda coluna: releitura incompleta nao apaga valor bom.
      company_id        = coalesce(excluded.company_id, ads.company_id),
      account_id        = coalesce(excluded.account_id, ads.account_id),
      campaign_id       = coalesce(excluded.campaign_id, ads.campaign_id),
      adset_external_id = coalesce(excluded.adset_external_id, ads.adset_external_id),
      name              = coalesce(excluded.name, ads.name),
      creative_id       = coalesce(excluded.creative_id, ads.creative_id),
      status            = coalesce(excluded.status, ads.status),
      last_synced_at    = now()
    returning (xmax = 0) as inserido
  )
  select count(*) filter (where inserido), count(*) filter (where not inserido)
    into inseridos, atualizados
  from gravada;

  return jsonb_build_object('inseridos', inseridos, 'atualizados', atualizados);
end
$function$;

comment on function public.espelhar_ads_da_graph(jsonb) is
  'Espelha a lista de anuncios vinda da Graph em public.ads. Insere anuncio ausente (metrica derivada da soma de ad_metric_snapshots, nunca inventada), atualiza objeto de anuncio existente sem tocar em metrica, url_tags ou destino_url, e sempre avanca last_synced_at. Chamada pela edge meta-campaign-status.';

-- Escreve em ads: fora do alcance de anon e authenticated. Somente service_role (a edge).
revoke all on function public.espelhar_ads_da_graph(jsonb) from public;
revoke all on function public.espelhar_ads_da_graph(jsonb) from anon;
revoke all on function public.espelhar_ads_da_graph(jsonb) from authenticated;
grant execute on function public.espelhar_ads_da_graph(jsonb) to service_role;
