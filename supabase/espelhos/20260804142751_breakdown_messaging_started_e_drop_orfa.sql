-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804142751
-- name: breakdown_messaging_started_e_drop_orfa
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Tres consertos apos a prova do v17.
--
-- (1) LACUNA QUE O CODE DECLAROU E ERA MINHA: eu desenhei metric_breakdown_daily sem
--     messaging_started. Duas das cinco campanhas da Legal e Viver sao de WhatsApp
--     (LEV_WPP-CTWA_FRIO_ADV+ e [LEV][WPP][LEADS]) e CONVERSA e a metrica do objetivo delas.
--     Sem a coluna, o recorte responde "qual faixa converte melhor" so para campanha de LP.
--     Ele preferiu NAO enviar o campo em vez de mandar para descarte silencioso - decisao certa.
ALTER TABLE public.metric_breakdown_daily
  ADD COLUMN IF NOT EXISTS messaging_started bigint;

COMMENT ON COLUMN public.metric_breakdown_daily.messaging_started IS
  'Conversas iniciadas no WhatsApp na faixa. NULL = nao coletado (o windsor-sync v17 nao enviava). Metrica do objetivo das campanhas WPP.';

-- (2) A ORFA. campaign_breakdown_daily existe em producao e NAO tem migracao que a criou -
--     nasceu do esboco do meu briefing, por SQL direto, fora da trilha. Um replay das migracoes
--     nao a reproduziria. Esta vazia, sem view nem funcao referenciando, e tem defeito proprio:
--     nenhum UNIQUE alem da chave primaria, logo cada corrida da janela rolante duplicaria as
--     linhas. Duas tabelas de recorte esperando quem chegar depois e pior que uma.
DROP TABLE IF EXISTS public.campaign_breakdown_daily;

-- (3) RPC estendida para aceitar messaging_started, no mesmo padrao dos outros campos.
CREATE OR REPLACE FUNCTION public.sync_ingest_breakdown(p jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      tipo_recorte text, valor_recorte text,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, form_leads bigint, messaging_started bigint
    )
  ),
  mapped as (
    select r.*, i.company_id,
           coalesce(nullif(trim(r.valor_recorte),''),'desconhecido') as valor_norm
      from rows r
      left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
     where r.ad_external_id is not null and r.snapshot_date is not null
       and r.tipo_recorte in ('idade','genero','plataforma','posicionamento')
  ),
  up as (
    insert into public.metric_breakdown_daily (
      company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_recorte,
      spend, impressions, reach, clicks, link_clicks, landing_page_views,
      form_leads, messaging_started, leads)
    select company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_norm,
      coalesce(spend,0), coalesce(impressions,0),
      reach,                                              -- NULL = nao coletado
      coalesce(clicks,0), coalesce(link_clicks,0), coalesce(landing_page_views,0),
      coalesce(form_leads,0),
      messaging_started,                                  -- NULL = nao coletado
      coalesce(form_leads,0) + coalesce(messaging_started,0)
    from mapped
    on conflict (ad_external_id, snapshot_date, tipo_recorte, valor_recorte) do update set
      company_id=excluded.company_id, account_id=excluded.account_id,
      campaign_external_id=excluded.campaign_external_id,
      spend=excluded.spend, impressions=excluded.impressions,
      -- coalesce(excluded, atual) nos campos que a releitura pode nao trazer: com janela rolante
      -- de 7 dias, 86% das linhas de cada corrida sao reescrita.
      reach=coalesce(excluded.reach, metric_breakdown_daily.reach),
      clicks=excluded.clicks, link_clicks=excluded.link_clicks,
      landing_page_views=excluded.landing_page_views, form_leads=excluded.form_leads,
      messaging_started=coalesce(excluded.messaging_started, metric_breakdown_daily.messaging_started),
      leads=excluded.leads
    returning 1)
  select count(*) into n from up; return n;
end $function$;