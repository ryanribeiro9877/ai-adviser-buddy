import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "viewer";
export type Company = { id: string; name: string; industry: string | null };

type Ctx = {
  user: User;
  role: AppRole;
  isAdmin: boolean;
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  setSelectedCompanyId: (id: string) => void;
  refreshCompanies: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "gt-selected-company";

// Empresa inicial: a URL manda (query param ?company=); o localStorage só semeia
// quando a URL não traz nenhuma (F0.1, decisão de produto). Sem localStorage novo.
function initialCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("company");
  if (fromUrl && /^[0-9a-f-]{36}$/i.test(fromUrl)) return fromUrl;
  return localStorage.getItem(STORAGE_KEY);
}

export function AppProvider({ user, children }: { user: User; children: ReactNode }) {
  const navigate = useNavigate();
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(initialCompanyId);

  const rolesQuery = useQuery({
    queryKey: ["roles", user.id],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return data?.map((r) => r.role) ?? [];
    },
  });

  const companiesQuery = useQuery({
    queryKey: ["companies", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name, industry").order("created_at");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });

  const companies = companiesQuery.data ?? [];
  const role: AppRole = rolesQuery.data?.includes("admin") ? "admin" : "viewer";

  useEffect(() => {
    if (companies.length > 0 && (!selectedCompanyId || !companies.find((c) => c.id === selectedCompanyId))) {
      setSelectedCompanyIdState(companies[0].id);
      localStorage.setItem(STORAGE_KEY, companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  const setSelectedCompanyId = (id: string) => {
    setSelectedCompanyIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Reflete a empresa na URL da rota atual (fonte da verdade / compartilhável).
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, company: id }),
      replace: true,
    });
  };

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;

  return (
    <AppCtx.Provider
      value={{
        user,
        role,
        isAdmin: role === "admin",
        companies,
        selectedCompanyId,
        selectedCompany,
        setSelectedCompanyId,
        refreshCompanies: async () => {
          await companiesQuery.refetch();
        },
      }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export async function logAudit(params: {
  companyId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return;
  await supabase.from("audit_log").insert({
    company_id: params.companyId,
    user_id: session.user.id,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    details: (params.details ?? {}) as never,
  });
}
