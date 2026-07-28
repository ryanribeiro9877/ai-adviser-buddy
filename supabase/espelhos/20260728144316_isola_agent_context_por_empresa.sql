-- 20260728144316_isola_agent_context_por_empresa.sql
-- Espelho da migracao aplicada em producao (projeto gzjwnjdpxpbmdhcyefvs).
-- Extraido de supabase_migrations.schema_migrations - e o SQL EXATO que rodou.
-- NAO re-executar: ja esta aplicado.

-- =====================================================================================
-- ISOLAMENTO DA MEMORIA INSTITUCIONAL POR EMPRESA
-- Achado do contrato tecnico do Roberto (28/07), confirmado por schema: agent_context nao
-- tem company_id. Existem 2 empresas no banco (Legal e Viver e COHAPM) e a memoria e
-- injetada em TODA conversa - fatos especificos da Legal (campanhas de WhatsApp pausadas,
-- WABAs desaparecidas, instrumentacao de UTM em junho) apareceriam numa conversa da COHAPM
-- como se fossem dela. Isso e contaminacao cruzada de portfolio e causa alucinacao.
--
-- DESENHO: company_id NULLABLE. NULL = fato universal (vale para todas as empresas: regras
-- anti-alucinacao, escopo, formato de recomendacao, conhecimento de plataforma). Preenchido =
-- fato daquela empresa apenas (incidentes, contas, historico de instrumentacao).
-- O agente carrega: fatos universais + fatos da empresa da conversa.
--
-- agent_style e agent_knowledge NAO recebem company_id de proposito: formatacao e conhecimento
-- de Meta Ads sao universais por natureza. Se um dia houver estilo por cliente, adicionar la.
-- =====================================================================================

alter table public.agent_context
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

comment on column public.agent_context.company_id is
  'NULL = fato universal (vale para todas as empresas). Preenchido = fato exclusivo daquela empresa. O traffic-chat v26+ carrega os universais MAIS os da empresa da conversa, nunca os de outra empresa.';

create index if not exists idx_agent_context_company on public.agent_context (company_id) where vigente;

-- Classificacao dos fatos existentes. Os que citam a operacao concreta da Legal e Viver
-- (conta, campanhas, incidentes, instrumentacao, CRM) passam a ser dela; os que sao regra de
-- raciocinio, escopo ou formato continuam universais.
update public.agent_context
   set company_id = (select id from companies where name ilike '%legal%' order by created_at limit 1)
 where vigente
   and (
     fato ilike '%act_3302001729967572%'
     or fato ilike '%LEV_WPP%' or fato ilike '%[LEV]%'
     or fato ilike '%WABA%'
     or fato ilike '%dash.legaleviver%'
     or fato ilike '%trafegar-midias%'
     or fato ilike '%JUL26v2%'
     or fato ilike '%consignado%'
     or fato ilike '%INSS%'
     or fato ilike '%facebook_leads%'
   );
