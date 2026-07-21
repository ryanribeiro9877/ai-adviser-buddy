import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Eye, Bell, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: Configuracoes,
  head: () => ({ meta: [{ title: "Configurações e integrações" }] }),
});

function Configuracoes() {
  const { user, role, isAdmin } = useApp();
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Configurações e integrações</h1>
        <p className="text-sm text-muted-foreground">Preferências da sua conta e do sistema.</p>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Perfil</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="text-muted-foreground text-xs">Email</div>{user.email}</div>
          <div>
            <div className="text-muted-foreground text-xs">Papel</div>
            <Badge variant={isAdmin ? "default" : "secondary"} className="gap-1">
              {isAdmin ? <ShieldCheck className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {role === "admin" ? "Administrador" : "Visualizador"}
            </Badge>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Segurança</h2>
        <div className="flex items-start gap-3 p-3 rounded-md bg-muted">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">Modo somente leitura ativo</div>
            <div className="text-muted-foreground">
              Nenhuma campanha, orçamento, anúncio, público ou configuração pode ser alterado sem aprovação explícita de um administrador em <Link className="underline" to="/aprovacoes">Aprovações pendentes</Link>.
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Notificações</h2>
        <div className="space-y-3">
          {[
            { id: "alerts", label: "Receber alertas por email", icon: Bell },
            { id: "recos", label: "Notificar novas recomendações da IA", icon: Sparkles },
            { id: "approvals", label: "Avisar sobre solicitações pendentes de aprovação", icon: ShieldCheck },
          ].map((n) => (
            <div key={n.id} className="flex items-center justify-between">
              <Label htmlFor={n.id} className="flex items-center gap-2"><n.icon className="h-4 w-4 text-muted-foreground" />{n.label}</Label>
              <Switch id={n.id} defaultChecked disabled={!isAdmin} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-1">Integrações</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Conecte contas de mídia e analytics em <Link to="/empresas" className="underline">Empresas e contas</Link>. Suportado: Meta Ads, GA4, Google Search Console e Google Tag Manager.
        </p>
      </Card>
    </div>
  );
}
