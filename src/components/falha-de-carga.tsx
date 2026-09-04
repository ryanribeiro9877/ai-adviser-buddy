import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/falha-de-carga-texto";

/**
 * Falha de consulta que SE IDENTIFICA como falha, com opcao de tentar de novo.
 *
 * Existe porque "ausencia vira informacao" apareceu cinco vezes nesta semana, e
 * a versao visual dele e sempre a mesma: a consulta falha, `data` fica
 * undefined, `isLoading` ja e false, e o `?? []` entrega lista vazia para a tela
 * — que entao afirma com toda a confianca que NAO HA nada. O gestor le "Nenhum
 * pedido de aprovacao" e conclui que nao ha o que aprovar; le "Nenhuma empresa
 * cadastrada" e conclui que a conta esta vazia. Nenhuma das duas foi verificada:
 * as duas sao a mesma pergunta que ninguem conseguiu fazer.
 *
 * Um componente so, e nao um bloco por tela, de proposito: seis mensagens
 * escritas a mao divergem, e a divergencia e o que faz uma delas voltar a
 * degradar em silencio na proxima mudanca.
 *
 * O padrao de tres estados (carregando / falhou / vazio) ja existia em
 * notification-bell.tsx e weekly-report.tsx; o que se acrescenta aqui e o
 * "Tentar de novo", que nenhum dos dois tinha.
 */
export function FalhaDeCarga({
  oQue,
  erro,
  onTentarDeNovo,
  compacto = false,
  className,
}: {
  /** O que nao carregou, para entrar na frase: "os pedidos de aprovação". */
  oQue: string;
  erro?: unknown;
  onTentarDeNovo: () => void;
  /** Versao de uma linha, para menu e barra lateral. */
  compacto?: boolean;
  className?: string;
}) {
  const causa = mensagemDeErro(erro);

  if (compacto) {
    return (
      <div
        role="alert"
        className={cn("flex items-center gap-1.5 px-2 py-2 text-xs text-destructive", className)}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Não foi possível carregar {oQue}.</span>
        <button
          type="button"
          onClick={onTentarDeNovo}
          className="shrink-0 underline underline-offset-2 hover:no-underline"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-left",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        Não foi possível carregar {oQue}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Isto é uma falha de consulta, não uma lista vazia — não dá para concluir que não há nada.
        {causa ? ` Motivo: ${causa}` : ""}
      </p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onTentarDeNovo}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        Tentar de novo
      </Button>
    </div>
  );
}
