import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  num,
  type AccountRow,
  type AdRow,
  type AdSetRow,
  type BaseDeResultado,
  type CampaignRow,
  type Targeting,
  type TipoConta,
} from "@/lib/breakdown";

const PAGINA = 1000;

// O PostgREST corta em silencio no teto da API. Paginar ate a pagina curta
// e, se mesmo assim nao acabar, falhar — lista truncada que nao se anuncia
// e pior do que erro.
async function lerTudo<T>(
  pedir: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let pagina = 0; pagina < 50; pagina++) {
    const de = pagina * PAGINA;
    const { data, error } = await pedir(de, de + PAGINA - 1);
    if (error) throw error;
    const linhas = data ?? [];
    tudo.push(...linhas);
    if (linhas.length < PAGINA) return tudo;
  }
  throw new Error("a lista passou de 50 mil linhas e a tela nao corta em silencio");
}

// Contas de uma empresa (v_account_breakdown), já normalizadas para números.
export function useAccountBreakdown(companyId: string | null) {
  return useQuery({
    queryKey: ["v_account_breakdown", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AccountRow[]> => {
      const data = await lerTudo((de, ate) =>
        supabase
          .from("v_account_breakdown")
          .select("*")
          .eq("company_id", companyId!)
          .order("spend", { ascending: false })
          .range(de, ate),
      );
      return data.map((r) => ({
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
        gasto_em_formulario: num(r.gasto_em_formulario),
        gasto_em_conversa: num(r.gasto_em_conversa),
        gasto_em_trafego: num(r.gasto_em_trafego),
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
      const data = await lerTudo((de, ate) =>
        supabase
          .from("v_campaign_breakdown")
          .select("*")
          .eq("company_id", companyId!)
          .is("ausente_na_graph_em", null)
          .order("spend", { ascending: false })
          .range(de, ate),
      );
      return data.map((r) => ({
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
        sales: num(r.sales),
        revenue: num(r.revenue),
        base_de_resultado: (r.base_de_resultado ?? "formularios") as BaseDeResultado,
        rotulo_do_custo: r.rotulo_do_custo ?? "por resultado",
        unidade_do_resultado: r.unidade_do_resultado ?? "resultados",
        resultados: num(r.resultados),
        custo_por_resultado: r.custo_por_resultado == null ? null : num(r.custo_por_resultado),
        cpc_link: r.cpc_link == null ? null : num(r.cpc_link),
        last_synced_at: r.last_synced_at ?? null,
        effective_status: r.effective_status ?? null,
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
      const data = await lerTudo((de, ate) =>
        supabase
          .from("ads")
          .select(
            // `leads` saiu: coluna sem base declarada e sem escritor vivo. Formulario e conversa
            // vem separados, cada um com o nome do que e.
            "id,name,status,effective_status,object_type,call_to_action_type,title,body,thumbnail_url,image_url,permalink_url,spend,impressions,reach,clicks,link_clicks,form_leads,messaging_started,sales,revenue,campaign_id,created_at,last_synced_at",
          )
          .eq("company_id", companyId!)
          .is("ausente_na_graph_em", null)
          .order("created_at", { ascending: false })
          .range(de, ate),
      );
      return data.map((r) => ({
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
        form_leads: num(r.form_leads),
        messaging_started: num(r.messaging_started),
        sales: num(r.sales),
        revenue: num(r.revenue),
        campaign_id: r.campaign_id ?? null,
        effective_status: r.effective_status ?? null,
        created_at: r.created_at ?? null,
        last_synced_at: r.last_synced_at ?? null,
      }));
    },
  });
}

// Conjuntos de anúncios de uma empresa. Os que a Meta nao devolve mais ficam de fora.
// A ordem padrao e a chegada no espelho: conjunto novo tem gasto zero e nao pode
// ir para o fim da lista.
export function useAdSets(companyId: string | null) {
  return useQuery({
    queryKey: ["ad_sets", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<AdSetRow[]> => {
      const data = await lerTudo((de, ate) =>
        supabase
          .from("ad_sets")
          .select(
            "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,targeting,spend,impressions,reach,clicks,link_clicks,form_leads,messaging_started,sales,revenue,campaign_id,created_at,last_synced_at",
          )
          .eq("company_id", companyId!)
          .is("ausente_na_graph_em", null)
          .order("created_at", { ascending: false })
          .range(de, ate),
      );
      return data.map((r) => ({
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
        form_leads: num(r.form_leads),
        messaging_started: num(r.messaging_started),
        sales: num(r.sales),
        revenue: num(r.revenue),
        campaign_id: r.campaign_id ?? null,
        effective_status: r.effective_status ?? null,
        created_at: r.created_at ?? null,
        last_synced_at: r.last_synced_at ?? null,
      }));
    },
  });
}
