-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806144011
-- name: procedencia_em_ad_metric_snapshots_pre_requisito_da_saida_do_windsor
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- PRE-REQUISITO DA SAIDA DO WINDSOR · procedencia em ad_metric_snapshots.
--
-- O PROBLEMA: metric_snapshots tem source e metric_breakdown_daily tem fonte, ambas com valor
-- unico 'windsor:facebook' (227 e 245 linhas). Mas ad_metric_snapshots - a tabela de 532 linhas
-- que sustenta a regua de custo por formulario, o motor de alertas e o de vencedores - NAO TEM
-- coluna de procedencia nenhuma.
--
-- POR QUE ISSO BLOQUEIA A MIGRACAO: o portao da remocao do Windsor e rodar os dois coletores em
-- PARALELO e comparar os numeros. Sem coluna de fonte, as linhas do Pipeboard e as do Windsor
-- ficam indistinguiveis na mesma tabela e a comparacao e impossivel. Pior: em caso de divergencia
-- ninguem saberia qual numero e de quem.
--
-- BACKFILL DECLARADO, nao medido: rotulo as 532 linhas existentes como 'windsor:facebook' porque
-- windsor-sync foi o UNICO escritor desta tabela ate 06/08/2026 - meta-campaign-status escreve
-- ads, nao snapshots de metrica. E inferencia forte, nao leitura de um campo que existia. Fica
-- registrado como suposicao para quem auditar depois.
--
-- Nada e apagado. O rotulo windsor:facebook e PROCEDENCIA HISTORICA e permanece mesmo depois de
-- a plataforma sair - remover a dependencia nao e reescrever o passado.

alter table public.ad_metric_snapshots
  add column if not exists fonte text;

comment on column public.ad_metric_snapshots.fonte is
  'Procedencia da linha (ex.: windsor:facebook, pipeboard:meta). NULO = nao declarado. Existe para permitir a coleta em PARALELO durante a saida do Windsor: sem isso as linhas dos dois coletores ficam indistinguiveis. O rotulo historico permanece depois de a plataforma sair - procedencia nao se apaga.';

update public.ad_metric_snapshots
   set fonte = 'windsor:facebook'
 where fonte is null;

-- Indice para a comparacao em paralelo nao virar varredura completa a cada conferencia.
create index if not exists idx_ad_metric_fonte_data
  on public.ad_metric_snapshots (fonte, snapshot_date);

-- Leitura que responde "os dois coletores concordam?" - o portao da remocao.
create or replace function public.comparar_coletores(p_company_id uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
as $$
declare v jsonb;
begin
  if p_company_id is null then
    raise exception 'comparar_coletores exige p_company_id';
  end if;

  select jsonb_build_object(
    'periodo', jsonb_build_object('de', p_de, 'ate', p_ate),
    'por_fonte', coalesce((
      select jsonb_agg(jsonb_build_object(
          'fonte', coalesce(fonte,'(nao declarada)'),
          'linhas', n, 'anuncios', ads, 'dias', dias,
          'gasto', gasto, 'form_leads', forms, 'impressoes', imps))
      from (
        select fonte, count(*) n, count(distinct ad_external_id) ads,
               count(distinct snapshot_date) dias,
               round(sum(spend)::numeric,2) gasto,
               sum(coalesce(form_leads,0)) forms,
               sum(coalesce(impressions,0)) imps
        from public.ad_metric_snapshots
        where company_id = p_company_id and snapshot_date between p_de and p_ate
        group by fonte) z), '[]'::jsonb),
    'divergencias_por_anuncio_e_dia', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ad', ad_external_id, 'dia', snapshot_date,
          'fontes', fontes, 'gastos', gastos, 'forms', formsl))
      from (
        select ad_external_id, snapshot_date,
               jsonb_agg(coalesce(fonte,'(nao declarada)') order by fonte) fontes,
               jsonb_agg(round(spend::numeric,2) order by fonte) gastos,
               jsonb_agg(coalesce(form_leads,0) order by fonte) formsl
        from public.ad_metric_snapshots
        where company_id = p_company_id and snapshot_date between p_de and p_ate
        group by ad_external_id, snapshot_date
        having count(distinct fonte) > 1
           and count(distinct spend) > 1
        limit 30) d), '[]'::jsonb),
    'veredito', case
      when (select count(distinct fonte) from public.ad_metric_snapshots
             where company_id = p_company_id and snapshot_date between p_de and p_ate) < 2
        then 'SO UM COLETOR ESCREVEU NESTE PERIODO. Nao ha comparacao possivel - e ausencia de paralelo, nao concordancia.'
      else 'Dois ou mais coletores no periodo. Ver divergencias_por_anuncio_e_dia: lista vazia significa que onde os dois escreveram o mesmo anuncio no mesmo dia, o gasto coincidiu.'
      end,
    'como_usar', 'Portao da remocao do Windsor: rodar os dois em paralelo, esta funcao voltar com divergencias vazias por varios dias, e SO ENTAO desligar o Windsor. Divergencia nao resolvida = nao desligar.'
  ) into v;

  return v;
end;
$$;