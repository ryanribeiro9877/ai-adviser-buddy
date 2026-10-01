-- Registro da rotina. Sem cron: o agendamento so nasce depois de duas execucoes
-- manuais limpas e da confirmacao das reguas provisorias.

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:vigia-de-regua',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'vigia-de-regua')::bytea), 'hex'),
       'Chamador do passe diario do vigia de regua de custo por conversa. O cron nao e criado nesta entrega.'
where not exists (
  select 1 from public.mcp_api_keys where chamador = 'cron:vigia-de-regua'
);

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo,
  timeout_ms, periodicidade, tolerancia_horas, natureza, motivo_natureza,
  tabela_destino, coluna_carimbo, tolerancia_frescor_horas, ativa)
values (
  'vigia-de-regua',
  'Vigia de régua de custo por conversa',
  'Algum alvo está acima da régua da marca e o que fazer sobre isso?',
  'http',
  'traffic-agent-job',
  'cron:vigia-de-regua',
  'x-mcp-key',
  '{"modo":"correcao_custo"}'::jsonb,
  120000,
  'diaria',
  2,
  'reativa',
  'Dia sem estouro é resultado válido, não falta de dado',
  'planos_de_ajuste_de_custo',
  'criado_em',
  null,
  true)
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
  natureza = excluded.natureza,
  motivo_natureza = excluded.motivo_natureza,
  tabela_destino = excluded.tabela_destino,
  coluna_carimbo = excluded.coluna_carimbo,
  tolerancia_frescor_horas = excluded.tolerancia_frescor_horas,
  ativa = excluded.ativa;
