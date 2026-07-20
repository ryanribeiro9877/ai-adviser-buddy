import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Megaphone,
  Target,
  Image as ImageIcon,
  Funnel,
  Bell,
  Sparkles,
  CheckSquare,
  History,
  Settings,
  LogOut,
  ShieldCheck,
  Eye,
  ChevronDown,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const nav = [
  { to: "/dashboard", label: "Dashboard executivo", icon: LayoutDashboard },
  { to: "/empresas", label: "Empresas e contas", icon: Building2 },
  { to: "/campanhas", label: "Campanhas", icon: Megaphone },
  { to: "/conjuntos", label: "Conjuntos e públicos", icon: Target },
  { to: "/anuncios", label: "Anúncios e criativos", icon: ImageIcon },
  { to: "/funil", label: "Funil e conversões", icon: Funnel },
  { to: "/alertas", label: "Alertas", icon: Bell },
  { to: "/recomendacoes", label: "Recomendações da IA", icon: Sparkles },
  { to: "/aprovacoes", label: "Aprovações pendentes", icon: CheckSquare },
  { to: "/auditoria", label: "Histórico e auditoria", icon: History },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AppShell() {
  const { user, role, isAdmin, companies, selectedCompany, setSelectedCompanyId } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden lg:flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">Gestor de Tráfego</div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">IA · v1.0</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {isAdmin ? <ShieldCheck className="h-3.5 w-3.5 text-primary" /> : <Eye className="h-3.5 w-3.5" />}
            Modo somente leitura por padrão
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center justify-between px-4 lg:px-6 bg-card/50 backdrop-blur">
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  {selectedCompany?.name ?? "Nenhuma empresa"}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Empresas</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {companies.length === 0 && (
                  <DropdownMenuItem disabled>Nenhuma empresa cadastrada</DropdownMenuItem>
                )}
                {companies.map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => setSelectedCompanyId(c.id)}>
                    {c.name}
                    {selectedCompany?.id === c.id && (
                      <Badge variant="secondary" className="ml-auto">Ativa</Badge>
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/empresas">Gerenciar empresas</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={isAdmin ? "default" : "secondary"} className="gap-1">
              {isAdmin ? <ShieldCheck className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {isAdmin ? "Administrador" : "Visualizador"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center text-xs font-semibold">
                    {user.email?.[0]?.toUpperCase()}
                  </div>
                  <span className="hidden md:inline text-sm">{user.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
