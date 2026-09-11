-- Portao Ritmo: soma gasto pelo external_id da campanha (11/09/2026)
--
-- O DEFEITO. pode_executar_ato_ritmo somava metric_snapshots.campaign_id
-- (uuid = campaigns.id) contra ritmo_missoes.campaign_id (text = Meta
-- external_id). O join uuid=text ou estoura operador ou soma zero e o teto
-- nao fecha. Acao significativa de gasto deve recusar com {ok:false,
-- motivo:'teto'}, nunca com erro de operador.
--
-- O PADRAO DA CASA (autorizar_ritmo_missao, post_daily): snapshots.campaign_id
-- = campaigns.id AND campaigns.external_id = missao.campaign_id AND mesmo
-- company_id.
--
-- NAO reescreve 20260910210000 (ja aplicado no remoto).

create or replace function public.pode_executar_ato_ritmo(
  p_missao_id uuid,
  p_company_id uuid,
  p_campaign_id text,
  p_acao text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.ritmo_missoes;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_master boolean;
  v_dry boolean := false;
  v_gasto numeric := 0;
begin
  if p_missao_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente', 'dry_run', false);
  end if;

  select * into m from public.ritmo_missoes where id = p_missao_id;
  if m.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'missao_ausente', 'dry_run', false);
  end if;

  select coalesce(mec.dry_run, false), mec.master_enabled
    into v_dry, v_master
    from public.meta_execution_config mec
   where mec.company_id = m.company_id;

  if m.status is distinct from 'em_execucao' then
    return jsonb_build_object('ok', false, 'motivo', 'status', 'dry_run', v_dry);
  end if;
  if m.autonomia_concedida_em is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_concessao', 'dry_run', v_dry);
  end if;
  if p_company_id is null or m.company_id is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'motivo', 'empresa', 'dry_run', v_dry);
  end if;
  if p_campaign_id is null or m.campaign_id is distinct from p_campaign_id then
    return jsonb_build_object('ok', false, 'motivo', 'campanha', 'dry_run', v_dry);
  end if;
  if v_master is not true then
    return jsonb_build_object('ok', false, 'motivo', 'master_desligado', 'dry_run', v_dry);
  end if;

  -- criar_campanha e qualquer acao fora da lista branca: recusa fechada.
  if p_acao is null
     or p_acao = 'criar_campanha'
     or p_acao not in (
       'pausar_criativo',
       'ativar_criativo',
       'escalar_criativo',
       'pausar_conjunto',
       'ativar_conjunto',
       'alterar_orcamento',
       'ajustar_posicionamentos_do_conjunto',
       'alterar_geo_do_conjunto',
       'vincular_instagram_dos_anuncios',
       'criar_conjunto_a_partir_de',
       'criar_anuncio_a_partir_de',
       'escalar_duplicar'
     ) then
    return jsonb_build_object('ok', false, 'motivo', 'acao_proibida', 'dry_run', v_dry);
  end if;

  if v_hoje < m.periodo_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'antes_do_inicio', 'dry_run', v_dry);
  end if;
  if v_hoje > m.periodo_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_prazo', 'dry_run', v_dry);
  end if;

  if p_acao = 'alterar_orcamento'
     or p_acao like 'escalar_%'
     or p_acao like 'criar_%' then
    v_gasto := coalesce((
      select sum(s.spend)
        from public.metric_snapshots s
        join public.campaigns c
          on s.campaign_id = c.id
         and c.company_id = m.company_id
         and c.external_id = m.campaign_id
       where s.company_id = m.company_id
         and s.snapshot_date >= m.periodo_inicio
         and s.snapshot_date <= m.periodo_fim
    ), 0);
    if v_gasto >= coalesce(m.teto_gasto_janela, 0) then
      return jsonb_build_object('ok', false, 'motivo', 'teto', 'dry_run', v_dry);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'motivo', null, 'dry_run', coalesce(v_dry, false));
end;
$$;

comment on function public.pode_executar_ato_ritmo(uuid, uuid, text, text) is
  'Portao da escrita sem card: missao em execucao, mesma empresa e campanha, prazo, teto e lista branca. dry_run informa; nao libera escrita.';
