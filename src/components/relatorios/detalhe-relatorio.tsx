import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { humanizarMarkdownRelatorio, normalizarAchados, type AchadoRelatorio } from "@/lib/relatorios";
import {
  limparJargaoRelatorio,
  rotuloNivelRelatorio,
  rotuloSeveridadeRelatorio,
  rotuloTipoAchado,
} from "@/lib/relatorios-apresentacao";
import type { Json } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

export type RelatorioGerado = {
  id: string;
  nome: string;
  status: string;
  fonte_campanhas: string | null;
  campaign_ids_resolvidos: string[];
  periodo_inicio: string | null;
  periodo_fim: string | null;
  corpo_md: string | null;
  achados: Json;
  cobertura: string | null;
  erro: string | null;
  criado_em: string;
  finalizado_em: string | null;
};

const SEV_BADGE: Record<AchadoRelatorio["severidade"], "destructive" | "outline" | "secondary"> = {
  urgente: "destructive",
  atencao: "outline",
  info: "secondary",
};

const SEV_BARRA: Record<AchadoRelatorio["severidade"], string> = {
  urgente: "border-l-destructive",
  atencao: "border-l-amber-500",
  info: "border-l-muted-foreground/40",
};

export function rotuloStatusGerado(status: string): string {
  if (status === "queued") return "Na fila";
  if (status === "running") return "Gerando";
  if (status === "done") return "Pronto";
  if (status === "error") return "Falhou";
  return status;
}

function periodoLegivel(inicio: string | null, fim: string | null): string {
  if (!inicio || !fim) return "Período ainda não fechado";
  const a = inicio.split("-").reverse().join("/");
  const b = fim.split("-").reverse().join("/");
  return a === b ? `Dia ${a}` : `${a} a ${b}`;
}

function Campo({ rotulo, texto, destaque }: { rotulo: string; texto: string; destaque?: boolean }) {
  const limpo = limparJargaoRelatorio(texto);
  if (!limpo) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{rotulo}</p>
      <p className={cn("text-sm leading-relaxed whitespace-pre-wrap", destaque ? "text-foreground" : "text-muted-foreground")}>
        {limpo}
      </p>
    </div>
  );
}

function CardAchado({ achado }: { achado: AchadoRelatorio }) {
  return (
    <Card className={cn("space-y-3 border-l-4 p-4", SEV_BARRA[achado.severidade])}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold">{rotuloTipoAchado(achado.tipo)}</p>
          <p className="text-sm text-foreground">{limparJargaoRelatorio(achado.alvo_nome)}</p>
          <p className="text-xs text-muted-foreground">{rotuloNivelRelatorio(achado.nivel)}</p>
        </div>
        <Badge variant={SEV_BADGE[achado.severidade]}>{rotuloSeveridadeRelatorio(achado.severidade)}</Badge>
      </div>
      <Campo rotulo="O que vimos" texto={achado.evidencia} destaque />
      <Campo rotulo="Por quê" texto={achado.mecanismo} />
      <Campo rotulo="O que fazer" texto={achado.acao} destaque />
      <Campo rotulo="Como saber que deu certo" texto={achado.metrica_sucesso} />
      <Campo rotulo="Quando ler de novo" texto={achado.janela_leitura} />
      <Campo rotulo="Se não confirmar" texto={achado.reversa} />
    </Card>
  );
}

export function DetalheRelatorio({ relatorio }: { relatorio: RelatorioGerado }) {
  const achados = normalizarAchados(relatorio.achados);
  const narrativa = humanizarMarkdownRelatorio(relatorio.corpo_md ?? "");
  const cobertura = limparJargaoRelatorio(relatorio.cobertura ?? "");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{relatorio.nome}</h2>
          <Badge variant={relatorio.status === "error" ? "destructive" : "secondary"}>
            {rotuloStatusGerado(relatorio.status)}
          </Badge>
          {relatorio.fonte_campanhas && (
            <Badge variant="outline">
              {relatorio.fonte_campanhas === "ao_vivo" ? "campanhas ao vivo" : "espelho local"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {periodoLegivel(relatorio.periodo_inicio, relatorio.periodo_fim)}
          {relatorio.campaign_ids_resolvidos?.length
            ? ` · ${relatorio.campaign_ids_resolvidos.length} campanha(s)`
            : ""}
        </p>
      </div>

      {relatorio.status === "error" && (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
          {limparJargaoRelatorio(relatorio.erro || "A geração falhou e não deixou detalhe. Tente de novo.")}
        </Card>
      )}

      {(relatorio.status === "queued" || relatorio.status === "running") && (
        <p className="text-sm text-muted-foreground">
          O gestor de IA está lendo as campanhas. Isto não escreve na Meta. A tela atualiza sozinha.
        </p>
      )}

      {achados.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Opiniões</h3>
          <div className="space-y-3">
            {achados.map((a, i) => (
              <CardAchado key={`${a.tipo}-${a.alvo_id ?? i}`} achado={a} />
            ))}
          </div>
        </section>
      )}

      {narrativa && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Relatório</h3>
          <Card className="p-5">
            <Markdown>{narrativa}</Markdown>
          </Card>
        </section>
      )}

      {cobertura && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">O que não foi medido</h3>
          <Card className="p-4">
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{cobertura}</p>
          </Card>
        </section>
      )}
    </div>
  );
}
