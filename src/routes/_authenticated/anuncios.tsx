import { createFileRoute } from "@tanstack/react-router";
import { useApp } from "@/lib/app-context";
import { EmptyCompany } from "@/components/metric-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtBRL, fmtPct } from "@/lib/mock-metrics";
import { ImageIcon, Video, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/anuncios")({
  component: Anuncios,
  head: () => ({ meta: [{ title: "Anúncios e criativos" }] }),
});

const ads = [
  { name: "Vídeo — Depoimento cliente", format: "video", ctr: 2.4, cpa: 42, spend: 6200, status: "Ativo" },
  { name: "Carrossel — Kit essencial", format: "image", ctr: 1.7, cpa: 51, spend: 3800, status: "Ativo" },
  { name: "Imagem única — Desconto 20%", format: "image", ctr: 3.1, cpa: 28, spend: 5400, status: "Ativo" },
  { name: "Vídeo curto — Tutorial", format: "video", ctr: 1.2, cpa: 88, spend: 2100, status: "Baixa performance" },
  { name: "Texto — Ad Search Marca", format: "text", ctr: 8.9, cpa: 12, spend: 1900, status: "Ativo" },
];

const IconFor = ({ f }: { f: string }) =>
  f === "video" ? <Video className="h-4 w-4" /> : f === "text" ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />;

function Anuncios() {
  const { selectedCompany } = useApp();
  if (!selectedCompany) return <EmptyCompany />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Anúncios e criativos</h1>
        <p className="text-sm text-muted-foreground">Performance dos criativos ativos.</p>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ads.map((a) => (
          <Card key={a.name} className="p-4">
            <div className="aspect-video rounded-lg bg-accent/40 flex items-center justify-center text-muted-foreground">
              <IconFor f={a.format} />
            </div>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="font-semibold text-sm">{a.name}</div>
              <Badge variant={a.status === "Ativo" ? "default" : "secondary"}>{a.status}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div><div className="text-xs text-muted-foreground">CTR</div><div className="font-semibold">{fmtPct(a.ctr)}</div></div>
              <div><div className="text-xs text-muted-foreground">CPA</div><div className="font-semibold">{fmtBRL(a.cpa)}</div></div>
              <div><div className="text-xs text-muted-foreground">Gasto</div><div className="font-semibold">{fmtBRL(a.spend)}</div></div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
