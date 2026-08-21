-- COHAPM Drive: pastas Jurídico + La Felicità, meio na análise, crons espelhando Legal.
-- Isolamento: company_id COHAPM; meio juridico|la_felicita; NUNCA misturar com Legal.

-- 1) Colunas de separação
ALTER TABLE public.drive_pastas_monitoradas
  ADD COLUMN IF NOT EXISTS meio text;

COMMENT ON COLUMN public.drive_pastas_monitoradas.meio IS
  'Meio/marca dentro da empresa: juridico | la_felicita | null (Legal). Separacao COHAPM Juridico x La Felicita.';

ALTER TABLE public.drive_midia_analises
  ADD COLUMN IF NOT EXISTS pasta_monitorada text,
  ADD COLUMN IF NOT EXISTS meio text;

COMMENT ON COLUMN public.drive_midia_analises.pasta_monitorada IS
  'Nome da raiz em drive_pastas_monitoradas no momento da varredura.';
COMMENT ON COLUMN public.drive_midia_analises.meio IS
  'Copia do meio da pasta: juridico | la_felicita. Filtro obrigatorio nas respostas do agente.';

-- 2) Plano de varredura devolve meio (overload de 3 args — o usado pelo job)
CREATE OR REPLACE FUNCTION public.drive_plano_de_varredura(
  p_company_id uuid,
  p_base_desejada text DEFAULT 'thumbnail'::text,
  p_mime_prefixo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH pecas AS (
    SELECT drive_file_id, drive_modified_time,
           max(nome) AS nome, max(mime) AS mime,
           jsonb_agg(DISTINCT base_da_analise) AS bases,
           bool_or(base_da_analise = p_base_desejada) AS tem_a_base,
           max(produto_detectado) FILTER (WHERE base_da_analise <> p_base_desejada) AS produto_anterior
      FROM drive_midia_analises
     WHERE company_id = p_company_id
       AND (p_mime_prefixo IS NULL OR mime LIKE p_mime_prefixo || '%')
     GROUP BY drive_file_id, drive_modified_time
  )
  SELECT jsonb_build_object(
    'base_desejada', p_base_desejada,
    'filtro_de_midia', coalesce(p_mime_prefixo, 'todos os tipos'),
    'pastas_ativas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'folder_id', folder_id, 'nome', nome, 'meio', meio,
        'ultima_varredura_em', ultima_varredura_em,
        'nunca_varrida', (ultima_varredura_em IS NULL),
        'pecas_na_ultima', pecas_na_ultima_varredura) ORDER BY nome)
      FROM drive_pastas_monitoradas WHERE company_id = p_company_id AND ativo), '[]'::jsonb),
    'pastas_desativadas', coalesce((
      SELECT jsonb_agg(nome ORDER BY nome) FROM drive_pastas_monitoradas
       WHERE company_id = p_company_id AND NOT ativo), '[]'::jsonb),
    'ja_analisados', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', drive_file_id, 'm', drive_modified_time))
        FROM pecas WHERE tem_a_base), '[]'::jsonb),
    'total_na_base_desejada', (SELECT count(*) FROM pecas WHERE tem_a_base),
    'vistos_em_base_mais_rasa', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', drive_file_id, 'm', drive_modified_time,
                                          'nome', nome, 'mime', mime,
                                          'bases_que_ja_tem', bases,
                                          'produto_atual', produto_anterior))
        FROM pecas WHERE NOT tem_a_base), '[]'::jsonb),
    'total_a_reanalisar', (SELECT count(*) FROM pecas WHERE NOT tem_a_base),
    'como_usar', 'Varra CADA pasta de pastas_ativas. Grave pasta_monitorada e meio em cada analise. NUNCA misture meios (juridico x la_felicita) nem empresas.',
    'declare_a_cobertura', 'NUNCA diga que leu "o Drive". Diga empresa, meio (Juridico/La Felicita), pastas e quando.'
  );
$function$;

-- Overload de 1 arg REMOVIDO de proposito: conflita com a de 3 args (defaults)
-- e PostgREST/SQL falham com "function is not unique". Sempre chamar a de 3 args.
DROP FUNCTION IF EXISTS public.drive_plano_de_varredura(uuid);
-- 3) Cadastrar pastas COHAPM (IDs validados via drive-access-probe 2026-08-21)
-- Jurídico = Exports Finais (aposentadoria, IR, emprestimos, RMC)
-- La Felicità = pastas mensais 06/07/08 (reels/videos com "La Felicità" no nome)
INSERT INTO public.drive_pastas_monitoradas
  (company_id, folder_id, nome, descricao, meio, declarado_por, declarado_em)
VALUES
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1P08VWeSxDvtGrTdRN-4vrFfVWRXDzPx7',
   'COHAPM Jurídico · Exports Finais',
   'Acervo jurídico COHAPM (Exports Finais). Owner Drive: presidentecohapm. NAO misturar com La Felicità nem Legal.',
   'juridico', 'Ryan', current_date),
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1RgPc4z59EtgiPynJnWma6O0FJCrFLUM8',
   'COHAPM La Felicità · 06. Junho',
   'Acervo La Felicità — pasta 06. Junho. Owner: presidentecohapm.',
   'la_felicita', 'Ryan', current_date),
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1xIFiORxHwYk4RZnakKlI_A_W2lS0w_58',
   'COHAPM La Felicità · 07. Julho',
   'Acervo La Felicità — pasta 07. Julho (nomes de arquivo com La Felicità).',
   'la_felicita', 'Ryan', current_date),
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1s3XIV1ebaGfgoH7xc8P1yQxQ3RcLgOA9',
   'COHAPM La Felicità · 08. Agosto',
   'Acervo La Felicità — pasta 08. Agosto.',
   'la_felicita', 'Ryan', current_date)
ON CONFLICT (company_id, folder_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  meio = EXCLUDED.meio,
  ativo = true;

-- Garantia: pasta Legal NUNCA sob COHAPM
DELETE FROM public.drive_pastas_monitoradas
 WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   AND folder_id = '1F6dRZcjGa0Vu_dxsZF32YbR6v2m-5KCo';

-- 4) Chaves MCP + crons COHAPM (uma empresa por entrada — isolamento do agendador)
INSERT INTO public.mcp_api_keys (chamador, api_key, observacao)
SELECT 'cron:drive-watch-cohapm-0846',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'drive-watch-cohapm')::bytea), 'hex'),
       'Cron Drive watch COHAPM (Juridico + La Felicita). Isolado do Legal.'
WHERE NOT EXISTS (SELECT 1 FROM public.mcp_api_keys WHERE chamador = 'cron:drive-watch-cohapm-0846');

INSERT INTO public.mcp_api_keys (chamador, api_key, observacao)
SELECT 'cron:escoar-imagens-cohapm-hora',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'escoar-img-cohapm')::bytea), 'hex'),
       'Cron escoar imagens COHAPM act_1622612945584817'
WHERE NOT EXISTS (SELECT 1 FROM public.mcp_api_keys WHERE chamador = 'cron:escoar-imagens-cohapm-hora');

INSERT INTO public.mcp_api_keys (chamador, api_key, observacao)
SELECT 'cron:escoar-videos-cohapm-hora',
       encode(sha256((gen_random_uuid()::text || clock_timestamp()::text || 'escoar-vid-cohapm')::bytea), 'hex'),
       'Cron escoar videos COHAPM act_1622612945584817'
WHERE NOT EXISTS (SELECT 1 FROM public.mcp_api_keys WHERE chamador = 'cron:escoar-videos-cohapm-hora');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'drive-watch-cohapm-0846';
SELECT cron.schedule(
  'drive-watch-cohapm-0846',
  '46 8 * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/traffic-agent-job',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:drive-watch-cohapm-0846')
    ),
    body := jsonb_build_object(
      'modo','drive_watch',
      'company_id', '57f755b9-c23d-4f58-a488-8173d697c010'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escoar-imagens-cohapm-hora';
SELECT cron.schedule(
  'escoar-imagens-cohapm-hora',
  '21 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-imagens-cohapm-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_imagens',
      'company', 'COHAPM',
      'account_id', 'act_1622612945584817'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escoar-videos-cohapm-hora';
SELECT cron.schedule(
  'escoar-videos-cohapm-hora',
  '26 * * * *',
  $$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/upload-midia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mcp-key', public.get_mcp_api_key('cron:escoar-videos-cohapm-hora')
    ),
    body := jsonb_build_object(
      'acao', 'escoar_videos',
      'company', 'COHAPM',
      'account_id', 'act_1622612945584817'
    ),
    timeout_milliseconds := 150000
  );
  $$
);

-- Doutrina anti-mistura Drive
INSERT INTO public.agent_context (company_id, categoria, fato, vigente)
SELECT '57f755b9-c23d-4f58-a488-8173d697c010', 'drive_isolamento',
  'DRIVE COHAPM: pastas com meio=juridico (Exports Finais) e meio=la_felicita (Jun/Jul/Ago). Ao falar de criativos, SEMPRE diga o meio. NUNCA misture com Legal (company_id distinto) nem misture Jurídico com La Felicità. Pasta Legal 1F6dRZ… e proibida sob COHAPM.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_context
  WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    AND categoria = 'drive_isolamento' AND vigente
);
