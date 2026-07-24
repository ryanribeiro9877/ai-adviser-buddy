-- =============================================================================
-- ESPELHO (já aplicado — NÃO re-executar; commit p/ histórico)
-- Migração: f43_compliance_rules · 24/07/2026 · gestão_marketing (gzjwnjdpxpbmdhcyefvs)
-- =============================================================================
-- F4.3 FECHADO 5/5: base de regras VERSIONADA (16 regras FIN/CRI/LGL) + edge
-- compliance-check v2 (motor multimodal; veredito DETERMINÍSTICO calculado pela
-- edge a partir das severidades da base — o modelo só identifica violações) +
-- comando no chat (traffic-chat v11, tool check_compliance chama o motor via
-- edge-to-edge; 1ª imagem anexada vai automaticamente). BATERIA 10/10 aprovada:
-- 8 legendas (FIN-01/03/05/06/07, LGL-02 pegos; 2 limpas aprovadas) + 2 criativos
-- (falso-PIX reprovado CRI-03+FIN-01/02+CRI-05; limpo aprovado).
-- F4.4 FECHADO 4/4: edge bm-monitor v1 (conta/cobrança/reprovados/issues →
-- alerts com dedup; fallback de cobrança documentado: Graph não expõe fatura
-- vencida, sinal = account_status=3 UNSETTLED + conferência manual no Gerenciador
-- de Pagamentos) + cron bm-monitor-0920 (09:20 UTC diário) + teste sintético
-- validado no motor E no chat + dedup provado.
-- Baseline real 24/07: conta ATIVA, saldo não faturado R$69,31 (VISA *1352),
-- 0 reprovados, 0 issues.
-- Edges p/ download: compliance-check v2, bm-monitor v1, traffic-chat v11(deploy 12).
-- Regra de manutenção: NUNCA editar regra in-place — inserir version+1 e marcar
-- active=false na anterior (unique code+version garante o histórico).
-- =============================================================================

create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  categoria text not null check (categoria in ('legenda','criativo','ambos')),
  severidade text not null check (severidade in ('bloqueia','atencao')),
  regra text not null,
  fonte text,
  exemplos_violacao text,
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, version)
);
comment on table public.compliance_rules is 'F4.3: regras de compliance p/ anúncios (consignado). Versionada: mudanças criam version nova; active=false na antiga.';
alter table public.compliance_rules enable row level security;
create policy compliance_rules_read on public.compliance_rules for select to authenticated using (true);

-- Seed v1 (16 regras): FIN-01 aprovação garantida/sem análise · FIN-02 dinheiro fácil ·
-- FIN-03 vínculo INSS/governo · FIN-04 taxa "a partir de"/CET · FIN-05 senha/dados ·
-- FIN-06 urgência artificial · FIN-07 limpar nome garantido · FIN-08 vulnerabilidade idoso ·
-- CRI-01 logos/brasões · CRI-02 dinheiro em espécie · CRI-03 interface falsa/PIX fake ·
-- CRI-04 figura pública · CRI-05 texto na arte coerente · LGL-01 natureza do produto ·
-- LGL-02 valor pré-aprovado nominal · LGL-03 canal oficial.
-- (INSERT completo com enunciados/fontes/exemplos conforme aplicado em produção —
--  consultar a tabela ou a migração f43_compliance_rules no histórico do Supabase.)
