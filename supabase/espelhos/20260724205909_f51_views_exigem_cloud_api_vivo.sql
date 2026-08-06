-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724205909
-- name: f51_views_exigem_cloud_api_vivo
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F5.1 (correção): as views não podem confiar só no status gravado pelo sync.
-- Evidência 24/07: 7 WABAs desapareceram da Meta (último sync 22/07 16:52) mas seguiam
-- no banco como se tivessem número CONNECTED — entrariam como alvo de replicação.
-- Critério de verdade: platform_type='CLOUD_API' (só preenchido quando a Meta respondeu
-- de fato no waba-probe) + status CONNECTED.
-- DROP necessário: a ordem/nome das colunas muda (CREATE OR REPLACE não permite).

drop view if exists public.v_waba_template_gap;
drop view if exists public.v_waba_inventory;

create view public.v_waba_inventory
with (security_invoker = true) as
select
  w.company_id,
  w.external_id                      as waba_id,
  w.name                             as waba_nome,
  w.ownership_type,
  w.account_review_status,
  p.external_id                      as phone_id,
  p.display_phone_number             as numero,
  p.verified_name                    as nome_exibicao,
  p.status                           as phone_status,
  p.platform_type,
  p.throughput_level,
  p.is_official_business_account,
  p.name_status,
  p.quality_rating,
  p.messaging_limit_tier,
  case
    when p.platform_type = 'CLOUD_API' and p.status = 'CONNECTED' then 'ativo'
    when p.status = 'MIGRATED'                                    then 'migrado'
    when p.external_id is null                                    then 'sem_numero'
    when p.platform_type is null                                  then 'fantasma_nao_confirmado_na_meta'
    else lower(coalesce(p.status,'desconhecido'))
  end                                as situacao,
  w.last_synced_at                   as waba_ultimo_sync,
  (w.last_synced_at::date = current_date) as waba_visto_hoje,
  (select count(*) from public.waba_templates t
    where t.waba_external_id = w.external_id)                          as templates_total,
  (select count(*) from public.waba_templates t
    where t.waba_external_id = w.external_id and t.status = 'APPROVED') as templates_aprovados
from public.wabas w
left join public.waba_phone_numbers p on p.waba_external_id = w.external_id;

comment on view public.v_waba_inventory is 'F5.1: inventário WABA x número x templates. situacao=ativo exige platform_type=CLOUD_API confirmado pela Meta (waba-probe) + CONNECTED. fantasma_nao_confirmado_na_meta = registro do sync que a Meta não confirma mais.';

create view public.v_waba_template_gap
with (security_invoker = true) as
with wabas_ativas as (
  select distinct w.company_id, w.external_id as waba_id, w.name as waba_nome
  from public.wabas w
  join public.waba_phone_numbers p
    on p.waba_external_id = w.external_id
   and p.status = 'CONNECTED'
   and p.platform_type = 'CLOUD_API'
),
catalogo as (
  select distinct t.name as template_nome, t.language as idioma
  from public.waba_templates t
  join public.wabas w on w.external_id = t.waba_external_id
  where t.status = 'APPROVED' and t.language = 'pt_BR'
    and w.ownership_type is not null
)
select a.company_id, a.waba_id, a.waba_nome, c.template_nome, c.idioma,
       exists (
         select 1 from public.waba_templates t
         where t.waba_external_id = a.waba_id
           and t.name = c.template_nome
           and t.language = c.idioma
       ) as tem_template
from wabas_ativas a
cross join catalogo c;

comment on view public.v_waba_template_gap is 'F5.2: matriz WABA viva (CLOUD_API+CONNECTED) x catálogo pt_BR aprovado de WABAs confirmadas. tem_template=false => candidato a replicação.';

grant select on public.v_waba_inventory to authenticated, service_role;
grant select on public.v_waba_template_gap to authenticated, service_role;