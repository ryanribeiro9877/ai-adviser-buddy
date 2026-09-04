-- Agenda o vigia do portao de compliance criado em 20260904100000.
--
-- Por que existe uma migration so para o agendamento: `provar_portao_de_compliance()` levanta
-- excecao quando o portao esta morto, mas excecao que ninguem chama nao avisa nada. O defeito
-- que originou tudo isso (03/09/2026: leitura da chave inexistente `aprovado`, com NULL
-- valendo aprovacao) passou desapercebido justamente porque portao morto NAO aparece na
-- operacao normal - tudo continua passando, com aparencia de normalidade. Sem cron, o controle
-- positivo depende de alguem desconfiar, que e exatamente o que falhou.
--
-- Tolerancia de 30 horas em tarefa diaria: 24h de intervalo + 6h de folga, para que um atraso
-- de agenda nao produza alerta de "tarefa nao rodou" que competiria com os alertas reais.

insert into public.tarefas_agendadas
  (tarefa, titulo, pergunta, tipo, funcao_sql, corpo, timeout_ms, periodicidade,
   tolerancia_horas, ativa, observacao)
values
  ('vigia-do-portao-de-compliance',
   'Vigia do portao de compliance',
   'O portao que barra promessa proibida ainda esta vivo, ou passou a aprovar tudo em silencio?',
   'sql',
   'vigiar_portao_de_compliance',
   '{}'::jsonb,
   30000,
   'diaria',
   30,
   true,
   'Roda controle positivo (texto que TEM de ser barrado) e negativo (texto inocente que NAO pode ser). Existe porque em 03/09/2026 uma comparacao de risco leu a chave inexistente aprovado e tratou NULL como aprovacao; o defeito so apareceu por controle positivo manual. Portao morto nao aparece na operacao normal - tudo continua passando.')
on conflict (tarefa) do update set
  titulo           = excluded.titulo,
  pergunta         = excluded.pergunta,
  tipo             = excluded.tipo,
  funcao_sql       = excluded.funcao_sql,
  corpo            = excluded.corpo,
  timeout_ms       = excluded.timeout_ms,
  periodicidade    = excluded.periodicidade,
  tolerancia_horas = excluded.tolerancia_horas,
  ativa            = excluded.ativa,
  observacao       = excluded.observacao;

-- Idempotente: `cron.schedule` sobrescreve job de mesmo nome.
select cron.schedule(
  'vigia-portao-compliance-0955',
  '55 9 * * *',
  $cron$select public.rodar_tarefa_sql('vigia-do-portao-de-compliance');$cron$
);
