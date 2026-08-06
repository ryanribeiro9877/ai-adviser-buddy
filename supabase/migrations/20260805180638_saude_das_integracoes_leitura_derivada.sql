-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805180638
-- name: saude_das_integracoes_leitura_derivada
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- SAUDE DAS INTEGRACOES · leitura DERIVADA da evidencia, sem tocar na camada humana.
--
-- PROBLEMA MEDIDO EM 05/08/2026: integrations tem DOIS campos que AFIRMAM estado
-- (status e estado_operacional) e NENHUM que MEDE. Resultado real:
--   17 de 21 integracoes meta_ads dizem status='connected' e nunca produziram 1 linha;
--   2 das 3 marcadas estado_operacional='ativa' tem dado de 5 meses e de 2,5 meses atras;
--   so 1 conta tem dado fresco.
-- O GT-00 consertou o CAMINHO DE CRIACAO (integracao nova nasce em quarentena), mas nao
-- tocou nas 20 linhas legadas de 20-21/07.
--
-- PRINCIPIO (duas camadas, nunca sobrescrita): esta funcao NAO corrige status nem
-- estado_operacional. Ela mede a evidencia e DECLARA A DIVERGENCIA quando a afirmacao
-- humana/config nao bate com o dado. Quem decide mudar o campo e humano.
--
-- DOIS RELOGIOS DIFERENTES, de proposito:
--   ultimo_dia_de_metrica = max(snapshot_date)  -> o dia mais recente que a conta ENTREGOU
--   ultima_gravacao       = max(created_at)     -> quando o coletor ESCREVEU por ultimo
-- Colapsar os dois esconde a diferenca entre "a conta nao entrega" e "o coletor nao traz".
--
-- company_id OBRIGATORIO: visao cruzando empresas e outro assunto (painel cross-portfolio),
-- e agregar sem filtro foi a origem dos 4 vazamentos de 03/08.

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
      i.id,
      i.account_name,
      i.external_id,
      i.status::text            as status_afirmado,
      i.estado_operacional::text as estado_afirmado,
      i.connected_at,
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
      (current_date - ultimo_dia_metrica)                       as dias_sem_metrica,
      extract(day from (now() - ultima_gravacao))::int           as dias_sem_gravacao,
      case
        when external_id is null then 'sem_conta_atrelada'
        when snapshots = 0 and ads = 0 then 'nunca_recebeu'
        when ultima_gravacao is null then 'nunca_recebeu'
        when (now() - ultima_gravacao) > make_interval(days => p_dias_tolerancia) then 'coletor_parado'
        when (current_date - ultimo_dia_metrica) > p_dias_tolerancia then 'sem_entrega_recente'
        else 'viva'
      end as veredito
    from ev
  )
  select jsonb_build_object(
    'company_id', p_company_id,
    'dias_tolerancia', p_dias_tolerancia,
    'integracoes', (select count(*) from julgada),
    'por_veredito', coalesce((
      select jsonb_object_agg(veredito, n) from (
        select veredito, count(*) n from julgada group by 1) z), '{}'::jsonb),
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
           'ads_ultimo_sync', ads_ultimo_sync,
           'dias_sem_metrica', dias_sem_metrica,
           'dias_sem_gravacao', dias_sem_gravacao),
        'divergencia', case
           when estado_afirmado = 'ativa' and veredito <> 'viva'
             then 'DIVERGENCIA: a integracao esta marcada ATIVA e a evidencia diz ' || veredito ||
                  '. A marca e afirmacao humana/config; o dado e medicao. Nao corrigi nenhuma das duas - quem decide e humano.'
           when status_afirmado = 'connected' and veredito = 'nunca_recebeu'
             then 'DIVERGENCIA: status diz CONNECTED e nunca chegou uma linha desta conta. Conectar nao foi verificado contra dado.'
           else null end
      ) order by
        case veredito when 'viva' then 0 when 'sem_entrega_recente' then 1
                      when 'coletor_parado' then 2 when 'nunca_recebeu' then 3 else 4 end,
        account_name)
      from julgada), '[]'::jsonb),
    'nota', 'ultimo_dia_de_metrica = dia mais recente que a conta ENTREGOU. ultima_gravacao = quando o coletor ESCREVEU. Os dois relogios sao distintos de proposito: conta sem entrega e coletor parado produzem sintomas parecidos e causas diferentes. Esta leitura NAO altera status nem estado_operacional.'
  ) into v;

  return v;
end;
$$;

comment on function public.saude_das_integracoes(uuid, int) is
  'Leitura derivada da saude das integracoes meta_ads por empresa: mede evidencia (ads, snapshots, breakdown, dois relogios) e DECLARA divergencia contra status/estado_operacional, sem sobrescrever nenhum dos dois.';