-- ESCRITA SO PELO PIPEBOARD (02/10/2026).
--
-- A configuracao da empresa sozinha e convencao. Quem trava o card e v_permitidos:
-- graph numa acao fora da excecao devolve suportado=false e nenhum card nasce.
--
-- Excecoes:
--   vincular_instagram_dos_anuncios — o Pipeboard nao republica o anuncio com criativo novo.
--   criar_criativo — aceita graph e pipeboard. O carrossel (child_attachments, 2+ slides)
--   nao passou no Pipeboard. Sonda em dry_run, conta act_1622612945584817, 02/10/2026:
--   o schema de create_ad_creative lista child_attachments e dry_run, e a chamada com
--   dry_run=true devolveu "No media provided. Specify 'image_hash', 'image_hashes',
--   'video_id', 'videos', 'images', or 'object_story_id'." id nulo, nada persistido.
--   resolver_driver so enxerga o nome da acao, entao a permissao de graph vale para
--   criar_criativo inteiro. Quem desvia so o carrossel e specTemCarrossel/forcarGraph
--   no meta-actions; imagem e video desse nome seguem o driver resolvido.
--
-- COMO REATIVAR GRAPH NUMA ACAO
-- Nao edite driver_escrita nem driver_por_acao para 'graph' esperando a escrita voltar.
-- Com a lista abaixo isso devolve suportado=false. Reativar e uma migration nova que
-- devolve a acao ao array, por exemplo:
--   when 'pausar_campanha' then array['graph','pipeboard']
-- Versionada e revisavel. Nunca por update de linha em meta_execution_config.
--
-- A COHAPM estava em driver_escrita=graph. criar_conjunto, criar_criativo, exclusao
-- geografica e a troca de criativo do 34b0861 nao tinham sido exercitados pelo
-- Pipeboard nessa conta. Esta migration muda o caminho de escrita deles na hora.

update public.meta_execution_config
   set driver_escrita = 'pipeboard',
       driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
                         - 'criar_conjunto_a_partir_de'
                         || jsonb_build_object('vincular_instagram_dos_anuncios', 'graph');

create or replace function public.resolver_driver(p_company_id uuid, p_acao text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record;
  v_override text;
  v_driver text;
  v_fonte text;
  v_permitidos text[];
begin
  if p_company_id is null then
    return jsonb_build_object('erro','company_id_obrigatorio','motivo','resolver_driver exige a empresa.');
  end if;

  select * into cfg from public.meta_execution_config where company_id = p_company_id;
  if cfg is null then
    return jsonb_build_object(
      'suportado', false, 'driver', null, 'fonte', 'sem_config', 'acao', p_acao,
      'motivo_bloqueio', 'empresa_sem_configuracao_de_execucao',
      'mensagem_para_o_gestor', 'Empresa sem configuracao de execucao; sem driver nada e transportado.'
    );
  end if;

  v_permitidos := case p_acao
    when 'vincular_instagram_dos_anuncios' then array['graph']
    when 'criar_criativo' then array['graph','pipeboard']
    else array['pipeboard']
  end;

  v_override := nullif(btrim(coalesce(cfg.driver_por_acao ->> p_acao, '')), '');
  if v_override is not null then
    v_driver := case when v_override = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'acao';
  else
    v_driver := case when cfg.driver_escrita = 'pipeboard' then 'pipeboard' else 'graph' end;
    v_fonte := 'empresa';
  end if;

  if not (v_driver = any(v_permitidos)) then
    return jsonb_build_object(
      'suportado', false, 'driver', v_driver, 'fonte', v_fonte, 'acao', p_acao,
      'drivers_suportados', to_jsonb(v_permitidos),
      'motivo_bloqueio', format('driver_nao_suporta_%s', p_acao),
      'mensagem_para_o_gestor',
        format('A acao %s nao roda no driver %s (suporta: %s). Ajuste driver_por_acao/driver_escrita. Nenhum card foi emitido.', p_acao, v_driver, array_to_string(v_permitidos, ', '))
    );
  end if;

  return jsonb_build_object(
    'suportado', true, 'driver', v_driver, 'fonte', v_fonte, 'acao', p_acao,
    'drivers_suportados', to_jsonb(v_permitidos)
  );
end
$function$;

comment on function public.resolver_driver(uuid, text) is
  'Driver de transporte. Precedencia do valor pedido: driver_por_acao > driver_escrita; o que nao e pipeboard vira graph e a lista recusa, salvo vincular_instagram_dos_anuncios (so graph) e criar_criativo (graph e pipeboard: carrossel medido em 02/10/2026). Reativar graph numa acao exige migration que a devolva ao array.';

-- Prova na mesma transacao. O override de graph sai no restore; a config do update fica.
do $prova$
declare
  v_empresa uuid := '307849e6-78a7-4217-8112-3fb0a924f988';
  v_antes jsonb;
  v_r jsonb;
begin
  if (select count(*) from public.meta_execution_config) <> 3 then
    raise exception 'prova config: esperava 3 empresas';
  end if;
  if exists (
    select 1 from public.meta_execution_config
     where driver_escrita is distinct from 'pipeboard'
        or (driver_por_acao ->> 'vincular_instagram_dos_anuncios') is distinct from 'graph'
        or driver_por_acao ? 'criar_conjunto_a_partir_de'
  ) then
    raise exception 'prova config: driver ou override fora do contrato';
  end if;

  select driver_por_acao into v_antes
    from public.meta_execution_config
   where company_id = v_empresa;

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
    raise exception 'prova graph em acao qualquer: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'vincular_instagram_dos_anuncios');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'graph'
     or (v_r ->> 'fonte') is distinct from 'acao'
  then
    raise exception 'prova instagram: %', v_r;
  end if;

  v_r := public.resolver_driver(v_empresa, 'criar_criativo');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'graph'
  then
    raise exception 'prova criar_criativo com graph: %', v_r;
  end if;

  update public.meta_execution_config
     set driver_por_acao = v_antes
   where company_id = v_empresa;

  v_r := public.resolver_driver(v_empresa, 'criar_campanha');
  if (v_r ->> 'suportado') is distinct from 'true'
     or (v_r ->> 'driver') is distinct from 'pipeboard'
  then
    raise exception 'prova estado estavel: %', v_r;
  end if;
end
$prova$;
