-- ============================================================================
-- Crons passam pelo registro de execucao
-- ============================================================================
-- Ate aqui cada cron chamava direto  net.http_post(...)  ou  select public.funcao().
-- Nos dois casos o pg_cron anotava 'succeeded' e ninguem sabia o que tinha acontecido:
-- no HTTP porque 'succeeded' significa apenas "POST enfileirado", e no SQL porque o valor
-- de retorno da funcao era descartado.
--
-- O que muda: HORARIO NENHUM. Todos os agendamentos mantem o mesmo schedule. Muda o CORPO
-- do comando, que agora entra por rodar_tarefa_sql / disparar_tarefa_http. Essas duas abrem
-- linha em execucoes_agendadas, guardam o retorno, e no caso HTTP guardam o request_id para
-- a conferencia posterior descobrir o desfecho REAL no destino.
--
-- Antes de reagendar foi conferido, tarefa por tarefa, que o catalogo reproduz fielmente o
-- comando original: mesma URL, mesmo modo de autenticacao (x-mcp-key ou Bearer, sempre via
-- public.get_mcp_api_key do mesmo chamador), mesmo corpo, mesmo timeout. As tarefas cujo
-- corpo carrega @company_id tem company_id preenchido no catalogo, e a janela de datas de
-- metricas-pipeboard reproduz o current_date - 6 do comando antigo.
--
-- Risco residual e auto-revelavel: se algum chamador do catalogo estiver errado, a rodada
-- agora GRAVA a falha e emite alerta, em vez de sumir em silencio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Reagendamento: mesmo horario, comando pelo registro
-- ----------------------------------------------------------------------------
do $mig$
declare
  r     record;
  v_id  bigint;
  v_n   int := 0;
begin
  for r in
    select * from (values
      -- tarefas SQL
      ('alerts-eval-daily',                 'select public.rodar_tarefa_sql(''alertas-de-midia''); select public.rodar_tarefa_sql(''criativos-vencedores'');'),
      ('campaign-config-snapshot-0925',     'select public.rodar_tarefa_sql(''snapshot-config-campanhas'');'),
      ('daily-report-0830',                 'select public.rodar_tarefa_sql(''relatorio-diario-no-chat'');'),
      ('expira-aprovacoes-hora',            'select public.rodar_tarefa_sql(''expirar-aprovacoes'');'),
      ('expira-chat-jobs-hora',             'select public.rodar_tarefa_sql(''expirar-jobs-de-chat'');'),
      ('reco-sinais-0925',                  'select public.rodar_tarefa_sql(''sinais-de-recomendacao-diario'');'),
      ('reco-sinais-semanal-1000',          'select public.rodar_tarefa_sql(''sinais-de-recomendacao-semanal'');'),
      ('valida-conhecimento-semanal',       'select public.rodar_tarefa_sql(''validade-do-conhecimento'');'),
      ('waba-tier-alerts-0940',             'select public.rodar_tarefa_sql(''qualidade-numeros-whatsapp'');'),
      -- tarefas HTTP
      ('bm-monitor-0920',                   'select public.disparar_tarefa_http(''monitor-contas-meta'');'),
      ('digest-email-horario',              'select public.disparar_tarefa_http(''digest-por-email'');'),
      ('digest-drenar-alertas',             'select public.disparar_tarefa_http(''drenar-alertas-criticos'');'),
      ('drive-watch-0845',                  'select public.disparar_tarefa_http(''varredura-drive-legal'');'),
      ('drive-watch-cohapm-0846',           'select public.disparar_tarefa_http(''varredura-drive-cohapm'');'),
      ('escoar-imagens-hora',               'select public.disparar_tarefa_http(''escoar-imagens-legal'');'),
      ('escoar-imagens-cohapm-hora',        'select public.disparar_tarefa_http(''escoar-imagens-cohapm'');'),
      ('escoar-videos-hora',                'select public.disparar_tarefa_http(''escoar-videos-legal'');'),
      ('escoar-videos-cohapm-hora',         'select public.disparar_tarefa_http(''escoar-videos-cohapm'');'),
      ('meta-campaign-status-0910',         'select public.disparar_tarefa_http(''espelho-meta-diario'');'),
      ('meta-token-monitor-0915',           'select public.disparar_tarefa_http(''saude-dos-tokens-meta'');'),
      ('pipeboard-metrics-daily',           'select public.disparar_tarefa_http(''metricas-pipeboard'');'),
      ('pipeboard-structure-campaigns-0912','select public.disparar_tarefa_http(''estrutura-campanhas'');'),
      ('pipeboard-structure-adsets-0917',   'select public.disparar_tarefa_http(''estrutura-conjuntos'');'),
      ('pipeboard-structure-ads-0922',      'select public.disparar_tarefa_http(''estrutura-anuncios'');'),
      ('traffic-reco-job-0935',             'select public.disparar_tarefa_http(''recomendacoes-da-ia'');'),
      ('waba-sync-daily',                   'select public.disparar_tarefa_http(''sincronizar-whatsapp'');')
    ) as m(jobname, comando)
  loop
    select jobid into v_id from cron.job where jobname = r.jobname;
    if v_id is null then
      raise notice 'cron ausente, nada a reagendar: %', r.jobname;
    else
      perform cron.alter_job(v_id, command := r.comando);
      v_n := v_n + 1;
    end if;
  end loop;

  raise notice 'crons reagendados pelo registro: %', v_n;
end
$mig$;

-- ----------------------------------------------------------------------------
-- 2) Duas tarefas novas, e as duas existem por necessidade estrutural
-- ----------------------------------------------------------------------------
-- conferir-chamadas-http: sem ela toda tarefa HTTP fica presa em 'em_curso' para sempre,
-- porque quem descobre o desfecho real e a leitura da resposta, nao o disparo. Roda de 5 em
-- 5 minutos porque pg_net guarda a resposta por pouco tempo.
--
-- vigia-das-tarefas: transforma AUSENCIA em alerta. E a resposta direta a queixa "as crons
-- nao rodam": sem vigia, tarefa que parou de rodar nao produz sinal nenhum — e o silencio
-- e indistinguivel de normalidade.
do $mig$
begin
  if exists (select 1 from cron.job where jobname = 'conferir-chamadas-http') then
    perform cron.unschedule('conferir-chamadas-http');
  end if;
  perform cron.schedule('conferir-chamadas-http', '*/5 * * * *',
                        'select public.rodar_tarefa_sql(''conferir-chamadas-http'');');

  if exists (select 1 from cron.job where jobname = 'vigia-das-tarefas') then
    perform cron.unschedule('vigia-das-tarefas');
  end if;
  perform cron.schedule('vigia-das-tarefas', '10 * * * *',
                        'select public.rodar_tarefa_sql(''vigia-das-tarefas'');');
end
$mig$;

-- ----------------------------------------------------------------------------
-- 3) Aposentadorias
-- ----------------------------------------------------------------------------
-- windsor-*: a edge windsor-sync foi retirada; os tres jobs ja estavam active = false e so
-- poluiam o inventario.
--
-- watchdog-frescor-0945 (check_data_freshness): aposentado de proposito, e vale registrar o
-- porque. As duas coisas que ele fazia agora sao feitas melhor:
--   - "chamadas internas que nao retornaram 200" -> conferir_execucoes_http, que sabe QUAL
--     tarefa falhou. O antigo lia net._http_response sem saber a URL, entao dizia apenas
--     "2 chamada(s) interna(s) nao retornaram 200" e mandava o gestor conferir a tabela de
--     rede na mao.
--   - atraso de rotina -> vigiar_tarefas_agendadas, para todas as empresas. O antigo estava
--     amarrado a uma empresa fixa e ainda citava a windsor-sync, que nao existe mais.
-- O texto dele era, alem disso, o exemplo mais claro da queixa do gestor sobre linguagem
-- tecnica crua. Mantê-lo agendado significaria reemitir esse texto todo dia as 09:45.
do $mig$
declare j text;
begin
  foreach j in array array['windsor-sync-daily', 'windsor-wide-ads-weekly',
                           'windsor-wide-adsets-weekly', 'watchdog-frescor-0945']
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice 'cron aposentado: %', j;
    end if;
  end loop;
end
$mig$;

-- Alerta legado do watchdog antigo: resolvido, nao apagado. O problema que ele apontava
-- (chamadas HTTP sem resposta) passa a ser reportado pela conferencia, com nome de tarefa.
update public.alerts
   set resolved = true
 where resolved = false
   and coalesce(padrao_versao, 1) = 1
   and title = 'Jobs internos com falha';

-- ----------------------------------------------------------------------------
-- 4) Tarefa sem agendamento fica inativa, para nao virar alarme falso
-- ----------------------------------------------------------------------------
-- transcrever-audios-drive (edge drive-audio-transcribe) esta no catalogo mas NAO tem cron
-- em cron.job. Deixar ativa faria o vigia acusar atraso eterno de uma tarefa que nunca foi
-- agendada. Fica inativa e entra no relatorio como decisao pendente do gestor: se a
-- transcricao de audio do Drive deve rodar sozinha, e com que periodicidade.
alter table public.tarefas_agendadas
  add column if not exists observacao text;

comment on column public.tarefas_agendadas.observacao is
  'Motivo de a tarefa estar inativa, ou ressalva operacional. Aparece na tela de saude das tarefas.';

update public.tarefas_agendadas
   set ativa = false,
       observacao = 'Sem agendamento em cron.job. Aguarda decisao do gestor sobre periodicidade antes de ativar.'
 where tarefa = 'transcrever-audios-drive';
