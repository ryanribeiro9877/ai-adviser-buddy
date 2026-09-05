-- `check_data_freshness` PERDE EXECUCAO, E O BURACO DE FRESCOR FICA DECLARADO (04/09/2026)
--
-- Terceiro orfao da mesma leva. A pergunta que decidia a acao era: a funcao e orfa, mas a
-- CAPACIDADE que ela oferecia ainda faz falta? Conferi antes de decidir. Faz falta.
-- Por isso ela NAO e dropada — e revogada.
--
-- ==========================================================================================
-- O QUE ELA E, E QUE ELA E ORFA DE VERDADE
-- ==========================================================================================
-- `check_data_freshness()`, sem argumentos, SECURITY DEFINER, escreve em `alerts`. Faz duas
-- coisas distintas:
--
--   METADE 1 — frescor do dado: le `max(snapshot_date)` de `metric_snapshots` e, com 2+ dias
--              de atraso, abre o alerta "Ingestao de metricas atrasada".
--   METADE 2 — chamadas HTTP que nao voltaram 200 em 24h, lidas de `net._http_response`,
--              abrindo "Jobs internos com falha".
--
-- Varredura de chamador nas seis superficies, todas com resultado zero em 04/09/2026: corpo
-- de funcao (`prosrc`), views e matviews, `cron.job.command`, triggers, `pg_depend`, e toda
-- coluna text/varchar/json/jsonb do schema `public` — esta ultima porque `traffic-agent-job`,
-- `traffic-chat` e `mcp-server` despacham RPC por nome vindo de registro, e nome dinamico nao
-- aparece em busca no fonte. Fora do banco: zero em `supabase/functions/` e zero em `src/`.
--
-- ==========================================================================================
-- ERA O CASO 2: NINGUEM VIGIA SE O DADO CHEGOU FRESCO
-- ==========================================================================================
-- A METADE 2 e limpeza pura: `conferir_execucoes_http` faz o mesmo e faz melhor. Ela julga
-- chamada por chamada, com chave de dedupe por tarefa, distingue "nao foi enfileirada" de
-- "estourou o prazo" de "respondeu 200 dizendo ok:false", e ainda trata timeout com destino
-- que cresceu como sucesso com ressalva. A metade 2 e uma contagem agregada de 24h ao lado
-- disso. Nao se perde nada.
--
-- A METADE 1 nao tem substituto. As duas rotinas que reorganizaram a area vigiam EXECUCAO:
--
--   `vigiar_tarefas_agendadas` — pergunta se a tarefa concluiu uma rodada dentro da
--     tolerancia, olhando `execucoes_agendadas.desfecho in ('sucesso','sucesso_vazio')`.
--     Repare no `sucesso_vazio`: rodou e nao gravou nada conta como EM DIA.
--   `conferir_execucoes_http` — pergunta qual foi o desfecho de uma chamada HTTP. So olha
--     crescimento do destino no ramo em que a edge nao respondeu dentro do prazo. No caminho
--     normal, 200 com ok:true fecha como sucesso sem conferir se veio linha nova.
--
-- Somadas, elas respondem "a rotina rodou?". Nenhuma responde "o dado chegou?". Um coletor
-- que roda todo dia, responde 200 e traz zero linha fica verde nas duas.
--
-- Conferi tambem quem mais poderia estar cobrindo, e nao esta:
--   `evaluate_alerts` — usa `max(snapshot_date)` so para montar a janela dos tres ultimos
--     dias por anuncio (d0/d1/d2). Nao alerta sobre atraso.
--   `saude_das_integracoes` — calcula `dias_sem_metrica`, que e exatamente a nocao certa, mas
--     e ferramenta sob demanda por `company_id`: nao esta agendada e nao emite alerta.
--   `nota_de_cobertura` — mede cobertura (que recorte existe), nao frescor.
--   `painel_tarefas_agendadas` — o `atrasada` dele e sobre horario de execucao, nao sobre a
--     data do dado, e e leitura de painel, nao alarme.
--
-- Cruzamento formal: das funcoes que emitem alerta, a unica agendada que tambem toca frescor
-- de dado e `evaluate_alerts`, e ela nao usa isso para alarme. A outra e esta aqui, que nao
-- esta agendada. Ou seja, o alarme de dado velho existe no codigo e nao existe em producao.
--
-- ==========================================================================================
-- A PROVA VIVA, QUE E PIOR DO QUE O RACIOCINIO
-- ==========================================================================================
-- `metric_breakdown_daily` esta parada desde 13/08/2026. Sao 23 dias em 04/09/2026, e nenhum
-- alerta foi aberto por ninguem. Nao e coincidencia de data: a Windsor foi encerrada em
-- 14/08/2026, e a tabela ficou sem escritor no dia seguinte. Hoje ela tem ZERO escritores —
-- o ultimo era `sync_ingest_breakdown`, removida hoje de manha por ser orfa, e nenhuma tarefa
-- do registro declara `metric_breakdown_daily` como destino.
--
-- E ela continua sendo LIDA por tres consumidores: `saude_das_integracoes`, `nota_de_cobertura`
-- e `get_report_export_data`. O digest de hoje publica, no presente:
--
--   "JA EXISTE no sistema: recorte por **idade** (7 faixas, 4 anuncios, de 28/07 a 13/08);
--    recorte por **genero** (3 valores). NAO e coletado por nenhuma rotina: recorte por
--    posicionamento"
--
-- A frase separa o que existe do que nao e coletado, e poe idade e genero do lado do que
-- existe. Os dois deixaram de ser coletados ha 23 dias. A ausencia de coleta virou afirmacao
-- de que o dado esta la — que e a mesma forma dos outros defeitos desta leva.
--
-- ==========================================================================================
-- POR QUE REVOGAR, E NAO DROPAR NEM RESSUSCITAR
-- ==========================================================================================
-- Dropar fecharia o buraco em silencio: sumiria o unico lugar do repositorio onde a regra de
-- frescor esta escrita, e ninguem notaria que o sistema deixou de ter esse alarme, porque ele
-- ja nao dispara. Some o codigo e some a divida junto — que e como divida vira surpresa.
--
-- Ressuscitar tambem nao serve, e por um motivo que so aparece medindo: ela vigia
-- `metric_snapshots`, que esta em D-1, fresca. Ligada hoje, ela ficaria calada e daria a
-- sensacao de que ha vigia de frescor. O buraco real esta em `metric_breakdown_daily`, que ela
-- nunca olhou. Alem disso ela e do padrao antigo de alerta — `insert into alerts` com casamento
-- por `title`, sem `chave_dedupe`, fora do `emitir_alerta` que virou o padrao em 03/09/2026.
-- Religar ela como esta seria reintroduzir alerta que a tela nova nao sabe agrupar.
--
-- Entao: a funcao fica de pe como a especificacao escrita de uma capacidade que falta, e
-- perde o direito de ser executada. Orfa e invocavel e superficie — ela escreve em `alerts`,
-- e quem tiver a chave de service_role pode abrir alerta falso ou resolver alerta verdadeiro
-- por ela. Sem chamador, revogar nao tira funcao de ninguem.
--
-- O conserto de verdade, que NAO esta aqui porque e decisao de produto e nao higiene: um vigia
-- de frescor guiado pelo registro. `tarefas_agendadas` ja tem `tabela_destino`,
-- `coluna_carimbo`, `periodicidade` e `tolerancia_horas`, e `contar_destino` ja sabe ler o
-- carimbo. Falta declarar quais tarefas sao COLETA — em que ausencia de linha nova significa
-- coleta quebrada — e quais sao REATIVAS, em que ausencia de linha e o resultado normal e
-- desejado (`expirar-aprovacoes` sem nada a expirar, `qualidade-numeros-whatsapp` sem numero
-- piorando). Sem essa distincao declarada, um vigia generico viraria maquina de alarme falso,
-- e alarme falso e o que faz alarme verdadeiro ser ignorado depois. Por isso a distincao
-- precisa ser decidida, nao adivinhada por mim.

-- ============================================================================
-- 1) Se aparecer chamador, esta migration NAO revoga
-- ============================================================================

do $guarda$
declare
  v_achados text;
  r         record;
  v_n       bigint;
  v_dinamicos text[] := '{}';
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'check_data_freshness'
  ) then
    raise exception 'check_data_freshness nao existe; outra frente ja mexeu nela — confira antes de aplicar';
  end if;

  select string_agg(distinct n.nspname || '.' || p.proname, ', ') into v_achados
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prokind in ('f','p')
     and p.proname <> 'check_data_freshness'
     and p.prosrc like '%check_data_freshness%';

  if v_achados is not null then
    raise exception 'ha funcao chamando check_data_freshness: %. Revogar quebraria chamador vivo.', v_achados;
  end if;

  select string_agg(n.nspname || '.' || c.relname, ', ') into v_achados
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v','m')
     and n.nspname not in ('pg_catalog','information_schema')
     and pg_get_viewdef(c.oid, true) like '%check_data_freshness%';

  if v_achados is not null then
    raise exception 'ha view chamando check_data_freshness: %', v_achados;
  end if;

  select string_agg(j.jobname, ', ') into v_achados
    from cron.job j where j.command like '%check_data_freshness%';

  if v_achados is not null then
    raise exception 'ha cron chamando check_data_freshness: %', v_achados;
  end if;

  select string_agg(t.tgname, ', ') into v_achados
    from pg_trigger t
   where not t.tgisinternal and pg_get_triggerdef(t.oid) like '%check_data_freshness%';

  if v_achados is not null then
    raise exception 'ha trigger chamando check_data_freshness: %', v_achados;
  end if;

  select string_agg(distinct d.classid::regclass::text || ' oid=' || d.objid, ', ') into v_achados
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass
     and d.refobjid in (
       select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'check_data_freshness')
     and not (d.classid = d.refclassid and d.objid = d.refobjid);

  if v_achados is not null then
    raise exception 'ha objeto dependente de check_data_freshness: %', v_achados;
  end if;

  -- Despacho por nome vindo de registro: varre toda coluna de texto do schema public.
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
       and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.data_type in ('text','character varying','jsonb','json')
  loop
    execute format('select count(*) from public.%I where %I::text like %L',
                   r.table_name, r.column_name, '%check_data_freshness%')
      into v_n;
    if v_n > 0 then
      v_dinamicos := v_dinamicos || (r.table_name || '.' || r.column_name);
    end if;
  end loop;

  if array_length(v_dinamicos, 1) > 0 then
    raise exception 'ha registro que pode invocar check_data_freshness por nome dinamico: %',
      array_to_string(v_dinamicos, ', ');
  end if;

  raise notice 'check_data_freshness nao tem chamador em nenhuma superficie; pode perder execucao';
end $guarda$;

-- ============================================================================
-- 2) Perde execucao, mantem o corpo
-- ============================================================================

revoke all on function public.check_data_freshness() from public, anon, authenticated, service_role;

comment on function public.check_data_freshness() is
'NAO ESTA EM USO E NAO PODE SER EXECUTADA (execucao revogada em 04/09/2026). Fica de pe de proposito, como a especificacao escrita de uma capacidade que o sistema NAO tem: alarme de dado velho. A metade que contava chamadas HTTP sem 200 foi superada por conferir_execucoes_http. A metade que mede frescor nao tem substituto: vigiar_tarefas_agendadas e conferir_execucoes_http vigiam EXECUCAO de rotina, e sucesso_vazio conta como em dia, entao coletor que roda e nao traz linha fica verde. Nao religue esta funcao como esta: ela olha metric_snapshots (fresca, D-1) e nao metric_breakdown_daily (parada desde 13/08/2026), e usa o padrao antigo de alerta por title, sem chave_dedupe. O conserto certo e um vigia de frescor guiado por tarefas_agendadas.tabela_destino, depois de declarar quais tarefas sao coleta e quais sao reativas.';

-- ============================================================================
-- 3) O buraco fica declarado para quem le a doutrina
-- ============================================================================

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
select 'execucao',
       'NAO HA VIGIA DE FRESCOR DE DADO (medido em 04/09/2026). vigiar_tarefas_agendadas e '
       'conferir_execucoes_http vigiam EXECUCAO de rotina, nao chegada de dado: desfecho '
       'sucesso_vazio conta como em dia, entao coletor que roda, responde 200 e traz zero linha '
       'fica verde nas duas. Consequencia medida: metric_breakdown_daily esta parada desde '
       '13/08/2026 (a Windsor foi encerrada em 14/08) e ficou 23 dias sem alerta. Hoje ela tem '
       'ZERO escritores e nenhuma tarefa do registro a declara como destino, mas segue sendo '
       'lida por saude_das_integracoes, nota_de_cobertura e get_report_export_data. Portanto: '
       'NAO afirme que o recorte por idade ou genero esta atualizado — a nota de cobertura do '
       'digest hoje lista os dois como existentes e a janela deles termina em 13/08/2026. Antes '
       'de concluir qualquer coisa sobre recorte demografico, confira max(snapshot_date) em '
       'metric_breakdown_daily. check_data_freshness existe no banco mas esta com execucao '
       'revogada e nunca foi religada; ela tambem nao cobriria este caso, porque vigia '
       'metric_snapshots, que esta fresca.',
       true, current_date, null
where not exists (
  select 1 from public.agent_context
   where categoria = 'execucao' and fato like 'NAO HA VIGIA DE FRESCOR DE DADO%'
);

-- ============================================================================
-- 4) Conferencia
-- ============================================================================

do $prova$
declare
  v_acl text;
  v_existe boolean;
begin
  select true, coalesce(array_to_string(p.proacl::text[], ' | '), '(sem acl explicita)')
    into v_existe, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_data_freshness';

  if not coalesce(v_existe, false) then
    raise exception 'check_data_freshness sumiu; esta migration revoga, nao dropa';
  end if;

  if v_acl like '%service_role=%' or v_acl like '%anon=%' or v_acl like '%authenticated=%' then
    raise exception 'check_data_freshness ainda executavel por papel de aplicacao: %', v_acl;
  end if;

  if not exists (
    select 1 from public.agent_context
     where categoria = 'execucao' and fato like 'NAO HA VIGIA DE FRESCOR DE DADO%' and vigente
  ) then
    raise exception 'a doutrina do buraco de frescor nao foi gravada';
  end if;

  raise notice 'check_data_freshness de pe, sem execucao por papel de aplicacao (acl: %); buraco de frescor declarado na doutrina', v_acl;
end $prova$;
