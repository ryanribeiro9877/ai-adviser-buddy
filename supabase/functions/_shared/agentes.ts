// Catalogo de agentes nomeados (public.agents + public.agent_unidades).
//
// O prompt de delegacao do Roteador e GERADO daqui. Catalogo e prompt nao podem divergir:
// editar a tabela muda a delegacao sem redeploy. Por isso nada de descricao de agente
// escrita a mao dentro do prompt do planner.
//
// A execucao nao muda de lugar: cada agente aponta para as unidades que ja existem
// (subagente do traffic-agent-job, edge function, pipeline ou ferramenta). Um agente pode
// ter varias — e o que permite fundir criativos + criativos_drive + analise_visual_drive
// sob o Estudio sem reescrever o executor.

import {
  ehPedidoLeituraCruzada,
  ehPedidoUploadLote,
  pedidoSoLegendasSemEmissao,
} from "./intencao_turno.ts";

export type AgenteRegistro = {
  codigo: string;
  nome: string;
  setor: string;
  papel: string;
  delegar_quando: string;
  nao_delegar_quando: string | null;
  exemplos: string[];
  roteavel: boolean;
  ordem: number;
};

export type UnidadeAgente = {
  agent_codigo: string;
  tipo: "subagente" | "edge" | "pipeline" | "ferramenta";
  chave: string;
};

export type CatalogoAgentes = {
  agentes: AgenteRegistro[];
  unidades: UnidadeAgente[];
  /** true = leitura da tabela falhou e o catalogo veio do fallback local. */
  degradado: boolean;
};

// Fallback condensado. Existe para que uma falha de leitura no banco NAO derrube a
// delegacao: sem catalogo o Roteador nao tem como escolher, e o turno morreria antes de
// qualquer especialista rodar. Condensado de proposito — o texto rico mora na tabela.
const FALLBACK_AGENTES: AgenteRegistro[] = [
  {
    codigo: "AG-02", nome: "Analista", setor: "Desempenho e estrutura de midia",
    papel: "Numeros de midia e a configuracao que os produz.",
    delegar_quando: "Metrica, custo, CTR, serie diaria, ranking, teto, pacing, escala, pausa por custo, CBO/ABO, orcamento, lance, targeting.",
    nao_delegar_quando: "Conteudo da peca, template de WhatsApp, alerta pendente, emissao de card.",
    exemplos: [], roteavel: true, ordem: 2,
  },
  {
    codigo: "AG-03", nome: "Estudio", setor: "Ativo criativo e copy",
    papel: "A peca no acervo, nos pixels e no ar, mais a copy.",
    delegar_quando: "Pasta do Drive, acervo, peca nova, classificar conteudo visual, legenda, copy, hook, CTA, o que o anuncio diz.",
    nao_delegar_quando: "Resultado da peca em numeros, veredito de conformidade, upload e criacao de anuncio.",
    exemplos: [], roteavel: true, ordem: 3,
  },
  {
    codigo: "AG-04", nome: "Guardiao", setor: "Conformidade",
    papel: "Unica autoridade sobre o que pode ir ao ar.",
    delegar_quando: "Compliance, pode anunciar isso, violacao, categoria especial, CET, auditoria de legenda. Sempre depois de copy nova.",
    nao_delegar_quando: "Duvida conceitual sem texto para validar; reescrita da copy.",
    exemplos: [], roteavel: true, ordem: 4,
  },
  {
    codigo: "AG-05", nome: "Mensageiro", setor: "Canal WhatsApp",
    papel: "Inventario WABA e CTWA, numeros e templates.",
    delegar_quando: "WhatsApp, WABA, numero de pe, wa.me, CTWA, tier, qualidade, template e clique DE TEMPLATE.",
    nao_delegar_quando: "Clique de campanha ou anuncio; emissao do conjunto CTWA.",
    exemplos: [], roteavel: true, ordem: 5,
  },
  {
    codigo: "AG-06", nome: "Executor", setor: "Atos na conta Meta",
    papel: "Unico agente que provoca escrita, sempre via card de aprovacao.",
    delegar_quando: "Verbo de ato: criar, suba, lance, duplique, escale, pause, ative, altere, emita, replique, renomeie, vincule. Estado de card.",
    nao_delegar_quando: "Pergunta de julgamento que so parece ato; 'crie as legendas' (o ato e escrever copy).",
    exemplos: [], roteavel: true, ordem: 6,
  },
  {
    codigo: "AG-07", nome: "Sentinela", setor: "Saude da plataforma e pendencias",
    papel: "Observa a operacao, nao o resultado de midia.",
    delegar_quando: "Alerta, recomendacao pendente, dica da Meta, integracao, coleta, token, escopo, digest, custo de LLM.",
    nao_delegar_quando: "Diagnostico de custo de midia; a acao sugerida pelo alerta.",
    exemplos: [], roteavel: true, ordem: 7,
  },
  {
    codigo: "AG-08", nome: "Bibliotecario", setor: "Conhecimento tecnico",
    papel: "Fundamento conceitual e validade da base.",
    delegar_quando: "Pergunta conceitual que independe da conta: o que e, como funciona, qual a definicao, o que a Meta permite em tese.",
    nao_delegar_quando: "Qualquer pergunta que exija olhar campanha, peca ou numero da conta.",
    exemplos: [], roteavel: true, ordem: 8,
  },
];

const FALLBACK_UNIDADES: UnidadeAgente[] = [
  { agent_codigo: "AG-02", tipo: "subagente", chave: "desempenho_campanhas" },
  { agent_codigo: "AG-02", tipo: "subagente", chave: "estrutura_conta" },
  { agent_codigo: "AG-03", tipo: "subagente", chave: "criativos_drive" },
  { agent_codigo: "AG-03", tipo: "subagente", chave: "analise_visual_drive" },
  { agent_codigo: "AG-03", tipo: "subagente", chave: "criativos" },
  { agent_codigo: "AG-04", tipo: "subagente", chave: "compliance" },
  { agent_codigo: "AG-05", tipo: "subagente", chave: "whatsapp_waba" },
  { agent_codigo: "AG-07", tipo: "subagente", chave: "alertas_recomendacoes" },
  { agent_codigo: "AG-08", tipo: "subagente", chave: "conhecimento" },
];

export function catalogoFallback(): CatalogoAgentes {
  return { agentes: FALLBACK_AGENTES, unidades: FALLBACK_UNIDADES, degradado: true };
}

export async function carregarCatalogoAgentes(
  // deno-lint-ignore no-explicit-any
  supa: { from: (t: string) => any },
): Promise<CatalogoAgentes> {
  try {
    const [ag, un] = await Promise.all([
      supa.from("agents")
        .select("codigo,nome,setor,papel,delegar_quando,nao_delegar_quando,exemplos,roteavel,ordem")
        .eq("vigente", true).order("ordem"),
      supa.from("agent_unidades").select("agent_codigo,tipo,chave").eq("vigente", true),
    ]);
    const agentes = (ag?.data ?? []) as AgenteRegistro[];
    const unidades = (un?.data ?? []) as UnidadeAgente[];
    if (!agentes.length || !unidades.length) return catalogoFallback();
    return {
      agentes: agentes.map((a) => ({ ...a, exemplos: Array.isArray(a.exemplos) ? a.exemplos : [] })),
      unidades,
      degradado: false,
    };
  } catch {
    return catalogoFallback();
  }
}

/** Só os agentes que podem receber delegação (exclui Gestor e Roteador). */
export function especialistas(cat: CatalogoAgentes): AgenteRegistro[] {
  return cat.agentes.filter((a) => a.roteavel).sort((a, b) => a.ordem - b.ordem);
}

/**
 * Bloco de catálogo que vai literal para o system prompt do Roteador.
 *
 * A fronteira NEGATIVA (`nao_delegar_quando`) é o que impede o erro clássico de roteamento
 * por semelhança de termo — "taxa de clique de template" caindo em desempenho de campanha.
 * Por isso ela entra sempre que existir, não só quando o texto é curto.
 */
export function montarPromptDelegacao(cat: CatalogoAgentes): string {
  const linhas = especialistas(cat).map((a) => {
    const partes = [
      `### ${a.codigo} — ${a.nome} (${a.setor})`,
      a.papel,
      `DELEGUE QUANDO: ${a.delegar_quando}`,
    ];
    if (a.nao_delegar_quando) partes.push(`NAO DELEGUE: ${a.nao_delegar_quando}`);
    if (a.exemplos.length) {
      partes.push(`EXEMPLOS: ${a.exemplos.map((e) => `"${e}"`).join(" | ")}`);
    }
    return partes.join("\n");
  });
  return linhas.join("\n\n");
}

/** Nomes aceitos na resposta do Roteador — código e nome, para o modelo não errar por grafia. */
export function nomesAceitos(cat: CatalogoAgentes): string[] {
  const out: string[] = [];
  for (const a of especialistas(cat)) {
    out.push(a.codigo, a.nome.toLowerCase());
  }
  return out;
}

function normalizar(s: string): string {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Resolve "AG-03", "Estudio" ou "estúdio" para o registro do agente. */
export function acharAgente(cat: CatalogoAgentes, ref: string): AgenteRegistro | null {
  const r = normalizar(ref);
  if (!r) return null;
  for (const a of cat.agentes) {
    if (normalizar(a.codigo) === r || normalizar(a.nome) === r) return a;
  }
  return null;
}

/**
 * Expande códigos de agente nas chaves de subagente que o executor já conhece.
 *
 * Um agente pode cobrir mais de um subagente (Analista = desempenho + estrutura), então a
 * ordem importa: `ordemPreferida` deixa o chamador priorizar quando o orçamento de
 * especialistas do tier não comporta todos.
 */
export function subagentesDosAgentes(
  cat: CatalogoAgentes,
  refs: string[],
  ordemPreferida?: string[],
): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const ref of refs) {
    const ag = acharAgente(cat, ref);
    if (!ag) continue;
    const chaves = cat.unidades
      .filter((u) => u.agent_codigo === ag.codigo && u.tipo === "subagente")
      .map((u) => u.chave);
    const ordenadas = ordemPreferida?.length
      ? [...chaves].sort((a, b) => {
        const ia = ordemPreferida.indexOf(a), ib = ordemPreferida.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      })
      : chaves;
    for (const c of ordenadas) {
      if (!vistos.has(c)) { vistos.add(c); out.push(c); }
    }
  }
  return out;
}

/** Caminho inverso: de qual agente é este subagente. Usado em telemetria e em plano forçado. */
export function agenteDoSubagente(cat: CatalogoAgentes, chave: string): AgenteRegistro | null {
  const u = cat.unidades.find((x) => x.tipo === "subagente" && x.chave === chave);
  if (!u) return null;
  return cat.agentes.find((a) => a.codigo === u.agent_codigo) ?? null;
}

// ============================================================================
// SELECAO DE FERRAMENTAS POR AGENTE (chat sincrono)
// ============================================================================

/**
 * Agentes cujas ferramentas entram em TODO turno, escolhidos ou nao.
 *
 * AG-00 porque sem a memoria da conversa o fio se perde no meio do turno. AG-06 porque
 * propose_action nao pode faltar: o gestor muda de leitura para ato dentro da mesma frase, e
 * o guarda deveForcarEmissao devolve o turno ao modelo exigindo a chamada — se a ferramenta
 * nao estiver na mesa, o guarda entra em laco e nenhum card sai. Foi assim que 19 turnos
 * anunciaram cards que nunca existiram.
 */
export const NUCLEO_SEMPRE = ["AG-00", "AG-06"];

/**
 * Quem vem junto por dependencia de fluxo. Estudio escreve copy e o Guardiao valida antes de
 * a resposta sair — e a cascata que gerar-legendas ja faz hoje para compliance-check.
 */
export const CASCATA: Record<string, string[]> = { "AG-03": ["AG-04"] };

/**
 * Rede de seguranca deterministica sobre a escolha do modelo.
 *
 * Os classificadores de intencao_turno.ts foram escritos depois de incidentes medidos, e cada
 * um sabe de um caso que a leitura semantica erra. O Roteador e um modelo: ele pode ler
 * "de qual pasta vieram os anuncios do CONJ.1" como pergunta de desempenho e deixar o Estudio
 * de fora — que e exatamente o defeito de 02/09, quando 5 de 6 anuncios sairam "sem vinculo"
 * embora os cards tivessem pasta e drive_file_id.
 *
 * Aqui a intencao ALARGA o conjunto, nunca estreita: em caso de divergencia entre o regex e o
 * modelo, os dois entram. Errar por agente a mais custa contexto; errar por agente a menos
 * custa a resposta.
 */
export function reforcarPorIntencao(agentes: string[], pergunta: string): string[] {
  const p = String(pergunta ?? "");
  const out = [...agentes];
  const juntar = (...cods: string[]) => {
    for (const c of cods) if (!out.includes(c)) out.push(c);
  };
  // Cruzar anuncio no ar com peca do Drive precisa dos dois lados na mesa.
  if (ehPedidoLeituraCruzada(p)) juntar("AG-02", "AG-03");
  // "crie as legendas" tem verbo de ato, mas o ato e escrever copy.
  if (pedidoSoLegendasSemEmissao(p)) juntar("AG-03");
  // Subir lote exige saber o que ainda falta subir, e isso mora no acervo.
  if (ehPedidoUploadLote(p)) juntar("AG-03");
  return out;
}

function expandirComNucleoECascata(refs: string[], cat: CatalogoAgentes): string[] {
  const codigos = new Set<string>(NUCLEO_SEMPRE);
  for (const ref of refs) {
    const ag = acharAgente(cat, ref);
    if (!ag) continue;
    codigos.add(ag.codigo);
    for (const extra of CASCATA[ag.codigo] ?? []) codigos.add(extra);
  }
  return [...codigos];
}

/**
 * Ferramentas do turno. `null` significa "nao estreitar" — o chamador deve mandar o conjunto
 * inteiro. Devolver null em vez de um conjunto vazio e proposital: um turno sem ferramenta
 * responderia de cabeca, que e pior do que um turno com ferramenta demais.
 */
export function ferramentasDosAgentes(cat: CatalogoAgentes, refs: string[]): Set<string> | null {
  if (!refs.length) return null;
  const codigos = expandirComNucleoECascata(refs, cat);
  const chaves = new Set<string>();
  for (const u of cat.unidades) {
    if (u.tipo === "ferramenta" && codigos.includes(u.agent_codigo)) chaves.add(u.chave);
  }
  // Catalogo sem ferramentas mapeadas (fallback local, ou seed incompleto): nao estreite nada.
  return chaves.size ? chaves : null;
}

/** Bloco de identidade para o system prompt do turno: quem esta atuando e onde e a fronteira. */
export function blocoIdentidadeAgentes(cat: CatalogoAgentes, refs: string[]): string {
  const codigos = expandirComNucleoECascata(refs, cat);
  const escolhidos = cat.agentes
    .filter((a) => codigos.includes(a.codigo) && a.roteavel)
    .sort((x, y) => x.ordem - y.ordem);
  if (!escolhidos.length) return "";
  const linhas = escolhidos.map((a) => {
    const fronteira = a.nao_delegar_quando ? ` FORA DO SEU SETOR: ${a.nao_delegar_quando}` : "";
    return `- ${a.codigo} ${a.nome} (${a.setor}): ${a.papel}${fronteira}`;
  });
  return `## AGENTES DESTE TURNO
O Roteador delegou este pedido aos agentes abaixo. Voce atua como eles, com as ferramentas deles na mesa.
${linhas.join("\n")}
Se o pedido exigir setor que nao esta nesta lista, diga o que falta em vez de improvisar com a ferramenta mais parecida.`;
}

// ============================================================================
// AG-01 ROTEADOR — delegacao por modelo
// ============================================================================

export type Delegacao = {
  agentes: string[];
  degradado: boolean;
  motivo: string;
  tokensIn: number;
  tokensOut: number;
};

function jsonDoTexto(t: string): any {
  const s = String(t ?? "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    return JSON.parse(s.slice(i, j + 1));
  } catch {
    return null;
  }
}

/**
 * Pergunta ao modelo quais agentes devem atender o turno.
 *
 * FALHA ABERTA por decisao: timeout, erro de rede ou JSON invalido devolvem lista vazia e
 * `degradado`, e o chamador mantem o conjunto inteiro de ferramentas. O Roteador existe para
 * economizar contexto, nao para ser mais um ponto que derruba o chat — um turno caro e melhor
 * do que um turno perdido.
 */
export async function delegarAgentes(opts: {
  pergunta: string;
  catalogo: CatalogoAgentes;
  chaveOpenRouter: string;
  // deno-lint-ignore no-explicit-any
  rota: { model: string; fallbacks?: string[] } & Record<string, any>;
  // deno-lint-ignore no-explicit-any
  montarBody: (rota: any, extra: Record<string, unknown>) => Record<string, unknown>;
  timeoutMs?: number;
}): Promise<Delegacao> {
  const vazio = (motivo: string): Delegacao => ({ agentes: [], degradado: true, motivo, tokensIn: 0, tokensOut: 0 });
  const pergunta = String(opts.pergunta ?? "").trim();
  if (!pergunta || !opts.chaveOpenRouter) return vazio("sem pergunta ou sem chave");

  const sys = `Voce e o ROTEADOR (AG-01) do Gestor de Trafego IA. Voce NAO responde ao gestor: voce le a mensagem, interpreta o que esta sendo pedido e escolhe QUEM vai atender.

CATALOGO DE AGENTES
${montarPromptDelegacao(opts.catalogo)}

COMO ESCOLHER
1. Identifique o que o gestor quer SABER ou quer QUE ACONTECA — nao o vocabulario que ele usou.
2. Case com o DELEGUE QUANDO de cada agente. Se dois casarem, use o NAO DELEGUE para desempatar: a fronteira negativa vale mais que a semelhanca de termo.
3. Escolha o MENOR conjunto que cobre o pedido. Agente a mais custa janela.
4. Na duvida entre dois, inclua os dois — e melhor um agente sobrando do que o pedido sem dono.

Responda APENAS com JSON valido, sem markdown:
{"agentes":["AG-02"],"motivo":"uma frase curta"}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8_000);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.chaveOpenRouter}` },
      body: JSON.stringify(opts.montarBody(opts.rota, {
        messages: [{ role: "system", content: sys }, { role: "user", content: pergunta.slice(0, 4000) }],
        // 03/09/2026: 300 nao serve mais. max_tokens cobre raciocinio + texto, e o padrao da
        // casa (Grok 4.6) raciocina em TODA chamada — nao ha como desligar. Com 300 o modelo
        // gastaria o teto pensando e devolveria content vazio, o que aqui significa turno com
        // as 54 ferramentas em vez das do setor. O JSON de resposta continua tendo ~40 tokens.
        max_tokens: 1200,
      })),
      signal: ac.signal,
    });
    if (!resp.ok) return vazio(`http ${resp.status}`);
    const j = await resp.json();
    const bruto = jsonDoTexto(String(j?.choices?.[0]?.message?.content ?? ""));
    const lista = Array.isArray(bruto?.agentes) ? bruto.agentes : null;
    if (!lista?.length) return vazio("resposta sem lista de agentes");
    const validos: string[] = [];
    for (const ref of lista) {
      const ag = acharAgente(opts.catalogo, String(ref));
      if (ag && ag.roteavel && !validos.includes(ag.codigo)) validos.push(ag.codigo);
    }
    if (!validos.length) return vazio("nenhum agente do catalogo foi reconhecido");
    return {
      agentes: validos,
      degradado: false,
      motivo: String(bruto?.motivo ?? "").slice(0, 200),
      tokensIn: Number(j?.usage?.prompt_tokens ?? 0),
      tokensOut: Number(j?.usage?.completion_tokens ?? 0),
    };
  } catch (e) {
    return vazio(String((e as any)?.name === "AbortError" ? "timeout" : (e as any)?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}
