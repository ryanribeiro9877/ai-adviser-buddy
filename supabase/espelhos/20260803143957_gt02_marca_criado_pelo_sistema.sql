-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260803143957
-- name: gt02_marca_criado_pelo_sistema
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 03/08/2026 - GT-02, parte de banco. Prepara o espelho para receber o que a executora cria.
-- PROBLEMA: meta-actions cria objeto na Meta e nao grava em campaigns/ad_sets/ads. O espelho
-- depende do windsor-sync, que por construcao nao devolve campanha sem entrega. Resultado: o
-- sistema fica cego para o que ele mesmo acabou de criar - exatamente durante a montagem da
-- estrutura. Prova: as 3 campanhas criadas em 31/07 (120254137750140191 / ...49230191 /
-- ...48220191) nao existem na tabela campaigns ate hoje.
-- Estas duas colunas permitem (a) distinguir objeto nascido pelo sistema de objeto legado e
-- (b) rastrear de volta ao card que o criou.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS criado_pelo_sistema boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criado_por_approval_id uuid
    REFERENCES public.approval_requests(id) ON DELETE SET NULL;

ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS criado_pelo_sistema boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criado_por_approval_id uuid
    REFERENCES public.approval_requests(id) ON DELETE SET NULL;

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS criado_pelo_sistema boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criado_por_approval_id uuid
    REFERENCES public.approval_requests(id) ON DELETE SET NULL;

-- Indice para a pergunta que o agente vai fazer: "o que o sistema criou e ainda nao entregou?"
CREATE INDEX IF NOT EXISTS ix_campaigns_criado_sistema
  ON public.campaigns (company_id) WHERE criado_pelo_sistema;
CREATE INDEX IF NOT EXISTS ix_adsets_criado_sistema
  ON public.ad_sets (company_id) WHERE criado_pelo_sistema;
CREATE INDEX IF NOT EXISTS ix_ads_criado_sistema
  ON public.ads (company_id) WHERE criado_pelo_sistema;

-- BACKFILL das 3 campanhas de 31/07 que a executora criou e nunca gravou. Os dados vem do
-- proprio execution_result do card - nao ha inferencia aqui, e o que a Meta devolveu.
-- ATENCAO DE CAIXA: campaigns.status e MINUSCULO nesta base (24 'paused' + 2 'active'),
-- enquanto ad_sets e ads sao MAIUSCULOS. Gravar 'ACTIVE' aqui faria a linha piscar a cada
-- sync. Seguimos a convencao da tabela e a divergencia fica declarada (GT-09).
INSERT INTO public.campaigns
  (company_id, provider, name, objective, status, daily_budget, external_id,
   external_account_id, special_ad_categories, criado_pelo_sistema, criado_por_approval_id)
SELECT
  ar.company_id,
  'meta_ads'::integration_provider,
  ar.execution_result->'objeto'->>'name',
  coalesce(ar.payload->>'objetivo','OUTCOME_LEADS'),
  lower(ar.execution_result->'objeto'->>'status'),
  0,
  ar.execution_result->>'id_criado',
  replace(coalesce(ar.payload->>'conta_destino',''),'act_',''),
  ARRAY['FINANCIAL_PRODUCTS_SERVICES'],
  true,
  ar.id
FROM public.approval_requests ar
WHERE ar.action = 'criar_campanha'
  AND ar.executed_at IS NOT NULL
  AND (ar.execution_result->>'ok')::boolean IS TRUE
  AND ar.execution_result->>'id_criado' IS NOT NULL
ON CONFLICT (provider, external_id) DO NOTHING;