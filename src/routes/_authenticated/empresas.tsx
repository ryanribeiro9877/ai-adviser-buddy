import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Building2, Link2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  AVISO_NAO_VERIFICADA,
  conectadaDesde,
  ehFantasma,
  estadoExibido,
  ESTADO_META,
  mostrarMotivo,
  piorEstado,
  rankEstado,
  rotuloProvedor,
  type EstadoExibido,
  type Integracao,
} from "@/lib/integracoes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/empresas")({
  component: EmpresasPage,
  head: () => ({ meta: [{ title: "Empresas e contas" }] }),
});

const PROVIDERS = [
  { id: "meta_ads", label: "Meta Ads" },
  // ESP-45: GA4 / Search Console / Tag Manager ocultos na UI — nao ha integracao real.
] as const;

/** Badge de estado — mesma aparência na grade de provedores e na tabela. */
function BadgeEstado({ estado }: { estado: EstadoExibido }) {
  const meta = ESTADO_META[estado];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        meta.classe,
      )}
    >
      {meta.rotulo}
    </span>
  );
}

function EmpresasPage() {
  const { isAdmin, companies, refreshCompanies, selectedCompanyId } = useApp();
  const [open, setOpen] = useState(false);

  const integrations = useQuery({
    queryKey: ["integrations", selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select(
          "id, provider, account_name, external_id, status, estado_operacional, estado_motivo, connected_at",
        )
        .eq("company_id", selectedCompanyId!);
      if (error) throw error;
      return (data ?? []) as Integracao[];
    },
  });

  const linhas = useMemo(() => {
    // ESP-45: nao exibir GA4 / GSC / GTM (provedores sem integracao real).
    const ocultos = new Set(["ga4", "gsc", "gtm"]);
    return (integrations.data ?? []).filter((i) => !ocultos.has(i.provider));
  }, [integrations.data]);

  // Lista completa, com o que precisa de atenção no topo.
  const ordenadas = useMemo(
    () =>
      [...linhas]
        .map((i) => ({ i, estado: estadoExibido(i) }))
        .sort(
          (a, b) =>
            rankEstado(a.estado) - rankEstado(b.estado) ||
            a.i.provider.localeCompare(b.i.provider) ||
            a.i.account_name.localeCompare(b.i.account_name),
        ),
    [linhas],
  );

  const createCompany = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name"));
    const industry = String(form.get("industry") || "");
    const { data: user } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("companies")
      .insert({ name, industry, created_by: user.user?.id })
      .select()
      .single();
    if (error) return toast.error(error.message);
    if (data && user.user) {
      await supabase.from("company_members").insert({ company_id: data.id, user_id: user.user.id });
      await logAudit({
        companyId: data.id,
        action: "company.create",
        targetType: "company",
        targetId: data.id,
        details: { name },
      });
    }
    await refreshCompanies();
    toast.success("Empresa cadastrada");
    setOpen(false);
  };

  // Registrar ≠ conectar. A linha nasce `nao_verificada` / `quarentena` pelos
  // defaults do banco (migração 20260803121910) e não coleta nada até o
  // handshake real existir (GT-24). O texto e o toast dizem isso.
  const registrar = async (provider: string) => {
    if (!selectedCompanyId) return;
    const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
    const hoje = new Date().toLocaleDateString("pt-BR");
    const { error } = await supabase.from("integrations").insert({
      company_id: selectedCompanyId,
      provider: provider as never,
      account_name: label,
      external_id: null,
      estado_motivo: `Registrada pelo painel em ${hoje}, sem handshake com a plataforma. Nenhum dado será coletado até a conexão ser verificada.`,
    });
    if (error) return toast.error(error.message);
    await logAudit({
      companyId: selectedCompanyId,
      action: "integration.connect",
      targetType: "integration",
      details: { provider, verificada: false },
    });
    await integrations.refetch();
    toast.warning("Integração registrada — ainda não verificada.", {
      description: AVISO_NAO_VERIFICADA,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Empresas e contas</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie empresas e conecte contas de Meta Ads.
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nova empresa
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova empresa</DialogTitle>
              </DialogHeader>
              <form onSubmit={createCompany} className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input name="name" required />
                </div>
                <div>
                  <Label>Setor</Label>
                  <Input name="industry" placeholder="Ex.: e-commerce, SaaS…" />
                </div>
                <DialogFooter>
                  <Button type="submit">Cadastrar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {companies.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
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
          <Card className="p-6 text-sm text-muted-foreground">
            Nenhuma empresa. {isAdmin ? "Cadastre a primeira acima." : "Peça a um admin."}
          </Card>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Integrações da empresa ativa</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          O estado vem de <code>estado_operacional</code>, não da existência da linha. Verde só
          quando a conta está de fato acessível.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const doProvedor = linhas.filter((i) => i.provider === p.id);
            const estados = doProvedor.map(estadoExibido);
            const estado = piorEstado(estados);
            const naoVerificadas = estados.filter((e) => ESTADO_META[e].verificavel).length;
            // Resumo por estado, sem esconder o que está quebrado atrás do total.
            const resumo = Object.entries(
              estados.reduce<Record<string, number>>((acc, e) => {
                acc[e] = (acc[e] ?? 0) + 1;
                return acc;
              }, {}),
            )
              .sort(([a], [b]) => rankEstado(a as EstadoExibido) - rankEstado(b as EstadoExibido))
              .map(([e, n]) => `${n} ${ESTADO_META[e as EstadoExibido].rotulo.toLowerCase()}`)
              .join(" · ");

            return (
              <Card key={p.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{p.label}</div>
                  <BadgeEstado estado={estado} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {doProvedor.length === 0
                    ? "Nenhuma conta"
                    : `${doProvedor.length} ${doProvedor.length === 1 ? "conta" : "contas"} · ${resumo}`}
                </div>

                {naoVerificadas > 0 && (
                  <p className="mt-2 rounded-md border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-2 text-[11px] leading-snug">
                    {AVISO_NAO_VERIFICADA}
                  </p>
                )}

                {isAdmin && doProvedor.length === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => registrar(p.id)}
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" />
                    Conectar
                  </Button>
                )}

                {isAdmin && naoVerificadas > 0 && (
                  // O endpoint de verificação é a edge integration-verify (GT-24),
                  // que ainda não existe. Botão desabilitado com o motivo em vez de
                  // um clique que não faz nada.
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full"
                    disabled
                    title="A verificação com a plataforma ainda não está disponível (edge integration-verify)"
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Verificar conexão
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {ordenadas.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Contas por integração</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Uma linha por conta, com o motivo do estado. É aqui que aparecem as contas que o token
            alcança mas que não entregam nada.
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Plataforma</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="w-[150px]">Estado</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="w-[170px]">Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenadas.map(({ i, estado }) => {
                  const fantasma = ehFantasma(i, rotuloProvedor(i.provider));
                  const desde = conectadaDesde(i.connected_at);
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">{rotuloProvedor(i.provider)}</TableCell>
                      <TableCell className="max-w-[320px] text-sm">
                        {fantasma ? (
                          <span
                            className="inline-flex items-center gap-1 text-muted-foreground"
                            title="account_name igual ao nome da plataforma e sem id externo: nenhuma chamada à plataforma aconteceu"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--color-warning)]" />
                            Sem conta identificada
                          </span>
                        ) : (
                          <span className="block truncate font-medium">{i.account_name}</span>
                        )}
                        {i.external_id && (
                          <span className="block text-[11px] text-muted-foreground">
                            id {i.external_id}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <BadgeEstado estado={estado} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {mostrarMotivo(estado)
                          ? (i.estado_motivo ?? "Motivo não registrado.")
                          : "—"}
                      </TableCell>
                      {/* Nunca "conectada desde —": sem connected_at, não mostra nada. */}
                      <TableCell className="text-xs text-muted-foreground">
                        {desde ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
