-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260721145751
-- name: fix_classify_campaign_numeric_signature
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- sum() retorna numeric; a assinatura precisa aceitar numeric (aceita bigint por cast implícito)
drop function if exists public.classify_campaign(text, bigint, bigint, bigint, bigint);

create or replace function public.classify_campaign(
  p_objective text, p_messaging numeric, p_forms numeric, p_sales numeric, p_link_clicks numeric
) returns text language sql immutable as $$
  select case
    when upper(coalesce(p_objective,'')) like '%LEAD%'                                            then 'leadgen'
    when upper(coalesce(p_objective,'')) like any (array['%SALES%','%CONVERSION%','%CATALOG%'])   then 'vendas'
    when upper(coalesce(p_objective,'')) like any (array['%TRAFFIC%','%LINK_CLICK%'])             then 'trafego'
    when upper(coalesce(p_objective,'')) like '%MESSAGE%'                                         then 'mensagem'
    when upper(coalesce(p_objective,'')) like '%ENGAGEMENT%'
         then case when p_messaging > 0 then 'mensagem' else 'engajamento' end
    when upper(coalesce(p_objective,'')) like any (array['%AWARENESS%','%REACH%'])                then 'alcance'
    when upper(coalesce(p_objective,'')) like '%VIDEO%'                                           then 'video'
    when upper(coalesce(p_objective,'')) like '%APP%'                                             then 'app'
    when p_messaging   > 0 then 'mensagem'
    when p_sales       > 0 then 'vendas'
    when p_forms       > 0 then 'leadgen'
    when p_link_clicks > 0 then 'trafego'
    else 'outro'
  end
$$;