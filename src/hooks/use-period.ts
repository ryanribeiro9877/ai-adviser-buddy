import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCampaignBreakdown } from "@/hooks/use-breakdown";
import { num, type CampaignRow } from "@/lib/breakdown";
import type { ISODate } from "@/lib/filters";

// Linha bruta de metric_snapshots (colunas selecionadas). Tipada localmente
// porque a tabela ainda não consta do types.ts gerado (arquivo defasado).
type SnapshotSelectRow = {
  campaign_id: string | null;
  spend: number | string | null;
  impressions: number | string | null;
  reach: number | string | null;
  clicks: number | string | null;
  link_clicks: number | string | null;
  landing_page_views: number | string | null;
  messaging_started: number | string | null;
  form_leads: number | string | null;
  leads: number | string | null;
  sales: number | string | null;
  revenue: number | string | null;
};

// Métricas somáveis de metric_snapshots (série diária por campanha).
type SnapshotAgg = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  landing_page_views: number;
  messaging_started: number;
  form_leads: number;
  leads: number;
  sales: number;
  revenue: number;
};

const emptyAgg = (): SnapshotAgg => ({
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  link_clicks: 0,
  landing_page_views: 0,
  messaging_started: 0,
  form_leads: 0,
  leads: 0,
  sales: 0,
  revenue: 0,
});

// Soma metric_snapshots por campanha no range [start, end] (inclusive).
function useCampaignSnapshots(companyId: string | null, range: { start: ISODate; end: ISODate }) {
  return useQuery({
    queryKey: ["campaign-snapshots", companyId, range.start, range.end],
    enabled: !!companyId && !!range.start && !!range.end,
    queryFn: async (): Promise<Map<string, SnapshotAgg>> => {
      const db = supabase as unknown as SupabaseClient;
      const { data, error } = await db
        .from("metric_snapshots")
        .select(
          "campaign_id,spend,impressions,reach,clicks,link_clicks,landing_page_views,messaging_started,form_leads,leads,sales,revenue",
        )
        .eq("company_id", companyId!)
        .gte("snapshot_date", range.start)
        .lte("snapshot_date", range.end);
      if (error) throw error;

      const map = new Map<string, SnapshotAgg>();
      for (const r of (data ?? []) as SnapshotSelectRow[]) {
        const id = r.campaign_id ?? "";
        if (!id) continue;
        const a = map.get(id) ?? emptyAgg();
        a.spend += num(r.spend);
        a.impressions += num(r.impressions);
        a.reach += num(r.reach);
        a.clicks += num(r.clicks);
        a.link_clicks += num(r.link_clicks);
        a.landing_page_views += num(r.landing_page_views);
        a.messaging_started += num(r.messaging_started);
        a.form_leads += num(r.form_leads);
        a.leads += num(r.leads);
        a.sales += num(r.sales);
        a.revenue += num(r.revenue);
        map.set(id, a);
      }
      return map;
    },
  });
}

// Campanhas com métricas do PERÍODO (via metric_snapshots) + metadados
// (nome, conta, tipo, status, objetivo) da view v_campaign_breakdown.
// Range = "Todo o período" reconcilia exatamente com o agregado (banco = tela).
export function usePeriodCampaigns(
  companyId: string | null,
  range: { start: ISODate; end: ISODate },
) {
  const metaQ = useCampaignBreakdown(companyId);
  const snapsQ = useCampaignSnapshots(companyId, range);

  const rows = useMemo<CampaignRow[]>(() => {
    const meta = metaQ.data ?? [];
    const snaps = snapsQ.data;
    if (!snaps) return [];
    return meta.map((m) => {
      const s = snaps.get(m.campaign_id) ?? emptyAgg();
      return {
        ...m,
        spend: s.spend,
        impressions: s.impressions,
        reach: s.reach,
        clicks: s.clicks,
        link_clicks: s.link_clicks,
        landing_page_views: s.landing_page_views,
        messaging_started: s.messaging_started,
        form_leads: s.form_leads,
        leads: s.leads,
        sales: s.sales,
        revenue: s.revenue,
        // CPL/CPC-link recalculados sobre o período (guard de divisão por zero).
        cpl: s.leads > 0 ? s.spend / s.leads : null,
        cpc_link: s.link_clicks > 0 ? s.spend / s.link_clicks : null,
      };
    });
  }, [metaQ.data, snapsQ.data]);

  return {
    data: rows,
    isLoading: metaQ.isLoading || snapsQ.isLoading,
    isError: metaQ.isError || snapsQ.isError,
  };
}
