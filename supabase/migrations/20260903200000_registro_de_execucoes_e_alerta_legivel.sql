-- Registro de execucoes agendadas e padrao unico de alerta legivel (03/09/2026)
--
-- POR QUE: hoje o pg_cron diz "succeeded" em 100% das 28 tarefas ativas — 6.310 rodadas do
-- digest sem uma falha registrada — e ninguem consegue dizer se uma tarefa parou. Dois motivos
-- somados:
--
--   1) Nas 17 tarefas que chamam edge por HTTP, o pg_cron marca sucesso quando ENFILEIRA o
--      net.http_post, nao quando a edge responde. Pior: net._http_response NAO tem coluna de
--      url (so id, status_code, content_type, headers, content, timed_out, error_msg, created)
--      e a fila net.http_request_queue e drenada. Ou seja, o watchdog atual consegue dizer
--      "2 chamadas falharam" e e literalmente incapaz de dizer QUAIS. E pg_net poda as linhas
--      por TTL, entao nao existe trilha duravel nenhuma.
--
--   2) Nas 10 tarefas que rodam funcao SQL, o retorno e DESCARTADO (`select public.fn()`).
--      "Rodou e nao achou nada" e "rodou e achou 12 problemas" produzem o mesmo silencio.
--
-- Consequencia medida: drive_midia_analises da Legal e Viver esta parada em 22/08 enquanto a
-- cron drive-watch-0845 acumulou 28 "sucessos". A corrente arrebenta sem ninguem ver.
--
-- O QUE ESTA MIGRATION FAZ: cria a trilha que faltava (execucoes_agendadas), o catalogo do que
-- DEVERIA rodar (tarefas_agendadas — sem ele a ausencia nunca vira alerta, porque nao ha o que
-- comparar), e o funil unico de alerta legivel (emitir_alerta).
--
-- DISTINCAO CENTRAL: 'sucesso' / 'sucesso_vazio' / 'falha' / 'em_curso'. Hoje "rodou e nao achou
-- nada" e "nao rodou" aparecem identicos — ambos como silencio. Sao estados diferentes e a
-- coluna desfecho passa a separa-los.
--
-- CONTAMINACAO ENTRE LINHAS: tres marcas dividem a MESMA empresa COHAPM (COHAPM Juridico/tag
-- COHAPM, La Felicita/tag LAF, Sistema Ocular/tag VISTTA). Logo company_id NAO identifica linha
-- de produto. Alerta que se apoia so em company_id pode apresentar conjunto da La Felicita como
-- se fosse do Juridico — o erro grave que ja aconteceu neste sistema. Por isso a linha vem
-- resolvida do TOKEN do nome da entidade contra brand_identity.marca_tag, nunca do ambiente.

-- ============================================================================
-- 1) CATALOGO: o que deveria rodar, com que frequencia, e onde se prova
-- ============================================================================
-- Sem catalogo nao existe atraso: "nao rodou" so e detectavel contra uma expectativa declarada.

create table if not exists public.tarefas_agendadas (
  tarefa            text primary key,
  titulo            text not null,
  pergunta          text not null,
  tipo              text not null check (tipo in ('sql','http')),

  -- tipo='sql'
  funcao_sql        text,
  arg_sql           text,

  -- tipo='http'
  edge              text,
  chave_chamador    text,
  modo_auth         text check (modo_auth in ('x-mcp-key','bearer')),
  corpo             jsonb not null default '{}'::jsonb,
  timeout_ms        integer not null default 120000,
  janela_dias       integer,

  -- expectativa de periodicidade: base do calculo de atraso
  periodicidade     text not null check (periodicidade in ('frequente','horaria','diaria','semanal')),
  tolerancia_horas  integer not null,

  -- prova no destino: converte "enfileirou" em "gravou"
  tabela_destino    text,
  coluna_carimbo    text,

  company_id        uuid references public.companies(id) on delete cascade,
  ativa             boolean not null default true,
  criado_em         timestamptz not null default now()
);

comment on table public.tarefas_agendadas is
  'Catalogo das tarefas agendadas: o que deveria rodar, com que frequencia e em qual tabela se prova o efeito. Sem esta declaracao a ausencia de rodada nao e detectavel.';
comment on column public.tarefas_agendadas.pergunta is
  'Pergunta operacional que a tarefa responde. Tarefa que nao responde pergunta nenhuma nao deveria existir.';
comment on column public.tarefas_agendadas.chave_chamador is
  'Nome do chamador para get_mcp_api_key. E NOME, nao segredo: a chave e resolvida em tempo de disparo.';
comment on column public.tarefas_agendadas.tolerancia_horas is
  'Quantas horas sem rodada caracterizam atraso. Passado esse prazo a ausencia vira alerta.';
comment on column public.tarefas_agendadas.tabela_destino is
  'Tabela onde o efeito da tarefa aparece. Usada para separar "rodou e nao achou nada" de "nao rodou".';

-- ============================================================================
-- 2) TRILHA: historico de rodadas
-- ============================================================================

create table if not exists public.execucoes_agendadas (
  id                 uuid primary key default gen_random_uuid(),
  tarefa             text not null,
  company_id         uuid references public.companies(id) on delete cascade,
  origem             text not null default 'cron' check (origem in ('cron','manual','edge')),

  iniciado_em        timestamptz not null default now(),
  finalizado_em      timestamptz,
  duracao_ms         integer,

  desfecho           text not null default 'em_curso'
                     check (desfecho in ('em_curso','sucesso','sucesso_vazio','falha')),

  itens_processados  integer not null default 0,
  achados            integer not null default 0,
  mensagem_erro      text,
  detalhe            jsonb not null default '{}'::jsonb,

  janela_inicio      date,
  janela_fim         date
);

comment on table public.execucoes_agendadas is
  'Historico de rodadas das tarefas agendadas. Existe porque pg_cron marca sucesso ao enfileirar o POST e net._http_response nem guarda a url — sem esta tabela nao ha como saber qual tarefa parou.';
comment on column public.execucoes_agendadas.desfecho is
  'em_curso | sucesso | sucesso_vazio | falha. sucesso_vazio = rodou e nao achou nada, que e diferente de nao ter rodado.';
comment on column public.execucoes_agendadas.achados is
  'Quantos problemas/itens a rodada gerou (alertas, recomendacoes, candidatos). Zero com desfecho sucesso_vazio significa "esta tudo em ordem", nao "quebrou".';

create index if not exists execucoes_agendadas_tarefa_idx
  on public.execucoes_agendadas (tarefa, iniciado_em desc);
create index if not exists execucoes_agendadas_em_curso_idx
  on public.execucoes_agendadas (iniciado_em)
  where desfecho = 'em_curso';
create index if not exists execucoes_agendadas_desfecho_idx
  on public.execucoes_agendadas (desfecho, iniciado_em desc);

-- ============================================================================
-- 3) PADRAO DE ALERTA: as seis perguntas respondidas sem abrir o banco
-- ============================================================================
-- O gestor pediu alerta que se entenda sozinho. Cada campo abaixo e uma das perguntas que ele
-- listou. Ficam em COLUNA (nao so no texto) para a tela renderizar sempre igual e para nenhuma
-- tarefa "esquecer" de responder uma delas.

alter table public.alerts
  add column if not exists tarefa            text,
  add column if not exists linha_produto     text,
  add column if not exists onde              text,
  add column if not exists quanto            text,
  add column if not exists acao              text,
  add column if not exists janela            text,
  add column if not exists chave_dedupe      text,
  add column if not exists padrao_versao     smallint not null default 1,
  add column if not exists primeira_deteccao timestamptz,
  add column if not exists vistas            integer not null default 1;

comment on column public.alerts.linha_produto is
  'Linha de produto (COHAPM Juridico, La Felicita, Sistema Ocular/VISTTA, Legal e Viver). Resolvida do token do nome da entidade, NAO de company_id: tres marcas dividem a empresa COHAPM e confundi-las e erro grave.';
comment on column public.alerts.onde is
  'Campanha/conjunto/anuncio com NOME legivel, nao id cru.';
comment on column public.alerts.quanto is
  'O numero que sustenta a afirmacao, com unidade e periodo.';
comment on column public.alerts.acao is
  'O que fazer, quando ha acao obvia.';
comment on column public.alerts.janela is
  'Sobre qual janela de dados a deteccao se apoia.';
comment on column public.alerts.primeira_deteccao is
  'Quando o problema apareceu pela primeira vez. Preservado entre rodadas para o gestor distinguir problema de hoje de problema de tres semanas.';
comment on column public.alerts.vistas is
  'Quantas rodadas consecutivas reencontraram o mesmo problema.';
comment on column public.alerts.padrao_versao is
  '1 = alerta legado (texto cru, sem campos estruturados). 2 = padrao legivel. A tela usa isto para nao fingir estrutura onde nao existe.';

-- Idempotencia do alerta: mesma chave aberta nao vira segunda linha.
create unique index if not exists alerts_chave_dedupe_aberto_uidx
  on public.alerts (company_id, chave_dedupe)
  where resolved = false and chave_dedupe is not null;

create index if not exists alerts_tarefa_idx on public.alerts (tarefa, created_at desc);

-- ============================================================================
-- 4) RESOLVEDOR DE LINHA DE PRODUTO
-- ============================================================================
-- Le o token entre colchetes do nome ([LEV], [LAF], [VISTTA], [COHAPM]) e casa com
-- brand_identity.marca_tag. Token desconhecido NAO e adivinhado: devolve o token cru entre
-- parenteses. Atribuir a marca errada e pior do que admitir que nao se sabe.

create or replace function public.linha_de_produto_do_nome(
  p_nome text,
  p_company_id uuid default null
) returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_marca text;
begin
  if p_nome is null or btrim(p_nome) = '' then
    return null;
  end if;

  v_token := upper(nullif(substring(p_nome from '^\s*\[([^\]]+)\]'), ''));
  if v_token is null then
    return null;
  end if;

  select b.marca_nome into v_marca
    from public.brand_identity b
   where b.vigente
     and upper(b.marca_tag) = v_token
     and (p_company_id is null or b.company_id = p_company_id)
   limit 1;

  if v_marca is not null then
    return v_marca;
  end if;

  -- Sem casamento na mesma empresa, tenta global antes de desistir.
  select b.marca_nome into v_marca
    from public.brand_identity b
   where b.vigente and upper(b.marca_tag) = v_token
   limit 1;

  if v_marca is not null then
    return v_marca;
  end if;

  return format('linha nao cadastrada (%s)', v_token);
end
$function$;

comment on function public.linha_de_produto_do_nome(text, uuid) is
  'Resolve a linha de produto pelo token do nome da entidade contra brand_identity.marca_tag. Token desconhecido devolve o token cru — nunca adivinha marca, porque tres marcas dividem a empresa COHAPM.';

-- Rotulo de severidade em portugues, para a tela e o e-mail falarem a mesma lingua.
create or replace function public.rotulo_severidade(p_sev alert_severity)
returns text
language sql
immutable
as $function$
  select case p_sev
           when 'critical' then 'Critico'
           when 'high'     then 'Alto'
           when 'medium'   then 'Medio'
           when 'low'      then 'Baixo'
         end
$function$;

-- ============================================================================
-- 5) EMITIR ALERTA — funil unico
-- ============================================================================
-- Toda tarefa passa por aqui. Isso garante que o alerta responda sempre as mesmas perguntas,
-- na mesma ordem, com a mesma escala de gravidade — o "padrao unico" que o gestor pediu.
-- Tambem preserva primeira_deteccao: sem isso o alerta parece novo todo dia e o gestor nao
-- consegue distinguir problema de hoje de problema cronico.

create or replace function public.emitir_alerta(
  p_company_id     uuid,
  p_severidade     alert_severity,
  p_titulo         text,
  p_o_que          text,
  p_onde           text default null,
  p_quanto         text default null,
  p_acao           text default null,
  p_janela         text default null,
  p_tarefa         text default null,
  p_linha_produto  text default null,
  p_chave_dedupe   text default null,
  p_valor          numeric default null,
  p_campaign_id    uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_desc text;
  v_agora text := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  v_linhas text[] := array[]::text[];
begin
  if p_company_id is null or p_titulo is null or p_o_que is null then
    raise exception 'emitir_alerta exige company_id, titulo e o_que';
  end if;

  -- Corpo legivel: uma frase de abertura que um gestor de trafego entende, e abaixo os campos
  -- rotulados sempre na mesma ordem. Campo sem valor nao vira linha vazia.
  v_linhas := array_append(v_linhas, btrim(p_o_que));

  if p_onde is not null or p_linha_produto is not null then
    v_linhas := array_append(v_linhas,
      'Onde: ' || coalesce(p_onde, 'nao especificado') ||
      case when p_linha_produto is not null then '  |  Linha: ' || p_linha_produto else '' end);
  end if;

  if p_quanto is not null then
    v_linhas := array_append(v_linhas, 'Quanto: ' || p_quanto);
  end if;

  if p_janela is not null then
    v_linhas := array_append(v_linhas, 'Janela dos dados: ' || p_janela);
  end if;

  if p_acao is not null then
    v_linhas := array_append(v_linhas, 'O que fazer: ' || p_acao);
  end if;

  v_linhas := array_append(v_linhas,
    'Gravidade ' || lower(public.rotulo_severidade(p_severidade)) ||
    '. Detectado em ' || v_agora ||
    case when p_tarefa is not null then ' pela tarefa ' || p_tarefa else '' end || '.');

  v_desc := array_to_string(v_linhas, E'\n');

  -- Reencontro do mesmo problema: atualiza sem perder quando ele apareceu.
  if p_chave_dedupe is not null then
    update public.alerts a
       set severity          = p_severidade,
           title             = p_titulo,
           description       = v_desc,
           tarefa            = p_tarefa,
           linha_produto     = p_linha_produto,
           onde              = p_onde,
           quanto            = p_quanto,
           acao              = p_acao,
           janela            = p_janela,
           triggered_value   = coalesce(p_valor, a.triggered_value),
           campaign_id       = coalesce(p_campaign_id, a.campaign_id),
           padrao_versao     = 2,
           vistas            = a.vistas + 1,
           primeira_deteccao = coalesce(a.primeira_deteccao, a.created_at)
     where a.company_id = p_company_id
       and a.chave_dedupe = p_chave_dedupe
       and a.resolved = false
    returning a.id into v_id;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.alerts (
    company_id, severity, title, description, resolved,
    tarefa, linha_produto, onde, quanto, acao, janela,
    chave_dedupe, padrao_versao, primeira_deteccao, vistas,
    triggered_value, campaign_id)
  values (
    p_company_id, p_severidade, p_titulo, v_desc, false,
    p_tarefa, p_linha_produto, p_onde, p_quanto, p_acao, p_janela,
    p_chave_dedupe, 2, now(), 1,
    p_valor, p_campaign_id)
  returning id into v_id;

  return v_id;
end
$function$;

comment on function public.emitir_alerta is
  'Funil unico de alerta legivel: compoe o que aconteceu, onde (nome, nao id), quanto (com unidade e periodo), gravidade, o que fazer e a janela dos dados. Deduplica por chave preservando primeira_deteccao.';

-- Fecha alertas de uma tarefa cuja condicao deixou de valer. Sem isso o painel acumula alerta
-- morto e o gestor para de confiar na tela.
create or replace function public.resolver_alertas_da_tarefa(
  p_tarefa text,
  p_chaves_vivas text[] default null
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  update public.alerts
     set resolved = true
   where tarefa = p_tarefa
     and resolved = false
     and chave_dedupe is not null
     and (p_chaves_vivas is null or not (chave_dedupe = any(p_chaves_vivas)));
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end
$function$;

comment on function public.resolver_alertas_da_tarefa(text, text[]) is
  'Resolve alertas da tarefa cuja chave nao apareceu na rodada atual: a condicao deixou de valer.';

-- ============================================================================
-- 6) CONTAGEM NO DESTINO — a prova de que gravou
-- ============================================================================
-- Identificadores sempre por %I (quote_ident): o catalogo e de uso interno, mas nome de tabela
-- concatenado em texto e porta de injecao e nao ha razao para deixar aberta.

create or replace function public.contar_destino(
  p_tabela text,
  p_coluna text,
  p_desde timestamptz,
  p_company_id uuid default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n bigint;
  v_tem_company boolean;
begin
  if p_tabela is null or p_coluna is null or p_desde is null then
    return null;
  end if;

  -- Coluna inexistente devolveria erro ou zero mentiroso: melhor admitir que nao se mede.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_tabela and column_name = p_coluna
  ) then
    return null;
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_tabela and column_name = 'company_id'
  ) into v_tem_company;

  if v_tem_company and p_company_id is not null then
    execute format('select count(*) from public.%I where %I::timestamptz >= $1 and company_id = $2',
                   p_tabela, p_coluna)
       into v_n using p_desde, p_company_id;
  else
    execute format('select count(*) from public.%I where %I::timestamptz >= $1', p_tabela, p_coluna)
       into v_n using p_desde;
  end if;

  return v_n;
end
$function$;

comment on function public.contar_destino(text, text, timestamptz, uuid) is
  'Conta linhas frescas na tabela de destino de uma tarefa. E o que separa "a edge respondeu 200" de "a edge realmente gravou".';

-- Inicio da janela de frescor conforme a periodicidade declarada.
create or replace function public.janela_de_frescor(p_periodicidade text)
returns timestamptz
language sql
stable
as $function$
  select case p_periodicidade
           when 'frequente' then now() - interval '15 minutes'
           when 'horaria'   then now() - interval '90 minutes'
           when 'diaria'    then date_trunc('day', now())
           when 'semanal'   then now() - interval '8 days'
           else now() - interval '1 day'
         end
$function$;

-- ============================================================================
-- 7) ABRIR / FECHAR EXECUCAO
-- ============================================================================

create or replace function public.abrir_execucao(
  p_tarefa       text,
  p_origem       text default 'cron',
  p_company_id   uuid default null,
  p_forcar       boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t record;
  v_id uuid;
  v_company uuid;
  v_base bigint;
  v_desde timestamptz;
begin
  select * into v_t from public.tarefas_agendadas where tarefa = p_tarefa;
  if v_t.tarefa is null then
    raise exception 'tarefa desconhecida no catalogo: %', p_tarefa;
  end if;

  v_company := coalesce(p_company_id, v_t.company_id);

  -- Registro em_curso velho e worker morto, nao rodada viva: fecha como falha antes de abrir
  -- outro, senao o painel mostra "em curso" para sempre e a tarefa parece saudavel.
  update public.execucoes_agendadas
     set desfecho      = 'falha',
         finalizado_em = now(),
         duracao_ms    = greatest(0, (extract(epoch from (now() - iniciado_em)) * 1000)::integer),
         mensagem_erro = 'registro abandonado: nenhuma conclusao dentro do prazo da tarefa'
   where tarefa = p_tarefa
     and desfecho = 'em_curso'
     and iniciado_em < now() - (coalesce(v_t.timeout_ms, 120000) + 120000) * interval '1 millisecond';

  -- Idempotencia por periodo: cron nao repete rodada bem-sucedida do mesmo periodo.
  -- Invocacao manual sempre roda, senao nao haveria como provar nada.
  if not p_forcar and p_origem = 'cron' and v_t.periodicidade in ('diaria','semanal') then
    if exists (
      select 1 from public.execucoes_agendadas e
       where e.tarefa = p_tarefa
         and e.desfecho in ('sucesso','sucesso_vazio')
         and e.iniciado_em >= case v_t.periodicidade
                                when 'diaria' then date_trunc('day', now())
                                else now() - interval '6 days'
                              end
    ) then
      return null;
    end if;
  end if;

  v_desde := public.janela_de_frescor(v_t.periodicidade);
  v_base := public.contar_destino(v_t.tabela_destino, v_t.coluna_carimbo, v_desde, v_company);

  insert into public.execucoes_agendadas (
    tarefa, company_id, origem, detalhe, janela_inicio, janela_fim)
  values (
    p_tarefa, v_company, p_origem,
    jsonb_build_object(
      'base_destino', v_base,
      'tabela_destino', v_t.tabela_destino,
      'frescor_desde', v_desde),
    case when v_t.janela_dias is not null then (current_date - v_t.janela_dias) else current_date end,
    current_date)
  returning id into v_id;

  return v_id;
end
$function$;

comment on function public.abrir_execucao(text, text, uuid, boolean) is
  'Abre o registro de uma rodada, guardando a contagem base do destino para depois medir o que a rodada de fato gravou. Cron nao repete periodo ja concluido; invocacao manual sempre roda.';

create or replace function public.fechar_execucao(
  p_execucao   uuid,
  p_desfecho   text,
  p_itens      integer default null,
  p_achados    integer default null,
  p_erro       text default null,
  p_detalhe    jsonb default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_e record;
  v_itens integer;
  v_achados integer;
  v_desfecho text := p_desfecho;
  v_agora timestamptz := now();
  v_t record;
  v_depois bigint;
  v_base bigint;
begin
  select * into v_e from public.execucoes_agendadas where id = p_execucao;
  if v_e.id is null then
    return;
  end if;

  select * into v_t from public.tarefas_agendadas where tarefa = v_e.tarefa;

  -- Quanto o destino cresceu durante a rodada. E a medida honesta de "gravou".
  v_base := nullif(v_e.detalhe->>'base_destino', '')::bigint;
  v_depois := public.contar_destino(
    v_t.tabela_destino, v_t.coluna_carimbo,
    (v_e.detalhe->>'frescor_desde')::timestamptz, v_e.company_id);

  v_itens := coalesce(p_itens,
                      case when v_depois is not null and v_base is not null
                           then greatest(0, (v_depois - v_base))::integer end,
                      0);

  -- Achados = alertas que esta rodada gerou. Metrica uniforme para toda tarefa.
  v_achados := coalesce(p_achados, (
    select count(*)::integer from public.alerts a
     where a.tarefa = v_e.tarefa
       and a.created_at >= v_e.iniciado_em), 0);

  -- "Rodou e nao achou nada" e desfecho proprio, nao sucesso mudo nem falha.
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
                             || jsonb_build_object('destino_depois', v_depois)
   where id = p_execucao;
end
$function$;

comment on function public.fechar_execucao(uuid, text, integer, integer, text, jsonb) is
  'Fecha o registro medindo o crescimento real da tabela de destino e os alertas gerados. Converte sucesso sem efeito em sucesso_vazio, para o painel nao confundir "esta tudo em ordem" com "nao rodou".';

-- ============================================================================
-- 8) RLS
-- ============================================================================
-- Mesma postura de agents / agent_unidades: catalogo e telemetria de infraestrutura nao sao
-- dado de cliente. Sem policy, so service_role escreve. RLS ligada para o linter nao apontar
-- tabela exposta. A tela le por RPC security definer, nao direto na tabela.

alter table public.tarefas_agendadas   enable row level security;
alter table public.execucoes_agendadas enable row level security;

revoke all on public.tarefas_agendadas   from anon, authenticated;
revoke all on public.execucoes_agendadas from anon, authenticated;

revoke all on function public.emitir_alerta(uuid, alert_severity, text, text, text, text, text, text, text, text, text, numeric, uuid) from anon, authenticated;
revoke all on function public.abrir_execucao(text, text, uuid, boolean) from anon, authenticated;
revoke all on function public.fechar_execucao(uuid, text, integer, integer, text, jsonb) from anon, authenticated;
revoke all on function public.contar_destino(text, text, timestamptz, uuid) from anon, authenticated;
revoke all on function public.resolver_alertas_da_tarefa(text, text[]) from anon, authenticated;
