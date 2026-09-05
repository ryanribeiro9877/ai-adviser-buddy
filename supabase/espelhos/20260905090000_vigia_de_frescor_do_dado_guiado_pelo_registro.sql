-- VIGIA DE FRESCOR DO DADO, GUIADO PELO REGISTRO (05/09/2026)
--
-- O sistema tinha dois vigias, e os dois respondiam a mesma pergunta: "a rotina rodou?".
-- `vigiar_tarefas_agendadas` olha `execucoes_agendadas.desfecho in ('sucesso','sucesso_vazio')`
-- dentro da tolerancia; `conferir_execucoes_http` julga o desfecho de uma chamada HTTP. Nenhum
-- dos dois pergunta "o dado chegou?". Um coletor que roda todo dia, responde 200 e traz zero
-- linha fica verde nos dois. Este vigia responde a pergunta que faltava, e responde olhando o
-- DADO, nao a execucao — por construcao, `sucesso_vazio` nao tem como deixa-lo calado.
--
-- ==========================================================================================
-- A CLASSIFICACAO SAIU DE MEDICAO, NAO DE LEITURA DO NOME DA TAREFA
-- ==========================================================================================
-- A regra e a do gestor: o padrao e COLETA, e RE ATIVA precisa de motivo. Errar para coleta
-- gera alarme falso; errar para reativa gera silencio, que e o defeito que estamos corrigindo.
--
-- Para decidir, medi 30 dias de cada destino declarado: ultima linha, quantos dias tiveram
-- linha, e o maior vao entre linhas consecutivas. Quando o maior vao observado ja passa da
-- tolerancia com folga E existe razao estrutural para o vao, e reativa. Sao seis motivos, cada
-- um cobrindo um grupo de tarefas:
--
--   1. DESTINO E `alerts` (5 tarefas: alertas-de-midia, cobertura-das-regras, monitor-contas-meta,
--      qualidade-numeros-whatsapp, validade-do-conhecimento). Ausencia de alerta e o resultado
--      DESEJADO. Vigiar frescor aqui seria alarmar exatamente quando esta tudo bem. Alem disso
--      `alerts` e destino compartilhado pelas cinco, entao max(created_at) nem atribui a linha
--      a tarefa que a criou.
--   2. VIGIAS E DRENOS (4: conferir-chamadas-http, vigia-das-tarefas, vigia-do-portao-de-compliance,
--      drenar-alertas-criticos). O produto deles tambem e alerta ou aviso; nao ter o que avisar e
--      o bom desfecho. A execucao deles ja e vigiada por `vigiar_tarefas_agendadas`.
--   3. ESCOAMENTO DE MIDIA (4: escoar-imagens-legal/cohapm, escoar-videos-legal/cohapm). Destino
--      `media_uploads`: 8 dias com linha em 30, maior vao medido de 231h (9,6 dias), contra
--      tolerancia de 4h. So sobe midia quando ha midia aprovada esperando.
--   4. TRABALHO SOBRE PECA NOVA DO DRIVE (3: varredura-drive-legal/cohapm, transcrever-audios-drive).
--      Destino `drive_midia_analises`: 5 a 6 dias com linha em 30, maior vao medido de 574h
--      (24 dias). So grava quando chega peca ou audio novo.
--   5. SINAL E RECOMENDACAO (4: sinais-de-recomendacao-diario/semanal, recomendacoes-da-ia,
--      criativos-vencedores). Maior vao medido de 96h a 120h contra tolerancia de 30h. Sinal que
--      nao existe nao vira linha, e isso e desempenho estavel, nao coleta quebrada.
--   6. CARIMBO POSTO POR TERCEIRO (2: expirar-aprovacoes, expirar-jobs-de-chat). O carimbo
--      (`reviewed_at`, `finished_at`) e posto quando alguem decide ou quando alguem usa o chat,
--      nao pela tarefa. Maior vao medido de 143h e 174h.
--
-- Todo o resto ficou COLETA, incluindo os casos em que a duvida existia. Sao 32 tarefas ativas:
-- 22 reativas nesses seis motivos e 10 coleta — dessas, 7 com destino declarado e vigiadas, e 3
-- sem registro suficiente, que aparecem nomeadas em vez de sumirem em silencio.
--
-- ==========================================================================================
-- DUAS COISAS PARA O VIGIA NAO REPETIR O DEFEITO QUE ELE EXISTE PARA PEGAR
-- ==========================================================================================
-- PRIMEIRA: tarefa de coleta SEM `tabela_destino` ou `coluna_carimbo` nao pode ser contada como
-- em dia por falta de dado para conferir. Ela sai numa lista de NAO VIGIADAS, com nome, num
-- alerta proprio que so se resolve quando o registro for completado. Sao tres hoje, as tres do
-- espelho de estrutura da Meta (estrutura-campanhas, estrutura-conjuntos, estrutura-anuncios):
-- coletam de verdade e nao declaram onde depositam.
--
-- SEGUNDA: `tolerancia_horas` calibra EXECUCAO, nao chegada de dado, e os dois nem sempre
-- batem. `digest-por-email` roda de hora em hora (tolerancia 3h) e produz UMA entrega por dia:
-- vigiar o dado com 3h alarmaria todo dia por construcao. Por isso entra
-- `tolerancia_frescor_horas`, usada quando declarada e caindo em `tolerancia_horas` quando nao.
-- So um caso precisou dela ate agora, e esta declarado com o motivo junto.
--
-- Terceiro cuidado, que apareceu medindo: destino compartilhado nao atribui. `relatorio-diario-no-chat`
-- deposita em `chat_messages`, que recebe toda mensagem de usuario — max(created_at) ficaria
-- fresco para sempre e o vigia nunca acusaria o relatorio faltando. Por isso entram
-- `filtro_destino_coluna` e `filtro_destino_valor`, com identificador citado por %I e valor
-- passado por parametro, sem SQL livre no registro. Para o relatorio o filtro e
-- `model = 'relatorio-deterministico'`, que e como `post_daily_report` assina a linha.
--
-- O que este vigia NAO cobre, e vale dizer: `metric_breakdown_daily`, parada desde 13/08. Ela
-- nao tem tarefa nenhuma no registro, porque perdeu o coletor junto com a Windsor. Vigia
-- guiado por registro nao ve o que nunca foi registrado. Quem passou a mostrar isso foi a
-- `nota_de_cobertura`, na migration anterior desta mesma leva.

-- ============================================================================
-- 1) O registro passa a declarar natureza, tolerancia de frescor e atribuicao
-- ============================================================================

alter table public.tarefas_agendadas
  add column if not exists natureza                text,
  add column if not exists motivo_natureza         text,
  add column if not exists tolerancia_frescor_horas integer,
  add column if not exists filtro_destino_coluna    text,
  add column if not exists filtro_destino_valor     text;

update public.tarefas_agendadas set natureza = 'coleta' where natureza is null;

alter table public.tarefas_agendadas
  alter column natureza set default 'coleta',
  alter column natureza set not null;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarefas_agendadas_natureza_valida') then
    alter table public.tarefas_agendadas
      add constraint tarefas_agendadas_natureza_valida
      check (natureza in ('coleta','reativa'));
  end if;

  -- Reativa sem motivo escrito e adivinhacao com cara de decisao. O banco recusa.
  if not exists (select 1 from pg_constraint where conname = 'tarefas_agendadas_reativa_justificada') then
    alter table public.tarefas_agendadas
      add constraint tarefas_agendadas_reativa_justificada
      check (natureza <> 'reativa' or nullif(btrim(coalesce(motivo_natureza,'')),'') is not null);
  end if;

  -- Filtro pela metade nao filtra nada e cria falso frescor.
  if not exists (select 1 from pg_constraint where conname = 'tarefas_agendadas_filtro_completo') then
    alter table public.tarefas_agendadas
      add constraint tarefas_agendadas_filtro_completo
      check ((filtro_destino_coluna is null) = (filtro_destino_valor is null));
  end if;
end $c$;

comment on column public.tarefas_agendadas.natureza is
'coleta = ausencia de linha nova no destino significa coleta quebrada, e o vigia de frescor alarma. reativa = ausencia de linha e o resultado normal e desejado, e o vigia nao olha. O padrao e coleta: errar para coleta gera alarme falso, errar para reativa gera silencio.';

comment on column public.tarefas_agendadas.tolerancia_frescor_horas is
'Horas sem linha nova no destino ate o vigia de frescor alarmar. Quando nula, cai em tolerancia_horas. Existe porque tolerancia_horas calibra a EXECUCAO: ha tarefa que roda de hora em hora e produz um dado por dia.';

comment on column public.tarefas_agendadas.filtro_destino_coluna is
'Coluna que atribui a linha do destino a esta tarefa, quando o destino e compartilhado com outros escritores. Sem ela, max(carimbo) de uma tabela movimentada fica fresco para sempre e o vigia nunca acusa a falta.';

-- ============================================================================
-- 2) Classificacao, um motivo por grupo
-- ============================================================================

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'Destino e a tabela alerts: ausencia de alerta e o resultado desejado, entao frescor aqui alarmaria justamente quando esta tudo bem. E alerts e destino compartilhado por cinco tarefas, entao o carimbo nem atribui a linha a quem a criou.'
 where tarefa in ('alertas-de-midia','cobertura-das-regras','monitor-contas-meta',
                  'qualidade-numeros-whatsapp','validade-do-conhecimento');

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'Vigia ou dreno: o produto dela e alerta ou aviso, e nao ter o que avisar e o bom desfecho. Que ela esteja rodando ja e vigiado por vigiar_tarefas_agendadas.'
 where tarefa in ('conferir-chamadas-http','vigia-das-tarefas','vigia-do-portao-de-compliance',
                  'drenar-alertas-criticos');

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'So escoa quando ha midia aprovada esperando. Medido em 30 dias no destino media_uploads: 8 dias com linha e maior vao de 231h (9,6 dias), contra tolerancia de execucao de 4h.'
 where tarefa in ('escoar-imagens-legal','escoar-imagens-cohapm',
                  'escoar-videos-legal','escoar-videos-cohapm');

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'So grava quando chega peca ou audio novo no Drive. Medido em 30 dias no destino drive_midia_analises: 5 a 6 dias com linha e maior vao de 574h (24 dias).'
 where tarefa in ('varredura-drive-legal','varredura-drive-cohapm','transcrever-audios-drive');

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'Sinal que nao existe nao vira linha, e isso e desempenho estavel, nao coleta quebrada. Medido em 30 dias: maior vao de 96h a 120h contra tolerancia de 30h.'
 where tarefa in ('sinais-de-recomendacao-diario','sinais-de-recomendacao-semanal',
                  'recomendacoes-da-ia','criativos-vencedores');

update public.tarefas_agendadas set natureza = 'reativa', motivo_natureza =
  'O carimbo do destino e posto por terceiro, nao pela tarefa: reviewed_at depende de alguem decidir e finished_at depende de alguem usar o chat. Medido em 30 dias: maior vao de 143h e 174h.'
 where tarefa in ('expirar-aprovacoes','expirar-jobs-de-chat');

-- Roda de hora em hora e produz UMA entrega por dia: com a tolerancia de execucao (3h) o
-- vigia alarmaria todo dia por construcao.
update public.tarefas_agendadas set tolerancia_frescor_horas = 30
 where tarefa = 'digest-por-email';

-- chat_messages recebe toda mensagem de usuario. Sem atribuir, o relatorio poderia sumir por
-- semanas com o carimbo sempre fresco. post_daily_report assina a linha em `model`.
update public.tarefas_agendadas
   set filtro_destino_coluna = 'model', filtro_destino_valor = 'relatorio-deterministico'
 where tarefa = 'relatorio-diario-no-chat';

do $classe$
declare
  v_coleta int; v_reativa int; v_sem_motivo int; v_sem_registro text;
begin
  select count(*) filter (where natureza = 'coleta'),
         count(*) filter (where natureza = 'reativa'),
         count(*) filter (where natureza = 'reativa'
                            and nullif(btrim(coalesce(motivo_natureza,'')),'') is null)
    into v_coleta, v_reativa, v_sem_motivo
    from public.tarefas_agendadas where ativa;

  if v_sem_motivo > 0 then
    raise exception 'ha % tarefa(s) reativa(s) sem motivo escrito', v_sem_motivo;
  end if;

  select string_agg(tarefa, ', ' order by tarefa) into v_sem_registro
    from public.tarefas_agendadas
   where ativa and natureza = 'coleta'
     and (tabela_destino is null or coluna_carimbo is null);

  raise notice 'classificacao: % coleta, % reativa; sem registro para vigiar: %',
    v_coleta, v_reativa, coalesce(v_sem_registro, 'nenhuma');
end $classe$;

-- ============================================================================
-- 3) Leitura do carimbo no destino, com atribuicao e sem SQL livre
-- ============================================================================

create or replace function public.ultimo_carimbo_no_destino(
  p_tabela         text,
  p_coluna         text,
  p_company_id     uuid default null,
  p_filtro_coluna  text default null,
  p_filtro_valor   text default null)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ts          timestamptz;
  v_tem_company boolean;
  v_sql         text;
begin
  if p_tabela is null or p_coluna is null then
    return null;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_tabela and column_name = p_coluna
  ) then
    return null;
  end if;

  if p_filtro_coluna is not null and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_tabela and column_name = p_filtro_coluna
  ) then
    return null;
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_tabela and column_name = 'company_id'
  ) into v_tem_company;

  -- Os dois parametros aparecem sempre, para o EXECUTE nunca receber parametro a mais.
  v_sql := format(
    'select max(%I::timestamptz) from public.%I where ($1::uuid is null%s) and %s',
    p_coluna, p_tabela,
    case when v_tem_company then ' or company_id = $1' else ' or true' end,
    case when p_filtro_coluna is not null
         then format('%I::text = $2', p_filtro_coluna)
         else '($2::text is null or true)' end);

  execute v_sql into v_ts using p_company_id, p_filtro_valor;
  return v_ts;
end;
$fn$;

comment on function public.ultimo_carimbo_no_destino(text, text, uuid, text, text) is
'Ultima vez que chegou linha no destino de uma tarefa. Identificadores entram citados por %I e o valor do filtro vai por parametro: o registro declara coluna e valor, nunca SQL. Devolve null quando a tabela ou a coluna declarada nao existe, e quem chama trata isso como registro invalido, nao como em dia.';

-- ============================================================================
-- 4) O vigia
-- ============================================================================

create or replace function public.vigiar_frescor_do_dado()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_t            record;
  v_ultimo       timestamptz;
  v_tol          numeric;
  v_horas        numeric;
  v_sev          alert_severity;
  v_company      uuid;
  v_ha           text;
  v_onde         text;
  v_ok           int := 0;
  v_velhas       int := 0;
  v_nunca        int := 0;
  v_alertas      int := 0;
  v_sem_registro text[] := '{}';
  v_declarado    boolean;
begin
  for v_t in
    select * from public.tarefas_agendadas
     where ativa and natureza = 'coleta'
     order by tarefa
  loop
    v_company := coalesce(v_t.company_id, public.empresa_principal());
    v_tol     := greatest(coalesce(v_t.tolerancia_frescor_horas, v_t.tolerancia_horas, 1), 1);
    v_onde    := 'Coleta do sistema (' || v_t.tarefa || ')';

    -- Sem registro NAO vira "em dia". Vai para a lista de nao vigiadas, com nome.
    v_declarado := v_t.tabela_destino is not null
               and v_t.coluna_carimbo is not null
               and exists (select 1 from information_schema.columns
                            where table_schema = 'public'
                              and table_name = v_t.tabela_destino
                              and column_name = v_t.coluna_carimbo);

    if not v_declarado then
      v_sem_registro := v_sem_registro || (v_t.titulo || ' (' || v_t.tarefa || ')');
      continue;
    end if;

    v_ultimo := public.ultimo_carimbo_no_destino(
                  v_t.tabela_destino, v_t.coluna_carimbo, v_t.company_id,
                  v_t.filtro_destino_coluna, v_t.filtro_destino_valor);

    if v_ultimo is null then
      v_nunca := v_nunca + 1;
      perform public.emitir_alerta(
        p_company_id    => v_company,
        p_severidade    => 'high'::alert_severity,
        p_titulo        => 'Coleta nunca trouxe dado: ' || v_t.titulo,
        p_o_que         => format('A coleta "%s" nao tem nenhuma linha em %s. Ela responde: %s. Sem esse dado, qualquer resposta sobre esse assunto e chute.',
                                  v_t.titulo, v_t.tabela_destino, v_t.pergunta),
        p_onde          => v_onde,
        p_quanto        => 'nenhuma linha encontrada em ' || v_t.tabela_destino
                           || ' (carimbo ' || v_t.coluna_carimbo || ')',
        p_acao          => 'Abrir a tela Tarefas agendadas e reexecutar esta coleta. Se ela responder sucesso e continuar sem linha, o problema esta na origem, nao no agendamento.',
        p_janela        => 'tolerancia de ' || v_tol::int || 'h sem linha nova',
        p_tarefa        => v_t.tarefa,
        p_linha_produto => 'Infraestrutura do sistema',
        p_chave_dedupe  => 'dado_velho:' || v_t.tarefa);
      v_alertas := v_alertas + 1;
      continue;
    end if;

    v_horas := extract(epoch from (now() - v_ultimo)) / 3600.0;

    if v_horas <= v_tol then
      v_ok := v_ok + 1;
      update public.alerts set resolved = true
       where resolved = false and chave_dedupe = 'dado_velho:' || v_t.tarefa;
      continue;
    end if;

    v_velhas := v_velhas + 1;

    v_sev := case
               when v_horas >= v_tol * 4 then 'critical'::alert_severity
               when v_horas >= v_tol * 2 then 'high'::alert_severity
               else 'medium'::alert_severity
             end;

    v_ha := case when v_horas < 48 then round(v_horas)::text || ' horas'
                 else round(v_horas / 24)::text || ' dias' end;

    perform public.emitir_alerta(
      p_company_id    => v_company,
      p_severidade    => v_sev,
      p_titulo        => 'Dado parou de chegar: ' || v_t.titulo,
      p_o_que         => format('A coleta "%s" nao traz linha nova ha %s. Ela responde: %s. A rotina pode estar rodando e respondendo sucesso — o que parou foi o DADO, e enquanto isso todo numero que depende dele descreve o passado.',
                                v_t.titulo, v_ha, v_t.pergunta),
      p_onde          => v_onde,
      p_quanto        => 'ultima linha em ' || v_t.tabela_destino || ' com carimbo de '
                         || to_char(v_ultimo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                         || ' (tolerancia: ' || v_tol::int || 'h)',
      p_acao          => 'Conferir na tela Tarefas agendadas se as ultimas rodadas dizem sucesso. Se disserem, a rotina esta viva e vazia: o problema esta na origem do dado, nao no agendamento.',
      p_janela        => 'sem linha nova ha ' || v_ha,
      p_tarefa        => v_t.tarefa,
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'dado_velho:' || v_t.tarefa,
      p_valor         => round(v_horas, 1));

    v_alertas := v_alertas + 1;
  end loop;

  if array_length(v_sem_registro, 1) > 0 then
    perform public.emitir_alerta(
      p_company_id    => public.empresa_principal(),
      p_severidade    => 'medium'::alert_severity,
      p_titulo        => 'Coleta sem registro para vigiar (' || array_length(v_sem_registro, 1) || ')',
      p_o_que         => 'Estas coletas nao declaram onde depositam o dado, entao ninguem consegue conferir se o dado delas chegou: '
                         || array_to_string(v_sem_registro, '; ')
                         || '. Elas NAO estao sendo dadas como em dia — estao fora do alcance do vigia, que e pior.',
      p_onde          => 'Registro de tarefas agendadas',
      p_quanto        => array_length(v_sem_registro, 1) || ' coleta(s) sem tabela de destino ou sem coluna de carimbo',
      p_acao          => 'Preencher tabela_destino e coluna_carimbo dessas tarefas no registro. Se alguma delas nao for coleta, marcar natureza = reativa com o motivo escrito.',
      p_janela        => 'conferido em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      p_linha_produto => 'Infraestrutura do sistema',
      p_chave_dedupe  => 'frescor_sem_registro');
    v_alertas := v_alertas + 1;
  else
    update public.alerts set resolved = true
     where resolved = false and chave_dedupe = 'frescor_sem_registro';
  end if;

  return jsonb_build_object(
    'verificado_em',   now(),
    'coletas_em_dia',  v_ok,
    'dado_velho',      v_velhas,
    'nunca_chegou',    v_nunca,
    'sem_registro',    coalesce(array_length(v_sem_registro, 1), 0),
    'nao_vigiadas',    to_jsonb(v_sem_registro),
    'alertas_emitidos', v_alertas);
end;
$fn$;

comment on function public.vigiar_frescor_do_dado() is
'Pergunta "o dado chegou?", que e a pergunta que vigiar_tarefas_agendadas e conferir_execucoes_http nao fazem — os dois perguntam "a rotina rodou?", e sucesso_vazio conta como em dia neles. Olha o carimbo do destino de cada tarefa de natureza coleta, nunca a execucao, entao rodada vazia nao tem como deixa-lo calado. Coleta sem destino declarado sai numa lista de nao vigiadas, com nome, em vez de ser contada como saudavel.';

revoke all on function public.vigiar_frescor_do_dado() from public, anon, authenticated;
grant execute on function public.vigiar_frescor_do_dado() to service_role;

-- ============================================================================
-- 5) Entra no registro e no cron
-- ============================================================================

insert into public.tarefas_agendadas
  (tarefa, titulo, pergunta, tipo, funcao_sql, periodicidade, tolerancia_horas,
   ativa, natureza, motivo_natureza, observacao)
values
  ('vigia-do-frescor-do-dado',
   'Vigia do frescor do dado',
   'Alguma coleta parou de trazer dado novo sem a rotina acusar falha?',
   'sql', 'vigiar_frescor_do_dado', 'diaria', 30,
   true, 'reativa',
   'Vigia: o produto dela e alerta, e nao ter o que alarmar e o bom desfecho. Que ela esteja rodando ja e vigiado por vigiar_tarefas_agendadas.',
   'Roda depois dos coletores da manha (ultimo as 09:55 UTC) e antes do relatorio diario (11:30 UTC), para o relatorio do dia ja sair sabendo.')
on conflict (tarefa) do update
  set funcao_sql = excluded.funcao_sql,
      ativa      = true,
      natureza   = excluded.natureza,
      motivo_natureza = excluded.motivo_natureza;

select cron.schedule('vigia-frescor-1010', '10 10 * * *',
                     $cron$select public.rodar_tarefa_sql('vigia-do-frescor-do-dado');$cron$);

-- ============================================================================
-- 6) Conferencia: roda de verdade e o resultado bate com a medicao
-- ============================================================================

do $prova$
declare
  v_r        jsonb;
  v_esperado int;
  v_agendado boolean;
begin
  v_r := public.vigiar_frescor_do_dado();

  if v_r is null then
    raise exception 'o vigia nao devolveu nada';
  end if;

  select count(*) into v_esperado
    from public.tarefas_agendadas
   where ativa and natureza = 'coleta'
     and (tabela_destino is null or coluna_carimbo is null);

  if (v_r->>'sem_registro')::int <> v_esperado then
    raise exception 'o vigia contou % sem registro, mas o registro tem %',
      v_r->>'sem_registro', v_esperado;
  end if;

  -- O ponto do vigia: nenhuma coleta pode sair da rodada sem cair em alguma categoria.
  if (v_r->>'coletas_em_dia')::int + (v_r->>'dado_velho')::int
     + (v_r->>'nunca_chegou')::int + (v_r->>'sem_registro')::int
     <> (select count(*) from public.tarefas_agendadas where ativa and natureza = 'coleta') then
    raise exception 'sobrou coleta sem categoria na rodada: %', v_r::text;
  end if;

  select active into v_agendado from cron.job where jobname = 'vigia-frescor-1010';
  if not coalesce(v_agendado, false) then
    raise exception 'o vigia nao ficou agendado e ativo no cron';
  end if;

  raise notice 'vigia de frescor: %', v_r::text;
end $prova$;
