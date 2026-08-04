-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804132524
-- name: teto_migra_para_targets_e_remove_duplicacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CORRECAO DE ERRO MEU. Criei campaign_spend_guard horas antes sem procurar
-- mecanismo existente. Ja havia: a tabela targets, com metric, valor, campaign_id, active,
-- fonte e memoria - suporte por campanha existia e nunca tinha sido usado (7 linhas, todas
-- com campaign_id nulo). E targets ainda e MELHOR que a minha tabela, porque ja tem campos
-- de procedencia (fonte, memoria) que eu teria que inventar de novo.
-- Mesma licao que este projeto ja documentou no CARD 12 do JurisAI: procurar mecanismo
-- existente ANTES de criar tabela.
-- Alem disso o Ryan mudou a direcao: em vez de alerta ao cruzar o teto, quer RELATORIO
-- DIARIO por campanha. Logo a funcao de avaliacao e a coleta intraday nao tem consumidor -
-- e codigo que finge ser capacidade e pior que codigo ausente.

-- 1) O teto declarado vira linha de targets, por campanha, com procedencia.
INSERT INTO public.targets (company_id, metric, valor, campaign_id, fonte, memoria, active)
SELECT g.company_id, 'teto_gasto_diario', g.teto_diario_reais, c.id,
       'declaracao humana',
       jsonb_build_object(
         'declarado_por', g.declarado_por,
         'declarado_em', g.declarado_em,
         'origem', 'Teto de R$ 60,00/dia por campanha nova - decisao do gestor Roberto em 31/07/2026, confirmada pelo Ryan em 04/08/2026.',
         'aviso_meta', 'A Meta trata orcamento diario como MEDIA e permite ate 175% num dia isolado (com R$ 60,00 o maximo diario e R$ 105,00 e o semanal R$ 420,00). Este teto e referencia de leitura, NAO limite imposto na plataforma.',
         'nao_confundir', 'Teto de GASTO DIARIO nao e teto de CUSTO POR RESULTADO. O campo de custo por resultado na Meta chama-se "Meta de custo por resultado" e esta vazio nestes conjuntos.'
       ),
       g.ativo
  FROM public.campaign_spend_guard g
  JOIN public.campaigns c ON c.external_id = g.campaign_external_id AND c.company_id = g.company_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.targets t
    WHERE t.campaign_id = c.id AND t.metric = 'teto_gasto_diario' AND t.active
 );

-- 2) Remove a duplicacao e o que nao tem consumidor.
DROP FUNCTION IF EXISTS public.evaluate_campaign_spend_alerts();
DROP TABLE IF EXISTS public.campaign_spend_intraday;
DROP TABLE IF EXISTS public.campaign_spend_guard;