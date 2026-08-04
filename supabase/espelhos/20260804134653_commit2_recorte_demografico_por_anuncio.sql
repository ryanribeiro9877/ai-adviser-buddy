-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804134653
-- name: commit2_recorte_demografico_por_anuncio
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - COMMIT 2 (parte de banco): recorte de metrica por faixa.
-- NOME: metric_breakdown_daily, e nao campaign_breakdown_daily como no briefing. Motivo: a
-- linha e de ANUNCIO, nao de campanha - guardar como "campaign_" mentiria sobre a granularidade,
-- e ja existe a view v_campaign_breakdown, que e outra coisa.
-- SUGESTAO DO CODE ACEITA: guardar ad_external_id. O argumento e assimetrico e correto - da
-- anuncio se soma para campanha, de campanha nao se decompoe para anuncio. Custa uma coluna.
-- ARMADILHA APLICADA: valor_recorte e NOT NULL e a RPC troca vazio/null por 'desconhecido',
-- porque NULL nao colide em UNIQUE - sem isso o balde sem rotulo duplicaria a cada coleta.

CREATE TABLE IF NOT EXISTS public.metric_breakdown_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  account_id            text,
  campaign_external_id  text,
  ad_external_id        text NOT NULL,
  snapshot_date         date NOT NULL,
  tipo_recorte          text NOT NULL CHECK (tipo_recorte IN ('idade','genero','plataforma','posicionamento')),
  valor_recorte         text NOT NULL,
  spend                 numeric NOT NULL DEFAULT 0,
  impressions           bigint  NOT NULL DEFAULT 0,
  reach                 bigint  NOT NULL DEFAULT 0,
  clicks                bigint  NOT NULL DEFAULT 0,
  link_clicks           bigint  NOT NULL DEFAULT 0,
  landing_page_views    bigint  NOT NULL DEFAULT 0,
  form_leads            bigint  NOT NULL DEFAULT 0,
  leads                 bigint  NOT NULL DEFAULT 0,
  fonte                 text    NOT NULL DEFAULT 'windsor:facebook',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_breakdown UNIQUE (ad_external_id, snapshot_date, tipo_recorte, valor_recorte)
);

COMMENT ON TABLE public.metric_breakdown_daily IS
  'Metrica por faixa (idade, genero, plataforma, posicionamento) no nivel de ANUNCIO. Some para chegar a campanha. ALCANCE NAO SOMA: reach e gente deduplicada e a mesma pessoa aparece em mais de um balde (medido em 04/08: 2.938 na soma contra 2.967 no total, -1,0%). Impressoes, gasto, cliques e formularios FECHAM exato na mesma leitura.';

CREATE INDEX IF NOT EXISTS ix_breakdown_campanha_dia
  ON public.metric_breakdown_daily (campaign_external_id, snapshot_date DESC, tipo_recorte);
CREATE INDEX IF NOT EXISTS ix_breakdown_empresa_dia
  ON public.metric_breakdown_daily (company_id, snapshot_date DESC);

ALTER TABLE public.metric_breakdown_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY breakdown_leitura ON public.metric_breakdown_daily
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

-- RPC de ingestao, no padrao das existentes (sync_ingest_ad_snapshots).
CREATE OR REPLACE FUNCTION public.sync_ingest_breakdown(p jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare n int;
begin
  with rows as (
    select * from jsonb_to_recordset(p) as r(
      account_id text, campaign_external_id text, ad_external_id text, snapshot_date date,
      tipo_recorte text, valor_recorte text,
      spend numeric, impressions bigint, reach bigint, clicks bigint, link_clicks bigint,
      landing_page_views bigint, form_leads bigint
    )
  ),
  mapped as (
    select r.*, i.company_id,
           -- NULL nao colide em UNIQUE: balde sem rotulo vira 'desconhecido' e passa a colidir.
           coalesce(nullif(trim(r.valor_recorte),''),'desconhecido') as valor_norm
      from rows r
      left join public.integrations i on i.external_id = r.account_id and i.provider='meta_ads'
     where r.ad_external_id is not null and r.snapshot_date is not null
       and r.tipo_recorte in ('idade','genero','plataforma','posicionamento')
  ),
  up as (
    insert into public.metric_breakdown_daily (
      company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_recorte,
      spend, impressions, reach, clicks, link_clicks, landing_page_views, form_leads, leads)
    select company_id, account_id, campaign_external_id, ad_external_id, snapshot_date,
      tipo_recorte, valor_norm,
      coalesce(spend,0), coalesce(impressions,0), coalesce(reach,0), coalesce(clicks,0),
      coalesce(link_clicks,0), coalesce(landing_page_views,0), coalesce(form_leads,0),
      coalesce(form_leads,0)
    from mapped
    on conflict (ad_external_id, snapshot_date, tipo_recorte, valor_recorte) do update set
      company_id=excluded.company_id, account_id=excluded.account_id,
      campaign_external_id=excluded.campaign_external_id,
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach,
      clicks=excluded.clicks, link_clicks=excluded.link_clicks,
      landing_page_views=excluded.landing_page_views, form_leads=excluded.form_leads,
      leads=excluded.leads
    returning 1)
  select count(*) into n from up; return n;
end $function$;

-- ============================================================
-- FATO NOVO: a Meta REESCREVE dias passados. Achado do Code em 04/08.
-- ============================================================
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('armadilha',
  'A META REESCREVE DIAS JA FECHADOS - RESTATEMENT (medido em 04/08/2026). O anuncio 120254...630191 '
  || 'tinha gasto R$ 70,64 gravado para 03/08 pela coleta das 09:00, e na releitura do mesmo dia a '
  || 'plataforma devolveu R$ 72,33. O numero do passado MUDOU depois de coletado. '
  || 'CONSEQUENCIAS QUE VOCE DEVE APLICAR: (1) o banco e verdade sobre O QUE FOI COLETADO, nao '
  || 'necessariamente sobre o que a Meta diz AGORA - ao citar numero de dia anterior, ele vale para a '
  || 'leitura que temos; (2) toda auditoria de fechamento (soma de recorte contra total) tem que comparar '
  || 'valores da MESMA leitura - comparar recorte novo com total antigo produz diferenca que e defasagem, '
  || 'nao erro; (3) diferenca pequena entre o que voce disse ontem e o numero de hoje para o mesmo dia '
  || 'pode ser restatement, e nao contradicao sua - verifique antes de se corrigir; (4) a ingestao usa '
  || 'ON CONFLICT DO UPDATE, entao restatement E absorvido - mas SOMENTE nos dias que a coleta relê. '
  || 'Dia fora da janela de releitura fica congelado no valor antigo para sempre.',
  true, '2026-08-04', now(), NULL);