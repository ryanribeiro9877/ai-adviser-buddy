-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260724203557
-- name: f51_waba_inventory_views
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- F5.1: views de inventário WABA (ADITIVAS, somente leitura).
-- security_invoker=true => a RLS das tabelas base continua valendo para o usuário.
-- Motivo: o sync traz 20 registros de número, mas 8 são cópias MIGRATED/DECLINED do
-- mesmo telefone em WABA antiga. Sem separar ativo x migrado, a contagem engana e a
-- replicação (F5.2) miraria WABA morta.

create or replace view public.v_waba_inventory
with (security_invoker = true) as
select
  w.company_id,
  w.external_id                      as waba_id,
  w.name                             as waba_nome,
  p.external_id                      as phone_id,
  p.display_phone_number             as numero,
  p.verified_name                    as nome_exibicao,
  p.status                           as phone_status,
  p.name_status,
  p.quality_rating,
  p.messaging_limit_tier,
  case
    when p.external_id is null      then 'sem_numero'
    when p.status = 'CONNECTED'     then 'ativo'
    when p.status = 'MIGRATED'      then 'migrado'
    else lower(coalesce(p.status,'desconhecido'))
  end                                as situacao,
  (select count(*) from public.waba_templates t
    where t.waba_external_id = w.external_id)                          as templates_total,
  (select count(*) from public.waba_templates t
    where t.waba_external_id = w.external_id and t.status = 'APPROVED') as templates_aprovados,
  p.last_synced_at
from public.wabas w
left join public.waba_phone_numbers p on p.waba_external_id = w.external_id;

comment on view public.v_waba_inventory is 'F5.1: inventário consolidado WABA x número x templates. situacao=ativo|migrado|sem_numero|pending. Use situacao=ativo para operar.';

-- Lacuna de cobertura de templates: base do F5.2 (replicação entre números)
create or replace view public.v_waba_template_gap
with (security_invoker = true) as
with wabas_ativas as (
  select distinct w.company_id, w.external_id as waba_id, w.name as waba_nome
  from public.wabas w
  join public.waba_phone_numbers p
    on p.waba_external_id = w.external_id and p.status = 'CONNECTED'
),
catalogo as (
  select distinct t.name as template_nome, t.language as idioma
  from public.waba_templates t
  where t.status = 'APPROVED' and t.language = 'pt_BR'
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

comment on view public.v_waba_template_gap is 'F5.2: matriz WABA ativa x catálogo de templates pt_BR aprovados. tem_template=false => candidato a replicação.';

grant select on public.v_waba_inventory  to authenticated, service_role;
grant select on public.v_waba_template_gap to authenticated, service_role;