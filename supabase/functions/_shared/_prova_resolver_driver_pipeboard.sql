-- Reexecutavel. Pressupoe a migration escrita_so_pelo_pipeboard (20261002213515) ja aplicada.
-- Graph numa acao qualquer devolve suportado=false. Instagram continua graph.
-- O override temporario e desfeito no fim. Empresa usada: Cooperativa Cohapm
-- (master_enabled=false), para o ensaio nao abrir escrita.

do $prova$
declare
  v_empresa uuid := '307849e6-78a7-4217-8112-3fb0a924f988';
  v_antes jsonb;
  v_r jsonb;
begin
  select driver_por_acao into v_antes
    from public.meta_execution_config
   where company_id = v_empresa;
  if v_antes is null and not exists (
    select 1 from public.meta_execution_config where company_id = v_empresa
  ) then
    raise exception 'prova: cooperativa sem meta_execution_config';
  end if;

  update public.meta_execution_config
     set driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
                           || jsonb_build_object('criar_campanha', 'graph', 'criar_criativo', 'graph')
   where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_campanha');
  if (v_r ->> 'suportado') is distinct from 'false'
     or (v_r ->> 'driver') is distinct from 'graph'
     or (v_r ->> 'motivo_bloqueio') is distinct from 'driver_nao_suporta_criar_campanha'
     or coalesce(v_r ->> 'mensagem_para_o_gestor', '') not like 'A acao criar_campanha nao roda no driver graph (suporta: pipeboard).%'
  then
    update public.meta_execution_config set driver_por_acao = v_antes where company_id = v_empresa;
    raise exception 'prova graph em acao qualquer: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'vincular_instagram_dos_anuncios');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'graph'
  then
    update public.meta_execution_config set driver_por_acao = v_antes where company_id = v_empresa;
    raise exception 'prova instagram: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'graph'
  then
    update public.meta_execution_config set driver_por_acao = v_antes where company_id = v_empresa;
    raise exception 'prova criar_criativo com graph: %', v_r;
  end if;

  update public.meta_execution_config
     set driver_por_acao = v_antes
   where company_id = v_empresa;
end
$prova$;
