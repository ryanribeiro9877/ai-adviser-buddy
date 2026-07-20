import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, ShieldCheck, Workflow, BarChart3, CheckSquare } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setChecked(true);
    });
  }, []);

  if (!checked) return <div className="min-h-screen bg-background" />;
  if (authed) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Gestor de Tráfego IA</span>
          </div>
          <Button asChild size="sm"><Link to="/auth">Entrar</Link></Button>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground mb-6">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Somente leitura por padrão · alterações via aprovação
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
          Toda sua mídia paga sob <span className="text-primary">um único painel</span>.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Multi-empresa. Meta Ads, Google Ads, GA4, Search Console e Tag Manager conectados. Fila de aprovações,
          auditoria completa e recomendações de IA para escalar campanhas com segurança.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <Button asChild size="lg"><Link to="/auth">Começar agora</Link></Button>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24 grid md:grid-cols-4 gap-4">
        {[
          { icon: BarChart3, title: "Dashboard executivo", text: "ROAS, CPA, CPL, frequência e taxa de conversão em tempo real." },
          { icon: Workflow, title: "Multi-plataforma", text: "Conecte Meta, Google Ads, GA4, GSC e GTM por empresa." },
          { icon: CheckSquare, title: "Fila de aprovação", text: "Nada muda em campanhas, orçamentos ou anúncios sem confirmação." },
          { icon: Sparkles, title: "IA guiada", text: "Recomendações práticas para pausar, escalar ou reajustar verba." },
        ].map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-5">
            <f.icon className="h-5 w-5 text-primary" />
            <div className="mt-3 font-semibold">{f.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{f.text}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
