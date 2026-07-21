import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { num, type AccountRow, type CampaignRow, type TipoConta } from "@/lib/breakdown";

// Contas de uma empresa (v_account_breakdown), já normalizadas para números.
export function useAccountBreakdown(companyId: string | null) {
  return useQuery({
    queryKey: ["v_account_breakdown", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from("v_account_breakdown")
        .select("*")
        .eq("company_id", companyId!)
        .order("spend", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        account_id: r.account_id ?? "",
        account_name: r.account_name ?? "(sem nome)",
        company_id: r.company_id ?? "",
        tipo_conta: (r.tipo_conta ?? "sem_dados") as TipoConta,
        campaigns: num(r.campaigns),
        spend: num(r.spend),
        clicks: num(r.clicks),
        link_clicks: num(r.link_clicks),
        landing_page_views: num(r.landing_page_views),
        messaging_started: num(r.messaging_started),
        form_leads: num(r.form_leads),
        leads: num(r.leads),
        sales: num(r.sales),
        revenue: num(r.revenue),
      }));
    },
  });
}

// Campanhas de uma empresa (v_campaign_breakdown), já normalizadas.
export function useCampaignBreakdown(companyId: string | null) {
  return useQuery({
    queryKey: ["v_campaign_breakdown", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CampaignRow[]> => {
      const { data, error } = await supabase
        .from("v_campaign_breakdown")
        .select("*")
        .eq("company_id", companyId!)
        .order("spend", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        company_id: r.company_id ?? "",
        empresa: r.empresa ?? "",
        account_id: r.account_id ?? "",
        account_name: r.account_name ?? "(sem nome)",
        campaign_id: r.campaign_id ?? "",
        campanha: r.campanha ?? "(sem nome)",
        objective: r.objective ?? null,
        tipo: (r.tipo ?? "outro") as TipoConta,
        status: r.status ?? "",
        spend: num(r.spend),
        impressions: num(r.impressions),
        reach: num(r.reach),
        frequency: num(r.frequency),
        clicks: num(r.clicks),
        link_clicks: num(r.link_clicks),
        landing_page_views: num(r.landing_page_views),
        messaging_started: num(r.messaging_started),
        form_leads: num(r.form_leads),
        leads: num(r.leads),
        sales: num(r.sales),
        revenue: num(r.revenue),
        cpl: r.cpl == null ? null : num(r.cpl),
        cpc_link: r.cpc_link == null ? null : num(r.cpc_link),
        last_synced_at: r.last_synced_at ?? null,
      }));
    },
  });
}
