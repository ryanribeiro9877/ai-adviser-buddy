import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const POSICOES = [
  { id: "feed", label: "Feed" },
  { id: "stories", label: "Stories" },
  { id: "reels", label: "Reels" },
] as const;

type Formato = (typeof POSICOES)[number]["id"];

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronto"; src: string }
  | { tipo: "erro"; texto: string };

export function PreviaAnuncio({
  adId,
  nome,
  aberto,
  onFechar,
}: {
  adId: string | null;
  nome: string;
  aberto: boolean;
  onFechar: () => void;
}) {
  const [formato, setFormato] = useState<Formato>("feed");
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  useEffect(() => {
    if (!aberto || !adId) return;
    let cancelado = false;
    setEstado({ tipo: "carregando" });
    supabase.functions
      .invoke<{ ok: boolean; src?: string; erro?: string }>("ad-preview", {
        body: { ad_id: adId, formato },
      })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          setEstado({ tipo: "erro", texto: "Não foi possível abrir a prévia." });
          return;
        }
        if (!data?.ok || !data.src) {
          setEstado({ tipo: "erro", texto: data?.erro || "A Meta não devolveu a prévia." });
          return;
        }
        setEstado({ tipo: "pronto", src: data.src });
      })
      .catch(() => {
        if (!cancelado) setEstado({ tipo: "erro", texto: "Não foi possível abrir a prévia." });
      });
    return () => {
      cancelado = true;
    };
  }, [aberto, adId, formato]);

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8 text-base">{nome || "Prévia do anúncio"}</SheetTitle>
          <SheetDescription>Como o anúncio aparece neste posicionamento. A prévia não fica salva.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex gap-2">
          {POSICOES.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={formato === p.id ? "default" : "outline"}
              onClick={() => setFormato(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="mt-4">
          {estado.tipo === "carregando" ? (
            <p className="text-sm text-muted-foreground">Abrindo a prévia na Meta…</p>
          ) : estado.tipo === "erro" ? (
            <p className="text-sm text-destructive">{estado.texto}</p>
          ) : (
            <iframe
              title={`Prévia de ${nome}`}
              src={estado.src}
              className="h-[640px] w-full rounded-md border border-border bg-white"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
