-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806113420
-- name: esp13_auditoria_dos_anuncios_no_ar_e_saude_da_conta
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-13 · auditoria periodica dos anuncios NO AR + saude da conta.
--
-- O CARD SAO DUAS COISAS COM MATURIDADE DIFERENTE, e misturar as duas produziria uma metade
-- falsa:
--   (a) auditar o TEXTO dos anuncios vivos contra as regras -> da para fazer hoje, porque ads
--       tem body e title e os 3 ativos tem os dois preenchidos.
--   (b) SAUDE DA CONTA (taxa de reprovacao em 30 dias, motivo de bloqueio, limite de entrega)
--       -> NAO da, e o motivo e simples: ad_metric_snapshots nao tem coluna de status, entao
--       nao existe HISTORICO de status de anuncio. Uma taxa de 30 dias nao sai de uma foto.
--       Hoje so existe o retrato de agora: 36 CAMPAIGN_PAUSED, 25 ADSET_PAUSED, 14 PAUSED,
--       3 ACTIVE e 2 WITH_ISSUES.
--
-- Entao aqui entram: o recipiente da coleta que falta (duas tabelas de foto diaria) e a funcao
-- de auditoria, que usa o que existe e DECLARA o que ainda nao existe em vez de estimar.
--
-- DEFINICAO EXPLICITA DE "REPROVADO", para o numero nao ficar a gosto de quem le: contam como
-- problema os status DISAPPROVED e WITH_ISSUES. PENDING_REVIEW nao conta (esta em analise, nao
-- foi reprovado) e os *_PAUSED nao contam (decisao de gestao, nao veredito da Meta).

create table if not exists public.ad_status_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id text,
  ad_external_id text not null,
  snapshot_date date not null default current_date,
  status text,
  effective_status text,
  issues_info jsonb,
  coletado_em timestamptz not null default now(),
  constraint ad_status_snap_unico unique (company_id, ad_external_id, snapshot_date)
);

comment on table public.ad_status_snapshots is
  'ESP-13: foto DIARIA do status de cada anuncio. Sem isto nao existe taxa de reprovacao em 30 dias - ads guarda so o estado de agora. issues_info recebe o campo da Graph quando a coleta o trouxer; NULO significa nao coletado, nao "sem problema".';

create table if not exists public.account_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id text not null,
  snapshot_date date not null default current_date,
  account_status text,
  disable_reason text,
  spend_cap numeric,
  capabilities jsonb,
  bruto jsonb,
  fonte text not null,
  coletado_em timestamptz not null default now(),
  constraint account_health_unico unique (company_id, account_id, snapshot_date)
);

comment on table public.account_health_snapshots is
  'ESP-13: foto diaria da saude da conta de anuncios. fonte registra de onde veio (graph | pipeboard) - escrever por um caminho e conferir por outro so vale se a procedencia estiver gravada. bruto guarda a resposta crua.';

alter table public.ad_status_snapshots enable row level security;
alter table public.account_health_snapshots enable row level security;
drop policy if exists ad_status_snap_leitura on public.ad_status_snapshots;
create policy ad_status_snap_leitura on public.ad_status_snapshots for select to authenticated
  using (public.is_company_member(company_id, auth.uid()) or public.has_role(auth.uid(),'admin'));
drop policy if exists account_health_leitura on public.account_health_snapshots;
create policy account_health_leitura on public.account_health_snapshots for select to authenticated
  using (public.is_company_member(company_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

create or replace function public.auditar_anuncios_no_ar(p_company_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_dias_de_historico int;
  v_ads_no_historico int;
  v_reprovados int;
  v jsonb;
begin
  if p_company_id is null then
    raise exception 'auditar_anuncios_no_ar exige p_company_id';
  end if;

  select count(distinct snapshot_date), count(distinct ad_external_id)
    into v_dias_de_historico, v_ads_no_historico
    from public.ad_status_snapshots
   where company_id = p_company_id and snapshot_date >= current_date - 30;

  select count(distinct ad_external_id) into v_reprovados
    from public.ad_status_snapshots
   where company_id = p_company_id and snapshot_date >= current_date - 30
     and upper(coalesce(effective_status, status,'')) in ('DISAPPROVED','WITH_ISSUES');

  select jsonb_build_object(
    'empresa', p_company_id,
    'auditado_em', now(),

    'anuncios_no_ar', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name,
          'external_id', a.external_id,
          'status', a.status,
          'tem_texto', (coalesce(a.body,'') <> '' or coalesce(a.title,'') <> ''),
          'destino', a.destino_url,
          'compliance_do_texto', public.checar_promessas_proibidas(
              nullif(btrim(coalesce(a.body,'') || ' ' || coalesce(a.title,'')), ''))
        ) order by a.name), '[]'::jsonb)
      from public.ads a
      where a.company_id = p_company_id and upper(coalesce(a.status,'')) = 'ACTIVE'),

    'retrato_de_status', (
      select coalesce(jsonb_object_agg(coalesce(status,'(nulo)'), n), '{}'::jsonb)
      from (select status, count(*) n from public.ads
             where company_id = p_company_id group by 1) z),

    'com_problema_agora', (
      select coalesce(jsonb_agg(jsonb_build_object('anuncio', name, 'status', status)), '[]'::jsonb)
      from public.ads
      where company_id = p_company_id
        and upper(coalesce(status,'')) in ('DISAPPROVED','WITH_ISSUES')),

    'taxa_de_reprovacao_30d', case
        when v_dias_de_historico = 0 then null
        else round(100.0 * v_reprovados / nullif(v_ads_no_historico,0), 1) end,

    'saude_da_conta', (
      select case when count(*) = 0 then null else jsonb_build_object(
          'ultima_leitura', max(snapshot_date), 'fonte', max(fonte),
          'account_status', max(account_status), 'disable_reason', max(disable_reason)) end
      from public.account_health_snapshots
      where company_id = p_company_id and snapshot_date >= current_date - 7),

    'LACUNAS', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'TAXA DE REPROVACAO NAO EXISTE AINDA: ha ' || v_dias_de_historico ||
               ' dia(s) de foto de status em ad_status_snapshots. A taxa de 30 dias exige coleta diaria; ' ||
               'ads guarda so o estado de AGORA. O retrato acima e verdadeiro; a tendencia nao existe.' as l
         where v_dias_de_historico < 7
        union all
        select 'SAUDE DA CONTA NAO COLETADA: nenhuma leitura de account_status, disable_reason ou limite de entrega nos ultimos 7 dias. Sem isso nao se sabe se a conta esta restrita - e conta restrita nao entrega, por melhor que esteja o criativo.'
         where not exists (select 1 from public.account_health_snapshots
                            where company_id = p_company_id and snapshot_date >= current_date - 7)
        union all
        select 'ISSUES_INFO NUNCA COLETADO: o motivo que a Meta da para um anuncio com problema nao esta em lugar nenhum. Hoje so se sabe QUE ha problema, nao QUAL.'
         where not exists (select 1 from public.ad_status_snapshots
                            where company_id = p_company_id and issues_info is not null)
        union all
        select 'AUDITORIA DE TEXTO SO, SEM A PECA: esta auditoria le body e title do anuncio. Ela NAO avalia o par texto+peca dos anuncios no ar, porque o espelho nao liga anuncio a peca do Drive. Para o par existe checar_par_texto_e_peca, que precisa do drive_file_id.'
      ) z),

    'definicao_de_reprovado', 'Contam como problema DISAPPROVED e WITH_ISSUES. PENDING_REVIEW nao conta (esta em analise). Os *_PAUSED nao contam (decisao de gestao, nao veredito da Meta).',
    'nao_e_aprovacao', 'Ausencia de violacao detectada por padrao de texto nao aprova o anuncio. O verificador por LLM continua sendo o principal.'
  ) into v;

  return v;
end;
$$;