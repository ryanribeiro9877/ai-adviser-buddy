-- Pipeboard passa a ser fonte estrutural (campaigns/adsets/ads) e fecha vazamentos
-- de doutrina/identidade entre empresas.

alter table public.campaigns
  add column if not exists fonte_config text;

alter table public.ad_sets
  add column if not exists config_coletada_em timestamptz,
  add column if not exists fonte_config text;

alter table public.ads
  add column if not exists config_coletada_em timestamptz,
  add column if not exists fonte_config text;

comment on column public.campaigns.fonte_config is
  'Proveniencia da configuracao estrutural; pipeboard:meta desde 14/08/2026.';
comment on column public.ad_sets.config_coletada_em is
  'Preenchido somente quando budget/lance/targeting foram efetivamente lidos.';
comment on column public.ad_sets.fonte_config is
  'Proveniencia da configuracao estrutural.';
comment on column public.ads.config_coletada_em is
  'Momento em que a configuracao do anuncio foi efetivamente lida.';
comment on column public.ads.fonte_config is
  'Proveniencia da configuracao estrutural.';

create index if not exists ix_campaigns_company_config_freshness
  on public.campaigns(company_id, config_coletada_em desc);
create index if not exists ix_adsets_company_config_freshness
  on public.ad_sets(company_id, config_coletada_em desc);
create index if not exists ix_ads_company_config_freshness
  on public.ads(company_id, config_coletada_em desc);

-- Fatos medidos na Legal e Viver nunca podem governar COHAPM.
update public.agent_context
set vigente = false
where vigente is true
  and company_id is distinct from 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid
  and (
    fato ilike '%R$72,00/dia%'
    or fato ilike '%R$ 72,00/dia%'
    or fato ilike '%orcamento estavel de R$72%'
    or fato ilike '%conta opera entre 3,1% e 4,9%%'
    or fato ilike '%@jcr2_legaleviver%'
    or fato ilike '%@legaleviver_%'
    or fato ilike '%act_3302001729967572%'
    or fato ilike '%Legal e Viver%'
    or fato ilike '%Legal é Viver%'
    or fato ilike '%consignado%'
    or fato ilike '%Categoria Especial CREDIT%'
  );

-- Linhas globais com identidade inequívoca da Legal viram fatos da Legal.
update public.agent_context
set company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid
where company_id is null
  and (
    fato ilike '%@jcr2_legaleviver%'
    or fato ilike '%@legaleviver_%'
    or fato ilike '%act_3302001729967572%'
    or fato ilike '%Legal e Viver%'
    or fato ilike '%Legal é Viver%'
  );

-- Regra universal limpa: sem benchmark nem exemplo de uma empresa.
insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'midia',
  'ORCAMENTO DIARIO DA META E MEDIA, NAO LIMITE DO DIA. Um dia isolado pode chegar a aproximadamente 1,25x o orcamento diario e a semana fecha em ate 7x o diario. Esta e regra de plataforma; referencias de valor, gasto e estrutura ativa devem vir exclusivamente da empresa selecionada.',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true
    and company_id is null
    and fato ilike 'ORCAMENTO DIARIO DA META E MEDIA, NAO LIMITE DO DIA.%'
);

-- Impede regressao: fatos universais nao podem carregar marcas/contas/benchmarks
-- inequivocamente empresariais.
create or replace function public.guard_agent_context_global_empresa()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.company_id is null and new.vigente is true and (
    new.fato ~* '(@jcr2_legaleviver|@legaleviver_|act_3302001729967572|legal[[:space:]]*(e|é)[[:space:]]*viver|R\\$[[:space:]]*72([,.]00)?/dia)'
  ) then
    raise exception 'agent_context_especifico_exige_company_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_agent_context_global_empresa on public.agent_context;
create trigger trg_guard_agent_context_global_empresa
before insert or update on public.agent_context
for each row execute function public.guard_agent_context_global_empresa();

-- Overloads antigos sem empresa deixam de ser superficie executavel.
do $$
begin
  if to_regprocedure('public.get_estrutura_conjuntos()') is not null then
    execute 'revoke all on function public.get_estrutura_conjuntos() from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.get_criativos_conteudo(boolean)') is not null then
    execute 'revoke all on function public.get_criativos_conteudo(boolean) from public, anon, authenticated, service_role';
  end if;
end $$;

-- Chaves independentes por nivel.
insert into public.mcp_api_keys(chamador, api_key, observacao)
select v.chamador,
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || v.chamador)::bytea), 'hex'),
       'Pipeboard estrutural por nivel, criado em 14/08/2026.'
from (values
  ('cron:pipeboard-structure-campaigns-0912'),
  ('cron:pipeboard-structure-adsets-0917'),
  ('cron:pipeboard-structure-ads-0922')
) as v(chamador)
on conflict(chamador) do nothing;

do $$
declare v_jobid bigint;
begin
  for v_jobid in
    select jobid from cron.job
    where jobname in (
      'pipeboard-structure-campaigns-0912',
      'pipeboard-structure-adsets-0917',
      'pipeboard-structure-ads-0922'
    )
  loop
    perform cron.unschedule(v_jobid);
  end loop;
end $$;

select cron.schedule(
  'pipeboard-structure-campaigns-0912',
  '12 9 * * *',
  $command$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/pipeboard-structure-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.get_mcp_api_key('cron:pipeboard-structure-campaigns-0912')
    ),
    body := '{"level":"campaigns"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $command$
);

select cron.schedule(
  'pipeboard-structure-adsets-0917',
  '17 9 * * *',
  $command$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/pipeboard-structure-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.get_mcp_api_key('cron:pipeboard-structure-adsets-0917')
    ),
    body := '{"level":"adsets"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $command$
);

select cron.schedule(
  'pipeboard-structure-ads-0922',
  '22 9 * * *',
  $command$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/pipeboard-structure-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || public.get_mcp_api_key('cron:pipeboard-structure-ads-0922')
    ),
    body := '{"level":"ads"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $command$
);

insert into public.agent_context(categoria, fato, vigente, desde, company_id)
values (
  'execucao',
  'COLETA ESTRUTURAL OFICIAL = PIPEBOARD (14/08/2026). Campanhas, conjuntos e anuncios sao atualizados diariamente por pipeboard-structure-sync em jobs separados. config_coletada_em nulo continua significando DESCONHECIMENTO; nunca trate budget/lance/targeting nulos como ausencia. Toda leitura deve permanecer presa ao company_id e a conta vinculada da empresa selecionada.',
  true,
  current_date,
  null
);
