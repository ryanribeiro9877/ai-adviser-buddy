-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812212335
-- name: esp38_score_de_prontidao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-38: score de prontidao por empresa (read-only), agregando sinais existentes.
create or replace function public.score_de_prontidao(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cfg record;
  v_checks jsonb := '[]'::jsonb;
  v_bloqueios jsonb := '[]'::jsonb;
  v_recomendacoes jsonb := '[]'::jsonb;
  v_score int := 0;
  v_nivel text;
  v_saude jsonb;
  v_vivas int := 0;
  v_brand jsonb;
  v_brand_ok boolean := false;
  v_destinos int := 0;
  v_postura jsonb;
  v_postura_ok boolean := false;
  v_drv jsonb;
  v_driver_ok boolean := false;
  v_config_ok boolean := false;
  v_int_ok boolean := false;
  v_faltando_cfg text[] := array[]::text[];
begin
  if p_company_id is null then
    return jsonb_build_object('erro','company_id_obrigatorio','motivo','score_de_prontidao exige a empresa.');
  end if;

  select * into cfg from public.meta_execution_config where company_id = p_company_id;
  if cfg is null then
    return jsonb_build_object(
      'company_id', p_company_id, 'score', 0, 'nivel', 'bloqueado',
      'checks', jsonb_build_array(jsonb_build_object(
        'item','config_execucao','ok',false,'peso',25,'evidencia', jsonb_build_object('existe', false),
        'lacuna','Empresa sem linha em meta_execution_config; nada pode ser criado nem executado.')),
      'bloqueios', jsonb_build_array('empresa_sem_configuracao_de_execucao'),
      'recomendacoes', jsonb_build_array('Crie a configuracao de execucao da empresa (meta_execution_config).'),
      'premissas', jsonb_build_array('Score read-only: NAO altera nada; apenas mede a prontidao.')
    );
  end if;

  -- 1) Config de execucao (peso 25): campos minimos para criar anuncio.
  if coalesce(nullif(btrim(cfg.page_id), ''), null) is null then v_faltando_cfg := v_faltando_cfg || 'page_id'; end if;
  if coalesce(nullif(btrim(cfg.cta_padrao), ''), null) is null then v_faltando_cfg := v_faltando_cfg || 'cta_padrao'; end if;
  if coalesce(array_length(cfg.contas_permitidas_criacao, 1), 0) = 0 then v_faltando_cfg := v_faltando_cfg || 'contas_permitidas_criacao'; end if;
  if cfg.teto_sanidade_orcamento_diario is null then v_faltando_cfg := v_faltando_cfg || 'teto_sanidade_orcamento_diario'; end if;
  if coalesce(nullif(btrim(cfg.marca_tag), ''), null) is null then v_faltando_cfg := v_faltando_cfg || 'marca_tag'; end if;
  v_config_ok := not ('page_id' = any(v_faltando_cfg) or 'cta_padrao' = any(v_faltando_cfg) or 'contas_permitidas_criacao' = any(v_faltando_cfg));
  if v_config_ok then v_score := v_score + 25; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','config_execucao','ok',v_config_ok,'peso',25,
    'evidencia', jsonb_build_object(
      'page_id', cfg.page_id, 'cta_padrao', cfg.cta_padrao, 'marca_tag', cfg.marca_tag,
      'contas_permitidas_criacao', to_jsonb(coalesce(cfg.contas_permitidas_criacao, '{}'::text[])),
      'teto_sanidade_orcamento_diario', cfg.teto_sanidade_orcamento_diario,
      'master_enabled', cfg.master_enabled, 'dry_run', cfg.dry_run),
    'lacuna', case when array_length(v_faltando_cfg,1) is null then null
                   else 'Faltam campos de config: ' || array_to_string(v_faltando_cfg, ', ') end);

  -- 2) Integracao Meta viva (peso 25).
  v_saude := public.saude_das_integracoes(p_company_id, 3);
  select count(*) into v_vivas
    from jsonb_array_elements(coalesce(v_saude->'contas','[]'::jsonb)) c
   where c->>'veredito' = 'viva';
  v_int_ok := v_vivas > 0;
  if v_int_ok then v_score := v_score + 25; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','integracao_meta','ok',v_int_ok,'peso',25,
    'evidencia', jsonb_build_object('contas_vivas', v_vivas, 'por_veredito', v_saude->'por_veredito'),
    'lacuna', case when v_int_ok then null else 'Nenhuma conta Meta com veredito viva; coletor/entrega sem prova recente.' end);

  -- 3) Postura de criacao (peso 20): pode_executar_acao para criar_anuncio_a_partir_de.
  v_postura := public.pode_executar_acao(p_company_id, 'criar_anuncio_a_partir_de');
  v_postura_ok := (v_postura->>'permitido') = 'true';
  if v_postura_ok then v_score := v_score + 20; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','postura_criacao','ok',v_postura_ok,'peso',20,
    'evidencia', jsonb_build_object('motivo', v_postura->>'motivo', 'dry_run', v_postura->'dry_run', 'driver_escrita', v_postura->>'driver_escrita'),
    'lacuna', case when v_postura_ok then null else coalesce(v_postura->>'mensagem_para_o_gestor', v_postura->>'motivo') end);

  -- 4) Identidade de marca (peso 15).
  v_brand := public.ler_brand_identity(p_company_id);
  v_brand_ok := (v_brand->>'existe') = 'true';
  if v_brand_ok then v_score := v_score + 15; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','brand_identity','ok',v_brand_ok,'peso',15,
    'evidencia', jsonb_build_object('marca_nome', v_brand->'brand'->>'marca_nome'),
    'lacuna', case when v_brand_ok then null else 'Sem brand_identity vigente (ESP-36); voz/tom cai no padrao.' end);

  -- 5) Destino por produto (peso 10).
  select count(*) into v_destinos from public.destino_por_produto where company_id = p_company_id and vigente;
  if v_destinos > 0 then v_score := v_score + 10; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','destino_produto','ok', v_destinos > 0,'peso',10,
    'evidencia', jsonb_build_object('destinos_vigentes', v_destinos),
    'lacuna', case when v_destinos > 0 then null else 'Nenhum destino por produto vigente; anuncio pode ficar sem LP canonica.' end);

  -- 6) Driver de criacao resolvivel (peso 5).
  v_drv := public.resolver_driver(p_company_id, 'criar_anuncio_a_partir_de');
  v_driver_ok := (v_drv->>'suportado') = 'true';
  if v_driver_ok then v_score := v_score + 5; end if;
  v_checks := v_checks || jsonb_build_object(
    'item','driver_criacao','ok',v_driver_ok,'peso',5,
    'evidencia', jsonb_build_object('driver', v_drv->>'driver', 'fonte', v_drv->>'fonte'),
    'lacuna', case when v_driver_ok then null else coalesce(v_drv->>'motivo_bloqueio','driver nao resolvido') end);

  -- Bloqueios duros (impedem propor criacao de anuncio).
  if not v_config_ok then v_bloqueios := v_bloqueios || to_jsonb('config_execucao_incompleta'::text); end if;
  if not v_int_ok then v_bloqueios := v_bloqueios || to_jsonb('sem_conta_meta_viva'::text); end if;
  if not v_postura_ok then v_bloqueios := v_bloqueios || to_jsonb(coalesce(v_postura->>'motivo','postura_criacao_negada')); end if;

  -- Recomendacoes (lacunas suaves).
  if not v_brand_ok then v_recomendacoes := v_recomendacoes || to_jsonb('Semear brand_identity (ESP-36).'::text); end if;
  if v_destinos = 0 then v_recomendacoes := v_recomendacoes || to_jsonb('Cadastrar destino_por_produto vigente.'::text); end if;
  if cfg.dry_run then v_recomendacoes := v_recomendacoes || to_jsonb('dry_run ligado: aprovar cards NAO altera a Meta (simulacao).'::text); end if;
  if cfg.master_enabled is not true then v_recomendacoes := v_recomendacoes || to_jsonb('master_enabled desligado: execucao real off.'::text); end if;

  -- Nivel.
  if jsonb_array_length(v_bloqueios) > 0 then
    v_nivel := 'bloqueado';
  elsif v_score >= 95 and cfg.master_enabled is true and cfg.dry_run is not true then
    v_nivel := 'pronto';
  elsif cfg.master_enabled is true and cfg.dry_run is not true then
    v_nivel := 'operacional';
  else
    v_nivel := 'parcial';
  end if;

  return jsonb_build_object(
    'company_id', p_company_id,
    'score', v_score,
    'nivel', v_nivel,
    'checks', v_checks,
    'bloqueios', v_bloqueios,
    'recomendacoes', v_recomendacoes,
    'premissas', jsonb_build_array(
      'Score read-only: NAO altera nada; apenas mede a prontidao para o agente propor/executar.',
      'Pesos: config 25, integracao 25, postura_criacao 20, brand 15, destino 10, driver 5.',
      'nivel operacional/pronto depende de master_enabled e dry_run; parcial inclui simulacao (dry_run).'
    ),
    'validacao_de_specs', 'Para validar um pedido especifico use validar_pedido_contra_contrato(acao, pedido); a criacao de anuncio tem gate proprio (pedido_de_anuncio_completo).'
  );
end $function$;

comment on function public.score_de_prontidao(uuid) is
  'ESP-38: score read-only 0-100 de prontidao da empresa (config, integracao viva, postura de criacao, brand_identity, destino_por_produto, driver) com checks, bloqueios e recomendacoes.';

revoke all on function public.score_de_prontidao(uuid) from public, anon;
grant execute on function public.score_de_prontidao(uuid) to service_role, authenticated;

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'SCORE DE PRONTIDAO (ESP-38, 12/08/2026). score_de_prontidao(company_id) e leitura pura que agrega os sinais que ja existiam (config de execucao, saude_das_integracoes, pode_executar_acao/resolver_driver para criar_anuncio, ler_brand_identity, destino_por_produto) num score 0-100 com nivel (bloqueado|parcial|operacional|pronto), checks itemizados, bloqueios duros e recomendacoes. NAO altera nada e NAO substitui os gates por pedido: para validar um pedido use validar_pedido_contra_contrato; a criacao de anuncio mantem o gate pedido_de_anuncio_completo. dry_run/master_enabled definem operacional vs simulacao.',
  true,
  date '2026-08-12'
);
