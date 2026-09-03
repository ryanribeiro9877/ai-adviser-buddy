// Catalogo fechado da casa (22/08/2026).
// Fonte: OpenRouter /api/v1/models?sort=most-popular + rankings da semana.
// 15 economia = alto uso, tools, custo baixo, qualidade suficiente para bloco operacional.
// 15 premium = frontier / julgamento / prosa longa. Nao usar no loop sincrono (teto ~118s).
// Atualizar slugs aqui quando a OpenRouter promover revisao (ex.: flash-0731 -> proxima).

export type FaixaLlm = "economia" | "premium";

export type LlmModelo = {
  slug: string;
  faixa: FaixaLlm;
  /** Chamada de ferramentas (chat / subagente). */
  tools: boolean;
  /** Imagem/video frame no content. */
  visao: boolean;
  /** JSON estruturado confiavel (planner, compliance, reco). */
  json: boolean;
  /** Prosa PT-BR / relatorio. */
  prosa: boolean;
  nota: string;
};

export const CATALOGO_ECONOMIA: LlmModelo[] = [
  { slug: "openai/gpt-5.6-luna", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "#4 uso OR; padrao da casa para loop de tools" },
  { slug: "openai/gpt-5.6-luna-pro", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "mesma faixa Luna com margem extra de qualidade" },
  { slug: "google/gemini-3.7-flash", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "Flash recente; copy e visao baratas" },
  { slug: "google/gemini-2.5-flash", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "ja usado na transcricao; visao estavel" },
  { slug: "anthropic/claude-haiku-4.5", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "JSON/tools excelentes; planner e ato" },
  { slug: "openai/gpt-5-mini", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "agente leve OpenAI" },
  { slug: "google/gemini-3-flash-preview", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "Flash 3; fallback de visao" },
  { slug: "google/gemini-2.5-flash-lite", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "mais barato Google ainda capaz" },
  { slug: "deepseek/deepseek-v4-pro", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "#10 uso; melhor custo/qualidade DeepSeek" },
  { slug: "xiaomi/mimo-v2.5-pro", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "Pro do #3 de volume" },
  { slug: "openai/gpt-4o-mini", faixa: "economia", tools: true, visao: true, json: true, prosa: true, nota: "JSON barato; reco/waba" },
  { slug: "tencent/hy3", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "#2 uso OR na semana" },
  { slug: "deepseek/deepseek-v4-flash-0731", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "#1 tokens OR; extracao simples" },
  { slug: "xiaomi/mimo-v2.5", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "#3 uso; fallback do Pro" },
  { slug: "z-ai/glm-5.2", faixa: "economia", tools: true, visao: false, json: true, prosa: true, nota: "#7 uso; agente barato" },
];

export const CATALOGO_PREMIUM: LlmModelo[] = [
  { slug: "anthropic/claude-sonnet-5", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "sintese da casa (historico job)" },
  { slug: "anthropic/claude-opus-4.8", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "julgamento fundo; so deep" },
  { slug: "anthropic/claude-opus-5", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "#8 uso; frontier Anthropic" },
  { slug: "anthropic/claude-sonnet-4.6", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "Sonnet atual; fallback do 5" },
  { slug: "openai/gpt-5.6-sol", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "GPT-5.6 raciocinio" },
  { slug: "openai/gpt-5.6-terra", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "GPT-5.6 prosa longa" },
  { slug: "openai/gpt-5.5", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "flagship OpenAI" },
  { slug: "google/gemini-3.1-pro-preview", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "Pro Google; visao pesada" },
  // 03/09/2026: padrao da casa para TODO agente e TODA tarefa (ver llm_roteador.ts).
  // Capacidades conferidas na /api/v1/models da OpenRouter em 03/09: input text+image+file,
  // tools/tool_choice, response_format + structured_outputs, 500k de contexto.
  // Raciocinio OBRIGATORIO (reasoning.mandatory=true): efforts low|medium|high|xhigh,
  // default high, e NAO aceita effort "none" / enabled:false — o modelo recusa.
  { slug: "x-ai/grok-4.6", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "padrao da casa (03/09/2026); raciocinio obrigatorio, aceita xhigh" },
  { slug: "anthropic/claude-opus-4.7", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "Opus anterior" },
  { slug: "openai/gpt-5.4", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "GPT-5.4" },
  { slug: "openai/gpt-5.6-sol-pro", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "Sol Pro" },
  { slug: "moonshotai/kimi-k3", faixa: "premium", tools: true, visao: false, json: true, prosa: true, nota: "contexto enorme; fallback" },
  { slug: "anthropic/claude-fable-5", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "faixa mais cara Anthropic" },
  { slug: "anthropic/claude-sonnet-4.5", faixa: "premium", tools: true, visao: true, json: true, prosa: true, nota: "Sonnet 4.5 estavel" },
];

export const CATALOGO_TODOS: LlmModelo[] = [...CATALOGO_ECONOMIA, ...CATALOGO_PREMIUM];

export function acharModelo(slug: string): LlmModelo | undefined {
  const s = slug.trim().toLowerCase();
  return CATALOGO_TODOS.find((m) => m.slug.toLowerCase() === s);
}

export function slugsDaFaixa(faixa: FaixaLlm): string[] {
  return (faixa === "premium" ? CATALOGO_PREMIUM : CATALOGO_ECONOMIA).map((m) => m.slug);
}

export type RequisitoCapacidade = { tools?: boolean; visao?: boolean; json?: boolean; prosa?: boolean };

/** O modelo entrega o que o bloco exige? Usado tambem para julgar o padrao da casa. */
export function atendeCapacidade(m: LlmModelo | undefined, req: RequisitoCapacidade): boolean {
  if (!m) return false;
  if (req.tools && !m.tools) return false;
  if (req.visao && !m.visao) return false;
  if (req.json && !m.json) return false;
  if (req.prosa && !m.prosa) return false;
  return true;
}

export function filtrarCatalogo(faixa: FaixaLlm, req: RequisitoCapacidade): LlmModelo[] {
  const lista = faixa === "premium" ? CATALOGO_PREMIUM : CATALOGO_ECONOMIA;
  return lista.filter((m) => atendeCapacidade(m, req));
}
