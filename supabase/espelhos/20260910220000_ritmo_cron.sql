-- Tiques da forca-tarefa Ritmo. Cron manda x-mcp-key; a UI autoriza com JWT.
-- Leve a cada 2h no minuto 20; fundo 08:15 UTC (~05h Brasilia).
-- Natureza reativa: nao ter missao em execucao e o desfecho normal.

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:ritmo-executar',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'ritmo-executar')::bytea), 'hex'),
       'Despachante dos tiques leve e fundo da forca-tarefa Ritmo.'
on conflict (chamador) do nothing;

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo, natureza, motivo_natureza)
values (
  'ritmo-tique-leve',
  'Tique leve do Ritmo',
  'Alguma forca-tarefa em execucao precisa de um tique leve agora?',
  'http', 'ritmo-executar', 'cron:ritmo-executar', 'x-mcp-key',
  '{"modo":"dispatcher_leve"}'::jsonb, 120000,
  'frequente', 1, 'ritmo_atos', 'criado_em',
  'reativa',
  'Tique de forca-tarefa: nao ter missao em execucao e o desfecho normal.')
on conflict (tarefa) do update set
  titulo = excluded.titulo,
  pergunta = excluded.pergunta,
  tipo = excluded.tipo,
  edge = excluded.edge,
  chave_chamador = excluded.chave_chamador,
  modo_auth = excluded.modo_auth,
  corpo = excluded.corpo,
  timeout_ms = excluded.timeout_ms,
  periodicidade = excluded.periodicidade,
  tolerancia_horas = excluded.tolerancia_horas,
  tabela_destino = excluded.tabela_destino,
  coluna_carimbo = excluded.coluna_carimbo,
  natureza = excluded.natureza,
  motivo_natureza = excluded.motivo_natureza;

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo, timeout_ms,
  periodicidade, tolerancia_horas, tabela_destino, coluna_carimbo, natureza, motivo_natureza)
values (
  'ritmo-tique-fundo',
  'Tique fundo do Ritmo',
  'Alguma forca-tarefa em execucao precisa de um tique fundo agora?',
  'http', 'ritmo-executar', 'cron:ritmo-executar', 'x-mcp-key',
  '{"modo":"dispatcher_fundo"}'::jsonb, 120000,
  'diaria', 30, 'ritmo_atos', 'criado_em',
  'reativa',
  'Tique de forca-tarefa: nao ter missao em execucao e o desfecho normal.')
on conflict (tarefa) do update set
  titulo = excluded.titulo,
  pergunta = excluded.pergunta,
  tipo = excluded.tipo,
  edge = excluded.edge,
  chave_chamador = excluded.chave_chamador,
  modo_auth = excluded.modo_auth,
  corpo = excluded.corpo,
  timeout_ms = excluded.timeout_ms,
  periodicidade = excluded.periodicidade,
  tolerancia_horas = excluded.tolerancia_horas,
  tabela_destino = excluded.tabela_destino,
  coluna_carimbo = excluded.coluna_carimbo,
  natureza = excluded.natureza,
  motivo_natureza = excluded.motivo_natureza;

select cron.unschedule(jobid)
  from cron.job
 where jobname in ('ritmo-tique-leve', 'ritmo-tique-fundo');

select cron.schedule(
  'ritmo-tique-leve',
  '20 */2 * * *',
  $cmd$ select public.disparar_tarefa_http('ritmo-tique-leve'); $cmd$
);

select cron.schedule(
  'ritmo-tique-fundo',
  '15 8 * * *',
  $cmd$ select public.disparar_tarefa_http('ritmo-tique-fundo'); $cmd$
);
