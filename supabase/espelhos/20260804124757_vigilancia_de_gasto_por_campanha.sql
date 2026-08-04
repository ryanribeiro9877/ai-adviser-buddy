-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804124757
-- name: vigilancia_de_gasto_por_campanha
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - VIGILANCIA DE GASTO DIARIO POR CAMPANHA (decisao do Ryan, 04/08).
-- CONTEXTO: a Meta trata orcamento diario como MEDIA e permite ate 175% num dia isolado
-- (com R$ 60,00/dia ela declara na propria tela: "limite maximo diario R$ 105,00, semanal
-- R$ 420,00"). O Ryan escolheu NAO usar limite rigido de gasto (opcao C) e sim ser avisado
-- quando o dia passar do teto declarado, para decidir pausar ou seguir.
-- MEDIDO ANTES DE DESENHAR: nas campanhas que entregam, estourar o orcamento acontece em
-- 40 a 50% dos dias - [C2-NOVO-LEILAO] 7 de 14 dias, WPP-CTWA 8 de 20. Nao e anomalia, e
-- pacing normal. Por isso o limiar NAO e o orcamento: e um valor declarado acima dele.
-- POR QUE O TETO E DECLARADO POR CAMPANHA e nao um numero global: a campanha lider gasta
-- ate R$ 767/dia com orcamento somado de R$ 2.308; um limiar absoluto de R$ 70 dispararia
-- nela todos os dias. Campanha sem teto declarado NAO e vigiada - e nao se finge que e.

-- ============================================================
-- 1) O TETO DECLARADO. Numero de humano, com dono e data - nunca inferido de orcamento.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_spend_guard (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_external_id   text NOT NULL,
  campaign_nome          text,
  teto_diario_reais      numeric NOT NULL CHECK (teto_diario_reais > 0),
  alerta_acima_de_reais  numeric NOT NULL CHECK (alerta_acima_de_reais > 0),
  ativo                  boolean NOT NULL DEFAULT true,
  declarado_por          text NOT NULL,
  declarado_em           date NOT NULL,
  observacao             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_spend_guard_campanha UNIQUE (campaign_external_id),
  CONSTRAINT chk_alerta_acima_do_teto CHECK (alerta_acima_de_reais >= teto_diario_reais)
);
COMMENT ON TABLE public.campaign_spend_guard IS
  'Teto diario DECLARADO por campanha e o valor a partir do qual se alerta. Campanha ausente desta tabela nao e vigiada.';

-- ============================================================
-- 2) LEITURAS DE GASTO DURANTE O DIA. metric_snapshots e diario e chega com 1 dia de atraso
--    (comprovado: mais recente = 03/08 em 04/08, fonte windsor:facebook). Esta tabela guarda
--    a ACUMULACAO do dia corrente, varias leituras por dia, para dar a hora do cruzamento.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaign_spend_intraday (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_external_id  text NOT NULL,
  dia                   date NOT NULL,
  gasto_reais           numeric NOT NULL CHECK (gasto_reais >= 0),
  lido_em               timestamptz NOT NULL DEFAULT now(),
  fonte                 text NOT NULL DEFAULT 'graph:insights',
  CONSTRAINT uq_intraday UNIQUE (campaign_external_id, dia, lido_em)
);
CREATE INDEX IF NOT EXISTS ix_intraday_campanha_dia
  ON public.campaign_spend_intraday (campaign_external_id, dia DESC, lido_em DESC);

ALTER TABLE public.campaign_spend_guard    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_spend_intraday ENABLE ROW LEVEL SECURITY;
CREATE POLICY guard_leitura   ON public.campaign_spend_guard    FOR SELECT USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY intraday_leitura ON public.campaign_spend_intraday FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

-- ============================================================
-- 3) A AVALIACAO. Um alerta por campanha por dia - nao um por ciclo de cron. Alerta que
--    repete a cada 15 minutos e anestesia, nao protecao.
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_campaign_spend_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_criados int := 0; v_avaliados int := 0; v_titulo text; v_uuid uuid;
BEGIN
  FOR r IN
    SELECT g.company_id, g.campaign_external_id, g.campaign_nome,
           g.teto_diario_reais, g.alerta_acima_de_reais,
           i.gasto_reais, i.lido_em, i.dia
      FROM campaign_spend_guard g
      JOIN LATERAL (
        SELECT gasto_reais, lido_em, dia FROM campaign_spend_intraday x
         WHERE x.campaign_external_id = g.campaign_external_id
           AND x.dia = current_date
         ORDER BY x.lido_em DESC LIMIT 1
      ) i ON true
     WHERE g.ativo
  LOOP
    v_avaliados := v_avaliados + 1;
    CONTINUE WHEN r.gasto_reais <= r.alerta_acima_de_reais;

    -- Titulo carrega a data: e a chave de deduplicacao por dia.
    v_titulo := 'Gasto do dia acima do teto declarado - ' || coalesce(r.campaign_nome, r.campaign_external_id)
                || ' (' || to_char(r.dia,'DD/MM') || ')';

    CONTINUE WHEN EXISTS (SELECT 1 FROM alerts a WHERE a.title = v_titulo AND a.company_id = r.company_id);

    SELECT id INTO v_uuid FROM campaigns
     WHERE external_id = r.campaign_external_id AND company_id = r.company_id LIMIT 1;

    INSERT INTO alerts (company_id, severity, title, description, resolved, campaign_id, triggered_value)
    VALUES (
      r.company_id, 'high'::alert_severity, v_titulo,
      'A campanha ja gastou R$ ' || to_char(r.gasto_reais,'FM999999990.00') || ' hoje, acima do limite de aviso de R$ '
      || to_char(r.alerta_acima_de_reais,'FM999999990.00') || ' (teto declarado: R$ '
      || to_char(r.teto_diario_reais,'FM999999990.00') || '/dia). Leitura de '
      || to_char(r.lido_em AT TIME ZONE 'America/Bahia','DD/MM HH24:MI')
      || '. IMPORTANTE: esta leitura tem atraso de ate 15 minutos mais a latencia da propria Meta, '
      || 'entao o gasto real neste instante pode ser maior. A Meta trata orcamento diario como MEDIA e '
      || 'permite ate 175% num dia isolado, garantindo o teto SEMANAL - passar do teto nao e defeito da '
      || 'plataforma, e comportamento dela. DECIDA: pausar a campanha no Gerenciador, ou seguir aceitando '
      || 'o gasto do dia. Este aviso nao se repete hoje para esta campanha.',
      false, v_uuid, r.gasto_reais
    );
    v_criados := v_criados + 1;
  END LOOP;

  RETURN jsonb_build_object('avaliados', v_avaliados, 'alertas_criados', v_criados, 'em', now());
END $$;

REVOKE ALL ON FUNCTION public.evaluate_campaign_spend_alerts() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4) SEED: as tres campanhas de teste, com o numero que o Ryan declarou hoje.
-- ============================================================
INSERT INTO public.campaign_spend_guard
  (company_id, campaign_external_id, campaign_nome, teto_diario_reais, alerta_acima_de_reais,
   declarado_por, declarado_em, observacao)
SELECT c.company_id, c.external_id, c.name, 60.00, 69.99, 'Ryan', '2026-08-04',
       'Teto de R$ 60/dia decidido pelo gestor em 31/07; limiar de aviso R$ 69,99 declarado pelo Ryan em 04/08. Nao vigiamos campanha sem teto declarado.'
  FROM campaigns c
 WHERE c.criado_pelo_sistema
ON CONFLICT (campaign_external_id) DO NOTHING;