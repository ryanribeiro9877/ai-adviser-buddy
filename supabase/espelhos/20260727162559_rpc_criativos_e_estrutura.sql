-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727162559
-- name: rpc_criativos_e_estrutura
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Expõe ao agente dados que JÁ estavam no banco e eram reportados como "não disponível":
-- (1) conteúdo dos criativos (legenda/título/CTA/imagem) -> compliance retroativo sem o
--     usuário colar texto manualmente;
-- (2) estrutura de conjuntos (bid_strategy = CBO/ABO, orçamento, targeting) -> governança
--     de orçamento e base para análise de sobreposição de público.
alter table public.campaigns
  add column if not exists special_ad_categories text[],
  add column if not exists bid_strategy text,
  add column if not exists categoria_especial_verificada_em timestamptz;
comment on column public.campaigns.special_ad_categories is 'Categoria Especial de Anuncio (CREDIT/EMPLOYMENT/HOUSING/...) lida da Graph API. Array vazio = sem categoria especial declarada.';

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean default true)
returns jsonb language sql stable as $$
select jsonb_build_object(
  'total', count(*),
  'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA) ja coletado pelo sync. Use junto com check_compliance para auditar as pecas em operacao sem pedir texto ao usuario.',
  'criativos', coalesce(jsonb_agg(jsonb_build_object(
      'anuncio', a.name,
      'campanha', c.name,
      'campanha_ativa', (c.status = 'active'),
      'status_anuncio', a.status,
      'titulo', a.title,
      'legenda', a.body,
      'cta', a.call_to_action_type,
      'tem_imagem', (a.image_url is not null or a.thumbnail_url is not null),
      'gasto_acumulado', round(coalesce(a.spend,0)::numeric,2),
      'formularios', a.form_leads
    ) order by coalesce(a.spend,0) desc), '[]'::jsonb)
)
from public.ads a
left join public.campaigns c on c.id = a.campaign_id
where (not p_somente_ativas or c.status = 'active') and a.body is not null;
$$;
comment on function public.get_criativos_conteudo is 'Legenda/titulo/CTA dos anuncios para auditoria de compliance retroativa.';

create or replace function public.get_estrutura_conjuntos()
returns jsonb language sql stable as $$
with cj as (
  select s.name as conjunto, s.status, s.bid_strategy,
         s.daily_budget, s.lifetime_budget,
         c.name as campanha, c.status as campanha_status,
         round(coalesce(s.spend,0)::numeric,2) as gasto, s.form_leads,
         case when s.daily_budget is null and s.lifetime_budget is null
              then 'orcamento na CAMPANHA (indicio de CBO/Advantage)'
              else 'orcamento no CONJUNTO (indicio de ABO)' end as leitura_orcamento,
         (s.targeting is not null) as tem_targeting,
         s.targeting->'geo_locations'->'countries' as paises,
         s.targeting->>'age_min' as idade_min,
         s.targeting->>'age_max' as idade_max,
         s.targeting->'flexible_spec' as interesses
  from public.ad_sets s
  left join public.campaigns c on c.id = s.campaign_id
)
select jsonb_build_object(
  'total_conjuntos', (select count(*) from cj),
  'em_campanha_ativa', (select count(*) from cj where campanha_status = 'active'),
  'resumo_orcamento', (select jsonb_object_agg(leitura_orcamento, n) from (select leitura_orcamento, count(*) as n from cj group by 1) z),
  'conjuntos', coalesce((select jsonb_agg(to_jsonb(cj) order by cj.gasto desc) from cj where cj.campanha_status = 'active' or cj.gasto > 0), '[]'::jsonb),
  'nota', 'bid_strategy e a presenca/ausencia de orcamento no conjunto indicam CBO vs ABO. targeting traz pais, faixa de idade e interesses conforme coletado - use para avaliar sobreposicao de publico.',
  'limite_conhecido', 'nao ha historico de ALTERACOES de orcamento (change log): exigiria coletar o endpoint /activities da Graph API.'
);
$$;
comment on function public.get_estrutura_conjuntos is 'Estrutura de conjuntos: CBO/ABO, orcamento e targeting.';

grant execute on function public.get_criativos_conteudo(boolean) to authenticated, service_role;
grant execute on function public.get_estrutura_conjuntos() to authenticated, service_role;