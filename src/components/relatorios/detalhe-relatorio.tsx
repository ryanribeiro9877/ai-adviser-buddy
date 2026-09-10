import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { normalizarAchados, type AchadoRelatorio } from "@/lib/relatorios";
import type { Json } from "@/integrations/supabase/types";

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

const SEV: Record<AchadoRelatorio["severidade"], "destructive" | "outline" | "secondary"> = {
  urgente: "destructive",
  atencao: "outline",
  info: "secondary",
};

const TIPO: Record<AchadoRelatorio["tipo"], string> = {
  teto: "Teto",
  custo_elevado: "Custo elevado",
  monitoramento_reforcado: "Monitoramento reforçado",
  fadiga: "Fadiga",
  escala: "Escala",
  pausa_com_guarda: "Pausa com guarda",
  hipotese: "Hipótese",
};

export function rotuloStatusGerado(status: string): string {
  if (status === "queued") return "Na fila";
  if (status === "running") return "Gerando";
  if (status === "done") return "Pronto";
  if (status === "error") return "Falhou";
  return status;
}

export function DetalheRelatorio({ relatorio }: { relatorio: RelatorioGerado }) {
  const achados = normalizarAchados(relatorio.achados);
  return (
    <div className="space-y-4">
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
        {relatorio.periodo_inicio && relatorio.periodo_fim
          ? `Período ${relatorio.periodo_inicio.split("-").reverse().join("/")} a ${relatorio.periodo_fim.split("-").reverse().join("/")}`
          : "Período ainda não fechado"}
        {relatorio.campaign_ids_resolvidos?.length
          ? ` · ${relatorio.campaign_ids_resolvidos.length} campanha(s)`
          : ""}
      </p>

      {relatorio.status === "error" && (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
          {relatorio.erro || "A geração falhou e não deixou detalhe. Tente de novo."}
        </Card>
      )}

      {(relatorio.status === "queued" || relatorio.status === "running") && (
        <p className="text-sm text-muted-foreground">
          O gestor de IA está lendo as campanhas. Isto não escreve na Meta. A tela atualiza sozinha.
        </p>
      )}

      {achados.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {achados.map((a, i) => (
            <Card key={`${a.tipo}-${i}`} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{TIPO[a.tipo]}</span>
                <Badge variant={SEV[a.severidade]}>{a.severidade}</Badge>
                <span className="text-xs text-muted-foreground">
                  {a.nivel} · {a.alvo_nome}
                </span>
              </div>
              <p className="text-sm">{a.evidencia}</p>
              {a.mecanismo && (
                <p className="text-xs text-muted-foreground">Mecanismo: {a.mecanismo}</p>
              )}
              {a.acao && <p className="text-sm">Fazer: {a.acao}</p>}
              {a.metrica_sucesso && (
                <p className="text-xs text-muted-foreground">Sucesso: {a.metrica_sucesso}</p>
              )}
              {a.janela_leitura && (
                <p className="text-xs text-muted-foreground">Ler em: {a.janela_leitura}</p>
              )}
              {a.reversa && <p className="text-xs">Reversa: {a.reversa}</p>}
            </Card>
          ))}
        </div>
      )}

      {relatorio.corpo_md && (
        <Card className="p-4">
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{relatorio.corpo_md}</div>
        </Card>
      )}

      {relatorio.cobertura && (
        <p className="text-xs text-muted-foreground">Cobertura: {relatorio.cobertura}</p>
      )}
    </div>
  );
}
