-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806144445
-- name: tabela_paralela_para_o_portao_da_saida_do_windsor
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CORRECAO DO MEU PROPRIO PLANO · a coleta em paralelo nao cabia no schema.
--
-- O QUE EU NAO TINHA VERIFICADO: ad_metric_snapshots tem unique (ad_external_id, snapshot_date)
-- SEM a fonte. Logo o Pipeboard escrevendo o mesmo anuncio no mesmo dia colide com a linha do
-- Windsor - sobrescreve ou falha. Nao existe paralelo. A coluna fonte que eu acabei de criar e a
-- funcao comparar_coletores mediam um cenario impossivel.
--
-- A SAIDA OBVIA SERIA A PIOR: incluir fonte na chave unica invalidaria a clausula onConflict do
-- windsor-sync, que morreria na proxima corrida das 09:00. Foi exatamente esse erro que eu
-- cometi antes neste projeto (quebrei onConflict ao mudar chave unica) e esta no registro.
--
-- ENTAO: tabela de ESTAGIO com a mesma forma, chave propria, e ninguem que ja escreve e tocado.
-- O Pipeboard escreve aqui durante a comparacao; passado o portao, ele passa a escrever na tabela
-- de verdade e o Windsor sai - momento em que sobra UM escritor e a chave nunca precisou mudar.
-- Tabela de estagio e descartavel por construcao: quando o Windsor sair, ela e dropada.

create table if not exists public.ad_metric_snapshots_paralelo
  (like public.ad_metric_snapshots including defaults including constraints including indexes);

comment on table public.ad_metric_snapshots_paralelo is
  'ESTAGIO TEMPORARIO da saida do Windsor. O coletor Pipeboard escreve AQUI enquanto o Windsor segue escrevendo na tabela real, para que comparar_coletores possa medir divergencia sem colisao de chave unica. DESCARTAR quando o Windsor sair - nao e tabela de producao.';

alter table public.ad_metric_snapshots_paralelo enable row level security;
drop policy if exists ad_metric_paralelo_leitura on public.ad_metric_snapshots_paralelo;
create policy ad_metric_paralelo_leitura on public.ad_metric_snapshots_paralelo for select to authenticated
  using (public.is_company_member(company_id, auth.uid()) or public.has_role(auth.uid(),'admin'));

-- O portao, agora medindo o que de fato pode existir: tabela real (Windsor) x estagio (Pipeboard).
create or replace function public.comparar_coletores(p_company_id uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
as $$
declare v_real int; v_par int; v jsonb;
begin
  if p_company_id is null then
    raise exception 'comparar_coletores exige p_company_id';
  end if;

  select count(*) into v_real from public.ad_metric_snapshots
   where company_id = p_company_id and snapshot_date between p_de and p_ate;
  select count(*) into v_par from public.ad_metric_snapshots_paralelo
   where company_id = p_company_id and snapshot_date between p_de and p_ate;

  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'tabela_real', jsonb_build_object('linhas', v_real,
      'fontes', (select coalesce(jsonb_agg(distinct coalesce(fonte,'(nao declarada)')),'[]'::jsonb)
                 from public.ad_metric_snapshots
                 where company_id = p_company_id and snapshot_date between p_de and p_ate)),
    'tabela_paralela', jsonb_build_object('linhas', v_par,
      'fontes', (select coalesce(jsonb_agg(distinct coalesce(fonte,'(nao declarada)')),'[]'::jsonb)
                 from public.ad_metric_snapshots_paralelo
                 where company_id = p_company_id and snapshot_date between p_de and p_ate)),

    'so_na_real', coalesce((select jsonb_agg(jsonb_build_object('ad', ad_external_id, 'dia', snapshot_date))
      from (select r.ad_external_id, r.snapshot_date from public.ad_metric_snapshots r
             where r.company_id = p_company_id and r.snapshot_date between p_de and p_ate
               and not exists (select 1 from public.ad_metric_snapshots_paralelo p
                                where p.ad_external_id = r.ad_external_id and p.snapshot_date = r.snapshot_date)
             limit 30) a), '[]'::jsonb),

    'so_na_paralela', coalesce((select jsonb_agg(jsonb_build_object('ad', ad_external_id, 'dia', snapshot_date))
      from (select p.ad_external_id, p.snapshot_date from public.ad_metric_snapshots_paralelo p
             where p.company_id = p_company_id and p.snapshot_date between p_de and p_ate
               and not exists (select 1 from public.ad_metric_snapshots r
                                where r.ad_external_id = p.ad_external_id and r.snapshot_date = p.snapshot_date)
             limit 30) b), '[]'::jsonb),

    'divergencias', coalesce((select jsonb_agg(jsonb_build_object(
        'ad', ad_external_id, 'dia', snapshot_date,
        'gasto', jsonb_build_object('real', gr, 'paralelo', gp, 'delta', round((gp - gr)::numeric,2)),
        'form_leads', jsonb_build_object('real', fr, 'paralelo', fp),
        'impressoes', jsonb_build_object('real', ir, 'paralelo', ip)))
      from (
        select r.ad_external_id, r.snapshot_date,
               round(r.spend::numeric,2) gr, round(p.spend::numeric,2) gp,
               coalesce(r.form_leads,0) fr, coalesce(p.form_leads,0) fp,
               coalesce(r.impressions,0) ir, coalesce(p.impressions,0) ip
        from public.ad_metric_snapshots r
        join public.ad_metric_snapshots_paralelo p
          on p.ad_external_id = r.ad_external_id and p.snapshot_date = r.snapshot_date
        where r.company_id = p_company_id and r.snapshot_date between p_de and p_ate
          and (round(r.spend::numeric,2) <> round(p.spend::numeric,2)
            or coalesce(r.form_leads,0) <> coalesce(p.form_leads,0)
            or coalesce(r.impressions,0) <> coalesce(p.impressions,0))
        limit 30) d), '[]'::jsonb),

    'veredito', case
      when v_par = 0 then 'O COLETOR PARALELO NAO ESCREVEU NADA neste periodo. Nao ha comparacao possivel - e ausencia de paralelo, nao concordancia. NAO desligar o Windsor.'
      when v_real = 0 then 'A tabela real esta vazia no periodo - conferir se o Windsor parou antes da hora.'
      else 'Ha os dois. Portao aberto SOMENTE se divergencias, so_na_real e so_na_paralela estiverem todas vazias por varios dias seguidos.'
      end,
    'regra_do_portao', 'Desligar o Windsor exige: divergencias vazia, so_na_real vazia e so_na_paralela vazia, por dias consecutivos. Qualquer uma delas cheia significa que os dois coletores nao contam a mesma coisa - e nesse caso a duvida NAO se resolve escolhendo o numero mais bonito.'
  ) into v;

  return v;
end;
$$;