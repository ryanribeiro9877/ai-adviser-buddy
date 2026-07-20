import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, Link2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/empresas")({
  component: EmpresasPage,
  head: () => ({ meta: [{ title: "Empresas e contas" }] }),
});

const PROVIDERS = [
  { id: "meta_ads", label: "Meta Ads" },
  { id: "google_ads", label: "Google Ads" },
  { id: "ga4", label: "Google Analytics 4" },
  { id: "gsc", label: "Search Console" },
  { id: "gtm", label: "Tag Manager" },
] as const;

function EmpresasPage() {
  const { isAdmin, companies, refreshCompanies, selectedCompanyId } = useApp();
  const [open, setOpen] = useState(false);

  const integrations = useQuery({
    queryKey: ["integrations", selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data } = await supabase.from("integrations").select("*").eq("company_id", selectedCompanyId!);
      return data ?? [];
    },
  });

  const createCompany = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name"));
    const industry = String(form.get("industry") || "");
    const { data: user } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("companies").insert({
      name, industry, created_by: user.user?.id,
    }).select().single();
    if (error) return toast.error(error.message);
    if (data && user.user) {
      await supabase.from("company_members").insert({ company_id: data.id, user_id: user.user.id });
      await logAudit({ companyId: data.id, action: "company.create", targetType: "company", targetId: data.id, details: { name } });
    }
    await refreshCompanies();
    toast.success("Empresa cadastrada");
    setOpen(false);
  };

  const connect = async (provider: string) => {
    if (!selectedCompanyId) return;
    const { error } = await supabase.from("integrations").insert({
      company_id: selectedCompanyId,
      provider: provider as never,
      account_name: `Conta ${provider.toUpperCase()} (mock)`,
      external_id: `mock-${Date.now()}`,
    });
    if (error) return toast.error(error.message);
    await logAudit({ companyId: selectedCompanyId, action: "integration.connect", targetType: "integration", details: { provider } });
    await integrations.refetch();
    toast.success("Conta conectada (mock)");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Empresas e contas</h1>
          <p className="text-sm text-muted-foreground">Gerencie empresas e conecte plataformas de anúncios/analytics.</p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Nova empresa</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
              <form onSubmit={createCompany} className="space-y-4">
                <div><Label>Nome</Label><Input name="name" required /></div>
                <div><Label>Setor</Label><Input name="industry" placeholder="Ex.: e-commerce, SaaS…" /></div>
                <DialogFooter><Button type="submit">Cadastrar</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {companies.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.industry || "—"}</div>
              </div>
            </div>
          </Card>
        ))}
        {companies.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground">Nenhuma empresa. {isAdmin ? "Cadastre a primeira acima." : "Peça a um admin."}</Card>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Integrações da empresa ativa</h2>
        <div className="grid md:grid-cols-5 gap-3">
          {PROVIDERS.map((p) => {
            const connected = integrations.data?.find((i) => i.provider === p.id);
            return (
              <Card key={p.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{p.label}</div>
                  {connected ? <Badge className="bg-[color:var(--color-success)] text-primary-foreground">Conectada</Badge> : <Badge variant="outline">Desconectada</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">{connected?.account_name ?? "Nenhuma conta"}</div>
                {isAdmin && !connected && (
                  <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => connect(p.id)}>
                    <Link2 className="h-3.5 w-3.5 mr-1" />Conectar (mock)
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
