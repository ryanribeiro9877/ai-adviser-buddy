import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  cleanFilterSearch,
  MIN_DATE_FALLBACK,
  withFilterDefaults,
  type FilterSearch,
  type GlobalFilterState,
  type ISODate,
} from "@/lib/filters";

// Lê/escreve o estado dos filtros globais na URL da rota atual.
// strict:false permite reutilizar o mesmo hook em Campanhas/Conjuntos/Anúncios/Funil.
export function useGlobalFilters() {
  const search = useSearch({ strict: false }) as FilterSearch;
  const navigate = useNavigate();

  const state = useMemo<GlobalFilterState>(() => withFilterDefaults(search), [search]);

  const set = (patch: Partial<FilterSearch>) => {
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) =>
        cleanFilterSearch({ ...(prev as FilterSearch), ...patch }),
      replace: true,
    });
  };

  const clear = () => {
    navigate({
      to: ".",
      // preserva empresa; zera período/status/tipo.
      search: (prev: Record<string, unknown>) =>
        cleanFilterSearch({ company: (prev as FilterSearch).company }),
      replace: true,
    });
  };

  return { filters: state, setFilters: set, clearFilters: clear };
}

// min(snapshot_date) global — base do preset "Todo o período" (default dinâmico).
export function useSnapshotMinDate() {
  return useQuery({
    queryKey: ["snapshot-min-date"],
    staleTime: Infinity,
    queryFn: async (): Promise<ISODate> => {
      // metric_snapshots ainda não está no types.ts gerado (arquivo defasado);
      // usamos o client sem o generic do schema só para esta leitura.
      const db = supabase as unknown as SupabaseClient;
      const { data } = await db
        .from("metric_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: true })
        .limit(1);
      return (data?.[0]?.snapshot_date as ISODate) ?? MIN_DATE_FALLBACK;
    },
  });
}
