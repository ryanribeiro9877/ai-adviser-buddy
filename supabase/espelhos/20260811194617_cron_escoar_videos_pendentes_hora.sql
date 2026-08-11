-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811194617
-- name: cron_escoar_videos_pendentes_hora
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao
-- Cron horario que escoa videos aproveitaveis do Drive para a biblioteca Meta
-- (upload-midia acao escoar_videos → Graph /advideos). Espelho do escoar-imagens-hora.
-- Minuto 25 (imagens no 20): compartilham o teto max_actions_per_hour=5 DENTRO da edge.
-- Se a corrida de imagens ja consumiu o teto, escoar_videos devolve enviados=0.
-- Nao afrouxa o teto. Idempotente; sem pendente para sozinho.

insert into public.mcp_api_keys (chamador, api_key, observacao)
select 'cron:escoar-videos-hora',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'escoar-videos-hora')::bytea), 'hex'),
       'Gerada em 11/08/2026: cron horario que escoa videos aproveitaveis pendentes via upload-midia/escoar_videos.'
on conflict (chamador) do nothing;

select cron.schedule(
  'escoar-videos-hora',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-videos-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_videos',
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
       'ESCOAMENTO DE VIDEOS (11/08/2026): cron escoar-videos-hora (minuto 25 de cada hora) chama upload-midia acao escoar_videos. Sobe so videos com aproveitavel=sim que ainda nao tem meta_video_id. Respeita max_actions_per_hour=5 (recontado a cada item, sequencial; compartilhado com imagens). Off-brand/reprovadas ficam de fora. Video id pode existir antes de ready - emissao de card checa status. Quando nao ha pendente, enviados=0 e para sozinha.',
       true
where not exists (
  select 1 from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and fato like 'ESCOAMENTO DE VIDEOS (11/08/2026):%'
     and vigente
);
