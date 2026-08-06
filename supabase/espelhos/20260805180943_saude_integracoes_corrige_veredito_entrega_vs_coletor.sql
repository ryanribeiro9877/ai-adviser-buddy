-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805180943
-- name: saude_integracoes_corrige_veredito_entrega_vs_coletor
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CORRECAO DE ERRO MEU, na funcao que eu escrevi 20 minutos antes.
--
-- O QUE EU ERREI: ordenei o veredito por dias_sem_gravacao antes de dias_sem_metrica.
-- Com isso, conta SEM ENTREGA saia rotulada 'coletor_parado' - acusando o coletor de um
-- problema que e da conta. Eu tinha os dois relogios exatamente para nao cometer isso.
--
-- A EVIDENCIA QUE ME CORRIGIU (medida em 05/08): em 22/07 houve UMA carga historica que
-- escreveu as tres contas no mesmo instante. Para 1622612945584817 ela trouxe dias
-- 03/03 a 10/03; para 946388181625874, 09/05 a 23/05. Ou seja: o coletor rodou e o que
-- existia para trazer JA ERA ANTIGO. Depois disso nao escreveu mais porque nao havia nada -
-- o Windsor so devolve linha para objeto COM entrega. Ausencia de gravacao ali e ACERTO.
--
-- A REGRA NOVA: se a ultima gravacao trouxe apenas dias muito anteriores a ela propria,
-- entao o coletor funcionou e a conta e que nao entrega. O intervalo entre a DATA DA
-- GRAVACAO e o DIA MAIS RECENTE GRAVADO e o que separa as duas causas.

create or replace function public.saude_das_integracoes(
  p_company_id uuid,
  p_dias_tolerancia int default 3
)
returns jsonb
language plpgsql
stable
as $$
declare
  v jsonb;
begin
  if p_company_id is null then
    raise exception 'saude_das_integracoes exige p_company_id (leitura sem filtro de empresa e proibida neste projeto)';
  end if;

  with ev as (
    select
      i.account_name, i.external_id,
      i.status::text as status_afirmado,
      i.estado_operacional::text as estado_afirmado,
      (select count(*) from ads a where a.account_id = i.external_id and a.company_id = i.company_id) as ads,
      (select max(a.last_synced_at) from ads a where a.account_id = i.external_id and a.company_id = i.company_id) as ads_ultimo_sync,
      (select count(*) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as snapshots,
      (select max(s.snapshot_date) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as ultimo_dia_metrica,
      (select max(s.created_at) from ad_metric_snapshots s where s.account_id = i.external_id and s.company_id = i.company_id) as ultima_gravacao,
      (select count(*) from metric_breakdown_daily b where b.account_id = i.external_id and b.company_id = i.company_id) as breakdown
    from integrations i
    where i.company_id = p_company_id and i.provider = 'meta_ads'
  ),
  julgada as (
    select ev.*,
      (current_date - ultimo_dia_metrica) as dias_sem_metrica,
      extract(day from (now() - ultima_gravacao))::int as dias_sem_gravacao,
      -- quantos dias a ULTIMA GRAVACAO ja estava atrasada quando aconteceu:
      (ultima_gravacao::date - ultimo_dia_metrica) as atraso_da_ultima_gravacao,
      case
        when external_id is null then 'sem_conta_atrelada'
        when ultima_gravacao is null or (snapshots = 0 and ads = 0) then 'nunca_recebeu'
        -- a ultima gravacao trouxe SO dia velho => o coletor rodou, a conta nao entrega
        when (ultima_gravacao::date - ultimo_dia_metrica) > p_dias_tolerancia
          then 'conta_sem_entrega'
        -- a ultima gravacao estava em dia, mas parou de acontecer => suspeita de coletor
        when (now() - ultima_gravacao) > make_interval(days => p_dias_tolerancia)
          then 'coletor_sem_escrever'
        when (current_date - ultimo_dia_metrica) > p_dias_tolerancia
          then 'sem_entrega_recente'
        else 'viva'
      end as veredito
    from ev
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'dias_tolerancia', p_dias_tolerancia,
    'integracoes', (select count(*) from julgada),
    'por_veredito', coalesce((select jsonb_object_agg(veredito, n)
       from (select veredito, count(*) n from julgada group by 1) z), '{}'::jsonb),
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conta', account_name,
        'external_id', external_id,
        'veredito', veredito,
        'afirmado', jsonb_build_object('status', status_afirmado, 'estado_operacional', estado_afirmado),
        'evidencia', jsonb_build_object(
           'ads', ads, 'snapshots', snapshots, 'breakdown', breakdown,
           'ultimo_dia_de_metrica', ultimo_dia_metrica,
           'ultima_gravacao', ultima_gravacao,
           'atraso_da_ultima_gravacao_em_dias', atraso_da_ultima_gravacao,
           'ads_ultimo_sync', ads_ultimo_sync,
           'dias_sem_metrica', dias_sem_metrica,
           'dias_sem_gravacao', dias_sem_gravacao),
        'divergencia', case
           when estado_afirmado = 'ativa' and veredito = 'conta_sem_entrega'
             then 'DIVERGENCIA: marcada ATIVA e a conta nao entrega ha ' || dias_sem_metrica ||
                  ' dias. Isso e fato de MIDIA (conta parada), nao falha de coleta - a ultima gravacao ja veio ' ||
                  atraso_da_ultima_gravacao || ' dias atrasada, o que prova que o coletor rodou e nao havia o que trazer.'
           when estado_afirmado = 'ativa' and veredito <> 'viva'
             then 'DIVERGENCIA: marcada ATIVA e a evidencia diz ' || veredito || '. Marca e afirmacao; dado e medicao.'
           when status_afirmado = 'connected' and veredito = 'nunca_recebeu'
             then 'DIVERGENCIA: status diz CONNECTED e nunca chegou uma linha desta conta. Conectar nao foi verificado contra dado.'
           else null end
      ) order by
        case veredito when 'viva' then 0 when 'sem_entrega_recente' then 1
             when 'conta_sem_entrega' then 2 when 'coletor_sem_escrever' then 3
             when 'nunca_recebeu' then 4 else 5 end, account_name)
      from julgada), '[]'::jsonb),
    'nota', 'Tres relogios, de proposito: ultimo_dia_de_metrica = dia que a conta ENTREGOU; ultima_gravacao = quando o coletor ESCREVEU; atraso_da_ultima_gravacao = quantos dias a escrita ja estava atrasada quando ocorreu. E o terceiro que separa "a conta parou" de "o coletor parou" - escrita que traz so dia velho prova coletor funcionando. Esta leitura NAO altera status nem estado_operacional.'
  ) into v;

  return v;
end;
$$;