import { Check, MessageSquare, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  apresentarRecomendacao,
  type OpiniaoTom,
  type RecoBruta,
} from "@/lib/recomendacao-texto";
import { cn } from "@/lib/utils";

export type RecoCardRow = RecoBruta & {
  id: string;
  status: "new" | "accepted" | "dismissed";
};

const TOM: Record<OpiniaoTom, string> = {
  fazer:
    "border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/10",
  nao_fazer: "border-destructive/40 bg-destructive/10",
  avaliar:
    "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10",
  informativo: "border-border bg-muted/40",
};

const TOM_BADGE: Record<OpiniaoTom, "default" | "destructive" | "outline" | "secondary"> = {
  fazer: "default",
  nao_fazer: "destructive",
  avaliar: "outline",
  informativo: "secondary",
};

function Secao({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className="text-sm leading-relaxed">{texto}</p>
    </div>
  );
}

export function RecomendacaoCard({
  reco,
  onChat,
  onAccept,
  onDismiss,
}: {
  reco: RecoCardRow;
  onChat: () => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const a = apresentarRecomendacao(reco);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold leading-snug">{a.titulo}</p>
            {a.onde && (
              <p className="text-xs text-muted-foreground mt-0.5">{a.onde}</p>
            )}
          </div>
        </div>
        <Badge
          variant={reco.impact === "high" ? "destructive" : reco.impact === "low" ? "secondary" : "outline"}
          className="shrink-0"
        >
          {a.urgencia}
        </Badge>
      </div>

      <Secao rotulo="Do que se trata" texto={a.assunto} />
      <Secao rotulo={a.rotuloProposta} texto={a.proposta} />

      <div className={cn("rounded-md border px-3 py-2 space-y-1.5", TOM[a.opiniaoTom])}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Opinião do SuperGestor
          </p>
          <Badge variant={TOM_BADGE[a.opiniaoTom]}>{a.opiniaoRotulo}</Badge>
        </div>
        <p className="text-sm leading-relaxed">{a.opiniao}</p>
      </div>

      {a.numeros.length > 0 && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
          {a.numeros.map((n) => (
            <div key={n.rotulo}>
              <span className="font-medium text-foreground/80">{n.rotulo}:</span> {n.valor}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant="secondary">{a.familia}</Badge>
          {a.desde && <Badge variant="outline">desde {a.desde}</Badge>}
        </div>
        <div className="flex gap-2">
          {(reco.status === "new" || reco.status === "accepted") && (
            <Button size="sm" variant="secondary" onClick={onChat}>
              <MessageSquare className="h-4 w-4 mr-1" />
              Chat
            </Button>
          )}
          {reco.status === "new" ? (
            <>
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                <X className="h-4 w-4 mr-1" />
                Descartar
              </Button>
              <Button size="sm" onClick={onAccept}>
                <Check className="h-4 w-4 mr-1" />
                Aceitar
              </Button>
            </>
          ) : (
            <Badge>{reco.status === "accepted" ? "Aceita" : "Descartada"}</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
