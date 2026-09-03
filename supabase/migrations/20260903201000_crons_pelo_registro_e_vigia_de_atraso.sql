-- Crons passam pelo registro, sucesso e conferido no destino, e atraso vira alerta (03/09/2026)
--
-- POR QUE: a migration anterior criou a trilha. Esta faz as tarefas usarem a trilha, e conserta
-- o modo de falha central: nas 17 tarefas HTTP o pg_cron declarava sucesso ao ENFILEIRAR.
--
-- COMO O SUCESSO PASSA A SER VERIFICADO NO DESTINO, E NAO NO ENFILEIRAMENTO:
--   net.http_post devolve um request_id (bigint) que casa com net._http_response.id. Entao
--   disparar_tarefa_http guarda esse id no registro e deixa a rodada em 'em_curso' — enfileirar
--   nao e sucesso e o registro nao finge que e. Dois minutos depois conferir_execucoes_http le a
--   resposta REAL por aquele id e so ai decide o desfecho. Tres checagens, nesta ordem:
--     1) status HTTP 2xx?
--     2) o corpo diz ok:false? Varias edges deste projeto devolvem 200 com ok:false quando uma
--        conta falha (pipeboard-metrics-sync, pipeboard-structure-sync, waba-sync). 200 sozinho
--        nunca foi prova de nada aqui.
--     3) a tabela de destino cresceu? Se sim, gravou. Se nao, e sucesso_vazio, nao falha.
--
--   Caso especial honesto: timeout do net.http_post (150s) com destino que cresceu. A edge
--   gravou e nao respondeu a tempo. Isso e registrado como sucesso com ressalva, nao como falha:
--   chamar de falha faria o gestor perseguir problema que nao existe.
--
-- CRONS APOSENTADAS: windsor-sync-daily, windsor-wide-ads-weekly e windsor-wide-adsets-weekly
-- apontam para a edge windsor-sync, que foi descontinuada (mora em docs/edges-descontinuadas/).
-- Estavam inativas mas continuavam registradas, e o texto do watchdog antigo ainda mandava o
-- gestor "conferir windsor-sync". Conselho apontando para funcao que nao existe e pior que
-- nenhum conselho: saem do cron.job.

-- ============================================================================
-- 1) BASE DA URL E EMPRESA PARA ALERTA DE INFRAESTRUTURA
-- ============================================================================

create or replace function public.url_functions()
returns text
language sql
immutable
as $function$
  select 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/'
$function$;

-- Alerta de infraestrutura precisa de uma casa: alerts.company_id e NOT NULL. Usamos a empresa
-- com mais campanhas ativas e marcamos linha_produto como 'Infraestrutura do sistema', para o
-- alerta nunca ser confundido com achado de uma linha de produto.
create or replace function public.empresa_principal()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.id
    from public.companies c
    left join public.campaigns cp
      on cp.company_id = c.id and cp.status = 'active'
   group by c.id, c.created_at
   order by count(cp.id) desc, c.created_at
   limit 1
$function$;

-- ============================================================================
-- 2) RODAR TAREFA SQL COM REGISTRO
-- ============================================================================
-- NAO re-levanta a excecao de proposito: re-levantar abortaria a transacao do cron e levaria o
-- INSERT do registro embora — voltando exatamente ao silencio que esta entrega combate. O erro
-- fica gravado no registro E vira alerta.

create or replace function public.rodar_tarefa_sql(
  p_tarefa text,
  p_origem text default 'cron',
  p_forcar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_exec uuid;
  v_retorno text;
  v_itens integer;
begin
  select * into v_t from public.tarefas_agendadas where tarefa = p_tarefa;
  if v_t.tarefa is null or v_t.tipo <> 'sql' then
    raise exception 'tarefa sql desconhecida no catalogo: %', p_tarefa;
  end if;
  if not v_t.ativa then
    return jsonb_build_object('tarefa', p_tarefa, 'pulado', 'tarefa inativa no catalogo');
  end if;

  v_exec := public.abrir_execucao(p_tarefa, p_origem, null, p_forcar);
  if v_exec is null then
    return jsonb_build_object('tarefa', p_tarefa, 'pulado', 'periodo ja concluido com sucesso');
  end if;

  begin
    if v_t.arg_sql is null then
      execute format('select (public.%I())::text', v_t.funcao_sql) into v_retorno;
    else
      execute format('select (public.%I($1))::text', v_t.funcao_sql) into v_retorno using v_t.arg_sql;
    end if;

    -- Funcao que devolve inteiro esta dizendo quantos itens tratou. Isso deixava de ser lido.
    v_itens := case when v_retorno ~ '^\d+$' then v_retorno::integer else null end;

    perform public.fechar_execucao(
      v_exec, 'sucesso', v_itens, null, null,
      jsonb_build_object('retorno', left(coalesce(v_retorno, ''), 4000), 'funcao', v_t.funcao_sql));

    return jsonb_build_object('tarefa', p_tarefa, 'execucao', v_exec,
                              'retorno', left(coalesce(v_retorno, ''), 500));
  exception when others then
    perform public.fechar_execucao(
      v_exec, 'falha', 0, null, coalesce(sqlerrm, 'erro sem mensagem'),
      jsonb_build_object('sqlstate', sqlstate, 'funcao', v_t.funcao_sql));

    perform public.emitir_alerta(
      p_company_id    => coalesce(v_t.company_id, public.empresa_principal()),
      p_severidade    => 'high'::alert_severity,
      p_titulo        => 'Rotina do sistema falhou: ' || v_t.titulo,
      p_o_que         => format('A rotina "%s" tentou rodar e parou com erro. Ela responde: %s. Enquanto o erro nao for corrigido, essa resposta fica desatualizada.',
                                v_t.titulo, v_t.pergunta),
      p_onde          => 'Rotina interna do sistema (' || p_tarefa || ')',
      p_quanto        => 'mensagem do banco: ' || left(coalesce(sqlerrm, 'sem mensagem'), 300),
      p_acao          => 'Abrir a tela Tarefas agendadas e reexecutar. Se repetir, o erro esta na funcao ' || v_t.funcao_sql || '.',
      p_janela        => 'rodada de ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      p_tarefa        => p_tarefa,
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'tarefa_erro:' || p_tarefa);

    return jsonb_build_object('tarefa', p_tarefa, 'execucao', v_exec, 'erro', sqlerrm);
  end;
end
$function$;

comment on function public.rodar_tarefa_sql(text, text, boolean) is
  'Roda uma tarefa SQL do catalogo dentro de um registro de execucao. Captura a excecao em vez de re-levantar: re-levantar abortaria a transacao do cron e apagaria o proprio registro do erro.';

-- ============================================================================
-- 3) DISPARAR TAREFA HTTP — deixa em_curso de proposito
-- ============================================================================

create or replace function public.disparar_tarefa_http(
  p_tarefa text,
  p_origem text default 'cron',
  p_forcar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_exec uuid;
  v_req bigint;
  v_chave text;
  v_headers jsonb;
  v_corpo text;
begin
  select * into v_t from public.tarefas_agendadas where tarefa = p_tarefa;
  if v_t.tarefa is null or v_t.tipo <> 'http' then
    raise exception 'tarefa http desconhecida no catalogo: %', p_tarefa;
  end if;
  if not v_t.ativa then
    return jsonb_build_object('tarefa', p_tarefa, 'pulado', 'tarefa inativa no catalogo');
  end if;

  v_exec := public.abrir_execucao(p_tarefa, p_origem, null, p_forcar);
  if v_exec is null then
    return jsonb_build_object('tarefa', p_tarefa, 'pulado', 'periodo ja concluido com sucesso');
  end if;

  -- Chave por chamador (o catalogo guarda o NOME do chamador, nunca o valor).
  if v_t.chave_chamador is null then
    v_chave := public.get_mcp_api_key();
  else
    v_chave := public.get_mcp_api_key(v_t.chave_chamador);
  end if;

  -- Chave ausente era uma das causas suspeitas de falha muda. Agora ela para a rodada com
  -- registro e alerta, em vez de disparar um POST que volta 401 sem ninguem ver.
  if v_chave is null or length(btrim(v_chave)) < 8 then
    perform public.fechar_execucao(
      v_exec, 'falha', 0, 0,
      format('credencial ausente ou invalida para o chamador %s', coalesce(v_t.chave_chamador, '(chave legada)')),
      jsonb_build_object('edge', v_t.edge));

    perform public.emitir_alerta(
      p_company_id    => coalesce(v_t.company_id, public.empresa_principal()),
      p_severidade    => 'critical'::alert_severity,
      p_titulo        => 'Rotina do sistema sem credencial: ' || v_t.titulo,
      p_o_que         => format('A rotina "%s" nao rodou porque a credencial interna dela nao existe mais ou foi revogada. Ela responde: %s.',
                                v_t.titulo, v_t.pergunta),
      p_onde          => 'Rotina interna do sistema (' || p_tarefa || ')',
      p_quanto        => 'chamador ' || coalesce(v_t.chave_chamador, '(chave legada)') || ' sem chave valida',
      p_acao          => 'Recadastrar a chave desse chamador. Sem ela essa rotina nao volta a rodar sozinha.',
      p_janela        => 'rodada de ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      p_tarefa        => p_tarefa,
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'tarefa_sem_chave:' || p_tarefa);

    return jsonb_build_object('tarefa', p_tarefa, 'execucao', v_exec, 'erro', 'credencial ausente');
  end if;

  v_headers := case v_t.modo_auth
                 when 'x-mcp-key' then jsonb_build_object('Content-Type', 'application/json', 'x-mcp-key', v_chave)
                 else jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_chave)
               end;

  -- Substituicoes do corpo. Mantem o catalogo declarativo sem precisar de SQL por tarefa.
  v_corpo := v_t.corpo::text;
  if v_t.company_id is not null then
    v_corpo := replace(v_corpo, '@company_id', v_t.company_id::text);
  end if;
  v_corpo := replace(v_corpo, '@data_inicio',
                     to_char(current_date - coalesce(v_t.janela_dias, 0), 'YYYY-MM-DD'));
  v_corpo := replace(v_corpo, '@data_fim', to_char(current_date, 'YYYY-MM-DD'));

  select net.http_post(
           url := public.url_functions() || v_t.edge,
           headers := v_headers,
           body := v_corpo::jsonb,
           timeout_milliseconds := v_t.timeout_ms)
    into v_req;

  -- Fica em_curso: enfileirar nao e sucesso. Quem fecha e conferir_execucoes_http.
  update public.execucoes_agendadas
     set detalhe = detalhe || jsonb_build_object('request_id', v_req, 'edge', v_t.edge)
   where id = v_exec;

  return jsonb_build_object('tarefa', p_tarefa, 'execucao', v_exec,
                            'request_id', v_req, 'desfecho', 'em_curso');
end
$function$;

comment on function public.disparar_tarefa_http(text, text, boolean) is
  'Dispara a edge da tarefa e guarda o request_id do pg_net, deixando a rodada em_curso. Enfileirar nao e sucesso: o desfecho sai de conferir_execucoes_http, que le a resposta real.';

-- ============================================================================
-- 4) CONFERIR NO DESTINO — onde "enfileirou" vira veredito
-- ============================================================================

create or replace function public.conferir_execucoes_http()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e record;
  v_status int;
  v_timeout boolean;
  v_errmsg text;
  v_conteudo text;
  v_corpo jsonb;
  v_ok_corpo boolean;
  v_cresceu bigint;
  v_fechados int := 0;
  v_falhas int := 0;
  v_pendentes int := 0;
  v_desfecho text;
  v_erro text;
begin
  for v_e in
    select e.id, e.tarefa, e.iniciado_em, e.company_id, e.detalhe,
           t.timeout_ms, t.titulo, t.pergunta, t.edge, t.tabela_destino, t.coluna_carimbo,
           t.company_id as tarefa_company
      from public.execucoes_agendadas e
      join public.tarefas_agendadas t on t.tarefa = e.tarefa
     where e.desfecho = 'em_curso'
       and t.tipo = 'http'
     order by e.iniciado_em
  loop
    v_status := null; v_timeout := null; v_errmsg := null; v_conteudo := null;
    v_corpo := null; v_ok_corpo := true; v_desfecho := null; v_erro := null;

    if (v_e.detalhe->>'request_id') is null then
      -- Disparo que nem chegou a enfileirar. Prazo generoso e depois falha declarada.
      if v_e.iniciado_em < now() - interval '15 minutes' then
        perform public.fechar_execucao(v_e.id, 'falha', 0, 0,
          'a chamada nao chegou a ser enfileirada pelo banco', '{}'::jsonb);
        v_falhas := v_falhas + 1; v_fechados := v_fechados + 1;
      else
        v_pendentes := v_pendentes + 1;
      end if;
      continue;
    end if;

    select r.status_code, r.timed_out, r.error_msg, left(r.content, 4000)
      into v_status, v_timeout, v_errmsg, v_conteudo
      from net._http_response r
     where r.id = (v_e.detalhe->>'request_id')::bigint;

    -- Sem linha de resposta: ou ainda esta em voo, ou o pg_net ja podou por TTL.
    if not found then
      if v_e.iniciado_em < now() - ((coalesce(v_e.timeout_ms, 120000) + 120000) * interval '1 millisecond') then
        v_cresceu := public.contar_destino(v_e.tabela_destino, v_e.coluna_carimbo,
                                           (v_e.detalhe->>'frescor_desde')::timestamptz, v_e.company_id);
        if v_cresceu is not null and v_cresceu > coalesce(nullif(v_e.detalhe->>'base_destino','')::bigint, 0) then
          -- Gravou e nao respondeu a tempo: chamar de falha mandaria o gestor caçar fantasma.
          perform public.fechar_execucao(v_e.id, 'sucesso', null, null, null,
            jsonb_build_object('ressalva', 'a edge gravou no destino mas nao respondeu dentro do prazo'));
        else
          perform public.fechar_execucao(v_e.id, 'falha', 0, 0,
            'a edge nao respondeu dentro do prazo e nada novo apareceu na tabela de destino',
            jsonb_build_object('sem_resposta', true));
          v_falhas := v_falhas + 1;
        end if;
        v_fechados := v_fechados + 1;
      else
        v_pendentes := v_pendentes + 1;
      end if;
      continue;
    end if;

    -- 200 nao basta neste projeto: varias edges devolvem 200 com ok:false no corpo.
    begin
      v_corpo := nullif(btrim(coalesce(v_conteudo, '')), '')::jsonb;
      if v_corpo is not null and jsonb_typeof(v_corpo) = 'object'
         and v_corpo ? 'ok' and lower(coalesce(v_corpo->>'ok','')) = 'false' then
        v_ok_corpo := false;
      end if;
    exception when others then
      v_corpo := null;  -- corpo nao-JSON nao invalida a rodada; o status manda
    end;

    if v_status between 200 and 299 and v_ok_corpo then
      v_desfecho := 'sucesso';
    elsif v_status between 200 and 299 and not v_ok_corpo then
      v_desfecho := 'falha';
      v_erro := 'a edge respondeu 200 mas declarou falha no corpo (ok:false): '
                || left(coalesce(v_corpo::text, ''), 500);
    elsif coalesce(v_timeout, false) then
      v_desfecho := 'falha';
      v_erro := 'a chamada estourou o tempo limite de ' || (coalesce(v_e.timeout_ms,120000)/1000) || 's';
    else
      v_desfecho := 'falha';
      v_erro := 'a edge respondeu HTTP ' || coalesce(v_status::text, 'sem status')
                || coalesce(' - ' || left(v_errmsg, 200), '')
                || coalesce(' - ' || left(coalesce(v_corpo::text, v_conteudo), 400), '');
    end if;

    perform public.fechar_execucao(v_e.id, v_desfecho, null, null, v_erro,
      jsonb_build_object('status_http', v_status, 'timed_out', v_timeout));

    v_fechados := v_fechados + 1;

    if v_desfecho = 'falha' then
      v_falhas := v_falhas + 1;

      perform public.emitir_alerta(
        p_company_id    => coalesce(v_e.company_id, v_e.tarefa_company, public.empresa_principal()),
        p_severidade    => 'high'::alert_severity,
        p_titulo        => 'Rotina do sistema falhou: ' || v_e.titulo,
        p_o_que         => format('A rotina "%s" rodou e nao concluiu. Ela responde: %s. Os dados que ela alimenta ficam parados ate a proxima rodada dar certo.',
                                  v_e.titulo, v_e.pergunta),
        p_onde          => 'Rotina interna do sistema (' || v_e.tarefa || ')',
        p_quanto        => coalesce(v_erro, 'sem detalhe'),
        p_acao          => 'Abrir a tela Tarefas agendadas e reexecutar. Se repetir, a falha esta na funcao ' || coalesce(v_e.edge, 'chamada') || '.',
        p_janela        => 'rodada de ' || to_char(v_e.iniciado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        p_tarefa        => v_e.tarefa,
        p_linha_produto => 'Infraestrutura do sistema',
        p_chave_dedupe  => 'tarefa_erro:' || v_e.tarefa);
    else
      -- Rodada boa apaga o alerta de erro da mesma tarefa: painel sem alerta morto.
      update public.alerts set resolved = true
       where resolved = false
         and chave_dedupe in ('tarefa_erro:' || v_e.tarefa, 'tarefa_sem_chave:' || v_e.tarefa);
    end if;
  end loop;

  return jsonb_build_object(
    'verificado_em', now(),
    'fechados', v_fechados,
    'falhas', v_falhas,
    'ainda_em_curso', v_pendentes);
end
$function$;

comment on function public.conferir_execucoes_http() is
  'Le a resposta real de cada chamada enfileirada (net._http_response por request_id) e so ai fecha a rodada. Trata 200-com-ok:false como falha e timeout-que-gravou como sucesso com ressalva.';

-- ============================================================================
-- 5) VIGIA DE ATRASO — a ausencia deixa de ser silencio
-- ============================================================================
-- Substitui check_data_freshness, que tinha tres defeitos: olhava UMA empresa (name ilike
-- '%legal%', deixando COHAPM/La Felicita/VISTTA sem vigilancia), mandava o gestor "conferir
-- net._http_response", e citava windsor-sync, uma edge descontinuada.

create or replace function public.vigiar_tarefas_agendadas()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_ultimo_ok timestamptz;
  v_ultima record;
  v_horas numeric;
  v_sev alert_severity;
  v_atrasadas int := 0;
  v_alertas int := 0;
  v_ok int := 0;
  v_company uuid;
  v_periodo text;
begin
  for v_t in select * from public.tarefas_agendadas where ativa order by tarefa loop
    v_company := coalesce(v_t.company_id, public.empresa_principal());

    v_periodo := case v_t.periodicidade
                   when 'frequente' then 'a cada poucos minutos'
                   when 'horaria'   then 'de hora em hora'
                   when 'diaria'    then 'uma vez por dia'
                   when 'semanal'   then 'uma vez por semana'
                 end;

    select max(e.iniciado_em) into v_ultimo_ok
      from public.execucoes_agendadas e
     where e.tarefa = v_t.tarefa
       and e.desfecho in ('sucesso', 'sucesso_vazio');

    select e.desfecho, e.iniciado_em, e.mensagem_erro into v_ultima
      from public.execucoes_agendadas e
     where e.tarefa = v_t.tarefa
     order by e.iniciado_em desc
     limit 1;

    -- Tarefa recem-cadastrada tem direito a uma janela antes de ser cobrada.
    if v_ultimo_ok is null and v_t.criado_em > now() - (v_t.tolerancia_horas * interval '1 hour') then
      v_ok := v_ok + 1;
      continue;
    end if;

    v_horas := case when v_ultimo_ok is null
                    then extract(epoch from (now() - v_t.criado_em)) / 3600.0
                    else extract(epoch from (now() - v_ultimo_ok)) / 3600.0 end;

    if v_horas <= v_t.tolerancia_horas then
      v_ok := v_ok + 1;
      update public.alerts set resolved = true
       where resolved = false and chave_dedupe = 'tarefa_parada:' || v_t.tarefa;
      continue;
    end if;

    -- Quanto mais janelas de tolerancia vencidas, mais grave. Escala pequena e previsivel.
    v_sev := case
               when v_horas >= v_t.tolerancia_horas * 4 then 'critical'::alert_severity
               when v_horas >= v_t.tolerancia_horas * 2 then 'high'::alert_severity
               else 'medium'::alert_severity
             end;

    v_atrasadas := v_atrasadas + 1;

    perform public.emitir_alerta(
      p_company_id    => v_company,
      p_severidade    => v_sev,
      p_titulo        => 'Rotina do sistema parada: ' || v_t.titulo,
      p_o_que         => format('A rotina "%s" deveria rodar %s e nao conclui uma rodada ha %s. Ela responde: %s. Enquanto estiver parada, essa resposta esta velha e nao se deve confiar nela.',
                                v_t.titulo, v_periodo,
                                case when v_horas < 48 then round(v_horas)::text || ' horas'
                                     else round(v_horas / 24)::text || ' dias' end,
                                v_t.pergunta),
      p_onde          => 'Rotina interna do sistema (' || v_t.tarefa || ')',
      p_quanto        => case when v_ultimo_ok is null
                              then 'nenhuma rodada bem-sucedida desde o cadastro'
                              else 'ultima rodada boa em ' || to_char(v_ultimo_ok at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                                   || ' (tolerancia: ' || v_t.tolerancia_horas || 'h)' end
                         || case when v_ultima.desfecho = 'falha' and v_ultima.mensagem_erro is not null
                                 then '. Ultima tentativa falhou: ' || left(v_ultima.mensagem_erro, 250)
                                 else '' end,
      p_acao          => 'Abrir a tela Tarefas agendadas e reexecutar esta rotina. Se ela voltar a falhar, o problema esta na rotina, nao no agendamento.',
      p_janela        => 'esperado ' || v_periodo || ', tolerancia de ' || v_t.tolerancia_horas || 'h',
      p_tarefa        => v_t.tarefa,
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'tarefa_parada:' || v_t.tarefa,
      p_valor         => round(v_horas, 1));

    v_alertas := v_alertas + 1;
  end loop;

  -- Retencao: a trilha serve para denunciar o presente, nao para virar arquivo morto.
  delete from public.execucoes_agendadas where iniciado_em < now() - interval '90 days';

  return jsonb_build_object(
    'verificado_em', now(),
    'tarefas_em_dia', v_ok,
    'tarefas_atrasadas', v_atrasadas,
    'alertas_emitidos', v_alertas);
end
$function$;

comment on function public.vigiar_tarefas_agendadas() is
  'Compara cada tarefa do catalogo com sua ultima rodada boa e transforma atraso em alerta legivel. Substitui check_data_freshness, que vigiava so uma empresa e mandava o gestor ler net._http_response.';

-- ============================================================================
-- 6) PAINEL PARA A TELA
-- ============================================================================
-- SECURITY DEFINER porque as tabelas nao tem policy (uso interno). Concedida a authenticated:
-- e telemetria de rotina, nao dado de cliente, e o gestor precisa ver sem depender de admin.

create or replace function public.painel_tarefas_agendadas()
returns table (
  tarefa            text,
  titulo            text,
  pergunta          text,
  periodicidade     text,
  tolerancia_horas  integer,
  tipo              text,
  empresa           text,
  ultima_em         timestamptz,
  desfecho          text,
  duracao_ms        integer,
  itens_processados integer,
  achados           integer,
  mensagem_erro     text,
  horas_desde_ok    numeric,
  atrasada          boolean,
  rodadas_7d        integer,
  falhas_7d         integer,
  agendada_no_cron  boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.tarefa,
         t.titulo,
         t.pergunta,
         t.periodicidade,
         t.tolerancia_horas,
         t.tipo,
         co.name as empresa,
         u.iniciado_em as ultima_em,
         u.desfecho,
         u.duracao_ms,
         u.itens_processados,
         u.achados,
         u.mensagem_erro,
         round(extract(epoch from (now() - ok.ultimo_ok)) / 3600.0, 1) as horas_desde_ok,
         (ok.ultimo_ok is null or ok.ultimo_ok < now() - (t.tolerancia_horas * interval '1 hour')) as atrasada,
         coalesce(j.rodadas_7d, 0)::integer as rodadas_7d,
         coalesce(j.falhas_7d, 0)::integer as falhas_7d,
         exists (select 1 from cron.job c
                  where c.active and c.command like '%' || t.tarefa || '%') as agendada_no_cron
    from public.tarefas_agendadas t
    left join public.companies co on co.id = t.company_id
    left join lateral (
      select e.iniciado_em, e.desfecho, e.duracao_ms, e.itens_processados, e.achados, e.mensagem_erro
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa
       order by e.iniciado_em desc
       limit 1
    ) u on true
    left join lateral (
      select max(e.iniciado_em) as ultimo_ok
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa and e.desfecho in ('sucesso','sucesso_vazio')
    ) ok on true
    left join lateral (
      select count(*)::int as rodadas_7d,
             count(*) filter (where e.desfecho = 'falha')::int as falhas_7d
        from public.execucoes_agendadas e
       where e.tarefa = t.tarefa and e.iniciado_em > now() - interval '7 days'
    ) j on true
   where t.ativa
   order by
     (ok.ultimo_ok is null or ok.ultimo_ok < now() - (t.tolerancia_horas * interval '1 hour')) desc,
     u.desfecho = 'falha' desc nulls last,
     t.titulo
$function$;

comment on function public.painel_tarefas_agendadas() is
  'Saude das tarefas agendadas para a tela: ultima rodada, desfecho, duracao, achados, atraso e se o agendamento existe de fato no cron.job.';

-- Reexecutar da tela: o gestor consegue agir sem abrir o banco.
create or replace function public.reexecutar_tarefa(p_tarefa text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_t record;
begin
  if not has_role((select auth.uid()), 'admin'::app_role) then
    raise exception 'apenas admin pode reexecutar tarefa agendada';
  end if;

  select * into v_t from public.tarefas_agendadas where tarefa = p_tarefa and ativa;
  if v_t.tarefa is null then
    raise exception 'tarefa desconhecida ou inativa: %', p_tarefa;
  end if;

  if v_t.tipo = 'sql' then
    return public.rodar_tarefa_sql(p_tarefa, 'manual', true);
  else
    return public.disparar_tarefa_http(p_tarefa, 'manual', true);
  end if;
end
$function$;

comment on function public.reexecutar_tarefa(text) is
  'Reexecucao manual de uma tarefa agendada pela tela, restrita a admin. Sempre roda (ignora a trava de periodo) porque o objetivo e justamente reagir a uma rodada ruim.';

-- ============================================================================
-- 7) CATALOGO
-- ============================================================================
-- Toda tarefa declara a PERGUNTA que responde. Tarefa sem pergunta nao entra: o pedido foi
-- menos tarefas que funcionam, nao catalogo grande e inerte.

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, funcao_sql, arg_sql,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo) values

  ('alertas-de-midia', 'Alertas de midia',
   'Alguma campanha ativa estourou custo, orcamento, frequencia ou parou de entregar?',
   'sql', 'evaluate_alerts', null, 'diaria', 30, 'alerts', 'created_at'),

  ('criativos-vencedores', 'Criativos vencedores',
   'Quais criativos merecem escala pelo desempenho recente?',
   'sql', 'evaluate_winners', null, 'diaria', 30, null, null),

  ('snapshot-config-campanhas', 'Foto diaria da configuracao das campanhas',
   'A configuracao de alguma campanha mudou de um dia para o outro?',
   'sql', 'snapshot_campaign_config', null, 'diaria', 30, 'campaign_config_snapshots', 'snapshot_date'),

  ('relatorio-diario-no-chat', 'Relatorio diario no chat',
   'Qual foi o resultado de ontem, por campanha?',
   'sql', 'post_daily_report', null, 'diaria', 30, 'chat_messages', 'created_at'),

  ('expirar-aprovacoes', 'Expirar aprovacoes vencidas',
   'Ha card esperando decisao ha mais de 24h?',
   'sql', 'expire_stale_approvals', null, 'horaria', 3, 'approval_requests', 'reviewed_at'),

  ('expirar-jobs-de-chat', 'Expirar jobs de chat travados',
   'Algum job de analise morreu sem concluir?',
   'sql', 'expire_stale_chat_jobs', null, 'horaria', 3, 'chat_jobs', 'finished_at'),

  ('sinais-de-recomendacao-diario', 'Sinais diarios de recomendacao',
   'O desempenho de ontem sugere alguma acao?',
   'sql', 'detectar_sinais_recomendacao', 'diario', 'diaria', 30, 'recommendation_candidates', 'created_at'),

  ('sinais-de-recomendacao-semanal', 'Sinais semanais de recomendacao',
   'O que mudou na comparacao de uma semana para a outra?',
   'sql', 'detectar_sinais_recomendacao', 'semanal', 'semanal', 192, 'recommendation_candidates', 'created_at'),

  ('validade-do-conhecimento', 'Validade da base de conhecimento',
   'Algum tema tecnico passou do prazo de revalidacao?',
   'sql', 'check_conhecimento_validade', null, 'semanal', 192, 'alerts', 'created_at'),

  ('qualidade-numeros-whatsapp', 'Qualidade dos numeros de WhatsApp',
   'Algum numero piorou de tier e corre risco de restricao de envio?',
   'sql', 'evaluate_waba_tier_alerts', null, 'diaria', 30, 'alerts', 'created_at'),

  ('vigia-das-tarefas', 'Vigia das tarefas agendadas',
   'Alguma rotina do sistema parou de rodar sem ninguem perceber?',
   'sql', 'vigiar_tarefas_agendadas', null, 'horaria', 3, null, null),

  ('conferir-chamadas-http', 'Conferencia das chamadas as edges',
   'As chamadas enfileiradas realmente chegaram e responderam?',
   'sql', 'conferir_execucoes_http', null, 'frequente', 1, null, null)

on conflict (tarefa) do update set
  titulo = excluded.titulo, pergunta = excluded.pergunta, tipo = excluded.tipo,
  funcao_sql = excluded.funcao_sql, arg_sql = excluded.arg_sql,
  periodicidade = excluded.periodicidade, tolerancia_horas = excluded.tolerancia_horas,
  tabela_destino = excluded.tabela_destino, coluna_carimbo = excluded.coluna_carimbo;

-- Tarefas HTTP. tabela_destino fica nula onde a rodada em regime normal legitimamente nao cria
-- linha (espelho de estrutura so faz upsert): nesses casos o veredito vem do corpo da resposta.
insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms, janela_dias,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo, company_id) values

  ('monitor-contas-meta', 'Monitor das contas de anuncio',
   'Alguma conta de anuncio esta bloqueada, com cobranca pendente ou com anuncio reprovado?',
   'http', 'bm-monitor', 'cron:bm-monitor-0920', 'x-mcp-key', '{}'::jsonb, 90000, null,
   'diaria', 30, 'alerts', 'created_at', null),

  ('saude-dos-tokens-meta', 'Saude dos tokens da Meta',
   'Algum token vai expirar, perdeu escopo ou ja esta invalido?',
   'http', 'meta-token-monitor', 'cron:meta-token-monitor', 'x-mcp-key', '{}'::jsonb, 90000, null,
   'diaria', 30, 'meta_tokens', 'verificado_em', null),

  ('espelho-meta-diario', 'Espelho diario da Meta',
   'O que esta no ar agora, com que status e que configuracao?',
   'http', 'meta-campaign-status', 'cron:meta-campaign-status-0910', 'x-mcp-key', '{}'::jsonb, 120000, null,
   'diaria', 30, 'ad_status_snapshots', 'snapshot_date', null),

  ('metricas-pipeboard', 'Metricas diarias de midia',
   'Quanto se gastou e o que se obteve, por anuncio e por dia?',
   'http', 'pipeboard-metrics-sync', 'cron:pipeboard-metrics-daily', 'bearer',
   '{"date_from":"@data_inicio","date_to":"@data_fim"}'::jsonb, 150000, 6,
   'diaria', 30, 'ad_metric_snapshots', 'snapshot_date', null),

  ('estrutura-campanhas', 'Espelho da estrutura: campanhas',
   'A lista de campanhas do sistema confere com a da Meta?',
   'http', 'pipeboard-structure-sync', 'cron:pipeboard-structure-campaigns-0912', 'bearer',
   '{"level":"campaigns"}'::jsonb, 150000, null, 'diaria', 30, null, null, null),

  ('estrutura-conjuntos', 'Espelho da estrutura: conjuntos',
   'A lista de conjuntos do sistema confere com a da Meta?',
   'http', 'pipeboard-structure-sync', 'cron:pipeboard-structure-adsets-0917', 'bearer',
   '{"level":"adsets"}'::jsonb, 150000, null, 'diaria', 30, null, null, null),

  ('estrutura-anuncios', 'Espelho da estrutura: anuncios',
   'A lista de anuncios do sistema confere com a da Meta?',
   'http', 'pipeboard-structure-sync', 'cron:pipeboard-structure-ads-0922', 'bearer',
   '{"level":"ads"}'::jsonb, 150000, null, 'diaria', 30, null, null, null),

  ('recomendacoes-da-ia', 'Recomendacoes da IA',
   'Os sinais detectados viraram recomendacao escrita para o gestor ler?',
   'http', 'traffic-reco-job', 'cron:traffic-reco-job', 'x-mcp-key',
   '{"modo":"diario"}'::jsonb, 120000, null, 'diaria', 30, 'ai_recommendations', 'created_at', null),

  ('sincronizar-whatsapp', 'Sincronizar WhatsApp',
   'Qual o estado dos numeros, templates e volumes do WhatsApp?',
   'http', 'waba-sync', 'cron:waba-sync-daily', 'bearer', '{}'::jsonb, 120000, null,
   'diaria', 30, 'waba_phone_snapshots', 'snapshot_date', null),

  ('digest-por-email', 'Digest por e-mail',
   'O resumo do dia saiu por e-mail para quem precisa ler?',
   'http', 'enviar-digest', null, 'bearer', '{"modo":"digest"}'::jsonb, 60000, null,
   'horaria', 3, 'digest_entregas', 'criado_em', null),

  ('drenar-alertas-criticos', 'Drenar alertas criticos por e-mail',
   'Os alertas criticos abertos foram avisados por e-mail?',
   'http', 'enviar-digest', null, 'bearer', '{"modo":"drenar_alertas"}'::jsonb, 60000, null,
   'frequente', 1, null, null, null),

  ('varredura-drive-legal', 'Varredura do Drive: Legal e Viver',
   'Chegou peca nova no Drive da Legal e Viver que ainda nao foi analisada?',
   'http', 'traffic-agent-job', 'cron:drive-watch-0845', 'x-mcp-key',
   '{"modo":"drive_watch","company_id":"@company_id"}'::jsonb, 150000, null,
   'diaria', 30, 'drive_midia_analises', 'analisado_em',
   (select id from public.companies where name like 'Legal%Viver' order by created_at limit 1)),

  ('varredura-drive-cohapm', 'Varredura do Drive: COHAPM',
   'Chegou peca nova no Drive da COHAPM que ainda nao foi analisada?',
   'http', 'traffic-agent-job', 'cron:drive-watch-cohapm-0846', 'x-mcp-key',
   '{"modo":"drive_watch","company_id":"@company_id"}'::jsonb, 150000, null,
   'diaria', 30, 'drive_midia_analises', 'analisado_em',
   (select id from public.companies where name = 'COHAPM' order by created_at limit 1)),

  ('transcrever-audios-drive', 'Transcrever audios do Drive',
   'Os audios novos do Drive foram transcritos?',
   'http', 'drive-audio-transcribe', 'cron:drive-watch-0845', 'x-mcp-key', '{}'::jsonb, 150000, null,
   'diaria', 30, 'drive_midia_analises', 'transcricao_em', null),

  ('escoar-imagens-legal', 'Escoar imagens: Legal e Viver',
   'As imagens liberadas subiram para a biblioteca da Meta?',
   'http', 'upload-midia', 'cron:escoar-imagens-hora', 'x-mcp-key',
   '{"acao":"escoar_imagens","company":"Legal é Viver","account_id":"act_3302001729967572"}'::jsonb, 150000, null,
   'horaria', 4, 'media_uploads', 'enviado_em',
   (select id from public.companies where name like 'Legal%Viver' order by created_at limit 1)),

  ('escoar-videos-legal', 'Escoar videos: Legal e Viver',
   'Os videos liberados subiram para a biblioteca da Meta?',
   'http', 'upload-midia', 'cron:escoar-videos-hora', 'x-mcp-key',
   '{"acao":"escoar_videos","company":"Legal é Viver","account_id":"act_3302001729967572"}'::jsonb, 150000, null,
   'horaria', 4, 'media_uploads', 'enviado_em',
   (select id from public.companies where name like 'Legal%Viver' order by created_at limit 1)),

  ('escoar-imagens-cohapm', 'Escoar imagens: COHAPM',
   'As imagens liberadas da COHAPM subiram para a biblioteca da Meta?',
   'http', 'upload-midia', 'cron:escoar-imagens-cohapm-hora', 'x-mcp-key',
   '{"acao":"escoar_imagens","company":"COHAPM","company_id":"@company_id","account_id":"act_1622612945584817"}'::jsonb, 150000, null,
   'horaria', 4, 'media_uploads', 'enviado_em',
   (select id from public.companies where name = 'COHAPM' order by created_at limit 1)),

  ('escoar-videos-cohapm', 'Escoar videos: COHAPM',
   'Os videos liberados da COHAPM subiram para a biblioteca da Meta?',
   'http', 'upload-midia', 'cron:escoar-videos-cohapm-hora', 'x-mcp-key',
   '{"acao":"escoar_videos","company":"COHAPM","company_id":"@company_id","account_id":"act_1622612945584817"}'::jsonb, 150000, null,
   'horaria', 4, 'media_uploads', 'enviado_em',
   (select id from public.companies where name = 'COHAPM' order by created_at limit 1))

on conflict (tarefa) do update set
  titulo = excluded.titulo, pergunta = excluded.pergunta, tipo = excluded.tipo,
  edge = excluded.edge, chave_chamador = excluded.chave_chamador, modo_auth = excluded.modo_auth,
  corpo = excluded.corpo, timeout_ms = excluded.timeout_ms, janela_dias = excluded.janela_dias,
  periodicidade = excluded.periodicidade, tolerancia_horas = excluded.tolerancia_horas,
  tabela_destino = excluded.tabela_destino, coluna_carimbo = excluded.coluna_carimbo,
  company_id = excluded.company_id;

-- ============================================================================
-- 8) REAGENDAMENTO
-- ============================================================================
-- Mesmos horarios de hoje. O que muda e o CORPO do comando: em vez de disparar direto, chama a
-- funcao que abre o registro. O nome da tarefa aparece no comando de proposito — e assim que
-- painel_tarefas_agendadas confirma que o agendamento existe de fato.

select cron.alter_job((select jobid from cron.job where jobname = 'alerts-eval-daily'),
  command := $cmd$ select public.rodar_tarefa_sql('alertas-de-midia'); select public.rodar_tarefa_sql('criativos-vencedores'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'campaign-config-snapshot-0925'),
  command := $cmd$ select public.rodar_tarefa_sql('snapshot-config-campanhas'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'daily-report-0830'),
  command := $cmd$ select public.rodar_tarefa_sql('relatorio-diario-no-chat'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'expira-aprovacoes-hora'),
  command := $cmd$ select public.rodar_tarefa_sql('expirar-aprovacoes'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'expira-chat-jobs-hora'),
  command := $cmd$ select public.rodar_tarefa_sql('expirar-jobs-de-chat'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'reco-sinais-0925'),
  command := $cmd$ select public.rodar_tarefa_sql('sinais-de-recomendacao-diario'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'reco-sinais-semanal-1000'),
  command := $cmd$ select public.rodar_tarefa_sql('sinais-de-recomendacao-semanal'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'valida-conhecimento-semanal'),
  command := $cmd$ select public.rodar_tarefa_sql('validade-do-conhecimento'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'waba-tier-alerts-0940'),
  command := $cmd$ select public.rodar_tarefa_sql('qualidade-numeros-whatsapp'); $cmd$);

-- O watchdog antigo cede o horario para o vigia novo, que olha TODAS as empresas.
select cron.alter_job((select jobid from cron.job where jobname = 'watchdog-frescor-0945'),
  schedule := '*/20 * * * *',
  command := $cmd$ select public.rodar_tarefa_sql('vigia-das-tarefas'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'bm-monitor-0920'),
  command := $cmd$ select public.disparar_tarefa_http('monitor-contas-meta'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'meta-token-monitor-0915'),
  command := $cmd$ select public.disparar_tarefa_http('saude-dos-tokens-meta'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'meta-campaign-status-0910'),
  command := $cmd$ select public.disparar_tarefa_http('espelho-meta-diario'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'pipeboard-metrics-daily'),
  command := $cmd$ select public.disparar_tarefa_http('metricas-pipeboard'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'pipeboard-structure-campaigns-0912'),
  command := $cmd$ select public.disparar_tarefa_http('estrutura-campanhas'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'pipeboard-structure-adsets-0917'),
  command := $cmd$ select public.disparar_tarefa_http('estrutura-conjuntos'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'pipeboard-structure-ads-0922'),
  command := $cmd$ select public.disparar_tarefa_http('estrutura-anuncios'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'traffic-reco-job-0935'),
  command := $cmd$ select public.disparar_tarefa_http('recomendacoes-da-ia'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'waba-sync-daily'),
  command := $cmd$ select public.disparar_tarefa_http('sincronizar-whatsapp'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'digest-email-horario'),
  command := $cmd$ select public.disparar_tarefa_http('digest-por-email'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'digest-drenar-alertas'),
  command := $cmd$ select public.disparar_tarefa_http('drenar-alertas-criticos'); $cmd$);

-- drive-watch-0845 fazia DOIS posts no mesmo comando; viram duas tarefas com registro proprio,
-- porque a varredura pode dar certo e a transcricao falhar (e vice-versa).
select cron.alter_job((select jobid from cron.job where jobname = 'drive-watch-0845'),
  command := $cmd$ select public.disparar_tarefa_http('varredura-drive-legal'); select public.disparar_tarefa_http('transcrever-audios-drive'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'drive-watch-cohapm-0846'),
  command := $cmd$ select public.disparar_tarefa_http('varredura-drive-cohapm'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'escoar-imagens-hora'),
  command := $cmd$ select public.disparar_tarefa_http('escoar-imagens-legal'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'escoar-videos-hora'),
  command := $cmd$ select public.disparar_tarefa_http('escoar-videos-legal'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'escoar-imagens-cohapm-hora'),
  command := $cmd$ select public.disparar_tarefa_http('escoar-imagens-cohapm'); $cmd$);

select cron.alter_job((select jobid from cron.job where jobname = 'escoar-videos-cohapm-hora'),
  command := $cmd$ select public.disparar_tarefa_http('escoar-videos-cohapm'); $cmd$);

-- Conferente das chamadas HTTP: e ele que transforma "enfileirado" em veredito.
select cron.schedule('conferir-chamadas-http', '*/2 * * * *',
  $cmd$ select public.rodar_tarefa_sql('conferir-chamadas-http'); $cmd$);

-- Aposenta as crons da edge descontinuada.
select cron.unschedule('windsor-sync-daily');
select cron.unschedule('windsor-wide-ads-weekly');
select cron.unschedule('windsor-wide-adsets-weekly');

-- ============================================================================
-- 9) PERMISSOES
-- ============================================================================

revoke all on function public.rodar_tarefa_sql(text, text, boolean) from anon, authenticated;
revoke all on function public.disparar_tarefa_http(text, text, boolean) from anon, authenticated;
revoke all on function public.conferir_execucoes_http() from anon, authenticated;
revoke all on function public.vigiar_tarefas_agendadas() from anon, authenticated;
revoke all on function public.empresa_principal() from anon, authenticated;

revoke all on function public.painel_tarefas_agendadas() from anon;
grant execute on function public.painel_tarefas_agendadas() to authenticated;

revoke all on function public.reexecutar_tarefa(text) from anon;
grant execute on function public.reexecutar_tarefa(text) to authenticated;
