-- Cron horario que escoa imagens aproveitaveis do Drive para a biblioteca Meta
-- (upload-midia acao escoar_imagens → Graph /adimages). Nao existia nenhum cron
-- chamando upload-midia (confirmado em cron.job em 11/08/2026): as 27 imagens
-- aproveitaveis restantes apos o lote manual ficariam eternamente sem meta_image_hash.
--
-- Frequencia: a cada hora no minuto 20 (evita colisao com expira-aprovacoes :07 e
-- expira-chat-jobs :08). O teto max_actions_per_hour=5 e imposto DENTRO da edge
-- (recontado a cada item, sequencial) — este cron NAO afrouxa o teto.
-- Idempotente: dedup por (drive_file_id, account_external_id); pendente = sem
-- meta_image_hash. Quando nao ha pendente, a edge devolve enviados=0 e o cron
-- nao faz nada (para sozinho).
-- Uma empresa por entrada (padrao drive-watch): so Legal e Viver.

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:escoar-imagens-hora',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'escoar-imagens-hora')::bytea), 'hex'),
       'Gerada em 11/08/2026: cron horario que escoa imagens aproveitaveis pendentes via upload-midia/escoar_imagens.'
on conflict (chamador) do nothing;

select cron.schedule(
  'escoar-imagens-hora',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-imagens-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_imagens',
      'company', 'Legal é Viver',
      'account_id', 'act_3302001729967572'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

insert into public.agent_context (company_id, categoria, fato, vigente)
select 'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
       'criacao',
       'ESCOAMENTO DE IMAGENS (11/08/2026): cron escoar-imagens-hora (minuto 20 de cada hora) chama upload-midia acao escoar_imagens. Sobe so imagens com aproveitavel=sim que ainda nao tem meta_image_hash. Respeita max_actions_per_hour=5 (recontado a cada item, sequencial). Off-brand/reprovadas ficam de fora ate haver demanda. Quando nao ha pendente, a corrida devolve enviados=0 e para sozinha.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'ESCOAMENTO DE IMAGENS (11/08/2026):%'
     and vigente
);
