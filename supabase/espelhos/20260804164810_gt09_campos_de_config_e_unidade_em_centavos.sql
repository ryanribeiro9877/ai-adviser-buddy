-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804164810
-- name: gt09_campos_de_config_e_unidade_em_centavos
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - GT-09, parte de banco. Rota B: a coleta vai pelo meta-campaign-status, que le a
-- LISTA de campanhas da Graph e por isso ve campanha pausada. O Windsor foi descartado porque so
-- devolve linha para campanha COM ENTREGA na janela - cobriria 2 de 29. Principio que decidiu,
-- do Claude Code: CONFIGURACAO E ESTADO, NAO METRICA.

-- ============================================================
-- 1) Colunas que faltavam. buying_type de bonus: vem no mesmo pacote e a meta-actions forca
--    AUCTION na criacao, entao ter o valor permite conferir se a Meta respeitou.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS lifetime_budget numeric,
  ADD COLUMN IF NOT EXISTS is_adset_budget_sharing_enabled boolean,
  ADD COLUMN IF NOT EXISTS buying_type text,
  ADD COLUMN IF NOT EXISTS config_coletada_em timestamptz;

-- ============================================================
-- 2) daily_budget era NOT NULL - e a restricao era o defeito: ela OBRIGA representar
--    desconhecimento como numero. Orcamento nao coletado nao e zero, e campanha ABO nao tem
--    orcamento de campanha nenhum. Nos dois casos o valor honesto e NULL.
ALTER TABLE public.campaigns ALTER COLUMN daily_budget DROP NOT NULL;

-- ============================================================
-- 3) UNIDADE. Havia 4 linhas em REAIS (250.00) enquanto ad_sets guarda CENTAVOS (31200 = R$ 312,00)
--    e a Graph manda centavos (25000 para a mesma campanha gravada como 250.00). Mesma coluna,
--    mesmo tipo, significados 100x diferentes entre tabelas. Nao era convencao: o
--    sync_ingest_windsor insere 0 fixo e nunca atualiza o campo, entao os 250,00 entraram por
--    outro caminho, de procedencia desconhecida.
--    ADOTO CENTAVOS. E as 4 linhas viram NULL em vez de x100 de proposito: valor de procedencia
--    desconhecida corrigido por multiplicacao continua desconhecido, agora com cara de confiavel.
--    NULL com config_coletada_em nula diz a verdade - "nao sei" - e a primeira coleta preenche.
UPDATE public.campaigns
   SET daily_budget = NULL
 WHERE coalesce(daily_budget,0) > 0
   AND config_coletada_em IS NULL
   AND criado_pelo_sistema IS NOT TRUE;

COMMENT ON COLUMN public.campaigns.config_coletada_em IS
  'Quando a configuracao desta campanha foi lida da Graph pela ultima vez. NULL = NUNCA coletada, e nesse caso bid_strategy, orcamentos e categoria nulos NAO significam ausencia - significam desconhecimento. Resolve a ambiguidade para TODOS os campos de config de uma vez, inclusive os que o proprio valor nao consegue distinguir. Preenchida pelo meta-campaign-status.';
COMMENT ON COLUMN public.campaigns.daily_budget IS
  'Orcamento diario da campanha em CENTAVOS, igual a ad_sets.daily_budget e igual ao que a Graph devolve. NULO em campanha ABO (o orcamento vive no conjunto) e PREENCHIDO em CBO - essa e a leitura que distingue os dois regimes. Se config_coletada_em for nulo, o nulo aqui significa "nao coletado", nao "ABO".';
COMMENT ON COLUMN public.campaigns.lifetime_budget IS
  'Orcamento total da campanha em CENTAVOS. A Graph devolve 0 quando nao ha orcamento vitalicio.';
COMMENT ON COLUMN public.campaigns.is_adset_budget_sharing_enabled IS
  'Medido em 04/08 nos dois regimes: a Meta devolve false tanto em ABO quanto em CBO, entao este campo NAO distingue os dois. Quem distingue e daily_budget. Serve para conferir se a Meta respeitou o false que a meta-actions v4 forca na criacao.';
COMMENT ON COLUMN public.campaigns.categoria_especial_verificada_em IS
  'Quando a categoria especial foi confirmada NA META (nao no espelho). Preenchida junto de config_coletada_em. Distinta de special_ad_categories: array {} significa "a Meta disse que nao tem categoria"; array nulo com esta coluna nula significa "nunca verifiquei".';

-- ============================================================
-- 4) Fato para o agente: os nulos de config tem dois significados.
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('armadilha',
  'CONFIGURACAO DE CAMPANHA - NULO TEM DOIS SIGNIFICADOS, NAO CONFUNDA (04/08/2026). Os campos '
  || 'bid_strategy, daily_budget, lifetime_budget, special_ad_categories e buying_type de uma campanha '
  || 'so sao confiaveis se config_coletada_em estiver PREENCHIDO. '
  || 'SE config_coletada_em FOR NULO: a configuracao daquela campanha NUNCA foi lida da Meta, e todo nulo '
  || 'nos campos acima significa DESCONHECIMENTO, nao ausencia. Nao diga "a campanha nao tem teto de lance" '
  || 'nem "nao declara categoria especial" nesse caso - diga que nao esta verificado. '
  || 'SE ESTIVER PREENCHIDO: o nulo passa a ser informacao real. Em particular, daily_budget NULO com config '
  || 'coletada significa campanha ABO (o orcamento vive no conjunto) e PREENCHIDO significa CBO - essa e a '
  || 'leitura que distingue os dois regimes. O campo is_adset_budget_sharing_enabled NAO distingue: medido em '
  || '04/08, a Meta devolve false nos dois. '
  || 'UNIDADE: orcamento de campanha e de conjunto estao em CENTAVOS. 6000 e R$ 60,00. Nunca apresente o '
  || 'numero cru ao gestor. '
  || 'COBERTURA: a coleta le a lista de campanhas das contas que o token alcanca. Conta inacessivel (o cron '
  || 'de 03/08 reportou 1 conta acessivel de 20) fica com config nula para sempre - e e por isso que a marca '
  || 'de coleta existe.',
  true, '2026-08-04', now(), NULL);