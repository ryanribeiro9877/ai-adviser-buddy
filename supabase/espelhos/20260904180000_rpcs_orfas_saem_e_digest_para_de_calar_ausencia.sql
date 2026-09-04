-- AS QUATRO RPCS ORFAS SAEM, E O DIGEST PARA DE CALAR AUSENCIA (04/09/2026)
--
-- Fecha os dois itens que a auditoria deixou abertos. Sao dois assuntos diferentes com a
-- mesma raiz: coisa morta que continua parecendo viva. Uma escreve sem ser chamada; a outra
-- e monitorada sem existir.
--
-- ==========================================================================================
-- ITEM 1 — AS QUATRO `sync_ingest_*` SAEM
-- ==========================================================================================
-- Sao estas, todas `(p jsonb)`, todas plpgsql, todas SECURITY DEFINER de dono `postgres`:
--
--   sync_ingest_ads           -> upsert em public.ads
--   sync_ingest_adsets        -> upsert em public.ad_sets
--   sync_ingest_ad_snapshots  -> upsert em public.ad_metric_snapshots
--   sync_ingest_breakdown     -> upsert em public.metric_breakdown_daily
--
-- Perderam o chamador quando a Windsor foi encerrada (20260814123000) e a edge `windsor-sync`
-- foi para docs/edges-descontinuadas/. Em 20260904170000 a frente das colunas `leads` as
-- classificou como "orfaos mas saos" e escolheu ALTERAR em vez de remover, para nao deixa-las
-- gravando a mistura de formulario com conversa. Aquela decisao estava certa naquele momento:
-- o assunto ali era a coluna, nao a superficie. O assunto aqui e a superficie.
--
-- POR QUE ISSO E SUPERFICIE, E NAO SO SUJEIRA
-- ------------------------------------------------------------------------------------------
-- As quatro escrevem, com dado 100% vindo do chamador, exatamente nas quatro tabelas que
-- sustentam todo numero que o gestor le: gasto, impressao, alcance, formulario, conversa.
-- Sao SECURITY DEFINER, entao rodam com poder de `postgres` e passam por cima de RLS. E o
-- `company_id` nao e verificado: sai de um LEFT JOIN em `integrations`, ou seja, `account_id`
-- desconhecido grava linha com `company_id` NULL, sem erro e sem dono.
--
-- Ninguem chama, ninguem monitora, ninguem testa — e ainda assim continuam capazes de
-- reescrever a base de decisao. Nao e risco teorico de invasao: e uma porta de escrita em
-- producao que nenhuma prova deste repositorio cobre, porque nenhuma prova cobre funcao que
-- nao tem chamador.
--
-- A BUSCA FOI TEXTUAL, NAO SO PELO GRAFO DE DEPENDENCIA
-- ------------------------------------------------------------------------------------------
-- Este repositorio ja levou esse susto: na aposentadoria das colunas `leads`,
-- `montar_corpo_digest` somava `metric_snapshots.leads` no corpo plpgsql e o `DROP COLUMN`
-- teria passado limpo, quebrando o relatorio diario as 11:30 do dia seguinte com erro 42703.
-- Corpo de plpgsql e texto para o Postgres, nao dependencia. Entao a conferencia aqui foi
-- feita em quatro varreduras independentes, todas com resultado zero em 04/09/2026:
--
--   1) Catalogo do banco, por texto: `pg_proc.prosrc` de TODAS as funcoes, `pg_get_viewdef`
--      de views e materialized views, `cron.job.command` e `pg_get_triggerdef`. Zero.
--   2) Codigo-fonte das edges vivas (`supabase/functions/`): zero chamadas. A unica mencao e
--      um comentario em `pipeboard-metrics-sync` que cita `sync_ingest_windsor` (ja removida)
--      ao explicar o que a coluna `leads` deveria ter sido.
--   3) Frontend (`src/`): zero, nem o nome aparece.
--   4) O caso que o grafo E a busca no fonte perderiam: nome de RPC montado em tempo de
--      execucao. Tres edges despacham por nome vindo de registro — `traffic-agent-job`,
--      `traffic-chat` e `mcp-server` fazem `rpc(nome, parametros)`. Entao varri TODA coluna
--      text/varchar/json/jsonb de TODA tabela do schema `public` atras dos quatro nomes.
--      Zero linhas. Nao ha ferramenta registrada, doutrina, config nem tarefa agendada que
--      possa invoca-las por nome dinamico.
--
-- O unico chamador que existiu esta em `docs/edges-descontinuadas/windsor-sync/index.ts`, e
-- essa edge nao esta publicada no projeto remoto — a lista de functions do Supabase confirma.
-- O coletor vivo (`pipeboard-metrics-sync`) nao passa por elas: escreve direto na tabela com
-- `.from("ad_metric_snapshots").upsert(...)` e so chama `rollup_metric_snapshots_from_ads`.
--
-- REMOVER, E NAO APENAS REVOGAR
-- ------------------------------------------------------------------------------------------
-- Revogar ja foi feito, e nao resolve. Desde 20260819171000 o EXECUTE esta assim:
--
--   postgres=X/postgres | service_role=X/postgres
--
-- `anon` e `authenticated` ja estao fora, entao nao ha exposicao anonima pela PostgREST. Mas
-- `service_role` e a chave que TODA edge deste projeto usa, e `postgres` executa de qualquer
-- jeito — revogar de novo nao tira poder de ninguem que ja o tenha. Sobraria a mesma funcao,
-- com a mesma capacidade de escrita, protegida por uma ACL que qualquer `grant` distraido no
-- futuro desfaz em uma linha.
--
-- Remover e reversivel a custo baixo e conhecido: o corpo das quatro esta inteiro em
-- `supabase/migrations/20260904170000_ingestao_para_de_gravar_leads.sql`, na versao ja
-- corrigida (sem `leads`). Se um coletor futuro precisar delas, e copiar de volta com o
-- chamador junto — que e a unica forma de nao recriar o mesmo orfao.
--
-- ==========================================================================================
-- ITEM 2 — O NOME MORTO `windsor-sync-daily` NA LISTA DO DIGEST
-- ==========================================================================================
-- A pergunta era se o digest reporta a ausencia como falha ou se a ignora. MEDIDO no remoto
-- em 04/09/2026, rodando o proprio SELECT do digest: ele IGNORA. A secao "Resolvi" sai assim,
-- com duas linhas, e o nome morto simplesmente nao aparece:
--
--   - alerts-eval-daily: ✅ rodou
--   - pipeboard-metrics-daily: ✅ rodou
--
-- A causa e o `from cron.job j ... where j.jobname in (...)`: e INNER JOIN contra `cron.job`.
-- `windsor-sync-daily` foi desagendado em 20260903201000, entao nao ha linha, e o que nao
-- existe nao vira texto. Nao e alarme falso — e silencio.
--
-- E POR ISSO O CONSERTO TEM DUAS PARTES, NAO UMA
-- ------------------------------------------------------------------------------------------
-- Se o digest gritasse falso, bastava tirar o nome. Como ele cala, tirar o nome sozinho nao
-- mudaria UMA LETRA da saida — a lista passaria de tres nomes (um invisivel) para dois, e a
-- cegueira ficaria de pe. O defeito de verdade nao e o nome morto: e a lista nao saber
-- distinguir "a rotina rodou" de "a rotina nao existe mais". Hoje as duas coisas produzem o
-- mesmo silencio, e o silencio e lido como "esta tudo bem".
--
-- Isso importa alem da Windsor: se `pipeboard-metrics-daily` for desagendado por acidente
-- amanha, a coleta de midia inteira para e o relatorio diario nao diz nada. A linha some, e
-- ninguem procura o que nao foi mencionado.
--
-- Entao: (a) o nome morto sai da lista — mante-lo agora, com ausencia falando, criaria de
-- fato o alarme falso permanente que ate hoje nao existia; e (b) a consulta passa a partir da
-- lista esperada e faz LEFT JOIN no cron, para que sumico vire texto:
--
--   nao esta no cron.job   -> ⚠️ NAO ESTA AGENDADA
--   esta, porem active=false -> ⏸️ agendada porem inativa
--   esta e ativa, sem execucao hoje -> ⏳ ainda nao rodou hoje
--   rodou                  -> ✅ / ❌ com o status real
--
-- O "ainda nao rodou hoje" e honesto em qualquer hora do dia porque diz "ainda", nao "falhou".
-- Nas duas invocacoes reais ele e sinal de verdade: o digest do chat monta as 11:30 UTC
-- (`daily-report-0830`) e o do e-mail as 11:35 UTC (slot 8 local), e as duas rotinas vigiadas
-- rodam as 09:00 e 09:15 UTC — bem antes.
--
-- A troca e cirurgica, via `pg_get_functiondef` + `replace`, que e o padrao do repositorio
-- para mexer neste corpo (20260806200740). Nao reescrevo a funcao a mao: ela tem
-- `p_dia date DEFAULT (CURRENT_DATE - 1)`, e `enviar-digest` chama passando SO `p_company_id`.
-- Redigitar o cabecalho e perder o default quebraria o digest por e-mail. A guarda abaixo
-- confere que o default sobreviveu.

-- ============================================================================
-- 1) Nenhum chamador vivo pode existir — se existir, esta migration NAO dropa
-- ============================================================================

do $guarda$
declare
  v_alvos text[] := array[
    'sync_ingest_ads', 'sync_ingest_adsets', 'sync_ingest_ad_snapshots', 'sync_ingest_breakdown'
  ];
  v_alvo   text;
  v_achados text;
  r        record;
  v_n      bigint;
  v_dinamicos text[] := '{}';
begin
  -- 1.1) Corpo de funcao. Textual de proposito: plpgsql nao entra no grafo de dependencia,
  --      e foi exatamente assim que `montar_corpo_digest` quase derrubou o digest no drop
  --      das colunas `leads`.
  select string_agg(distinct n.nspname || '.' || p.proname, ', ') into v_achados
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prokind in ('f','p')
     and not (p.proname = any(v_alvos))
     and exists (select 1 from unnest(v_alvos) a where p.prosrc like '%' || a || '%');

  if v_achados is not null then
    raise exception 'ha funcao citando as RPCs no corpo: %. Nao dropo funcao com chamador vivo.', v_achados;
  end if;

  -- 1.2) Views e materialized views.
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_achados
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v','m')
     and n.nspname not in ('pg_catalog','information_schema')
     and exists (select 1 from unnest(v_alvos) a where pg_get_viewdef(c.oid, true) like '%' || a || '%');

  if v_achados is not null then
    raise exception 'ha view chamando as RPCs: %', v_achados;
  end if;

  -- 1.3) Crons.
  select string_agg(j.jobname, ', ') into v_achados
    from cron.job j
   where exists (select 1 from unnest(v_alvos) a where j.command like '%' || a || '%');

  if v_achados is not null then
    raise exception 'ha cron chamando as RPCs: %', v_achados;
  end if;

  -- 1.4) Triggers.
  select string_agg(t.tgname, ', ') into v_achados
    from pg_trigger t
   where not t.tgisinternal
     and exists (select 1 from unnest(v_alvos) a where pg_get_triggerdef(t.oid) like '%' || a || '%');

  if v_achados is not null then
    raise exception 'ha trigger chamando as RPCs: %', v_achados;
  end if;

  -- 1.5) Qualquer objeto que dependa das quatro pelo catalogo. Cobre o que a busca textual
  --      nao veria por outro motivo: funcao SQL de corpo padronizado (BEGIN ATOMIC), que
  --      registra dependencia real em vez de guardar texto. Por isso classid = pg_proc NAO e
  --      excluido aqui; so a auto-referencia sai.
  select string_agg(distinct d.classid::regclass::text || ' oid=' || d.objid, ', ') into v_achados
    from pg_depend d
   where d.refclassid = 'pg_proc'::regclass
     and d.refobjid in (
       select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any(v_alvos))
     and not (d.classid = d.refclassid and d.objid = d.refobjid);

  if v_achados is not null then
    raise exception 'ha objeto dependente das RPCs no catalogo: %', v_achados;
  end if;

  -- 1.6) O chamador que nem o grafo nem a busca no fonte pegariam: nome montado em tempo de
  --      execucao. `traffic-agent-job`, `traffic-chat` e `mcp-server` despacham com
  --      rpc(nome, parametros), e o `nome` vem de registro no banco. Entao o registro inteiro
  --      tem de ser varrido, coluna de texto por coluna de texto.
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
       and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.data_type in ('text','character varying','jsonb','json')
  loop
    foreach v_alvo in array v_alvos loop
      execute format('select count(*) from public.%I where %I::text like %L',
                     r.table_name, r.column_name, '%' || v_alvo || '%')
        into v_n;
      if v_n > 0 then
        v_dinamicos := v_dinamicos || (r.table_name || '.' || r.column_name || ' -> ' || v_alvo);
      end if;
    end loop;
  end loop;

  if array_length(v_dinamicos, 1) > 0 then
    raise exception 'ha registro no banco que pode invocar as RPCs por nome dinamico: %',
      array_to_string(v_dinamicos, ', ');
  end if;

  raise notice 'nenhum chamador vivo das quatro RPCs em funcao, view, cron, trigger, catalogo ou registro; pode dropar';
end $guarda$;

-- ============================================================================
-- 2) As quatro saem
-- ============================================================================

drop function if exists public.sync_ingest_ads(jsonb);
drop function if exists public.sync_ingest_adsets(jsonb);
drop function if exists public.sync_ingest_ad_snapshots(jsonb);
drop function if exists public.sync_ingest_breakdown(jsonb);

-- ============================================================================
-- 3) E tem de ter sumido mesmo
-- ============================================================================

do $depois$
declare
  v_restam text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_restam
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'sync\_ingest%';

  if v_restam is not null then
    raise exception 'ainda existe RPC sync_ingest_*: %', v_restam;
  end if;

  raise notice 'quatro RPCs orfas removidas; nenhuma sync_ingest_* restante em public';
end $depois$;

-- ============================================================================
-- 4) Digest: o nome morto sai e a ausencia passa a falar
-- ============================================================================

do $digest$
declare
  v_def text;
  v_novo text;
begin
  select pg_get_functiondef('public.montar_corpo_digest(uuid,date)'::regprocedure) into v_def;

  if v_def is null then
    raise exception 'montar_corpo_digest nao encontrada';
  end if;

  if position('NÃO ESTÁ AGENDADA' in v_def) > 0 then
    raise notice 'montar_corpo_digest ja consertada; nada a fazer';
    return;
  end if;

  v_novo := replace(v_def,
$antigo$  select coalesce(string_agg('- ' || j.jobname || ': ' ||
           case d.status when 'succeeded' then '✅ rodou' else '❌ ' || coalesce(d.status,'?') end, e'\n'),
           '- (nenhuma rotina registrada hoje)')
    into v_sync
    from cron.job j
    join lateral (select status from cron.job_run_details r
       where r.jobid = j.jobid and r.start_time::date = current_date
       order by r.start_time desc limit 1) d on true
   where j.jobname in ('windsor-sync-daily','alerts-eval-daily','pipeboard-metrics-daily');$antigo$,
$novo$  -- A lista esperada vem primeiro e o cron entra por LEFT JOIN: rotina que sumiu do
  -- agendamento vira linha visivel em vez de sumir do texto. Antes era INNER JOIN contra
  -- cron.job, entao desagendar uma rotina a apagava do relatorio em silencio.
  select coalesce(string_agg('- ' || esperada.jobname || ': ' ||
           case
             when j.jobid is null   then '⚠️ **NÃO ESTÁ AGENDADA** — sumiu do cron, ninguém está rodando'
             when not j.active      then '⏸️ agendada porém inativa'
             when d.status is null  then '⏳ ainda não rodou hoje'
             when d.status = 'succeeded' then '✅ rodou'
             else '❌ ' || d.status
           end, e'\n' order by esperada.jobname),
           '- ⚠️ lista de monitoramento vazia — o digest deixou de vigiar qualquer rotina')
    into v_sync
    from (values ('alerts-eval-daily'),('pipeboard-metrics-daily')) as esperada(jobname)
    left join cron.job j on j.jobname = esperada.jobname
    left join lateral (select status from cron.job_run_details r
       where r.jobid = j.jobid and r.start_time::date = current_date
       order by r.start_time desc limit 1) d on true;$novo$);

  if v_novo = v_def then
    raise exception 'montar_corpo_digest: bloco de rotinas esperado nao encontrado; nao aplico troca cega';
  end if;

  -- O default de p_dia e o que permite `enviar-digest` chamar so com p_company_id.
  if position('p_dia date DEFAULT (CURRENT_DATE - 1)' in v_novo) = 0 then
    raise exception 'montar_corpo_digest: o default de p_dia se perdeu na transformacao';
  end if;

  if position('windsor' in lower(v_novo)) > 0 then
    raise exception 'montar_corpo_digest: sobrou mencao a windsor apos a troca';
  end if;

  if position('NÃO ESTÁ AGENDADA' in v_novo) = 0 then
    raise exception 'montar_corpo_digest: o novo bloco nao entrou';
  end if;

  execute v_novo;
end $digest$;

comment on function public.montar_corpo_digest(uuid, date) is
'Corpo do relatorio diario. Em 04/09/2026 a secao de rotinas passou a partir da lista esperada com LEFT JOIN no cron: rotina desagendada vira "NAO ESTA AGENDADA" em vez de sumir do texto. O nome morto windsor-sync-daily saiu junto — era monitorado desde que a Windsor foi encerrada em 14/08/2026 e produzia silencio, nao alarme.';

-- ============================================================================
-- 5) Nome monitorado tem de existir — e o que impede a lista de apodrecer de novo
-- ============================================================================

do $lista$
declare
  v_def       text;
  v_lista     text;
  v_nomes     text[];
  v_nome      text;
  v_fantasmas text[] := '{}';
begin
  select pg_get_functiondef('public.montar_corpo_digest(uuid,date)'::regprocedure) into v_def;

  v_lista := substring(v_def from 'from \(values (.*?)\) as esperada\(jobname\)');
  if v_lista is null then
    raise exception 'nao consegui ler a lista de rotinas monitoradas pelo digest; guarda cega nao vale nada';
  end if;

  select array_agg(m[1]) into v_nomes
    from regexp_matches(v_lista, '''([a-z0-9._-]+)''', 'g') m;

  if v_nomes is null or array_length(v_nomes, 1) = 0 then
    raise exception 'a lista de rotinas monitoradas pelo digest esta vazia';
  end if;

  foreach v_nome in array v_nomes loop
    if not exists (select 1 from cron.job j where j.jobname = v_nome) then
      v_fantasmas := v_fantasmas || v_nome;
    end if;
  end loop;

  if array_length(v_fantasmas, 1) > 0 then
    raise exception 'o digest ficaria monitorando nome que nao existe no cron.job: %',
      array_to_string(v_fantasmas, ', ');
  end if;

  raise notice 'digest vigia % rotina(s), todas existentes no cron.job: %',
    array_length(v_nomes, 1), array_to_string(v_nomes, ', ');
end $lista$;

-- ============================================================================
-- 6) O digest ainda monta, e a secao mudou
-- ============================================================================

do $prova$
declare
  v_empresa uuid;
  v_corpo text;
begin
  select company_id into v_empresa from public.digest_config where ativo limit 1;
  if v_empresa is null then
    select id into v_empresa from public.companies order by created_at limit 1;
  end if;

  if v_empresa is null then
    raise notice 'sem empresa para provar o digest; troca aplicada sem execucao de prova';
    return;
  end if;

  v_corpo := public.montar_corpo_digest(v_empresa);

  if v_corpo is null or length(v_corpo) < 200 then
    raise exception 'montar_corpo_digest devolveu corpo vazio ou curto demais apos a troca';
  end if;

  if position('Rotinas de hoje' in v_corpo) = 0 then
    raise exception 'a secao de rotinas sumiu do corpo do digest';
  end if;

  if position('windsor' in lower(v_corpo)) > 0 then
    raise exception 'o corpo do digest ainda cita windsor';
  end if;

  raise notice 'digest monta apos a troca: % caracteres, secao de rotinas presente, sem windsor', length(v_corpo);
end $prova$;
