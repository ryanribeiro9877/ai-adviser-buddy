-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260722222739
-- name: update_v_custo_proposta_metricas_dash
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- v2 da view (drop+create p/ renomear colunas):
-- custo_aquisicao_dash = fonte OFICIAL de custo por proposta (carimbado pelo Dash da Legal)
-- rateio_meta_referencia = gasto/propostas, apenas reconciliação; amostral enquanto import for manual
drop view public.v_custo_proposta;
create view public.v_custo_proposta as
select
  co.id  as company_id,
  co.name as empresa,
  c.id   as campaign_id,
  c.name as campanha,
  count(p.id) as propostas,
  round(c.spend::numeric, 2) as gasto_campanha,
  round(avg((p.raw->>'custo_aquisicao')::numeric), 2) as custo_aquisicao_dash,
  round(sum((p.raw->>'custo_total')::numeric), 2)     as custo_total_dash,
  round((c.spend::numeric / nullif(count(p.id),0)), 2) as rateio_meta_referencia
from public.campaigns c
join public.companies co on co.id = c.company_id
left join public.proposals p on p.campaign_id = c.id and p.matched
group by co.id, co.name, c.id, c.name, c.spend;