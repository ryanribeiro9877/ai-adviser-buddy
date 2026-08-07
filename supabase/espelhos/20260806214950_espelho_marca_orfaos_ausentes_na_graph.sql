-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806214950
-- name: espelho_marca_orfaos_ausentes_na_graph
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

alter table public.ads add column if not exists ausente_na_graph_em timestamptz;
alter table public.ad_sets add column if not exists ausente_na_graph_em timestamptz;
alter table public.campaigns add column if not exists ausente_na_graph_em timestamptz;

comment on column public.ads.ausente_na_graph_em is 'Instante em que a varredura da Graph nao devolveu este external_id na lista da conta. NULL = presente (ou nunca varrido apos a coluna). Nao apaga metrica.';
comment on column public.ad_sets.ausente_na_graph_em is 'Instante em que a varredura da Graph nao devolveu este external_id na lista da conta. NULL = presente (ou nunca varrido apos a coluna). Nao apaga metrica.';
comment on column public.campaigns.ausente_na_graph_em is 'Instante em que a varredura da Graph nao devolveu este external_id na lista da conta. NULL = presente (ou nunca varrido apos a coluna). Nao apaga metrica.';

create or replace function public.marcar_orfaos_ausentes_na_graph(
  p_nivel text,
  p_account_id text,
  p_ids_presentes text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_conta text := nullif(trim(coalesce(p_account_id,'')),'');
  v_nivel text := lower(nullif(trim(coalesce(p_nivel,'')),''));
  v_presentes text[] := coalesce(p_ids_presentes, '{}');
  v_marcados int := 0;
  v_reativados int := 0;
begin
  if v_conta is null then
    raise exception 'marcar_orfaos_ausentes_na_graph: p_account_id obrigatorio (id sem act_)';
  end if;
  if v_conta like 'act_%' then
    v_conta := substring(v_conta from 5);
  end if;
  if v_nivel not in ('ads','ad_sets','campaigns') then
    raise exception 'marcar_orfaos_ausentes_na_graph: p_nivel deve ser ads|ad_sets|campaigns, veio %', p_nivel;
  end if;

  if v_nivel = 'ads' then
    update public.ads
       set ausente_na_graph_em = null
     where provider = 'meta_ads'
       and account_id = v_conta
       and external_id = any (v_presentes)
       and ausente_na_graph_em is not null;
    get diagnostics v_reativados = row_count;

    update public.ads
       set status = 'DELETED',
           ausente_na_graph_em = coalesce(ausente_na_graph_em, now())
     where provider = 'meta_ads'
       and account_id = v_conta
       and external_id is not null
       and not (external_id = any (v_presentes))
       and coalesce(status, '') <> 'DELETED';
    get diagnostics v_marcados = row_count;

  elsif v_nivel = 'ad_sets' then
    update public.ad_sets
       set ausente_na_graph_em = null
     where provider = 'meta_ads'
       and account_id = v_conta
       and external_id = any (v_presentes)
       and ausente_na_graph_em is not null;
    get diagnostics v_reativados = row_count;

    update public.ad_sets
       set status = 'DELETED',
           ausente_na_graph_em = coalesce(ausente_na_graph_em, now())
     where provider = 'meta_ads'
       and account_id = v_conta
       and external_id is not null
       and not (external_id = any (v_presentes))
       and coalesce(status, '') <> 'DELETED';
    get diagnostics v_marcados = row_count;

  else
    update public.campaigns
       set ausente_na_graph_em = null
     where provider = 'meta_ads'
       and external_account_id = v_conta
       and external_id = any (v_presentes)
       and ausente_na_graph_em is not null;
    get diagnostics v_reativados = row_count;

    update public.campaigns
       set status = 'DELETED',
           ausente_na_graph_em = coalesce(ausente_na_graph_em, now())
     where provider = 'meta_ads'
       and external_account_id = v_conta
       and external_id is not null
       and not (external_id = any (v_presentes))
       and coalesce(status, '') <> 'DELETED';
    get diagnostics v_marcados = row_count;
  end if;

  return jsonb_build_object(
    'nivel', v_nivel,
    'account_id', v_conta,
    'presentes', coalesce(cardinality(v_presentes), 0),
    'marcados_ausentes', v_marcados,
    'reativados', v_reativados,
    'nota', 'status=DELETED e vocabulario da Meta para objeto removido; metrica historica intacta'
  );
end
$function$;

comment on function public.marcar_orfaos_ausentes_na_graph(text, text, text[]) is
  'Marca no espelho (ads|ad_sets|campaigns) o que a lista da Graph da conta nao devolveu: status DELETED + ausente_na_graph_em. Nao apaga linha nem metrica. Chamada por meta-campaign-status apos leitura ok da conta.';

revoke all on function public.marcar_orfaos_ausentes_na_graph(text, text, text[]) from public, anon, authenticated;
grant execute on function public.marcar_orfaos_ausentes_na_graph(text, text, text[]) to service_role;