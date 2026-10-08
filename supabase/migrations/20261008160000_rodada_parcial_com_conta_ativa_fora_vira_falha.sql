-- RODADA PARCIAL COM CONTA ATIVA DE FORA VIRA FALHA (08/10/2026)
--
-- O DEFEITO: estrutura-anuncios respondia 200 com ok:true, truncado=true e as contas da
-- COHAPM "pulado_por_prazo". conferir_execucoes_http so olhava status e ok, gravava
-- "sucesso" e resolvia o alerta da rotina. De 06 a 08/10 a COHAPM ficou sem anuncio novo
-- no espelho (e o gasto fora do rollup de campanha) com o painel todo verde.
--
-- O CONSERTO:
--   1. A edge pipeboard-structure-sync (nivel ads) passa a devolver contas_ativas_fora:
--      contas com campanha ACTIVE que sairam pulado_por_prazo ou com error. Conta parada
--      pulada nao entra: nao ha anuncio vivo a perder.
--   2. Aqui: corpo com contas_ativas_fora nao vazio fecha a rodada como 'falha' com
--      detalhe.parcial=true (o check de desfecho nao tem 'parcial'; criar um desfecho novo
--      mexeria em painel, vigia de atraso e vigia de frescor). A mensagem diz "parcial".
--   3. Um alerta por conta via emitir_alerta, chave 'conta_fora_do_sync:<tarefa>:<conta>',
--      na empresa dona da conta. A conta que volta a sincronizar tem o alerta resolvido.
--      Quando a unica falha e a conta de fora, o alerta generico tarefa_erro nao e emitido
--      (a chamada em si funcionou; o alerta por conta diz exatamente o que faltou).
--   4. O corpo deixa de ser cortado em 4000 caracteres antes do parse: com 17 contas e o
--      bloco de miniaturas a resposta passa disso, o JSON cortado nao parseava e qualquer
--      ok:false no corpo tambem passava batido.

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
  v_ressalva  text;
  v_achou     boolean;
  v_fora      jsonb;
  v_parcial   boolean;
  v_conta     jsonb;
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
    v_itens := null; v_achados := null; v_chegou_em := null; v_ressalva := null;
    v_cresceu := null; v_fora := null; v_parcial := false;

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
    select r.status_code, r.timed_out, r.error_msg, r.content, r.created, true
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
      if jsonb_typeof(v_corpo) = 'object' and jsonb_typeof(v_corpo->'contas_ativas_fora') = 'array' then
        v_fora := v_corpo->'contas_ativas_fora';
      end if;
    exception when others then
      v_corpo := null;
    end;

    v_cresceu := public.contar_destino(v_e.tabela_destino, v_e.coluna_carimbo,
                                       (v_e.detalhe->>'frescor_desde')::timestamptz, v_e.company_id);

    if v_status between 200 and 299 and v_ok_corpo then
      v_desfecho := 'sucesso';
    elsif v_cresceu is not null
          and v_cresceu > coalesce(nullif(v_e.detalhe->>'base_destino','')::bigint, 0) then
      -- HTTP sujo (timeout, 502, ok:false) mas o destino cresceu: a coleta fez o trabalho.
      v_desfecho := 'sucesso';
      v_ressalva := 'a edge gravou no destino embora a chamada HTTP nao tenha fechado limpa';
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

    -- Conta com campanha ativa que ficou sem sincronizar: a rodada nao fez o trabalho todo.
    if jsonb_array_length(coalesce(v_fora, '[]'::jsonb)) > 0 then
      if v_desfecho = 'sucesso' then
        v_desfecho := 'falha';
        v_parcial  := true;
      end if;
      v_erro := concat_ws(' | ', v_erro,
        format('rodada parcial: %s conta(s) com campanha ativa ficaram sem sincronizar (%s)',
               jsonb_array_length(v_fora),
               (select string_agg((c->>'account_id') || ' ' || coalesce(c->>'motivo', '?'), ', ')
                  from jsonb_array_elements(v_fora) c)));
    end if;

    perform public.fechar_execucao(v_e.id, v_desfecho, v_itens, v_achados, v_erro,
      jsonb_strip_nulls(jsonb_build_object(
        'status_http', v_status,
        'timed_out', v_timeout,
        'resposta_em', v_chegou_em,
        'ressalva', v_ressalva,
        'parcial', case when v_parcial then true end,
        'contas_ativas_fora', case when jsonb_array_length(coalesce(v_fora, '[]'::jsonb)) > 0 then v_fora end)),
      v_chegou_em);

    v_fechados := v_fechados + 1;

    if v_desfecho = 'falha' then
      v_falhas := v_falhas + 1;
    end if;

    if v_desfecho = 'falha' and not v_parcial then
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

    -- Um alerta por conta de fora, na empresa dona da conta.
    for v_conta in select c from jsonb_array_elements(coalesce(v_fora, '[]'::jsonb)) c loop
      perform public.emitir_alerta(
        p_company_id    => coalesce(nullif(v_conta->>'company_id','')::uuid, v_e.company_id,
                                    v_e.tarefa_company, public.empresa_principal()),
        p_severidade    => 'high'::alert_severity,
        p_titulo        => 'Conta de anuncio com campanha ativa ficou fora da sincronizacao: ' || (v_conta->>'account_id'),
        p_o_que         => format('A rotina "%s" rodou mas nao sincronizou a conta %s, que tem campanha ativa (%s). Anuncio novo dessa conta nao chega ao espelho e o gasto dela pode ficar fora do relatorio de campanha.',
                                  v_e.titulo, v_conta->>'account_id',
                                  case v_conta->>'motivo'
                                    when 'pulado_por_prazo' then 'acabou o prazo da rodada antes de chegar nela'
                                    when 'erro' then 'deu erro: ' || left(coalesce(v_conta->>'erro', 'sem detalhe'), 200)
                                    else coalesce(v_conta->>'motivo', 'motivo nao informado') end),
        p_onde          => 'Conta Meta ' || (v_conta->>'account_id') || ' (rotina ' || v_e.tarefa || ')',
        p_quanto        => coalesce(v_erro, 'sem detalhe'),
        p_acao          => 'Reexecutar a rotina na tela Tarefas agendadas. Se a mesma conta voltar a ficar de fora, o prazo da funcao ' || coalesce(v_e.edge, 'chamada') || ' nao comporta todas as contas ativas.',
        p_janela        => 'rodada de ' || to_char(v_e.iniciado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
        p_tarefa        => v_e.tarefa,
        p_linha_produto => 'Infraestrutura do sistema',
        p_chave_dedupe  => 'conta_fora_do_sync:' || v_e.tarefa || ':' || (v_conta->>'account_id'));
    end loop;

    -- A edge reportou a lista: conta que nao esta nela sincronizou e tem o alerta resolvido.
    if v_fora is not null then
      update public.alerts a set resolved = true
       where a.resolved = false
         and a.chave_dedupe like 'conta_fora_do_sync:' || v_e.tarefa || ':%'
         and not exists (
           select 1 from jsonb_array_elements(v_fora) c
            where a.chave_dedupe = 'conta_fora_do_sync:' || v_e.tarefa || ':' || (c->>'account_id'));
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
  'Fecha rodadas HTTP em_curso lendo net._http_response. 2xx com ok:true e sucesso, salvo quando o corpo traz contas_ativas_fora: ai e falha parcial e sai um alerta por conta (conta_fora_do_sync:<tarefa>:<conta>). Timeout, 502 ou ok:false viram sucesso com ressalva quando a tabela de destino cresceu; senao, falha.';

revoke all on function public.conferir_execucoes_http() from public, anon, authenticated;
grant execute on function public.conferir_execucoes_http() to service_role;
