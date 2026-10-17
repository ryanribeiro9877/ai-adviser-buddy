// supabase/functions/_shared/aprendizados_regras.ts
//
// Regras PURAS da memoria aprendida dos agentes: sem rede, sem banco, sem relogio. Quem grava
// (chat, job) e quem consulta (edges) importam daqui, e a prova roda sem Supabase.
// Tabela e trigger: supabase/migrations/20261017150000_memoria_aprendida_dos_agentes.sql.
// Spec: docs/superpowers/specs/2026-10-17-memoria-aprendida-dos-agentes-design.md (7.0, 7.2, 7.5).
//
// PARIDADE COM O TRIGGER: conferirIsolamento e resolverLinha repetem as regras do trigger
// guard_agent_aprendizados_isolamento para devolver um motivo legivel ao modelo ANTES do insert.
// O trigger e a rede final. Se uma regra mudar la, muda aqui (e na prova), e vice-versa.
// Os dois olham o texto sem acento e em minusculo; aqui isso e feito por desacentuar().

import { type LinhaProdutoCohapm, linhasProdutoNoTexto } from "./memoria_conjunto.ts";
import { inferirMeiosDoPedido } from "./pedido_drive_criativos.ts";
import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CategoriaAprendizado =
  | "preferencia_do_gestor"
  | "correcao"
  | "fato_da_conta"
  | "armadilha"
  | "processo";

export type Evidencia = {
  tipo: "fala_do_gestor" | "retorno_de_ferramenta" | "resultado_de_ato";
  trecho: string;
  ferramenta?: string;
};

export type PedidoRegistro = {
  fato: string;
  contexto: string;
  categoria: CategoriaAprendizado;
  evidencia: Evidencia;
  confianca: "confirmada" | "observada";
  linha?: string | null;
  valido_ate?: string | null;
};

/** O que o chamador (chat ou job) sabe do turno e a confere contra o que o modelo alega. */
export type TurnoAprendizado = {
  companyId: string;
  agente: string;
  superficie: "chat" | "job";
  conversationId: string | null;
  jobId: string | null;
  falasDoGestor: string[];
  retornos: { tool: string; retorno: unknown }[];
  registrosNoTurno: number;
};

/** Linha devolvida por public.consultar_aprendizados. */
export type AprendizadoLinha = {
  id: string;
  categoria: string;
  fato: string;
  linha: string | null;
  agente_codigo: string;
  confianca: string;
  confirmacoes: number;
  criado_em: string;
  motivo?: string;
};

export type Veredito = { ok: true } | { ok: false; motivo: string };

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Precedencia: sai SEMPRE no topo do bloco, mesmo com um unico item (spec 7.0). */
export const CABECALHO_APRENDIZADOS =
  "MEMÓRIA APRENDIDA (registrada pelos agentes desta casa; dado fresco, regra de conformidade e memória curada vencem esta — se contradizer, diga e corrija com corrigir_aprendizado):";

/** Vai no prompt quando a consulta falha: o modelo nao pode concluir que nao ha aprendizado. */
export const AVISO_FALHA_APRENDIZADOS =
  "memória aprendida indisponível neste turno; não afirme que não há aprendizado";

/** Aprendizado `correcao` que contradiz memoria curada: o gestor leva isso a curadoria. */
export const PREFIXO_REVISAO_CURADORIA = "pedido de revisao de curadoria: ";

export const TETO_REGISTROS_TURNO = 3;
export const TETO_REGISTROS_DIA = 30;
export const LIMITE_CHAT = 8;
export const LIMITE_OUTROS = 5;
export const TETO_CHARS_CHAT = 4000;
export const TETO_CHARS_OUTROS = 2500;
export const MAX_PREFERENCIAS = 5;

const CATEGORIAS: readonly CategoriaAprendizado[] = [
  "preferencia_do_gestor",
  "correcao",
  "fato_da_conta",
  "armadilha",
  "processo",
];
const TIPOS_EVIDENCIA: readonly Evidencia["tipo"][] = [
  "fala_do_gestor",
  "retorno_de_ferramenta",
  "resultado_de_ato",
];
const CONFIANCAS: readonly PedidoRegistro["confianca"][] = ["confirmada", "observada"];

// Mesmos limites do CHECK da tabela (fato 20..600, contexto ate 1500).
const FATO_MIN = 20;
const FATO_MAX = 600;
const CONTEXTO_MAX = 1500;

// Linhas de negocio por empresa. Na v1 so a COHAPM tem (spec 7.6). A ordem e a de exibicao.
const LINHAS_COHAPM: readonly LinhaProdutoCohapm[] = ["la_felicita", "juridico", "sistema_ocular"];

// ---------------------------------------------------------------------------
// Normalizacao
// ---------------------------------------------------------------------------

/** Tira acento sem mexer em caixa nem em pontuacao (o que o unaccent do trigger faz). */
function desacentuar(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Minusculo, sem acento, sem pontuacao, espacos colapsados. Pontuacao vira espaco (nao some):
 * "12,5" e "125" nao podem virar a mesma chave, e "COHAPM_JURIDICO_V2" fica em tokens.
 */
export function normalizarTexto(s: string): string {
  return desacentuar(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Chave do dedupe exato (unica entre os vigentes da empresa). */
export function chaveNormalizada(fato: string): string {
  return normalizarTexto(fato).slice(0, 300);
}

/** Id curto que o gestor cita no chat ("esquece o #ab12cd"): 6 primeiros hex do uuid. */
export function idCurto(id: string): string {
  return String(id ?? "").replace(/-/g, "").toLowerCase().slice(0, 6);
}

// ---------------------------------------------------------------------------
// Dado volatil
// ---------------------------------------------------------------------------

// Roda sobre o texto SEM acento mas COM pontuacao: "R$", "%" e "12/10" somem na normalizarTexto.
const RE_NUMERO = /\d|r\$|%/;
const RE_TEMPO =
  /\b(?:hoje|ontem|anteontem|esta\s+semana|semana\s+passada|mes\s+passado|neste\s+mes|ultimos?\s+\d+\s+dias)\b|\d{2}\/\d{2}/;
// Sem fecho de palavra no fim de proposito: "custos", "gastos", "resultados", "conversas" contam.
const RE_METRICA =
  /\b(?:cpl|cpm|ctr|cpc|custo|gasto|investimento|resultado|conversa|formulario|lead|alcance|impressoes|clique|frequencia|roas)/;

/**
 * "Isso e dado, nao memoria": numero de desempenho preso a um periodo. Os tres sinais juntos
 * (numero, referencia de tempo, palavra de metrica). Qualquer um sozinho e fala normal do
 * gestor ("prefiro ver o CPL de ontem", "o conjunto 3 usa copy longa").
 */
export function ehDadoVolatil(fato: string): boolean {
  const t = desacentuar(String(fato ?? "")).toLowerCase();
  return RE_NUMERO.test(t) && RE_TEMPO.test(t) && RE_METRICA.test(t);
}

// ---------------------------------------------------------------------------
// Isolamento (espelho do trigger)
// ---------------------------------------------------------------------------

// Regra 1 do trigger. \mLEV\M do Postgres vira \blev\b: "levantamento" nao casa.
const RE_MARCA_LEGAL = /legal\s*e\s*viver|\blev\b|consignado\s*clt/;
const RE_MARCA_COHAPM = /cohapm|la felicit|lafelicita/;
const RE_MARCA_LAFELICITA = /la felicit|lafelicita/;

/**
 * Isolamento por empresa e por conta Meta. Mesmas regras 1 e 2 do trigger:
 * - Legal: nada de COHAPM nem La Felicita;
 * - COHAPM: nada de Legal e Viver / LEV / consignado CLT (La Felicita e linha dela);
 * - demais empresas: nada de Legal e Viver nem de La Felicita (COHAPM pode ser citada);
 * - todo act_<digitos> precisa ser conta da empresa (compara so os digitos, com ou sem act_).
 * `texto` e fato + contexto.
 */
export function conferirIsolamento(
  texto: string,
  companyId: string,
  contasDaEmpresa: string[],
): Veredito {
  const t = desacentuar(texto).toLowerCase();

  let citaOutraEmpresa: boolean;
  if (companyId === COMPANY_LEGAL) {
    citaOutraEmpresa = RE_MARCA_COHAPM.test(t);
  } else if (companyId === COMPANY_COHAPM) {
    citaOutraEmpresa = RE_MARCA_LEGAL.test(t);
  } else {
    citaOutraEmpresa = RE_MARCA_LEGAL.test(t) || RE_MARCA_LAFELICITA.test(t);
  }
  if (citaOutraEmpresa) return { ok: false, motivo: "cita_outra_empresa" };

  const proprias = new Set(
    (contasDaEmpresa ?? []).map((c) => String(c).replace(/\D/g, "")).filter(Boolean),
  );
  for (const m of t.matchAll(/act_([0-9]+)/g)) {
    if (!proprias.has(m[1])) return { ok: false, motivo: "cita_conta_alheia" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Linhas de negocio
// ---------------------------------------------------------------------------

export function linhasDaEmpresa(companyId: string): string[] {
  return companyId === COMPANY_COHAPM ? [...LINHAS_COHAPM] : [];
}

export function rotuloLinha(linha: string | null | undefined): string {
  if (!linha) return "Geral";
  switch (linha) {
    case "la_felicita":
      return "La Felicità";
    case "juridico":
      return "Jurídico";
    case "sistema_ocular":
      return "Sistema Ocular";
    default:
      return linha;
  }
}

/**
 * Codigo de linha vindo do modelo ou da edge, tolerante a acento, caixa e espaco ("Jurídico",
 * "Sistema Ocular"). "geral" e o rotulo que o bloco mostra para item sem linha, entao o modelo
 * pode devolver isso: vale como vazio. Devolve null quando nao informou nada.
 */
function lerLinha(raw: string | null | undefined): string | null {
  const n = normalizarTexto(String(raw ?? "")).replace(/ /g, "_");
  if (!n || n === "geral") return null;
  return n;
}

// Regra 3 do trigger: com linha preenchida, o texto nao pode citar OUTRA linha. Os padroes sao
// os do trigger, que sao mais largos que o classificador de linha (ex.: "juridica", "oculo").
// "Vistta" e marca da propria linha sistema_ocular, nao de outra.
function citaOutraLinha(linha: string, t: string): boolean {
  if (linha !== "la_felicita" && /la felicit|lafelicita|\blaf\b/.test(t)) return true;
  if (linha !== "juridico" && /juridic/.test(t)) return true;
  if (linha !== "sistema_ocular" && /vistta|sistema ocular|\boculos?\b/.test(t)) return true;
  return false;
}

/**
 * Spec 7.2, passo 4: quem decide a linha do registro e o texto, nao o modelo.
 * - empresa sem linhas: sempre nula (o parametro do modelo e ignorado);
 * - texto com duas ou mais linhas: recusa ("registre um aprendizado por linha");
 * - texto com uma linha: vale ela; se o modelo mandou outra, recusa por divergencia;
 * - texto sem linha: vale a do modelo (validada contra a lista da empresa) ou nula;
 * - por fim, a regra 3 do trigger, para nao gravar o que o banco recusaria.
 * `texto` e fato + contexto.
 */
export function resolverLinha(
  companyId: string,
  texto: string,
  linhaDoModelo?: string | null,
): { ok: true; linha: string | null } | { ok: false; motivo: string } {
  const permitidas = linhasDaEmpresa(companyId);
  if (!permitidas.length) return { ok: true, linha: null };

  const informada = lerLinha(linhaDoModelo);
  if (informada && !permitidas.includes(informada)) {
    return { ok: false, motivo: `linha invalida para esta empresa; use uma de: ${permitidas.join(", ")}` };
  }

  const achadas = linhasProdutoNoTexto(texto).filter((l) => permitidas.includes(l));
  if (achadas.length > 1) return { ok: false, motivo: "registre um aprendizado por linha" };

  let linha: string | null;
  if (achadas.length === 1) {
    if (informada && informada !== achadas[0]) {
      return {
        ok: false,
        motivo: `linha divergente: o texto cita ${achadas[0]} e a linha informada e ${informada}`,
      };
    }
    linha = achadas[0];
  } else {
    linha = informada;
  }

  if (linha && citaOutraLinha(linha, desacentuar(texto).toLowerCase())) {
    return { ok: false, motivo: "cita_outra_linha" };
  }
  return { ok: true, linha };
}

/**
 * Linhas que a TAREFA envolve, para o recorte da consulta (spec 7.5). Nulo = sem linha definida:
 * a consulta traz todas, cada item com o rotulo da linha. A linha fixa (dada pela edge, como a
 * marca escolhida no gerar-legendas) vence a inferencia. So devolve linhas da empresa.
 */
export function linhasDaTarefa(
  companyId: string,
  tarefa: string,
  linhaFixa?: string | null,
): string[] | null {
  const permitidas = linhasDaEmpresa(companyId);
  if (!permitidas.length) return null;

  const fixa = lerLinha(linhaFixa);
  if (fixa && permitidas.includes(fixa)) return [fixa];

  const achadas = inferirMeiosDoPedido(String(tarefa ?? "")).filter((l) => permitidas.includes(l));
  return achadas.length ? achadas : null;
}

// ---------------------------------------------------------------------------
// Evidencia conferida contra o texto real
// ---------------------------------------------------------------------------

/** Retorno de ferramenta como texto. Quebra de linha escapada pelo JSON vira espaco. */
function serializarRetorno(retorno: unknown): string {
  if (typeof retorno === "string") return retorno;
  try {
    return (JSON.stringify(retorno) ?? "").replace(/\\[nrt]/g, " ");
  } catch {
    return "";
  }
}

/**
 * Spec 7.2, passo 1. O trecho normalizado precisa estar CONTIDO no texto real:
 * - fala_do_gestor: em alguma fala do gestor neste turno (no job, o pedido). Parafrase recusa.
 * - retorno_de_ferramenta / resultado_de_ato: a ferramenta precisa ter rodado neste turno e o
 *   trecho precisa estar no retorno dela.
 * - "confirmada" so com fala do gestor; o resto e "observada".
 */
export function conferirEvidencia(
  ev: Evidencia,
  confianca: string,
  turno: TurnoAprendizado,
): Veredito {
  if (confianca !== "confirmada" && confianca !== "observada") {
    return { ok: false, motivo: "confianca invalida: use confirmada ou observada" };
  }
  // Trecho vazio depois de normalizar (so pontuacao, so espaco) estaria "contido" em qualquer texto.
  const trecho = normalizarTexto(String(ev?.trecho ?? ""));
  if (!trecho) return { ok: false, motivo: "evidencia sem trecho" };

  if (ev.tipo === "fala_do_gestor") {
    const achou = (turno.falasDoGestor ?? []).some((fala) => normalizarTexto(fala).includes(trecho));
    return achou ? { ok: true } : { ok: false, motivo: "cite a fala exata" };
  }

  if (ev.tipo === "retorno_de_ferramenta" || ev.tipo === "resultado_de_ato") {
    if (confianca === "confirmada") {
      return { ok: false, motivo: "confianca confirmada exige fala do gestor; use observada" };
    }
    const ferramenta = String(ev.ferramenta ?? "").trim();
    if (!ferramenta) return { ok: false, motivo: "informe a ferramenta da evidencia" };
    const rodadas = (turno.retornos ?? []).filter((r) => r.tool === ferramenta);
    if (!rodadas.length) {
      return { ok: false, motivo: `a ferramenta ${ferramenta} nao rodou neste turno` };
    }
    const achou = rodadas.some((r) => normalizarTexto(serializarRetorno(r.retorno)).includes(trecho));
    return achou
      ? { ok: true }
      : { ok: false, motivo: `o trecho nao aparece no retorno de ${ferramenta}` };
  }

  return { ok: false, motivo: "tipo de evidencia invalido" };
}

// ---------------------------------------------------------------------------
// Forma do pedido
// ---------------------------------------------------------------------------

function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Passo 1 da spec 7.2, so a FORMA: tamanhos, categoria, confianca, evidencia com trecho. A
 * conferencia do trecho contra o texto real e do conferirEvidencia. Entrada vem do modelo,
 * entao nada aqui lanca. Devolve o pedido aparado (fato e contexto sem espaco nas pontas).
 */
export function validarPedidoRegistro(
  p: unknown,
): { ok: true; pedido: PedidoRegistro } | { ok: false; motivo: string } {
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    return { ok: false, motivo: "pedido invalido: esperado um objeto" };
  }
  const o = p as Record<string, unknown>;

  const fato = typeof o.fato === "string" ? o.fato.trim() : "";
  if (fato.length < FATO_MIN || fato.length > FATO_MAX) {
    return { ok: false, motivo: `fato deve ter de ${FATO_MIN} a ${FATO_MAX} caracteres` };
  }

  if (o.contexto != null && typeof o.contexto !== "string") {
    return { ok: false, motivo: "contexto deve ser texto" };
  }
  const contexto = typeof o.contexto === "string" ? o.contexto.trim() : "";
  if (contexto.length > CONTEXTO_MAX) {
    return { ok: false, motivo: `contexto deve ter no maximo ${CONTEXTO_MAX} caracteres` };
  }

  const categoria = o.categoria as CategoriaAprendizado;
  if (!CATEGORIAS.includes(categoria)) {
    return { ok: false, motivo: `categoria invalida; use uma de: ${CATEGORIAS.join(", ")}` };
  }

  const confianca = o.confianca as PedidoRegistro["confianca"];
  if (!CONFIANCAS.includes(confianca)) {
    return { ok: false, motivo: "confianca invalida: use confirmada ou observada" };
  }

  const ev = o.evidencia;
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
    return { ok: false, motivo: "evidencia obrigatoria: {tipo, trecho}" };
  }
  const e = ev as Record<string, unknown>;
  const tipo = e.tipo as Evidencia["tipo"];
  if (!TIPOS_EVIDENCIA.includes(tipo)) {
    return { ok: false, motivo: `tipo de evidencia invalido; use um de: ${TIPOS_EVIDENCIA.join(", ")}` };
  }
  const trecho = typeof e.trecho === "string" ? e.trecho.trim() : "";
  if (!trecho) return { ok: false, motivo: "evidencia sem trecho" };
  const ferramenta = typeof e.ferramenta === "string" ? e.ferramenta.trim() : "";
  const evidencia: Evidencia = ferramenta ? { tipo, trecho, ferramenta } : { tipo, trecho };

  if (o.linha != null && typeof o.linha !== "string") {
    return { ok: false, motivo: "linha deve ser texto ou vazia" };
  }
  const linha = typeof o.linha === "string" && o.linha.trim() ? o.linha.trim() : null;

  if (o.valido_ate != null && typeof o.valido_ate !== "string") {
    return { ok: false, motivo: "valido_ate deve ser uma data AAAA-MM-DD" };
  }
  const validoAte = typeof o.valido_ate === "string" && o.valido_ate.trim() ? o.valido_ate.trim() : null;
  if (validoAte && !dataValida(validoAte)) {
    return { ok: false, motivo: "valido_ate deve ser uma data AAAA-MM-DD" };
  }

  return {
    ok: true,
    pedido: { fato, contexto, categoria, evidencia, confianca, linha, valido_ate: validoAte },
  };
}

// ---------------------------------------------------------------------------
// Rede de seguranca do chat
// ---------------------------------------------------------------------------

// Leitura (spec 7.4): o gestor corrige ou declara preferencia no meio de uma pergunta. Barata e
// larga de proposito: falso positivo custa uma extracao curta; falso negativo perde a correcao.
// Fecho de palavra nas palavras inteiras ("lembrete" nao e "lembre"); radical aberto nas flexoes
// ("corrig" pega corrigir/corrija, "errad" pega errado/errada).
const RE_SINAL_CORRECAO = new RegExp(
  "\\b(?:" +
    [
      "nao e assim",
      "esta errad",
      "errou\\b",
      "errad",
      "corrig",
      "a partir de agora",
      "daqui pra frente",
      "sempre\\b",
      "nunca\\b",
      "prefiro\\b",
      "prefira\\b",
      "lembr(?:e|a|ar)\\b",
      "nao (?:use|faca|mande|coloque|mostre) mais",
    ].join("|") +
    ")",
);

export function sinalDeCorrecao(msg: string): boolean {
  return RE_SINAL_CORRECAO.test(normalizarTexto(String(msg ?? "")));
}

// ---------------------------------------------------------------------------
// Bloco para o prompt
// ---------------------------------------------------------------------------

/** dd/mm/aaaa no fuso de Sao Paulo: 01:30 UTC de 02/11 ainda e dia 01 para o gestor. */
const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function dataBr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "s/d";
  const partes = Object.fromEntries(FORMATO_DATA.formatToParts(d).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year}`;
}

/** Uma linha so: quebra de linha dentro do texto abriria "item" forjado no prompt. */
function emUmaLinha(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function formatarItem(r: AprendizadoLinha, comLinha: boolean): string {
  const partes = [`#${idCurto(r.id)}`, emUmaLinha(r.categoria)];
  if (comLinha) partes.push(rotuloLinha(r.linha));
  const confirmacoes = Number(r.confirmacoes) > 1 ? ` ${Number(r.confirmacoes)}x` : "";
  partes.push(
    `${emUmaLinha(r.agente_codigo)}, ${dataBr(r.criado_em)}, ${emUmaLinha(r.confianca)}${confirmacoes}`,
  );
  return `- [${partes.join(" | ")}] ${emUmaLinha(r.fato)}`;
}

/**
 * Bloco da memoria aprendida para o prompt: cabecalho de precedencia + um item por linha, na
 * ordem recebida (a consulta ja entrega preferencias primeiro e depois por relevancia).
 * Sem itens, "" (nao gera bloco). No teto, corta ITEM inteiro a partir do primeiro que nao
 * cabe, nunca no meio dele; se nem o primeiro cabe, tambem "".
 */
export function formatarBlocoAprendizados(
  rows: AprendizadoLinha[],
  opts: { tetoChars: number; comLinha: boolean },
): string {
  if (!rows?.length) return "";
  let bloco = CABECALHO_APRENDIZADOS;
  let itens = 0;
  for (const r of rows) {
    const candidato = `${bloco}\n${formatarItem(r, opts.comLinha)}`;
    if (candidato.length > opts.tetoChars) break;
    bloco = candidato;
    itens++;
  }
  return itens ? bloco : "";
}
