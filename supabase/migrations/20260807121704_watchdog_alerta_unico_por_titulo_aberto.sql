-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807121704
-- name: watchdog_alerta_unico_por_titulo_aberto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- O watchdog dedupava por janela de 20h, mas o alerta que ele cria nunca se resolve sozinho.
-- Resultado: um alerta novo por dia com o MESMO texto - 6 linhas identicas de "Jobs internos com
-- falha" no relatorio diario de hoje, mais da metade da lista de alertas ativos virou eco.
-- Passa a existir NO MAXIMO UM alerta aberto por titulo: se ja existe, ele e ATUALIZADO com a
-- medida de agora. Atualizar em vez de ignorar importa porque a descricao carrega a contagem e o
-- status do dia; alerta aberto e nunca reescrito envelhece e mente sobre o presente.

create or replace function public.check_data_freshness()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_ultimo_snapshot date;
  v_dias_atraso int;
  v_jobs_falhos int;
  v_detalhe_jobs text;
  v_alertas int := 0;
  v_atualizados int := 0;
  v_desc text;
  v_sev alert_severity;
  v_resultado jsonb;
begin
  select id into v_company from companies where name ilike '%legal%' order by created_at limit 1;
  if v_company is null then
    return jsonb_build_object('erro','empresa principal nao encontrada');
  end if;

  -- 1) FRESCOR DA INGESTAO DE MIDIA
  select max(snapshot_date) into v_ultimo_snapshot
  from metric_snapshots where company_id = v_company;

  v_dias_atraso := coalesce((current_date - v_ultimo_snapshot), 999);

  -- D-1 e o esperado (o cron das 09:00 UTC ingere o dia anterior). 2+ dias = atraso real.
  if v_dias_atraso >= 2 then
    v_sev := case when v_dias_atraso >= 3 then 'high'::alert_severity else 'medium'::alert_severity end;
    v_desc := format('metric_snapshots sem dado novo ha %s dia(s). Ultimo snapshot: %s. O sistema pode estar cego para gasto e resultados - conferir windsor-sync e net._http_response antes de confiar em qualquer relatorio.',
                     v_dias_atraso, coalesce(v_ultimo_snapshot::text,'nenhum'));

    update alerts set description = v_desc, severity = v_sev, triggered_value = v_dias_atraso
     where company_id = v_company and resolved = false
       and title = 'Ingestao de metricas atrasada';
    get diagnostics v_atualizados = row_count;

    if v_atualizados = 0 then
      insert into alerts (company_id, severity, title, description, triggered_value)
      values (v_company, v_sev, 'Ingestao de metricas atrasada', v_desc, v_dias_atraso);
      v_alertas := v_alertas + 1;
    end if;
  end if;

  -- 2) JOBS QUE NAO RETORNARAM 200
  -- pg_cron marca "succeeded" quando o POST e ENFILEIRADO, nao quando a edge responde OK.
  -- A verdade esta em net._http_response.
  select count(*), string_agg(distinct coalesce(status_code::text,'sem resposta'), ', ')
    into v_jobs_falhos, v_detalhe_jobs
  from net._http_response
  where created > now() - interval '24 hours'
    and (status_code is null or status_code <> 200);

  if v_jobs_falhos > 0 then
    v_desc := format('%s chamada(s) interna(s) nao retornaram 200 nas ultimas 24h (status: %s), medido em %s. Conferir net._http_response - "succeeded" no pg_cron significa apenas que o POST foi enfileirado. Sem resposta e tipicamente estouro do timeout de 150s do net.http_post: a edge pode ter gravado o dado e nao ter respondido a tempo - confira o frescor da tabela de destino antes de concluir que o job falhou.',
                     v_jobs_falhos, coalesce(v_detalhe_jobs,'-'), to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'));

    update alerts set description = v_desc, triggered_value = v_jobs_falhos
     where company_id = v_company and resolved = false
       and title = 'Jobs internos com falha';
    get diagnostics v_atualizados = row_count;

    if v_atualizados = 0 then
      insert into alerts (company_id, severity, title, description, triggered_value)
      values (v_company, 'medium'::alert_severity, 'Jobs internos com falha', v_desc, v_jobs_falhos);
      v_alertas := v_alertas + 1;
    end if;
  else
    -- Sem falha na janela: o alerta aberto perdeu o lastro e se resolve sozinho.
    update alerts set resolved = true
     where company_id = v_company and resolved = false
       and title = 'Jobs internos com falha';
  end if;

  v_resultado := jsonb_build_object(
    'verificado_em', now(),
    'ultimo_snapshot', v_ultimo_snapshot,
    'dias_atraso', v_dias_atraso,
    'ingestao_ok', v_dias_atraso < 2,
    'jobs_com_falha_24h', v_jobs_falhos,
    'alertas_criados', v_alertas);

  return v_resultado;
end
$function$;
