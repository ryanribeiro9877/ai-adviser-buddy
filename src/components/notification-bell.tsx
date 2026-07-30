import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp, logAudit } from "@/lib/app-context";
import { useNotificacoes } from "@/hooks/use-notificacoes";
import { useAgora } from "@/hooks/use-agora";
import {
  agruparPorTitulo,
  haQuanto,
  primeiraLinha,
  textoExpiracao,
  URGENCIA,
  type ItemNotificacao,
} from "@/lib/notificacoes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const { selectedCompany, isAdmin } = useApp();
  const { dados, carregando, erro, pedidoDeAbrir, irPara, recarregar } = useNotificacoes();
  const [aberto, setAberto] = useState(false);
  const [resolvendo, setResolvendo] = useState<string | null>(null);

  // Toast agrupado pede o sino aberto.
  useEffect(() => {
    if (pedidoDeAbrir > 0) setAberto(true);
  }, [pedidoDeAbrir]);

  const temPrazo = dados.itens.some((i) => i.expires_at);
  const agora = useAgora(aberto || temPrazo);

  const grupos = agruparPorTitulo(dados.itens);
  const total = dados.total;
  const vermelho = dados.criticos > 0;

  const resolver = async (item: ItemNotificacao) => {
    setResolvendo(item.id);
    const { error } = await supabase.from("alerts").update({ resolved: true }).eq("id", item.id);
    setResolvendo(null);
    if (error) {
      toast.error(`Não foi possível resolver: ${error.message}`);
      return;
    }
    await logAudit({
      companyId: selectedCompany?.id ?? null,
      action: "alert.resolve",
      targetType: "alert",
      targetId: item.id,
    });
    toast.success("Alerta resolvido");
    recarregar();
  };

  return (
    <DropdownMenu open={aberto} onOpenChange={setAberto}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          disabled={!selectedCompany}
          aria-label={
            total > 0 ? `Notificações: ${total} pendência(s)` : "Notificações: nenhuma pendência"
          }
        >
          <Bell className="h-5 w-5" />
          {/* Badge só existe quando há pendência — nunca mostrar "0". */}
          {total > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white",
                vermelho ? "bg-destructive" : "bg-[color:var(--color-warning)]",
              )}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[380px] max-w-[92vw] p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
          <span>Pendências</span>
          {total > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">
              {dados.aprovacoes_pendentes} aprovação(ões) · {dados.alertas_abertos} alerta(s)
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />

        {carregando && (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}
        {erro && !carregando && (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            Não foi possível carregar as pendências: {erro}
          </div>
        )}
        {!carregando && !erro && grupos.length === 0 && (
          <div className="px-3 py-6 text-sm text-muted-foreground">Nenhuma pendência agora.</div>
        )}

        <div className="max-h-[60vh] overflow-y-auto">
          {grupos.map(({ chave, principal, quantidade }) => {
            const u = URGENCIA[principal.urgencia];
            const prazo =
              principal.tipo === "aprovacao" ? textoExpiracao(principal.expires_at, agora) : null;
            // Ênfase do contador: derivada do relógio, não da urgência (que é da RPC).
            const restamMin = principal.expires_at
              ? Math.floor((new Date(principal.expires_at).getTime() - agora) / 60000)
              : null;
            const prazoUrgente = restamMin !== null && restamMin <= 120;
            return (
              <div key={chave} className="flex items-start gap-1 px-1">
                <DropdownMenuItem
                  onSelect={() => irPara(principal)}
                  className="min-w-0 flex-1 cursor-pointer items-start gap-2 py-2"
                >
                  <span
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", u.ponto)}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{principal.titulo}</span>
                      {quantidade > 1 && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                          ×{quantidade}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                      {primeiraLinha(principal.descricao)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <span className={u.texto}>{u.rotulo}</span>
                      <span>·</span>
                      <span>
                        {principal.tipo === "aprovacao" ? "Aprovação" : "Alerta"}{" "}
                        {haQuanto(principal.created_at, agora)}
                      </span>
                      {prazo && (
                        <>
                          <span>·</span>
                          <span className={prazoUrgente ? "font-medium text-destructive" : ""}>
                            {prazo}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </DropdownMenuItem>

                {/* Ação rápida: só alerta, só admin (o UPDATE em alerts é admin-only
                    na RLS). Aprovar exige o contexto completo — não fica aqui. */}
                {principal.tipo === "alerta" && isAdmin && quantidade === 1 && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault(); // mantém o sino aberto
                      void resolver(principal);
                    }}
                    className="mt-2 shrink-0 cursor-pointer justify-center px-2 py-1 text-[11px]"
                    title="Marcar como resolvido"
                  >
                    {resolvendo === principal.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span className="sr-only">Resolver {principal.titulo}</span>
                  </DropdownMenuItem>
                )}
              </div>
            );
          })}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem asChild className="cursor-pointer justify-center py-2 text-xs">
          <Link to="/alertas">Ver todos os alertas</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
