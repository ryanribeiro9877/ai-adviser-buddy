// Casos que amarram a decisao de base de resultado dos DOIS lados.
//
// POR QUE ESTE ARQUIVO EXISTE: `baseDoObjetivo()` (TypeScript) e
// `public.base_de_resultado()` (SQL) sao a MESMA regra escrita duas vezes, porque as edges
// decidem sem ida ao banco e o banco decide sem ida as edges. Duas escritas da mesma regra e
// exatamente o defeito que a frente de 03/09/2026 veio eliminar — a diferenca e que aqui a
// divergencia e DETECTAVEL: esta lista e a unica fonte de casos, a prova do TypeScript roda
// `baseDoObjetivo` contra ela e a funcao `public.prova_base_de_resultado()` roda o SQL contra
// a copia dela embutida na migration 20260903243000.
//
// COMO QUEBRA, de proposito:
//   - mexeu no TypeScript e nao aqui  -> `_prova_metrica_canonica.ts` reprova o caso;
//   - mexeu no SQL e nao aqui         -> `select * from public.prova_base_de_resultado()`
//                                        devolve linha com confere = false;
//   - mexeu aqui e nao regerou o SQL  -> a prova do TypeScript compara esta lista com o JSON
//                                        embutido no arquivo da migration e reprova.
//
// Os casos com `origem` preenchida sao configuracao REAL lida do banco em 03/09/2026, nao
// hipotese: se a Meta mudar o vocabulario, e aqui que a mudanca aparece primeiro.

import type { BaseDeResultado } from "./metrica_canonica.ts";

export type CasoDeBase = {
  categoria: string | null;
  optimization_goal: string | null;
  objective: string | null;
  base_ts: BaseDeResultado;
  porque: string;
  origem?: string;
};

export const CASOS_DE_BASE_DE_RESULTADO: CasoDeBase[] = [
  // 1. Categoria decidida por humano vence tudo.
  { categoria: "mensagem", optimization_goal: "LINK_CLICKS", objective: "OUTCOME_TRAFFIC", base_ts: "conversas", porque: "categoria humana vence a configuracao da Meta" },
  { categoria: "mensagens", optimization_goal: null, objective: null, base_ts: "conversas", porque: "plural aceito" },
  { categoria: "leadgen", optimization_goal: null, objective: null, base_ts: "formularios", porque: "categoria de formulario" },
  { categoria: "cadastro", optimization_goal: null, objective: null, base_ts: "formularios", porque: "sinonimo de formulario" },
  { categoria: "vendas", optimization_goal: null, objective: null, base_ts: "formularios", porque: "venda e conversao medida por formulario neste sistema" },
  { categoria: "conversoes", optimization_goal: null, objective: null, base_ts: "formularios", porque: "sinonimo de conversao" },
  { categoria: "trafego", optimization_goal: "LEAD_GENERATION", objective: "OUTCOME_LEADS", base_ts: "cliques_no_link", porque: "categoria humana vence tambem para baixo" },
  { categoria: "engajamento", optimization_goal: null, objective: null, base_ts: "cliques_no_link", porque: "impulsionamento de post nao produz formulario" },
  { categoria: "alcance", optimization_goal: null, objective: null, base_ts: "cliques_no_link", porque: "alcance nao produz formulario" },
  { categoria: "video", optimization_goal: null, objective: null, base_ts: "cliques_no_link", porque: "video nao produz formulario" },
  { categoria: "MENSAGEM", optimization_goal: null, objective: null, base_ts: "conversas", porque: "categoria e comparada sem caixa" },
  { categoria: "  leadgen  ", optimization_goal: null, objective: null, base_ts: "formularios", porque: "categoria e comparada sem espaco em volta" },

  // 2. Sem categoria: configuracao declarada na Meta. Conversa vem antes de tudo.
  { categoria: null, optimization_goal: "CONVERSATIONS", objective: "OUTCOME_ENGAGEMENT", base_ts: "conversas", porque: "Click-to-WhatsApp: a Meta aceita OUTCOME_ENGAGEMENT com CONVERSATIONS, e o objetivo sozinho leria como engajamento", origem: "COHAPM_JURIDICO_CONV_WA_2026-08 e outros 22 conjuntos" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_MESSAGES", base_ts: "conversas", porque: "objetivo de mensagem sem optimization_goal legivel" },
  { categoria: null, optimization_goal: null, objective: "MESSAGES", base_ts: "conversas", porque: "vocabulario antigo da Meta" },

  // 3. Sem categoria: formulario.
  { categoria: null, optimization_goal: "LEAD_GENERATION", objective: null, base_ts: "formularios", porque: "formulario nativo da Meta" },
  { categoria: null, optimization_goal: "QUALITY_LEAD", objective: null, base_ts: "formularios", porque: "lead qualificado ainda e formulario" },
  { categoria: null, optimization_goal: "OFFSITE_CONVERSIONS", objective: "OUTCOME_LEADS", base_ts: "formularios", porque: "conversao fora do site com objetivo de lead", origem: "[LEV][LP][LEADS][CLT][TESTE][MIX][AGO26]" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_LEADS", base_ts: "formularios", porque: "objetivo de lead sem optimization_goal legivel" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_SALES", base_ts: "formularios", porque: "venda entra na base de formulario" },
  { categoria: null, optimization_goal: null, objective: "PRODUCT_CATALOG_SALES", base_ts: "formularios", porque: "catalogo entra na base de formulario" },

  // 4. Sem categoria: clique no link. A base que faltava e que causava o erro de 5,4x.
  { categoria: null, optimization_goal: "POST_ENGAGEMENT", objective: "OUTCOME_ENGAGEMENT", base_ts: "cliques_no_link", porque: "impulsionamento de post: zero formulario por construcao", origem: "21 das 27 campanhas com entrega da Legal e Viver" },
  { categoria: null, optimization_goal: "LINK_CLICKS", objective: "OUTCOME_TRAFFIC", base_ts: "cliques_no_link", porque: "trafego mede clique no link" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_TRAFFIC", base_ts: "cliques_no_link", porque: "trafego sem optimization_goal legivel" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_AWARENESS", base_ts: "cliques_no_link", porque: "reconhecimento nao produz formulario" },
  { categoria: null, optimization_goal: null, objective: "REACH", base_ts: "cliques_no_link", porque: "alcance nao produz formulario" },
  { categoria: null, optimization_goal: null, objective: "VIDEO_VIEWS", base_ts: "cliques_no_link", porque: "visualizacao de video nao produz formulario" },
  { categoria: null, optimization_goal: null, objective: "OUTCOME_APP_PROMOTION", base_ts: "cliques_no_link", porque: "promocao de app nao produz formulario neste sistema" },
  { categoria: null, optimization_goal: "THRUPLAY", objective: null, base_ts: "cliques_no_link", porque: "thruplay sem objetivo legivel" },
  { categoria: null, optimization_goal: "VISIT_INSTAGRAM_PROFILE", objective: null, base_ts: "cliques_no_link", porque: "visita a perfil nao produz formulario" },
  { categoria: null, optimization_goal: "LANDING_PAGE_VIEWS", objective: null, base_ts: "cliques_no_link", porque: "visualizacao de pagina nao e formulario preenchido" },

  // 5. Precedencia entre objetivo e optimization_goal, onde os dois falam.
  { categoria: null, optimization_goal: "CONVERSATIONS", objective: "OUTCOME_TRAFFIC", base_ts: "conversas", porque: "CONVERSATIONS vence trafego: a otimizacao e mais especifica que o objetivo" },
  { categoria: null, optimization_goal: "LINK_CLICKS", objective: "OUTCOME_LEADS", base_ts: "formularios", porque: "objetivo de lead vence a otimizacao por clique" },
  { categoria: null, optimization_goal: "POST_ENGAGEMENT", objective: "OUTCOME_MESSAGES", base_ts: "conversas", porque: "objetivo de mensagem vence engajamento" },

  // 6. Sem nada legivel: o chute declarado.
  { categoria: null, optimization_goal: null, objective: null, base_ts: "formularios", porque: "sem categoria e sem configuracao, o padrao historico do sistema" },
  { categoria: "", optimization_goal: "", objective: "", base_ts: "formularios", porque: "vazio nao e sinal" },
  { categoria: null, optimization_goal: "ALGO_QUE_A_META_INVENTOU_DEPOIS", objective: "OUTCOME_QUE_NAO_EXISTE", base_ts: "formularios", porque: "vocabulario desconhecido cai no padrao em vez de adivinhar" },
];

/** Forma exata que vai para o `jsonb` da migration. Serve de contrato entre os dois lados. */
export function casosParaJson(): string {
  return JSON.stringify(
    CASOS_DE_BASE_DE_RESULTADO.map((c) => ({
      categoria: c.categoria,
      optimization_goal: c.optimization_goal,
      objective: c.objective,
      base_ts: c.base_ts,
    })),
  );
}
