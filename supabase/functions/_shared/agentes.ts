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
