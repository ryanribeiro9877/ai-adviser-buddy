// Registro de ferramentas (public.agent_ferramentas).
//
// POR QUE ISTO EXISTE: ate 03/09/2026 a definicao de cada ferramenta era um literal dentro da
// edge — `const TOOLS` no traffic-chat e `const DEF` no traffic-agent-job. Duas consequencias
// medidas: (1) as descricoes viraram deposito de doutrina, 27.893 chars so de texto de
// ferramenta indo ao modelo em TODO turno, escolhida a ferramenta ou nao; (2) a mesma
// ferramenta tinha duas descricoes diferentes nas duas edges, e nenhuma delas conversava com
// public.agent_unidades, que ja dizia de qual agente a ferramenta e. get_detalhe_anuncios e
// origem_drive_dos_anuncios existiam no codigo do chat e NAO existiam no registro — como o
// Roteador estreita o turno pelo registro, um pedido de serie por anuncio saia sem a
// ferramenta que a propria doutrina chama de obrigatoria.
//
// TRES CAMADAS, E ELAS NAO SE MISTURAM:
//   descricao  -> decide SE a ferramenta e chamada. Vai ao modelo em todo turno em que a
//                 ferramenta esta na mesa. Curta por obrigacao.
//   parametros -> o schema. Igual ao que as edges ja mandavam.
//   doutrina   -> decide COMO ler o retorno. NAO vai no prompt: e anexada a mensagem de
//                 retorno da ferramenta, e so quando ela foi de fato executada.
//
// A LINHA ENTRE descricao E doutrina NAO E ESTETICA. Num turno degradado (leitura da tabela
// falhou) o fallback local traz descricao e parametros, mas nao a doutrina. Entao o que nao
// pode ser perdido em turno nenhum — a guarda que decide se um ato acontece — mora na
// descricao ou no system prompt, nunca so na doutrina.
//
// A DOUTRINA NAO E REINJETADA. Ela e concatenada a mensagem `role: "tool"` da rodada, depois
// do JSON; o que fica gravado em chat_messages.tool_results (e volta no bloco [RETORNOS DE
// FERRAMENTA JA APURADOS EM ...]) e so o retorno. Assim o texto longo e pago uma vez, na
// rodada em que serve, e nao em todas as seguintes.

import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";

export type Superficie = "chat" | "job";

export type FerramentaRegistro = {
  chave: string;
  descricao: string;
  parametros: Record<string, unknown>;
  doutrina: string | null;
  superficies: string[];
  /** Propriedades que o handler daquela superficie nao implementa. Ver ferramentas_base.ts. */
  parametros_omitidos: Record<string, string[]>;
};

export type CatalogoFerramentas = {
  porChave: Map<string, FerramentaRegistro>;
  /** true = leitura da tabela falhou; vale o snapshot local e a doutrina esta ausente. */
  degradado: boolean;
};

/** Definicao no formato que a API de tool calling espera. */
export type DefinicaoFerramenta = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/**
 * Fallback local. Mesma postura de catalogoFallback() em agentes.ts: leitura de banco que
 * falha NAO pode derrubar o turno. Sem ferramenta o modelo responde de cabeca, que e o pior
 * resultado possivel — pior que um turno caro.
 */
export function catalogoFerramentasFallback(): CatalogoFerramentas {
  const porChave = new Map<string, FerramentaRegistro>();
  for (const [chave, base] of Object.entries(FERRAMENTAS_BASE)) {
    porChave.set(chave, {
      chave,
      descricao: base.descricao,
      parametros: base.parametros,
      doutrina: null,
      superficies: base.superficies,
      parametros_omitidos: base.omitidos ?? {},
    });
  }
  return { porChave, degradado: true };
}

export async function carregarFerramentas(
  // deno-lint-ignore no-explicit-any
  supa: { from: (t: string) => any },
): Promise<CatalogoFerramentas> {
  try {
    const { data } = await supa.from("agent_ferramentas")
      .select("chave,descricao,parametros,doutrina,superficies,parametros_omitidos")
      .eq("vigente", true);
    const linhas = (data ?? []) as FerramentaRegistro[];
    if (!linhas.length) return catalogoFerramentasFallback();
    const porChave = new Map<string, FerramentaRegistro>();
    for (const l of linhas) {
      if (!l?.chave || !l?.descricao || !l?.parametros) continue;
      porChave.set(l.chave, {
        chave: l.chave,
        descricao: l.descricao,
        parametros: l.parametros,
        doutrina: l.doutrina ?? null,
        superficies: Array.isArray(l.superficies) ? l.superficies : ["chat"],
        parametros_omitidos: (l.parametros_omitidos ?? {}) as Record<string, string[]>,
      });
    }
    // Registro parcial e pior que registro nenhum: o turno perderia ferramentas sem avisar.
    // O piso e o snapshot local, que por construcao cobre tudo que o codigo sabe executar.
    if (porChave.size < Object.keys(FERRAMENTAS_BASE).length) {
      const base = catalogoFerramentasFallback();
      for (const [k, v] of porChave) base.porChave.set(k, v);
      return { porChave: base.porChave, degradado: true };
    }
    return { porChave, degradado: false };
  } catch {
    return catalogoFerramentasFallback();
  }
}

function schemaDaSuperficie(f: FerramentaRegistro, superficie: Superficie): Record<string, unknown> {
  const omitir = f.parametros_omitidos?.[superficie] ?? [];
  if (!omitir.length) return f.parametros;
  const p = JSON.parse(JSON.stringify(f.parametros)) as Record<string, unknown>;
  const props = (p.properties ?? {}) as Record<string, unknown>;
  for (const k of omitir) delete props[k];
  if (Array.isArray(p.required)) {
    p.required = (p.required as string[]).filter((k) => !omitir.includes(k));
  }
  return p;
}

export function definicaoDaFerramenta(
  cat: CatalogoFerramentas,
  chave: string,
  superficie: Superficie,
): DefinicaoFerramenta | null {
  const f = cat.porChave.get(chave);
  if (!f || !f.superficies.includes(superficie)) return null;
  return {
    type: "function",
    function: { name: f.chave, description: f.descricao, parameters: schemaDaSuperficie(f, superficie) },
  };
}

/**
 * Monta o array de ferramentas do turno.
 *
 * `permitidas` vem do estreitamento por agente (ferramentasDosAgentes). null significa "nao
 * estreitar" — o mesmo contrato de agentes.ts, e pela mesma razao: errar por ferramenta a
 * menos custa a resposta, errar por ferramenta a mais custa janela.
 *
 * `ordem` existe porque o array hardcoded tinha uma ordem estavel e a leitura do banco nao
 * tem. Ordem de ferramenta nao muda comportamento, mas muda o corpo da requisicao byte a
 * byte, e requisicao instavel joga fora o cache de prefixo do provider.
 */
export function montarFerramentas(
  cat: CatalogoFerramentas,
  superficie: Superficie,
  permitidas?: Set<string> | null,
  ordem?: string[],
): DefinicaoFerramenta[] {
  const chaves = [...cat.porChave.keys()]
    .filter((k) => cat.porChave.get(k)!.superficies.includes(superficie))
    .filter((k) => !permitidas || permitidas.has(k));
  const peso = (k: string) => {
    const i = ordem?.indexOf(k) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  chaves.sort((a, b) => (peso(a) - peso(b)) || a.localeCompare(b));
  const out: DefinicaoFerramenta[] = [];
  for (const k of chaves) {
    const d = definicaoDaFerramenta(cat, k, superficie);
    if (d) out.push(d);
  }
  return out;
}

/** Chaves que existem nesta superficie. Usado em telemetria e nas conferencias de cobertura. */
export function chavesDaSuperficie(cat: CatalogoFerramentas, superficie: Superficie): string[] {
  return [...cat.porChave.keys()]
    .filter((k) => cat.porChave.get(k)!.superficies.includes(superficie))
    .sort();
}

const CABECALHO_DOUTRINA =
  "COMO LER ESTE RETORNO (doutrina registrada desta ferramenta, nao faz parte do dado):";

/**
 * Retorno da ferramenta com a doutrina de uso colada depois.
 *
 * Concatena em vez de inserir um campo no JSON de proposito: o retorno e persistido e
 * reinjetado em turnos seguintes, e a doutrina nao deve viajar junto — ela serve na rodada em
 * que a ferramenta rodou. Colar depois tambem sobrevive ao corte por tamanho do payload, que
 * e aplicado so ao JSON.
 */
export function retornoComDoutrina(
  cat: CatalogoFerramentas,
  chave: string,
  retornoJson: string,
): string {
  const d = cat.porChave.get(chave)?.doutrina;
  if (!d) return retornoJson;
  return `${retornoJson}\n\n${CABECALHO_DOUTRINA}\n${d}`;
}
