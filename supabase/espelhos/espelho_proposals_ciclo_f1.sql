-- ============================================================================
-- ESPELHO: Fase 1 — ciclo de propostas (criação -> v2 -> hardening -> dormência)
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicadas: 22/07/2026
-- Migrações: update_v_custo_proposta_metricas_dash, v_custo_proposta_security_invoker
--            + limpeza de dados (truncate, decisão de escopo)
-- ATENÇÃO: espelho para git. NÃO re-executar.
--
-- HISTÓRIA (para contexto de quem ler no futuro):
-- 1. F1.1 importou 78 propostas do Dash da Legal (telefone E.164 + UTM + custo)
--    e cruzou com campanhas: 36 casadas por UTM na [LEV][LP][LEADS][01.05.26];
--    36 de contas Meta sem insights via API (JCR2/Blip — nenhum usuário conectado
--    à Windsor enxerga essas contas); 6 TikTok (fora do escopo por decisão).
-- 2. A view v_custo_proposta foi promovida a v2 para separar a métrica OFICIAL
--    (custo_aquisicao_dash, carimbado pelo Dash, ~R$0,80) do rateio enganoso
--    (gasto_campanha/propostas, que inflava p/ R$621 com amostra parcial).
-- 3. Apontamento do Claude Code: a view ignorava RLS (rodava como dono).
--    Corrigido com security_invoker=on após mapear consumidores
--    (is_company_member tem bypass de admin embutido — front admin intacto).
-- 4. DECISÃO DE ESCOPO (Ryan, 22/07): o Gestor de Tráfego gere APENAS dados
--    primários de tráfego pago (Meta/WABA). Dados de proposta pertencem ao Dash
--    da Legal; o comparativo é feito FORA do sistema via exports dos dois lados.
--    As tabelas foram TRUNCADAS (PII de 78 pessoas removida do banco de
--    marketing — higiene LGPD) e mantidas DORMENTES com comentários no schema.
--    Reimportar, se o escopo mudar: exportar planilha do Dash (com UTM, via
--    Claude in Chrome), inserir em proposals_import, rodar match_proposals_batch.
--
-- APRENDIZADO PRESERVADO: o de-para telefone<->UTM<->campanha FUNCIONA; custo
-- real por proposta = custo_aquisicao do Dash; recomendação operacional ao
-- Roberto: concentrar campanhas novas na conta Meta principal (única legível).
-- ============================================================================

-- ------------------------------------------------------------------
-- Migração 1: v_custo_proposta v2 (métrica oficial vs rateio de referência)
-- ------------------------------------------------------------------
drop view public.v_custo_proposta;
create view public.v_custo_proposta as
select
  co.id  as company_id,
  co.name as empresa,
  c.id   as campaign_id,
  c.name as campanha,
  count(p.id) as propostas,
  round(c.spend::numeric, 2) as gasto_campanha,
  round(avg((p.raw->>'custo_aquisicao')::numeric), 2) as custo_aquisicao_dash,
  round(sum((p.raw->>'custo_total')::numeric), 2)     as custo_total_dash,
  round((c.spend::numeric / nullif(count(p.id),0)), 2) as rateio_meta_referencia
from public.campaigns c
join public.companies co on co.id = c.company_id
left join public.proposals p on p.campaign_id = c.id and p.matched
group by co.id, co.name, c.id, c.name, c.spend;

-- ------------------------------------------------------------------
-- Migração 2: RLS do consultante passa a valer na view
-- ------------------------------------------------------------------
alter view public.v_custo_proposta set (security_invoker = on);

-- ------------------------------------------------------------------
-- Limpeza (decisão de escopo — executada fora de migração versionada)
-- ------------------------------------------------------------------
truncate table public.proposals, public.proposals_import;
comment on table public.proposals is 'DORMENTE (22/07/2026, decisão Ryan): comparativo propostas×campanha é feito FORA do sistema via exports (Dash Legal × plataforma). Estrutura preservada; sem dados/PII. Reimportar via processo documentado se escopo mudar.';
comment on table public.proposals_import is 'DORMENTE (22/07/2026): staging do import de propostas. Ver comentário em proposals.';
