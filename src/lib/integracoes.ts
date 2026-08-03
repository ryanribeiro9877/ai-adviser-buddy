// Regra de exibição das integrações (03/08/2026).
//
// Contexto: até a migração 20260803121910, `integrations.status` nascia
// 'connected' por DEFAULT — 22 de 22 linhas diziam "conectada", campo constante.
// A verdade sempre esteve em `estado_operacional` (e o porquê em `estado_motivo`),
// e nada disso era exibido. Aqui a precedência é explícita e testável.

export type StatusIntegracao = "connected" | "nao_verificada" | "erro" | "revogada";
export type EstadoOperacional = "ativa" | "nao_operacional" | "quarentena";

export type Integracao = {
  id: string;
  provider: string;
  account_name: string;
  external_id: string | null;
  status: string;
  estado_operacional: string;
  estado_motivo: string | null;
  connected_at: string | null;
};

export type EstadoExibido =
  | "desconectada"
  | "nao_verificada"
  | "erro"
  | "revogada"
  | "nao_operacional"
  | "quarentena"
  | "conectada";

/**
 * Precedência (a ordem importa):
 *  1. sem linha                              -> desconectada
 *  2. status <> 'connected'                  -> o próprio status (não verificada / erro / revogada)
 *  3. connected + estado nao_operacional     -> não operacional
 *  4. connected + estado quarentena          -> em quarentena
 *  5. connected + estado ativa               -> conectada
 *
 * Nota sobre o item 2: o briefing agrupa tudo que não é 'connected' sob
 * "Não verificada". Aqui `erro` e `revogada` mantêm o próprio rótulo — a edge de
 * handshake (GT-24) grava status='erro' quando a plataforma recusa, e chamar
 * isso de "não verificada" esconderia exatamente a falha que ela precisa mostrar.
 * O tratamento é o mesmo (âmbar/vermelho + motivo + botão de verificar).
 */
export function estadoExibido(i?: Integracao | null): EstadoExibido {
  if (!i) return "desconectada";
  if (i.status !== "connected") {
    if (i.status === "erro") return "erro";
    if (i.status === "revogada") return "revogada";
    return "nao_verificada";
  }
  if (i.estado_operacional === "nao_operacional") return "nao_operacional";
  if (i.estado_operacional === "quarentena") return "quarentena";
  if (i.estado_operacional === "ativa") return "conectada";
  // Vocabulário desconhecido: não inventar verde.
  return "nao_verificada";
}

export type Tom = "verde" | "ambar" | "vermelho" | "neutro";

export const ESTADO_META: Record<
  EstadoExibido,
  { rotulo: string; tom: Tom; classe: string; verificavel: boolean }
> = {
  desconectada: {
    rotulo: "Desconectada",
    tom: "neutro",
    classe: "border-border text-muted-foreground",
    verificavel: false,
  },
  nao_verificada: {
    rotulo: "Não verificada",
    tom: "ambar",
    classe:
      "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]",
    verificavel: true,
  },
  erro: {
    rotulo: "Erro na conexão",
    tom: "vermelho",
    classe: "border-destructive/40 bg-destructive/15 text-destructive",
    verificavel: true,
  },
  revogada: {
    rotulo: "Acesso revogado",
    tom: "vermelho",
    classe: "border-destructive/40 bg-destructive/15 text-destructive",
    verificavel: true,
  },
  nao_operacional: {
    rotulo: "Não operacional",
    tom: "vermelho",
    classe: "border-destructive/40 bg-destructive/15 text-destructive",
    verificavel: false,
  },
  quarentena: {
    rotulo: "Em quarentena",
    tom: "ambar",
    classe:
      "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]",
    verificavel: false,
  },
  conectada: {
    rotulo: "Conectada",
    tom: "verde",
    classe:
      "border-[color:var(--color-success)]/40 bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
    verificavel: false,
  },
};

/** Só o verde dispensa explicação; nos outros o motivo é a informação útil. */
export function mostrarMotivo(estado: EstadoExibido): boolean {
  return estado !== "conectada" && estado !== "desconectada";
}

// Do pior para o melhor — usado no rollup por provedor, que nunca deve
// mostrar verde tendo uma conta quebrada embaixo.
const ORDEM: EstadoExibido[] = [
  "erro",
  "revogada",
  "nao_operacional",
  "nao_verificada",
  "quarentena",
  "conectada",
  "desconectada",
];

export function piorEstado(estados: EstadoExibido[]): EstadoExibido {
  if (estados.length === 0) return "desconectada";
  return ORDEM.find((e) => estados.includes(e)) ?? "desconectada";
}

/** Ordena a lista com o que precisa de atenção primeiro. */
export function rankEstado(estado: EstadoExibido): number {
  const i = ORDEM.indexOf(estado);
  return i === -1 ? ORDEM.length : i;
}

/**
 * Integração fantasma: `account_name` igual ao nome do provedor e `external_id`
 * vazio só é possível se nenhuma chamada à plataforma aconteceu. É sintoma, não
 * dado — depois do handshake o nome real vem da API.
 */
export function ehFantasma(i: Integracao, rotuloProvedor: string): boolean {
  return !i.external_id && i.account_name.trim().toLowerCase() === rotuloProvedor.toLowerCase();
}

export const PROVEDOR_ROTULO: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  ga4: "Google Analytics 4",
  gsc: "Search Console",
  gtm: "Tag Manager",
};

export const rotuloProvedor = (p: string) => PROVEDOR_ROTULO[p] ?? p;

/** Aviso do estado âmbar recém-criado: registrado não é conectado. */
export const AVISO_NAO_VERIFICADA =
  "Integração registrada mas ainda não verificada. Nenhum dado será coletado até a conexão ser confirmada com a plataforma.";

/** "conectada desde 21/07/2026" — e nunca "desde —". */
export function conectadaDesde(connectedAt: string | null): string | null {
  if (!connectedAt) return null;
  return `conectada desde ${new Date(connectedAt).toLocaleDateString("pt-BR")}`;
}
