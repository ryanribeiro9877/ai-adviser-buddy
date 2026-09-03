-- A duracao das tarefas HTTP passa a medir a chamada, nao o atraso da conferencia.
--
-- Sintoma: a tela dizia "levou 300s" para tarefas que respondem em poucos segundos. As
-- quatro rodadas de 'drenar-alertas-criticos' gravaram duracao_ms = 300002/300003 com
-- status_http 200 e timed_out = false -- ou seja, respostas boas.
--
-- Causa: `fechar_execucao` calculava a duracao como now() - iniciado_em, e quem fecha
-- tarefa HTTP e a conferencia, que roda de 5 em 5 minutos. O numero media
-- "disparo -> a conferencia percebeu", que e um artefato do intervalo do cron e nao diz
-- nada sobre a tarefa. Pior: 300s parece problema de desempenho onde nao ha nenhum, o
-- que e exatamente o tipo de numero ilegivel que esta entrega existe para eliminar.
--
-- Conserto: `net._http_response.created` guarda quando a resposta chegou. A conferencia
-- passa esse instante como p_fim e a duracao vira "disparo -> resposta recebida", que e a
-- latencia real. Tarefa SQL nao passa p_fim e segue medindo com now(), que ali e correto
-- porque quem fecha e a propria rodada.
--
-- A versao de 6 argumentos e derrubada em vez de conviver com a nova: duas assinaturas
-- que so diferem por um argumento com default e um convite a chamada ambigua. Todos os
-- chamadores passam 6 argumentos ou menos, entao o default cobre todos sem tocar em nada.

drop function if exists public.fechar_execucao(uuid, text, integer, integer, text, jsonb);

create or replace function public.fechar_execucao(
  p_execucao uuid,
  p_desfecho text,
  p_itens    integer     default null,
  p_achados  integer     default null,
  p_erro     text        default null,
  p_detalhe  jsonb       default null,
  p_fim      timestamptz default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e        record;
  v_t        record;
  v_itens    integer;
  v_achados  integer;
  v_alertas  integer;
  v_delta    integer;
  v_desfecho text := p_desfecho;
  v_agora    timestamptz := coalesce(p_fim, now());
  v_depois   bigint;
  v_base     bigint;
begin
  select * into v_e from public.execucoes_agendadas where id = p_execucao;
  if v_e.id is null then
    return;
  end if;

  select * into v_t from public.tarefas_agendadas where tarefa = v_e.tarefa;

  v_base   := nullif(v_e.detalhe->>'base_destino', '')::bigint;
  v_depois := public.contar_destino(
    v_t.tabela_destino, v_t.coluna_carimbo,
    (v_e.detalhe->>'frescor_desde')::timestamptz, v_e.company_id);

  v_delta := case when v_depois is not null and v_base is not null
                  then greatest(0, (v_depois - v_base))::integer end;

  v_itens := greatest(coalesce(p_itens, 0), coalesce(v_delta, 0));

  select count(*)::integer into v_alertas
    from public.alerts a
   where a.tarefa = v_e.tarefa
     and a.created_at >= v_e.iniciado_em;

  v_achados := greatest(coalesce(p_achados, 0), coalesce(v_alertas, 0));

  if v_desfecho = 'sucesso' and v_itens = 0 and v_achados = 0 then
    v_desfecho := 'sucesso_vazio';
  end if;

  update public.execucoes_agendadas
     set desfecho          = v_desfecho,
         finalizado_em     = v_agora,
         duracao_ms        = greatest(0, (extract(epoch from (v_agora - iniciado_em)) * 1000)::integer),
         itens_processados = v_itens,
         achados           = v_achados,
         mensagem_erro     = p_erro,
         detalhe           = detalhe
                             || coalesce(p_detalhe, '{}'::jsonb)
                             || jsonb_build_object(
                                  'destino_depois', v_depois,
                                  'delta_destino',  v_delta)
   where id = p_execucao;
end
$function$;

revoke all on function public.fechar_execucao(uuid, text, integer, integer, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fechar_execucao(uuid, text, integer, integer, text, jsonb, timestamptz)
  to service_role;

-- A conferencia passa a ler `created` junto do resto e a repassa como fim da execucao.
create or replace function public.conferir_execucoes_http()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e         record;
  v_status    int;
  v_timeout   boolean;
  v_errmsg    text;
  v_conteudo  text;
  v_chegou_em timestamptz;
  v_corpo     jsonb;
  v_ok_corpo  boolean;
  v_itens     integer;
  v_achados   integer;
  v_cresceu   bigint;
  v_fechados  int := 0;
  v_falhas    int := 0;
  v_pendentes int := 0;
  v_desfecho  text;
  v_erro      text;
  v_achou     boolean;
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
    v_itens := null; v_achados := null; v_chegou_em := null;

    if (v_e.detalhe->>'request_id') is null then
      if v_e.iniciado_em < now() - interval '15 minutes' then
        perform public.fechar_execucao(v_e.id, 'falha', 0, 0,
          'a chamada nao chegou a ser enfileirada pelo banco', '{}'::jsonb);
        v_falhas := v_falhas + 1; v_fechados := v_fechados + 1;
      else
        v_pendentes := v_pendentes + 1;
      end if;
      continue;
    end if;

    v_achou := false;
    select r.status_code, r.timed_out, r.error_msg, left(r.content, 4000), r.created, true
      into v_status, v_timeout, v_errmsg, v_conteudo, v_chegou_em, v_achou
      from net._http_response r
     where r.id = (v_e.detalhe->>'request_id')::bigint;

    if not coalesce(v_achou, false) then
      if v_e.iniciado_em < now() - ((coalesce(v_e.timeout_ms, 120000) + 120000) * interval '1 millisecond') then
        v_cresceu := public.contar_destino(v_e.tabela_destino, v_e.coluna_carimbo,
                                           (v_e.detalhe->>'frescor_desde')::timestamptz, v_e.company_id);
        if v_cresceu is not null and v_cresceu > coalesce(nullif(v_e.detalhe->>'base_destino','')::bigint, 0) then
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

    begin
      v_corpo := nullif(btrim(coalesce(v_conteudo, '')), '')::jsonb;
      if v_corpo is not null and jsonb_typeof(v_corpo) = 'object'
         and v_corpo ? 'ok' and lower(coalesce(v_corpo->>'ok','')) = 'false' then
        v_ok_corpo := false;
      end if;
      v_itens   := public.itens_no_corpo(v_corpo);
      v_achados := public.achados_no_corpo(v_corpo);
    exception when others then
      v_corpo := null;
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

    perform public.fechar_execucao(v_e.id, v_desfecho, v_itens, v_achados, v_erro,
      jsonb_build_object('status_http', v_status, 'timed_out', v_timeout,
                         'resposta_em', v_chegou_em),
      v_chegou_em);

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

revoke all on function public.conferir_execucoes_http() from public, anon, authenticated;
grant execute on function public.conferir_execucoes_http() to service_role;
