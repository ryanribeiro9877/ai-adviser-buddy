-- ESPELHO DE MIGRAÇÃO APLICADA
-- version: 20260803121910
-- name: fix_integrations_status_nao_nasce_conectada
-- aplicada por: Claude via MCP apply_migration em 03/08/2026
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Tráfego IA)
--
-- 03/08/2026 - "Conectada" FALSA no front. Causa raiz no SCHEMA, nao no frontend:
--   integrations.status DEFAULT 'connected' + connected_at DEFAULT now() + estado_operacional DEFAULT 'ativa'.
-- Qualquer INSERT nascia conectado, com data de conexao preenchida, sem conta e sem uma unica
-- chamada a Graph. O front lia o campo fielmente - o BANCO mentia por construcao. Mesma classe
-- da licao "ato narrado sem ferramenta": aqui e conexao declarada sem handshake.
-- Prova: 22 de 22 integracoes com status='connected' desde sempre (campo constante, nunca
-- discriminou nada); 2 delas sem external_id NENHUM (gtm 11:05 e meta_ads 11:39 de hoje).
-- DECISAO DO RYAN (03/08): nao reescrever as 17 integracoes ja marcadas nao_operacional - o front
-- passa a mostrar "nao operacional" + motivo. As 2 linhas criadas HOJE sem conta sao o DEFEITO em
-- si, nao historico, e viram nao_verificada (sem isso a trava do item 5 nao pode existir).

-- 1) o campo de verificacao deixa de nascer mentindo
ALTER TABLE public.integrations ALTER COLUMN status SET DEFAULT 'nao_verificada';
ALTER TABLE public.integrations ALTER COLUMN estado_operacional SET DEFAULT 'quarentena';

-- 2) data de conexao so existe se houve conexao
ALTER TABLE public.integrations ALTER COLUMN connected_at DROP DEFAULT;
ALTER TABLE public.integrations ALTER COLUMN connected_at DROP NOT NULL;

-- 3) vocabulario declarado (status deixa de aceitar qualquer texto)
ALTER TABLE public.integrations
  ADD CONSTRAINT chk_integrations_status
  CHECK (status IN ('connected','nao_verificada','erro','revogada'));

-- 4) as 2 linhas de hoje: defeito, nao historico
UPDATE public.integrations
   SET status = 'nao_verificada',
       connected_at = NULL,
       estado_operacional = 'quarentena',
       estado_motivo = 'Linha criada sem handshake - defeito do DEFAULT connected, corrigido em 03/08/2026. Reconectar para verificar de fato.'
 WHERE status = 'connected'
   AND (external_id IS NULL OR external_id = '');

-- 5) TRAVA ESTRUTURAL: conectado exige conta. E o que impede a regressao - um bug futuro
--    no front nao consegue mais reintroduzir a mentira, o banco recusa.
ALTER TABLE public.integrations
  ADD CONSTRAINT chk_integrations_connected_exige_conta
  CHECK (status <> 'connected' OR (external_id IS NOT NULL AND external_id <> ''));

-- 6) A empresa nova (Cooperativa_ Cohapm, criada hoje 11:39) nasce trancada por DECLARACAO e
--    nao por ausencia de linha. Sem linha propria a meta-actions ja bloqueava, mas com motivo
--    confuso ("empresa sem configuracao"); com linha explicita o motivo passa a ser a flag.
--    NOTA: id tem DEFAULT 1 e e PRIMARY KEY - cicatriz do singleton anterior. Insert sem id
--    explicito colide. Por isso o MAX(id)+1 abaixo. Corrigir o default e item separado.
INSERT INTO public.meta_execution_config
  (id, company_id, master_enabled, dry_run, action_flags, max_actions_per_hour,
   contas_permitidas_criacao, teto_sanidade_orcamento_diario)
SELECT
  (SELECT COALESCE(MAX(id),0)+1 FROM public.meta_execution_config),
  '307849e6-78a7-4217-8112-3fb0a924f988',
  false,
  true,
  '{"upload_midia":false,"criar_campanha":false,"criar_template":false,"pausar_campanha":false,
    "pausar_criativo":false,"escalar_criativo":false,"alterar_orcamento":false,
    "replicar_template":false,"criar_anuncio_a_partir_de":false,"criar_conjunto_a_partir_de":false}'::jsonb,
  5,
  '{}'::text[],
  5000
WHERE NOT EXISTS (
  SELECT 1 FROM public.meta_execution_config
   WHERE company_id = '307849e6-78a7-4217-8112-3fb0a924f988'
);

-- ============================================================================
-- PROVA PÓS-APLICAÇÃO (sonda auto-apagável, rodada em 03/08/2026)
-- ============================================================================
-- trava conectado-sem-conta ....... OK: banco RECUSOU connected sem external_id
-- default de linha nova ........... status=nao_verificada / estado=quarentena / connected_at=NULL
-- as 17 nao_operacional ........... 17 linhas, status intocado ('connected') conforme decisão
-- as 2 linhas de hoje ............. nao_verificada / quarentena / connected_at NULL / motivo gravado
-- config da empresa nova .......... id=3, master=false, dry_run=true, 0 flags true, contas=[]
-- empresas sem config ............. nenhuma
