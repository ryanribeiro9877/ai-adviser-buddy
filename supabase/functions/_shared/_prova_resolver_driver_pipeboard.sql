-- Reexecutavel depois da migration do carrossel.
-- criar_criativo volta ["pipeboard"].
-- criar_criativo_carrossel volta ["graph"] e suportado true, sem override na empresa.
-- graph configurado em criar_criativo volta suportado false.
-- O override temporario e desfeito. Empresa: Cooperativa Cohapm (master_enabled=false).

do $prova$
declare
  v_empresa uuid := '307849e6-78a7-4217-8112-3fb0a924f988';
  v_antes jsonb;
  v_r jsonb;
begin
  select driver_por_acao into v_antes
    from public.meta_execution_config
   where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'pipeboard'
     or (v_r -> 'drivers_suportados') is distinct from '["pipeboard"]'::jsonb
  then
    raise exception 'prova criar_criativo pipeboard: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo_carrossel');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'graph'
     or (v_r -> 'drivers_suportados') is distinct from '["graph"]'::jsonb
  then
    raise exception 'prova carrossel graph: %', v_r;
  end if;

  if v_antes ? 'criar_criativo_carrossel' then
    raise exception 'prova: nao deveria haver override de carrossel em driver_por_acao';
  end if;

  update public.meta_execution_config
     set driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
                           || jsonb_build_object('criar_criativo', 'graph')
   where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r ->> 'suportado') is distinct from 'false'
     or (v_r ->> 'driver') is distinct from 'graph'
     or (v_r ->> 'motivo_bloqueio') is distinct from 'driver_nao_suporta_criar_criativo'
  then
    update public.meta_execution_config set driver_por_acao = v_antes where company_id = v_empresa;
    raise exception 'prova graph em criar_criativo: %', v_r;
  end if;

  update public.meta_execution_config
     set driver_por_acao = v_antes
   where company_id = v_empresa;
end
$prova$;
