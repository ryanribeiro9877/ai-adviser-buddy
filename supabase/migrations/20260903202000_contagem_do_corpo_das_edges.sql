-- ============================================================================
-- Contagem do corpo das edges: fazer a rodada HTTP dizer quanto trabalho fez
-- ============================================================================
-- Por que isto existe:
-- a primeira prova manual de uma tarefa HTTP (saude-dos-tokens-meta) voltou HTTP 200,
-- corpo {"ok":true,...,"empresas":[4 empresas]}, e mesmo assim o registro fechou como
-- 'sucesso_vazio'. O motivo: fechar_execucao rebaixa 'sucesso' para 'sucesso_vazio'
-- quando itens=0 e achados=0, e a conferencia HTTP nao lia contagem nenhuma do corpo
-- da resposta. Ou seja: a edge trabalhou, verificou 4 contas, e o historico dizia que
-- nada aconteceu.
--
-- O rebaixamento em si esta certo e e proposital — separar "rodou e nao achou nada" de
-- "nao rodou" e o pedido central. O que faltava era alimentar o contador com o numero
-- que a propria edge devolve.
--
-- Nao ha padrao unico de resposta entre as ~18 edges deste projeto, entao a extracao e
-- por lista de chaves conhecidas de trabalho, olhando o nivel de cima e um nivel de
-- containers ('resumo', 'resultado', 'totais'). Array conta pelo tamanho, numero conta
-- pelo valor, e vale o maior candidato — nunca a soma, para nao contar duas vezes o
-- mesmo trabalho descrito de duas formas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Extrator de contagem do corpo da resposta
-- ----------------------------------------------------------------------------
create or replace function public.contar_no_corpo(p_corpo jsonb, p_chaves text[])
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_containers text[] := array['resumo', 'resultado', 'totais', 'contagem', 'contagens'];
  v_escopos    jsonb[];
  v_escopo     jsonb;
  v_c          text;
  v_k          text;
  v_v          jsonb;
  v_n          integer := null;
  v_cand       integer;
begin
  if p_corpo is null or jsonb_typeof(p_corpo) <> 'object' then
    return null;
  end if;

  -- nivel de cima mais os containers de resumo, quando existirem
  v_escopos := array[p_corpo];
  foreach v_c in array v_containers loop
    v_v := p_corpo -> v_c;
    if v_v is not null and jsonb_typeof(v_v) = 'object' then
      v_escopos := v_escopos || v_v;
    end if;
  end loop;

  foreach v_escopo in array v_escopos loop
    foreach v_k in array p_chaves loop
      v_v := v_escopo -> v_k;
      if v_v is null then
        continue;
      end if;

      v_cand := case jsonb_typeof(v_v)
                  when 'array'  then jsonb_array_length(v_v)
                  when 'number' then floor((v_v #>> '{}')::numeric)::integer
                  else null
                end;

      if v_cand is not null and (v_n is null or v_cand > v_n) then
        v_n := v_cand;
      end if;
    end loop;
  end loop;

  return v_n;
end
$function$;

comment on function public.contar_no_corpo(jsonb, text[]) is
  'Le uma contagem de trabalho do corpo JSON devolvido por uma edge. Vale o maior candidato entre as chaves informadas; array conta pelo tamanho. Devolve null quando o corpo nao traz nenhuma das chaves.';

-- Atalhos com as listas de chaves ja decididas, para a conferencia nao repetir literal.
-- 'total' e 'totais' ficaram FORA de propósito na lista de itens: em varias edges 'total'
-- e o tamanho da conta inteira, nao o que a rodada processou, e isso inflaria o numero.
create or replace function public.itens_no_corpo(p_corpo jsonb)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select public.contar_no_corpo(p_corpo, array[
    'processados', 'processadas', 'analisados', 'analisadas',
    'verificados', 'verificadas', 'coletados', 'coletadas',
    'itens', 'registros', 'linhas', 'inseridos', 'atualizados', 'upserts',
    'empresas', 'contas', 'resultados',
    'campanhas', 'conjuntos', 'anuncios', 'criativos', 'quantidade'
  ]);
$function$;

create or replace function public.achados_no_corpo(p_corpo jsonb)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select public.contar_no_corpo(p_corpo, array[
    'alertas', 'avisos', 'achados', 'erros', 'falhas', 'problemas',
    'pendencias', 'anomalias', 'divergencias', 'reprovados', 'bloqueios', 'criticos'
  ]);
$function$;

revoke all on function public.contar_no_corpo(jsonb, text[])  from anon, authenticated;
revoke all on function public.itens_no_corpo(jsonb)           from anon, authenticated;
revoke all on function public.achados_no_corpo(jsonb)         from anon, authenticated;
grant execute on function public.contar_no_corpo(jsonb, text[]) to service_role;
grant execute on function public.itens_no_corpo(jsonb)          to service_role;
grant execute on function public.achados_no_corpo(jsonb)        to service_role;

-- ----------------------------------------------------------------------------
-- 2) fechar_execucao: numero informado e piso, nao substituto
-- ----------------------------------------------------------------------------
-- Antes usava coalesce(p_achados, contagem_de_alertas). Problema: varias edges antigas
-- gravam em public.alerts sem preencher a coluna 'tarefa', entao a contagem por tarefa
-- da 0 e o coalesce parava no 0 informado, escondendo achados reais. Agora vale o maior
-- entre o que foi informado e o que de fato apareceu na tabela de alertas.
create or replace function public.fechar_execucao(
  p_execucao uuid,
  p_desfecho text,
  p_itens    integer default null,
  p_achados  integer default null,
  p_erro     text    default null,
  p_detalhe  jsonb   default null)
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
  v_agora    timestamptz := now();
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

  -- crescimento real na tabela de destino: a prova mais forte de trabalho feito
  v_delta := case when v_depois is not null and v_base is not null
                  then greatest(0, (v_depois - v_base))::integer end;

  v_itens := greatest(coalesce(p_itens, 0), coalesce(v_delta, 0));

  select count(*)::integer into v_alertas
    from public.alerts a
   where a.tarefa = v_e.tarefa
     and a.created_at >= v_e.iniciado_em;

  v_achados := greatest(coalesce(p_achados, 0), coalesce(v_alertas, 0));

  -- a regra central do pedido: rodada que nao mexeu em nada nao pode se passar por
  -- rodada produtiva. 'sucesso_vazio' e um desfecho legitimo, distinto de falha e
  -- distinto de ausencia de rodada.
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

-- ----------------------------------------------------------------------------
-- 3) conferir_execucoes_http: passar as contagens do corpo para o fechamento
-- ----------------------------------------------------------------------------
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
    v_itens := null; v_achados := null;

    -- nem chegou a enfileirar: pg_net nao devolveu request_id
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
    select r.status_code, r.timed_out, r.error_msg, left(r.content, 4000), true
      into v_status, v_timeout, v_errmsg, v_conteudo, v_achou
      from net._http_response r
     where r.id = (v_e.detalhe->>'request_id')::bigint;

    -- resposta ainda nao chegou. pg_net guarda resposta por pouco tempo, entao a
    -- ausencia depois do prazo nao prova que a edge falhou: conferir o destino.
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

    -- corpo em JSON: serve para detectar 200-com-falha e para contar o trabalho
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
