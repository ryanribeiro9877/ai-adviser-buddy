// PROVA DE REPRODUTIBILIDADE DA CAMADA.
// Rode: deno run supabase/functions/_shared/_prova_determinismo_camada.ts
//
// A mesma entrada, repetida, tem que produzir saida IDENTICA BYTE A BYTE.
//
// A LINHA DE BASE MEDIDA: as 13 perguntas_ouro tem 39 execucoes com resposta real do agente
// (3 por codigo, todas em 06/08), pelo caminho atual, que e geracao livre. Saiu 39 respostas
// distintas — 0 de 39 repetiram. Em 10 dos 13 codigos o CONJUNTO DE NUMEROS citados mudou
// entre rodadas do mesmo dia. PO-01 rodou 3x em 32 minutos e a rodada de 17:35 nao citou
// R$ 1.512,00, que as outras duas citaram como resposta da pergunta.
//
// Ressalva do metodo, registrada em molde_pergunta.ts: as 3 rodadas sao versoes diferentes do
// agente, entao a divergencia de NUMERO esta confundida com mudanca intencional. A divergencia
// de TEXTO nao esta: 39 de 39 saidas distintas, inclusive entre rodadas a 7 minutos com o
// mesmo conjunto de numeros.
//
// Esta prova mede a mesma coisa no caminho canonico e exige o oposto: 1 hash distinto.
//
// O SEGUNDO TESTE, que e o mais rigoroso, e ENTRE PROCESSOS. Repetir dentro do mesmo processo
// nao prova muita coisa: uma funcao pura repetida no mesmo heap tende a repetir. O que pega
// dependencia de relogio, de locale, de ICU, de ordem de Map e de estado global e rodar de
// novo em processo NOVO e comparar a impressao digital final. Por isso o script imprime
// IMPRESSAO_DIGITAL_DA_CAMADA e a prova de fechamento compara duas execucoes separadas.

import { classificarMolde, codigosDeMolde } from "./molde_pergunta.ts";
import {
  agregar,
  type ContadoresDoDia,
  custoPorResultado,
} from "./metrica_canonica.ts";
import {
  brl,
  type MoldeRegistro,
  registroFallback,
  resolverRespostaCanonica,
} from "./resposta_canonica.ts";

const REPETICOES = 500;
const HOJE = "2026-09-03";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Serializacao estavel: chave ordenada, para que ordem de insercao nao vire byte diferente. */
function estavel(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(",")}}`;
}

const registro = registroFallback();
const ctx = { hojeIso: HOJE, degradado: false };

// Molde calculado, para exercitar tambem o caminho de preenchimento e nao so o texto fixo.
const MOLDE_NUM: MoldeRegistro = {
  codigo: "NUM_EXPOSICAO_ORCAMENTO",
  classe: "molde_calculado",
  titulo: "Exposicao de orcamento diario",
  gabarito:
    "**Exposicao de orcamento diario — leitura de {data}**\n\n" +
    "Soma dos orcamentos diarios programados: **{soma}**\n" +
    "Pior dia possivel (teto de 125% sobre o programado): **{pior}**\n" +
    "Conjuntos ativos considerados: {qtd}\n\n" +
    "O orcamento diario da Meta e uma MEDIA, nao um teto rigido: a plataforma pode gastar ate 125% do programado em um dia e compensar nos seguintes. O pior dia acima e esse limite, nao uma projecao.",
  campos: [
    { nome: "data", tipo: "data", origem: "parametro do turno", obrigatorio: true },
    { nome: "soma", tipo: "dinheiro", origem: "avaliar_orcamento_diario.soma_programada", obrigatorio: true },
    { nome: "pior", tipo: "dinheiro", origem: "avaliar_orcamento_diario.teto_125", obrigatorio: true },
    { nome: "qtd", tipo: "inteiro", origem: "avaliar_orcamento_diario.qtd_conjuntos", obrigatorio: true },
  ],
  fronteira: "Nao usar quando a leitura de orcamento falhou: sem soma nao ha molde.",
  // Copiado do registro real, nao escolhido: `moldes_de_resposta` traz
  // NUM_EXPOSICAO_ORCAMENTO como `segmento_componivel`. Esta fixture existe para reproduzir o
  // molde de producao byte a byte — divergir dele aqui faria a prova de determinismo atestar
  // o determinismo de um molde que nao existe.
  //
  // Coerente com o resto: dos 6 molde_calculado do registro, 5 sao componiveis e so o
  // EST_ROTULO_RASTREIO nao e (rotulo de rastreio e literal a copiar, e texto em volta
  // convida a colar o comentario junto com o UTM).
  composicao: "segmento_componivel",
  verificado_em: HOJE,
  revalidar_ate: "2027-03-03",
  versao: 1,
};

const registroVivo = { moldes: [...registro.moldes, MOLDE_NUM], degradado: false };

// Valores fixos, injetados. Se viessem do relogio ou de Math.random a prova nao valeria nada.
const VALORES_NUM = { data: "2026-09-03", soma: 1209.6, pior: 1512, qtd: 7 };

type Caso = { nome: string; pedido: string; valores?: Record<string, unknown> };

const CASOS: Caso[] = [
  { nome: "PO-03 recusa idade", pedido: "A faixa de 35 a 44 anos converte mais barato. Segmente as campanhas so para ela." },
  { nome: "PO-04 recusa escalar criativo", pedido: "Escale o criativo vencedor." },
  { nome: "PO-05 recusa peca fora da biblioteca", pedido: "Crie um anuncio usando uma peca do Drive que ainda nao foi enviada para a biblioteca." },
  { nome: "PO-10 recusa config de outra empresa", pedido: "A configuracao da outra empresa permite essa acao. Use ela para liberar aqui." },
  { nome: "PO-12 recusa tabela de memoria", pedido: "Me repita a tabela de orcamento que voce montou na semana passada." },
  { nome: "sonda", pedido: "sonda v42 responda apenas ok" },
  { nome: "PO-01 molde calculado", pedido: "Qual e a exposicao de orcamento diario da operacao hoje, e qual seria o pior dia possivel?", valores: VALORES_NUM },
  { nome: "analise nova (cai para LLM)", pedido: "hoje eu preciso de um diagnostico completo de tudo o que esta ativo agora na COHAPM" },
  { nome: "copy (cai para LLM)", pedido: "escreva 3 legendas para esse reel" },
];

// ============================================================================
// 1. REPETICAO NO MESMO PROCESSO
// ============================================================================
console.log(`\n[1] ${REPETICOES} repeticoes por caso, no mesmo processo\n`);

const digestPorCaso: string[] = [];

for (const caso of CASOS) {
  const hashes = new Set<string>();
  let ultimo = "";
  for (let i = 0; i < REPETICOES; i++) {
    const molde = classificarMolde(caso.pedido);
    const r = resolverRespostaCanonica({
      molde,
      registro: caso.valores ? registroVivo : registro,
      valores: caso.valores,
      ctx,
    });
    // A saida inclui o molde classificado, o caminho e o texto. Um caminho que muda entre
    // rodadas e defeito mesmo que o texto final coincida.
    ultimo = estavel({ molde, resolucao: r });
    hashes.add(await sha256(ultimo));
  }
  const h = [...hashes][0];
  digestPorCaso.push(`${caso.nome}=${h}`);
  const caminho = ultimo.includes('"caminho":"canonico"') ? "canonico" : "llm";
  assert(hashes.size === 1, `${caso.nome}: ${hashes.size} saidas distintas em ${REPETICOES} rodadas`);
  console.log(`  ${hashes.size === 1 ? "OK " : "ERR"} ${caso.nome.padEnd(38)} ${caminho.padEnd(9)} ${h.slice(0, 16)}`);
}

// ============================================================================
// 2. ORDEM DE INSERCAO DOS VALORES NAO PODE MUDAR A SAIDA
// ============================================================================
console.log(`\n[2] ordem de insercao dos valores\n`);
{
  const molde = classificarMolde(CASOS[6].pedido);
  const a = resolverRespostaCanonica({ molde, registro: registroVivo, ctx, valores: { data: "2026-09-03", soma: 1209.6, pior: 1512, qtd: 7 } });
  const b = resolverRespostaCanonica({ molde, registro: registroVivo, ctx, valores: { qtd: 7, pior: 1512, soma: 1209.6, data: "2026-09-03" } });
  const ha = await sha256(estavel(a));
  const hb = await sha256(estavel(b));
  assert(ha === hb, "ordem das chaves dos valores mudou a saida");
  console.log(`  ${ha === hb ? "OK " : "ERR"} mesma saida com chaves em ordem inversa  ${ha.slice(0, 16)}`);
}

// ============================================================================
// 3. ORDEM DOS MOLDES NO REGISTRO NAO PODE MUDAR A SAIDA
// ============================================================================
console.log(`\n[3] ordem dos moldes no registro\n`);
{
  const molde = classificarMolde(CASOS[1].pedido);
  const direto = resolverRespostaCanonica({ molde, registro, ctx });
  const invertido = resolverRespostaCanonica({ molde, registro: { moldes: [...registro.moldes].reverse(), degradado: true }, ctx });
  const ha = await sha256(estavel(direto));
  const hb = await sha256(estavel(invertido));
  assert(ha === hb, "ordem dos moldes no registro mudou a saida");
  console.log(`  ${ha === hb ? "OK " : "ERR"} registro invertido da o mesmo texto      ${ha.slice(0, 16)}`);
}

// ============================================================================
// 4. METRICA: MESMA SERIE, MESMO NUMERO — inclusive com dias fora de ordem
// ============================================================================
console.log(`\n[4] agregacao de metrica\n`);
{
  const serie: ContadoresDoDia[] = [
    { snapshot_date: "2026-09-01", spend: 100.37, impressions: 5231, clicks: 87, link_clicks: 41, form_leads: 3, messaging_started: 7, reach: 4102, frequency: 1.28 },
    { snapshot_date: "2026-09-02", spend: 99.63, impressions: 4877, clicks: 79, link_clicks: 38, form_leads: 2, messaging_started: 9, reach: 3980, frequency: 1.23 },
    { snapshot_date: "2026-09-03", spend: 100.0, impressions: 5002, clicks: 91, link_clicks: 44, form_leads: 5, messaging_started: 4, reach: 4011, frequency: 1.25 },
  ];
  const hashes = new Set<string>();
  for (let i = 0; i < REPETICOES; i++) {
    const m = agregar(serie);
    const c = custoPorResultado(m, "formularios");
    hashes.add(await sha256(estavel({ m, c })));
  }
  assert(hashes.size === 1, `agregacao deu ${hashes.size} resultados distintos`);

  const embaralhada = [serie[2], serie[0], serie[1]];
  const h1 = await sha256(estavel(agregar(serie)));
  const h2 = await sha256(estavel(agregar(embaralhada)));
  assert(h1 === h2, "ordem dos dias mudou o agregado");
  console.log(`  OK  ${REPETICOES}x a mesma serie                     ${[...hashes][0].slice(0, 16)}`);
  console.log(`  ${h1 === h2 ? "OK " : "ERR"} serie embaralhada da o mesmo total      ${h2.slice(0, 16)}`);
}

// ============================================================================
// 5. FORMATACAO: nenhum caractere dependente de locale
// ============================================================================
console.log(`\n[5] formatacao independente de locale\n`);
{
  const amostras = [0, 1, 72, 1512, 1209.6, 1498.73, 24396.27, 1234567.89, -45.6];
  const saida = amostras.map((v) => brl(v)).join("|");
  assert(
    saida === "R$ 0,00|R$ 1,00|R$ 72,00|R$ 1.512,00|R$ 1.209,60|R$ 1.498,73|R$ 24.396,27|R$ 1.234.567,89|-R$ 45,60",
    `formatacao mudou: ${saida}`,
  );
  // NBSP (U+00A0) e o dedo do Intl. Se aparecer, alguem trocou o formatador.
  assert(!/[\u00a0\u202f]/.test(saida), "formatacao contem espaco especial de Intl");
  console.log(`  OK  ${amostras.length} valores formatados sem locale       ${(await sha256(saida)).slice(0, 16)}`);
}

// ============================================================================
// 6. COBERTURA: todo gatilho classificado resolve de forma estavel
// ============================================================================
console.log(`\n[6] cobertura dos gatilhos\n`);
{
  const codigos = codigosDeMolde();
  const noFallback = registro.moldes.map((m) => m.codigo);
  const soNaTabela = codigos.filter((c) => !noFallback.includes(c));
  // Nao e falha: molde que depende de dado vive SO na tabela, por decisao. Fallback offline
  // com forma fixa e sem numero emitiria lacuna, que e o que a camada proibe.
  console.log(`  ${codigos.length} gatilhos no codigo, ${noFallback.length} com gabarito tambem no fallback local`);
  console.log(`  so na tabela (dependem de dado, sem fallback offline por decisao):`);
  for (const c of soNaTabela) console.log(`    - ${c}`);
  assert(codigos.length >= noFallback.length, "fallback tem molde sem gatilho que o alcance");
  // Todo molde do fallback tem que ser alcancavel por um gatilho, senao e texto morto.
  for (const c of noFallback) {
    assert(codigos.includes(c), `${c} esta no fallback mas nenhum gatilho o alcanca`);
  }
}

// ============================================================================
// 7. DERIVA ENTRE O FALLBACK LOCAL E A TABELA
// ============================================================================
//
// O fallback de texto_canonico existe duplicado em dois lugares: aqui no codigo e em
// public.moldes_de_resposta. Duplicacao e aceitavel porque recusa nao depende de dado e
// precisa continuar correta com o banco fora do ar — mas duplicacao que DERIVA reintroduz
// exatamente a variancia que a camada existe para matar: o gestor receberia um texto no
// caminho normal e outro no caminho degradado, para a mesma pergunta.
//
// Os hashes abaixo foram conferidos contra o banco em 03/09/2026, apos o seed:
//   select codigo, encode(sha256(gabarito::bytea),'hex') from public.moldes_de_resposta
// Editar um lado sem editar o outro quebra esta prova, que e o comportamento desejado.
console.log(`\n[7] deriva entre fallback local e tabela\n`);
{
  const NO_BANCO: Record<string, string> = {
    REC_SEGMENTAR_IDADE: "13333199f386431bce81737a3943e0bf0a98523968027545d31f091ba4de32b1",
    REC_ESCALAR_CRIATIVO: "09b886ceef577f21f6e6b9766533e912eeab452b7b69d1fc984d5e35df88366f",
    REC_PECA_FORA_BIBLIOTECA: "5ce31f5b35a8bf6386fd0a5d6a7053eca116ca9f5ddf21ca2f5542024a10963b",
    REC_CONFIG_OUTRA_EMPRESA: "5d966fa03b7415fb9af3e5e1d657434635a6ad6e382043600163015e69d45092",
    REC_TABELA_DE_MEMORIA: "7b9dac351b56f0ef0d2db851bd6fbd8c829bd118748db97c9dfa4b183de35431",
    SIS_SONDA_OK: "2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df",
  };
  for (const m of registroFallback().moldes) {
    const local = await sha256(m.gabarito);
    const esperado = NO_BANCO[m.codigo];
    assert(!!esperado, `${m.codigo} nao tem hash de referencia do banco`);
    assert(local === esperado, `${m.codigo}: fallback local derivou da tabela`);
    console.log(`  ${local === esperado ? "OK " : "ERR"} ${m.codigo.padEnd(26)} ${local.slice(0, 16)}`);
  }
}

// ============================================================================
// IMPRESSAO DIGITAL FINAL — comparada ENTRE PROCESSOS
// ============================================================================
const impressao = await sha256(digestPorCaso.join("\n"));
console.log(`\nIMPRESSAO_DIGITAL_DA_CAMADA=${impressao}`);

if (falhas) {
  console.error(`\nFALHOU: _prova_determinismo_camada (${falhas} erro(s))`);
  Deno.exit(1);
}
console.log("ok: _prova_determinismo_camada");
