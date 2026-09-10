-- TIMEOUT COM DESTINO CRESCIDO VIRA SUCESSO (10/09/2026)
--
-- O DEFEITO: as rotinas diarias de anuncio, recorte e WhatsApp gravavam no destino
-- e o pg_net marcava timed_out=true depois de 150s (corpo vazio). conferir_execucoes_http
-- ja tratava "sem linha de resposta + destino cresceu" como sucesso com ressalva, mas
-- timed_out=true caia no ramo de falha. O painel mostrava 7/7 falhas mesmo com 113
-- anuncios, 833 recortes e 25 snapshots WABA gravados. Recomendacoes da IA escrevia
-- cards e devolvia 502 (apagao do redator), outro falso alarme.
--
-- O DESENHO original (20260903201000) ja pedia: timeout com destino crescido = sucesso
-- com ressalva. Esta migration restaura isso para timed_out, 502 e 200+ok:false quando
-- a tabela de destino de fato cresceu. Sem isso o gestor persegue problema que nao existe.
--
-- CINTO: timeout_ms do WhatsApp sobe de 120s para 150s, alinhado as outras coletas longas.
-- O conserto real das edges e devolver corpo antes da parede do pg_net (prazo interno).

update public.tarefas_agendadas
   set timeout_ms = 150000
 where tarefa = 'sincronizar-whatsapp'
   and timeout_ms < 150000;

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
    v_cresceu := null;

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

    perform public.fechar_execucao(v_e.id, v_desfecho, v_itens, v_achados, v_erro,
      jsonb_strip_nulls(jsonb_build_object(
        'status_http', v_status,
        'timed_out', v_timeout,
        'resposta_em', v_chegou_em,
        'ressalva', v_ressalva)),
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

comment on function public.conferir_execucoes_http() is
  'Fecha rodadas HTTP em_curso lendo net._http_response. 2xx com ok:true e sucesso. Timeout, 502 ou ok:false viram sucesso com ressalva quando a tabela de destino cresceu; senao, falha.';

revoke all on function public.conferir_execucoes_http() from public, anon, authenticated;
grant execute on function public.conferir_execucoes_http() to service_role;
