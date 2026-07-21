import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  num,
  type AccountRow,
  type AdRow,
  type AdSetRow,
  type CampaignRow,
  type Targeting,
  type TipoConta,
} from "@/lib/breakdown";

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

// Anúncios/criativos de uma empresa (tabela ads), maior gasto primeiro.
export function useAds(companyId: string | null) {
  return useQuery({
    queryKey: ["ads", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AdRow[]> => {
      const { data, error } = await supabase
        .from("ads")
        .select(
          "id,name,status,object_type,call_to_action_type,title,body,thumbnail_url,image_url,permalink_url,spend,impressions,reach,clicks,link_clicks,leads,sales,revenue,campaign_id",
        )
        .eq("company_id", companyId!)
        .order("spend", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name ?? "(sem nome)",
        status: r.status ?? "",
        object_type: r.object_type ?? null,
        call_to_action_type: r.call_to_action_type ?? null,
        title: r.title ?? null,
        body: r.body ?? null,
        thumbnail_url: r.thumbnail_url ?? null,
        image_url: r.image_url ?? null,
        permalink_url: r.permalink_url ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        reach: num(r.reach),
        clicks: num(r.clicks),
        link_clicks: num(r.link_clicks),
        leads: num(r.leads),
        sales: num(r.sales),
        revenue: num(r.revenue),
        campaign_id: r.campaign_id ?? null,
      }));
    },
  });
}

// Conjuntos de anúncios de uma empresa (tabela ad_sets), maior gasto primeiro.
export function useAdSets(companyId: string | null) {
  return useQuery({
    queryKey: ["ad_sets", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AdSetRow[]> => {
      const { data, error } = await supabase
        .from("ad_sets")
        .select(
          "id,name,status,daily_budget,lifetime_budget,bid_strategy,targeting,spend,impressions,reach,clicks,link_clicks,leads,sales,revenue,campaign_id",
        )
        .eq("company_id", companyId!)
        .order("spend", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name ?? "(sem nome)",
        status: r.status ?? "",
        daily_budget: r.daily_budget == null ? null : num(r.daily_budget),
        lifetime_budget: r.lifetime_budget == null ? null : num(r.lifetime_budget),
        bid_strategy: r.bid_strategy ?? null,
        targeting: (r.targeting ?? null) as Targeting | null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        reach: num(r.reach),
        clicks: num(r.clicks),
        link_clicks: num(r.link_clicks),
        leads: num(r.leads),
        sales: num(r.sales),
        revenue: num(r.revenue),
        campaign_id: r.campaign_id ?? null,
      }));
    },
  });
}
