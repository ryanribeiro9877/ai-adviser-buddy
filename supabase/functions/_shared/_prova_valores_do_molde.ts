// PROVA DA EXTRACAO DE VALORES.
// Rode: deno run --allow-read supabase/functions/_shared/_prova_valores_do_molde.ts
//
// O que esta prova precisa garantir, porque cada item corresponde a um jeito conhecido de a
// camada mentir com forma de verdade:
//
//   [1] campo obrigatorio faltando DERRUBA a resolucao — nunca sai bloco parcial;
//   [2] valor malformado e detectado e NAO se confunde com ausente;
//   [3] o mapa e deterministico sobre a mesma entrada;
//   [4] `campos[].origem` do banco bate com o que o extrator realmente le;
//   [5] o portao que impede a resposta mutilada nos moldes sem extrator.

import {
  extrairValoresDoMolde,
  ORIGENS,
  type RetornoDeFerramenta,
  SEM_EXTRATOR,
  temExtrator,
} from "./valores_do_molde.ts";
import {
  type ContextoDaFronteira,
  type MoldeRegistro,
  preencher,
  resolverRespostaCanonica,
} from "./resposta_canonica.ts";
import { compor, instrucaoDeComposicao } from "./composicao_hibrida.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ERRO ${msg}`);
    falhas++;
  }
}

async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const HOJE = "2026-09-03";
const ctx = { hojeIso: HOJE };

// Retornos copiados da forma REAL medida em chat_messages.tool_results em 03/09/2026.
const OVERVIEW_OK: RetornoDeFerramenta = {
  tool: "get_overview",
  cortado: false,
  retorno: {
    nota: "status vem do effective_status real da Meta",
    campanhas_total: 23,
    campanhas_ativas: 6,
    campanhas_ativas_lista: [
      { nome: "COHAPM_VISTTA_CONV_WA_SET26", conta: "1622612945584817", categoria: null, gasto_acumulado: "R$ 114.16" },
      { nome: "COHAPM_JURIDICO_CONV_WA_2026-08", conta: "1622612945584817", categoria: null, gasto_acumulado: "R$ 980.11" },
    ],
  },
};
const ALERTS_OK: RetornoDeFerramenta = { tool: "get_alerts", cortado: false, retorno: { alertas_ativos: [{ title: "CPL acima do teto no CONJ.2" }] } };
const RECOS_OK: RetornoDeFerramenta = {
  tool: "get_recommendations",
  cortado: false,
  retorno: { nota: "regua de custo de MIDIA", recomendacoes_pendentes: [{ title: "Meta: CTX CREATION PACKAGE" }, { title: "Escalar CONJ.04" }] },
};
const PROPOSE_OK: RetornoDeFerramenta = {
  tool: "propose_action",
  cortado: false,
  retorno: { ok: true, approval_id: "761849f5-42c0-4901-9756-84dd4e9fe775", resumo: "Campanha: X\nConjunto: JUR_WA_CONJ.04", aviso: "Pedido PENDENTE." },
};
const SAUDE_OK: RetornoDeFerramenta = {
  tool: "saude_das_integracoes",
  cortado: false,
  retorno: {
    company_id: "c1", integracoes: 3, dias_tolerancia: 3,
    por_veredito: { viva: 1, nunca_recebeu: 2 },
    contas: [
      { conta: "Conta de Anuncio - COHAPM", afirmado: { status: "connected", estado_operacional: "ativa" }, veredito: "viva" },
      { conta: "Conta 2", afirmado: { status: "connected" }, veredito: "nunca_recebeu" },
    ],
  },
};

// ============================================================================
// 0. OS CINCO EXTRATORES RESOLVEM COM ENTRADA REAL
// ============================================================================
console.log(`\n[0] extracao com a forma real de producao\n`);
{
  const casos: { codigo: string; tools: RetornoDeFerramenta[]; campos: string[] }[] = [
    { codigo: "EST_CAMPANHAS_ATIVAS", tools: [OVERVIEW_OK], campos: ["data", "total", "ativas", "lista"] },
    { codigo: "EST_ALERTAS_ABERTOS", tools: [ALERTS_OK, RECOS_OK], campos: ["data", "alertas", "recomendacoes", "lista"] },
    { codigo: "ATO_CONFIRMACAO_CARD", tools: [PROPOSE_OK], campos: ["total", "emitidos"] },
    { codigo: "EST_SAUDE_INTEGRACOES", tools: [SAUDE_OK], campos: ["data", "integracoes", "vivas", "tolerancia", "detalhe"] },
    {
      codigo: "ATO_CARD_NAO_EMITIDO",
      tools: [{ tool: "propose_action", cortado: false, retorno: null, erro: "conjunto sem criativo aprovado" }],
      campos: ["motivo"],
    },
  ];

  for (const caso of casos) {
    const e = extrairValoresDoMolde({ codigo: caso.codigo, toolResults: caso.tools, ctx });
    assert(e.ok, `${caso.codigo}: deveria extrair, veio ${e.ok ? "" : JSON.stringify(e.defeitos)}`);
    if (!e.ok) continue;
    for (const c of caso.campos) {
      assert(e.valores[c] !== undefined, `${caso.codigo}: campo ${c} faltando`);
    }
    const extras = Object.keys(e.valores).filter((k) => !caso.campos.includes(k));
    assert(!extras.length, `${caso.codigo}: campos inesperados ${extras.join(", ")}`);
    console.log(`  OK  ${caso.codigo.padEnd(24)} ${caso.campos.map((c) => `${c}=${JSON.stringify(e.valores[c]).slice(0, 30)}`).join("  ")}`);
  }
}

// ============================================================================
// 0b. PONTA A PONTA COM OS GABARITOS REAIS DO BANCO
// ============================================================================
//
// Extrator -> resolucao -> composicao, usando os gabaritos EXATOS gravados em
// public.moldes_de_resposta (copiados em 03/09/2026, apos a migration 20260903240000).
//
// E a secao que pega o defeito mais bobo e mais provavel desta camada: lacuna do gabarito com
// nome diferente do campo que o extrator devolve. `{integracoes}` no gabarito e `integracao`
// no extrator resolveria para LLM em 100% dos turnos, silenciosamente, e as secoes [0] e [4]
// passariam as duas — porque cada uma olha um lado so.
console.log(`\n[0b] ponta a ponta: extrator -> resolucao -> composicao\n`);
{
  const ctxF: ContextoDaFronteira = { hojeIso: HOJE, degradado: false };
  const NL = "\n";

  const GABARITOS: Record<string, { classe: "molde_calculado" | "confirmacao_de_ato"; gabarito: string; tipos: Record<string, "texto" | "inteiro" | "data" | "lista"> }> = {
    ATO_CONFIRMACAO_CARD: {
      classe: "confirmacao_de_ato",
      gabarito: `**{total} card(s) emitido(s) para sua aprovacao**${NL}${NL}{emitidos}`,
      tipos: { total: "inteiro", emitidos: "lista" },
    },
    ATO_CARD_NAO_EMITIDO: {
      classe: "confirmacao_de_ato",
      gabarito: `**Nenhum card foi emitido neste turno.**${NL}${NL}{motivo}`,
      tipos: { motivo: "texto" },
    },
    EST_CAMPANHAS_ATIVAS: {
      classe: "molde_calculado",
      gabarito: `**Campanhas ativas — leitura de {data}**${NL}${NL}Total no cadastro: {total}${NL}Ativas agora: {ativas}${NL}${NL}{lista}${NL}${NL}Este e o estado do cadastro na hora da leitura. Nao inclui desempenho: custo, CTR e resultado tem base de calculo declarada e vem por outro caminho.`,
      tipos: { data: "data", total: "inteiro", ativas: "inteiro", lista: "lista" },
    },
    EST_ALERTAS_ABERTOS: {
      classe: "molde_calculado",
      gabarito: `**Pendencias abertas — leitura de {data}**${NL}${NL}Alertas nao resolvidos: {alertas}${NL}Recomendacoes na fila: {recomendacoes}${NL}${NL}{lista}`,
      tipos: { data: "data", alertas: "inteiro", recomendacoes: "inteiro", lista: "lista" },
    },
    EST_SAUDE_INTEGRACOES: {
      classe: "molde_calculado",
      gabarito: `**Integracoes — leitura de {data}**${NL}${NL}O cadastro AFIRMA e o dado MEDE coisas diferentes, entao as duas colunas vem separadas:${NL}${NL}Integracoes Meta cadastradas: {integracoes}${NL}Com entrega medida (veredito "viva"): {vivas}${NL}Tolerancia usada nesta leitura: {tolerancia} dia(s)${NL}${NL}{detalhe}${NL}${NL}Conectada no cadastro nao e prova de dado chegando: o status e uma afirmacao de configuracao, e o veredito e um fato observavel. Quando os dois divergem, o veredito e o que vale.`,
      tipos: { data: "data", integracoes: "inteiro", vivas: "inteiro", tolerancia: "inteiro", detalhe: "lista" },
    },
  };

  const entradas: Record<string, RetornoDeFerramenta[]> = {
    ATO_CONFIRMACAO_CARD: [PROPOSE_OK],
    ATO_CARD_NAO_EMITIDO: [{ tool: "propose_action", cortado: false, retorno: null, erro: "conjunto sem criativo aprovado" }],
    EST_CAMPANHAS_ATIVAS: [OVERVIEW_OK],
    EST_ALERTAS_ABERTOS: [ALERTS_OK, RECOS_OK],
    EST_SAUDE_INTEGRACOES: [SAUDE_OK],
  };

  for (const codigo of Object.keys(GABARITOS).sort()) {
    const g = GABARITOS[codigo];
    const molde: MoldeRegistro = {
      codigo, classe: g.classe, titulo: codigo, gabarito: g.gabarito,
      campos: Object.keys(g.tipos).map((nome) => ({
        nome, tipo: g.tipos[nome], origem: ORIGENS[codigo][nome], obrigatorio: true,
      })),
      fronteira: null, composicao: "segmento_componivel",
      verificado_em: HOJE, revalidar_ate: "2027-03-03", versao: 2,
    };

    // As lacunas do gabarito e os campos declarados tem de ser o MESMO conjunto.
    const lacunas = [...new Set([...g.gabarito.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]))].sort();
    const declarados = Object.keys(g.tipos).sort();
    assert(lacunas.join(",") === declarados.join(","), `${codigo}: lacunas [${lacunas}] != campos [${declarados}]`);

    const e = extrairValoresDoMolde({ codigo, toolResults: entradas[codigo], ctx });
    assert(e.ok, `${codigo}: extracao falhou`);
    if (!e.ok) continue;

    // E o que o extrator DEVOLVE tem de ser exatamente o que o gabarito PEDE.
    const entregues = Object.keys(e.valores).sort();
    assert(entregues.join(",") === declarados.join(","), `${codigo}: extrator entregou [${entregues}], gabarito pede [${declarados}]`);

    const r = resolverRespostaCanonica({
      molde: { codigo, classe: g.classe, confianca: "exata", parametros: {} },
      registro: { moldes: [molde], degradado: false },
      valores: e.valores,
      ctx: ctxF,
    });
    assert(r.caminho === "canonico", `${codigo}: deveria resolver canonico, veio ${r.caminho === "llm" ? r.motivo : ""}`);
    if (r.caminho !== "canonico") continue;

    // Nenhuma lacuna pode sobrar no texto emitido, e nenhum "indisponivel" pode aparecer.
    assert(!/\{[a-z0-9_]+\}/.test(r.texto), `${codigo}: sobrou lacuna no texto emitido`);
    assert(!r.texto.includes("indisponivel"), `${codigo}: 'indisponivel' vazou para o bloco`);

    const c = compor({ resolucao: r, gerado: "Analise do turno, escrita pelo modelo, que varia." });
    assert(c.caminho === "hibrido", `${codigo}: deveria compor hibrido`);
    assert(c.texto.startsWith(r.texto), `${codigo}: o bloco tem de abrir a mensagem`);
    console.log(`  OK  ${codigo.padEnd(24)} bloco de ${String(r.texto.length).padStart(4)} chars, ${r.campos_usados.length} campo(s) com origem`);
  }
}

// ============================================================================
// 1. CAMPO OBRIGATORIO FALTANDO DERRUBA A RESOLUCAO INTEIRA
// ============================================================================
//
// Este e o teste que impede a resposta mutilada. Nao basta o extrator falhar: a resolucao
// tem de cair para LLM e NENHUM bloco parcial pode chegar ao gestor.
console.log(`\n[1] campo obrigatorio ausente derruba tudo\n`);
{
  const moldeCampanhas: MoldeRegistro = {
    codigo: "EST_CAMPANHAS_ATIVAS",
    classe: "molde_calculado",
    titulo: "Campanhas ativas",
    gabarito: "Total: {total}\nAtivas: {ativas}\n\n{lista}",
    campos: [
      { nome: "total", tipo: "inteiro", origem: ORIGENS.EST_CAMPANHAS_ATIVAS.total, obrigatorio: true },
      { nome: "ativas", tipo: "inteiro", origem: ORIGENS.EST_CAMPANHAS_ATIVAS.ativas, obrigatorio: true },
      { nome: "lista", tipo: "lista", origem: ORIGENS.EST_CAMPANHAS_ATIVAS.lista, obrigatorio: true },
    ],
    fronteira: null,
    composicao: "segmento_componivel",
    verificado_em: HOJE,
    revalidar_ate: "2027-03-03",
    versao: 2,
  };
  const ctxF: ContextoDaFronteira = { hojeIso: HOJE, degradado: false };

  // Retorno sem `campanhas_total`: uma chave a menos, o resto perfeito.
  const semTotal: RetornoDeFerramenta = {
    tool: "get_overview",
    cortado: false,
    retorno: { campanhas_ativas: 6, campanhas_ativas_lista: [{ nome: "X" }] },
  };
  const e = extrairValoresDoMolde({ codigo: "EST_CAMPANHAS_ATIVAS", toolResults: [semTotal], ctx });
  assert(!e.ok, "sem campanhas_total nao deveria extrair");
  if (!e.ok) {
    assert(e.defeitos.some((d) => d.campo === "total"), "o defeito deveria apontar o campo total");
    console.log(`  OK  defeito nomeia o campo: ${e.defeitos[0].campo} — ${e.defeitos[0].motivo}`);
  }

  // A resolucao com o mapa vazio cai para LLM, e NAO emite bloco com lacuna.
  const r = resolverRespostaCanonica({
    molde: { codigo: "EST_CAMPANHAS_ATIVAS", classe: "molde_calculado", confianca: "exata", parametros: {} },
    registro: { moldes: [moldeCampanhas], degradado: false },
    valores: e.ok ? e.valores : {},
    ctx: ctxF,
  });
  assert(r.caminho === "llm", "resolucao sem valores tem de cair para LLM");
  console.log(`  OK  resolucao cai para LLM: ${r.caminho === "llm" ? r.motivo : ""}`);

  // E a composicao nao entrega bloco nenhum.
  const c = compor({ resolucao: r, gerado: "analise do turno" });
  assert(c.bloco_canonico === null, "nao pode haver bloco canonico");
  assert(!c.texto.includes("Total:"), "o gabarito NAO pode vazar para o texto final");
  console.log(`  OK  nenhum bloco parcial no texto final`);

  // Prova direta de que o preenchimento parcial e recusado, e nao remendado.
  const parcial = preencher(moldeCampanhas, { ativas: 6, lista: ["X"] });
  assert("falta" in parcial, "preenchimento parcial tem de ser recusado");
  if ("falta" in parcial) {
    assert(!parcial.falta.includes("indisponivel"), "nunca escrever 'indisponivel' na lacuna");
    console.log(`  OK  preenchimento parcial recusado: ${parcial.falta}`);
  }
}

// ============================================================================
// 2. MALFORMADO NAO E AUSENTE — cada forma errada tem defeito proprio
// ============================================================================
console.log(`\n[2] presente de forma inesperada != ausente\n`);
{
  const casos: { nome: string; codigo: string; tools: RetornoDeFerramenta[]; espera: string }[] = [
    {
      nome: "truncado (cortado=true, retorno string)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: true, retorno: '{"campanhas_total": 23, "campanhas_ati' }],
      espera: "truncado",
    },
    {
      nome: "ferramenta com erro (dado NAO lido)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: false, retorno: null, erro: "deadline de coleta — o dado NAO foi lido" }],
      espera: "nao pode ser tratado como zero",
    },
    {
      nome: "tipo errado (numero veio string)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: false, retorno: { campanhas_total: "23", campanhas_ativas: 6, campanhas_ativas_lista: [] } }],
      espera: "deveria ser numero e veio string",
    },
    {
      nome: "estrutura errada (lista veio objeto)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: false, retorno: { campanhas_total: 23, campanhas_ativas: 6, campanhas_ativas_lista: { a: 1 } } }],
      espera: "deveria ser lista",
    },
    {
      nome: "null explicito (ausencia de leitura, nao zero)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: false, retorno: { campanhas_total: null, campanhas_ativas: 6, campanhas_ativas_lista: [] } }],
      espera: "nao zero",
    },
    {
      nome: "incoerencia declarada (ativas > total)",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [{ tool: "get_overview", cortado: false, retorno: { campanhas_total: 3, campanhas_ativas: 9, campanhas_ativas_lista: [{ nome: "X" }] } }],
      espera: "incoerencia",
    },
    {
      nome: "por_veredito.viva de tipo errado",
      codigo: "EST_SAUDE_INTEGRACOES",
      tools: [{ tool: "saude_das_integracoes", cortado: false, retorno: { integracoes: 3, dias_tolerancia: 3, por_veredito: { viva: "1" }, contas: [{ conta: "A", veredito: "viva" }] } }],
      espera: "deveria ser inteiro",
    },
    {
      nome: "ferramenta nao chamada",
      codigo: "EST_CAMPANHAS_ATIVAS",
      tools: [ALERTS_OK],
      espera: "nao foi chamada",
    },
  ];

  for (const caso of casos) {
    const e = extrairValoresDoMolde({ codigo: caso.codigo, toolResults: caso.tools, ctx });
    assert(!e.ok, `${caso.nome}: deveria ser defeito`);
    if (e.ok) continue;
    const texto = e.defeitos.map((d) => d.motivo).join(" | ");
    assert(texto.includes(caso.espera), `${caso.nome}: defeito deveria conter "${caso.espera}", veio "${texto}"`);
    console.log(`  OK  ${caso.nome.padEnd(42)} ${texto.slice(0, 76)}`);
  }

  // A distincao central: truncado e erro NAO produzem zero.
  const truncado = extrairValoresDoMolde({
    codigo: "EST_ALERTAS_ABERTOS",
    toolResults: [{ tool: "get_alerts", cortado: true, retorno: '{"alertas_ativos": [{"title": "CPL aci' }, RECOS_OK],
    ctx,
  });
  assert(!truncado.ok, "lista truncada nao pode virar contagem");
  console.log(`  OK  lista truncada nao vira contagem: cardinalidade exige lista COMPLETA`);

  // Lista vazia de verdade E zero legitimo, e tem de passar. Se isto falhasse, o extrator
  // estaria confundindo "nada aberto" com "nao consegui ler" — o erro oposto e igualmente ruim.
  const vazio = extrairValoresDoMolde({
    codigo: "EST_ALERTAS_ABERTOS",
    toolResults: [{ tool: "get_alerts", cortado: false, retorno: { alertas_ativos: [] } }, { tool: "get_recommendations", cortado: false, retorno: { recomendacoes_pendentes: [] } }],
    ctx,
  });
  assert(vazio.ok, "lista vazia REAL e zero legitimo e tem de extrair");
  if (vazio.ok) {
    assert(vazio.valores.alertas === 0 && vazio.valores.recomendacoes === 0, "vazio deveria dar zero");
    console.log(`  OK  lista vazia REAL vira zero: alertas=0 recomendacoes=0 (e diferente de nao lido)`);
  }
}

// ============================================================================
// 3. DETERMINISMO DO MAPA
// ============================================================================
console.log(`\n[3] o mapa e deterministico sobre a mesma entrada\n`);
{
  const entradas: { codigo: string; tools: RetornoDeFerramenta[] }[] = [
    { codigo: "EST_CAMPANHAS_ATIVAS", tools: [OVERVIEW_OK] },
    { codigo: "EST_ALERTAS_ABERTOS", tools: [ALERTS_OK, RECOS_OK] },
    { codigo: "ATO_CONFIRMACAO_CARD", tools: [PROPOSE_OK, PROPOSE_OK] },
    { codigo: "EST_SAUDE_INTEGRACOES", tools: [SAUDE_OK] },
  ];

  for (const { codigo, tools } of entradas) {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const e = extrairValoresDoMolde({ codigo, toolResults: tools, ctx });
      if (!e.ok) { assert(false, `${codigo}: deveria extrair na volta ${i}`); break; }
      // Chaves ordenadas: o hash nao pode depender da ordem de insercao do objeto.
      const canonico = Object.keys(e.valores).sort().map((k) => `${k}=${JSON.stringify(e.valores[k])}`).join("\u0001");
      hashes.add(await sha256(canonico));
    }
    assert(hashes.size === 1, `${codigo}: deveria ter 1 hash em 100, tem ${hashes.size}`);
    console.log(`  OK  ${codigo.padEnd(24)} 1 hash em 100 extracoes  ${[...hashes][0].slice(0, 16)}`);
  }

  // Ferramenta repetida no turno: para LEITURA vale o ultimo (mais fresco), e isso tem de ser
  // estavel. Se valesse "algum", duas leituras divergentes dariam bloco imprevisivel.
  const velho: RetornoDeFerramenta = { tool: "get_overview", cortado: false, retorno: { campanhas_total: 20, campanhas_ativas: 4, campanhas_ativas_lista: [{ nome: "antiga" }] } };
  const e1 = extrairValoresDoMolde({ codigo: "EST_CAMPANHAS_ATIVAS", toolResults: [velho, OVERVIEW_OK], ctx });
  assert(e1.ok && e1.valores.total === 23, "leitura repetida: vale o ULTIMO retorno usavel");
  console.log(`  OK  ferramenta repetida: vale o ultimo usavel (total=23, nao 20)`);

  // Para propose_action valem TODOS: dois cards no turno somam 2, nao 1.
  const e2 = extrairValoresDoMolde({
    codigo: "ATO_CONFIRMACAO_CARD",
    toolResults: [PROPOSE_OK, { ...PROPOSE_OK, retorno: { ok: true, approval_id: "outro-id", resumo: "Conjunto: CONJ.05" } }],
    ctx,
  });
  assert(e2.ok && e2.valores.total === 2, "propose_action repetido soma todos os cards");
  console.log(`  OK  propose_action repetido: total=2 (todos, nao o ultimo)`);
}

// ============================================================================
// 4. DERIVA ENTRE `campos[].origem` DO BANCO E O QUE O EXTRATOR LE
// ============================================================================
//
// Conferido contra o banco em 03/09/2026, apos a migration 20260903240000:
//   select codigo, campos from public.moldes_de_resposta where vigente
// Se alguem corrigir a origem no banco sem mexer no extrator (ou o contrario), esta secao
// reprova. Sem ela a coluna `origem` seria decorativa, e origem que mente e pior que ausente.
console.log(`\n[4] origem declarada no banco x origem que o extrator le\n`);
{
  const NO_BANCO: Record<string, Record<string, string>> = {
    ATO_CONFIRMACAO_CARD: {
      total: "toolResults[propose_action].retorno.ok=true -> cardinalidade",
      emitidos: "toolResults[propose_action].retorno.approval_id + resumo",
    },
    ATO_CARD_NAO_EMITIDO: {
      motivo: "toolResults[propose_action|validar_pedido_contra_contrato].erro",
    },
    EST_ALERTAS_ABERTOS: {
      data: "parametro do turno (hojeIso)",
      alertas: "toolResults[get_alerts].retorno.alertas_ativos -> cardinalidade",
      recomendacoes: "toolResults[get_recommendations].retorno.recomendacoes_pendentes -> cardinalidade",
      lista: "toolResults[get_alerts].alertas_ativos + toolResults[get_recommendations].recomendacoes_pendentes",
    },
    EST_CAMPANHAS_ATIVAS: {
      data: "parametro do turno (hojeIso)",
      total: "toolResults[get_overview].retorno.campanhas_total",
      ativas: "toolResults[get_overview].retorno.campanhas_ativas",
      lista: "toolResults[get_overview].retorno.campanhas_ativas_lista -> nome + conta + gasto_acumulado",
    },
    EST_SAUDE_INTEGRACOES: {
      data: "parametro do turno (hojeIso)",
      integracoes: "toolResults[saude_das_integracoes].retorno.integracoes",
      vivas: "toolResults[saude_das_integracoes].retorno.por_veredito.viva",
      tolerancia: "toolResults[saude_das_integracoes].retorno.dias_tolerancia",
      detalhe: "toolResults[saude_das_integracoes].retorno.contas -> conta + afirmado.status + veredito",
    },
  };

  const codigosCodigo = Object.keys(ORIGENS).sort();
  const codigosBanco = Object.keys(NO_BANCO).sort();
  assert(
    codigosCodigo.join(",") === codigosBanco.join(","),
    `conjunto de moldes com extrator divergiu: codigo=[${codigosCodigo}] banco=[${codigosBanco}]`,
  );

  for (const codigo of codigosBanco) {
    const noCodigo = ORIGENS[codigo] ?? {};
    const noBanco = NO_BANCO[codigo];
    const camposCodigo = Object.keys(noCodigo).sort();
    const camposBanco = Object.keys(noBanco).sort();
    assert(
      camposCodigo.join(",") === camposBanco.join(","),
      `${codigo}: campos divergiram. codigo=[${camposCodigo}] banco=[${camposBanco}]`,
    );
    for (const campo of camposBanco) {
      assert(
        noCodigo[campo] === noBanco[campo],
        `${codigo}.${campo}: origem divergiu.\n        codigo="${noCodigo[campo]}"\n        banco ="${noBanco[campo]}"`,
      );
    }
    console.log(`  OK  ${codigo.padEnd(24)} ${camposBanco.length} campo(s) com origem identica`);
  }

  // Todo campo que o extrator devolve tem de ter origem declarada. Campo sem origem e numero
  // sem procedencia, e a auditoria nao teria como responder de onde ele veio.
  const entradas: { codigo: string; tools: RetornoDeFerramenta[] }[] = [
    { codigo: "EST_CAMPANHAS_ATIVAS", tools: [OVERVIEW_OK] },
    { codigo: "EST_ALERTAS_ABERTOS", tools: [ALERTS_OK, RECOS_OK] },
    { codigo: "ATO_CONFIRMACAO_CARD", tools: [PROPOSE_OK] },
    { codigo: "EST_SAUDE_INTEGRACOES", tools: [SAUDE_OK] },
    { codigo: "ATO_CARD_NAO_EMITIDO", tools: [{ tool: "propose_action", retorno: null, erro: "sem criativo" }] },
  ];
  for (const { codigo, tools } of entradas) {
    const e = extrairValoresDoMolde({ codigo, toolResults: tools, ctx });
    if (!e.ok) continue;
    for (const campo of Object.keys(e.valores)) {
      assert(!!ORIGENS[codigo]?.[campo], `${codigo}.${campo}: valor entregue sem origem declarada`);
    }
  }
  console.log(`  OK  todo campo entregue tem origem declarada`);
}

// ============================================================================
// 5. O PORTAO: MOLDE SEM EXTRATOR NAO RECEBE A INSTRUCAO DE OMITIR
// ============================================================================
//
// Sem este portao, ligar a camada faria NUM_EXPOSICAO_ORCAMENTO e NUM_CUSTO_LLM_PERIODO
// mutilarem a resposta em TODO turno: a instrucao mandaria o modelo omitir os numeros e o
// bloco nunca materializaria. Sao moldes de NUMERO, entao mutilar neles perde exatamente o
// dado que o gestor pediu.
console.log(`\n[5] portao contra mutilacao nos moldes sem extrator\n`);
{
  const semExtrator = Object.keys(SEM_EXTRATOR).sort();
  assert(semExtrator.length === 2, `esperados 2 componiveis sem extrator, ha ${semExtrator.length}`);

  for (const codigo of semExtrator) {
    assert(!temExtrator(codigo), `${codigo} nao deveria ter extrator`);
    assert(SEM_EXTRATOR[codigo].length > 40, `${codigo}: motivo precisa ser legivel para a governanca`);

    const molde: MoldeRegistro = {
      codigo, classe: "molde_calculado", titulo: codigo,
      gabarito: "sem lacuna", campos: [], fronteira: null,
      composicao: "segmento_componivel",
      verificado_em: HOJE, revalidar_ate: "2027-03-03", versao: 1,
    };
    const r = resolverRespostaCanonica({
      molde: { codigo, classe: "molde_calculado", confianca: "exata", parametros: {} },
      registro: { moldes: [molde], degradado: false },
      valores: {},
      ctx: { hojeIso: HOJE, degradado: false },
    });
    // Resolve canonico (gabarito sem lacuna), mas a instrucao NAO pode sair.
    assert(r.caminho === "canonico", `${codigo}: cenario do teste exige resolucao canonica`);
    assert(instrucaoDeComposicao(r) === "", `${codigo}: NAO pode receber instrucao de omitir`);
    console.log(`  OK  ${codigo.padEnd(24)} 0 chars no prompt — degrada para hoje, nao para pior`);
  }

  // Os 5 COM extrator continuam recebendo a instrucao.
  let comInstrucao = 0;
  for (const codigo of Object.keys(ORIGENS)) {
    const classe = codigo.startsWith("ATO_") ? "confirmacao_de_ato" as const : "molde_calculado" as const;
    const molde: MoldeRegistro = {
      codigo, classe, titulo: codigo, gabarito: "sem lacuna", campos: [], fronteira: null,
      composicao: "segmento_componivel", verificado_em: HOJE, revalidar_ate: "2027-03-03", versao: 2,
    };
    const r = resolverRespostaCanonica({
      molde: { codigo, classe, confianca: "exata", parametros: {} },
      registro: { moldes: [molde], degradado: false },
      valores: {},
      ctx: { hojeIso: HOJE, degradado: false },
    });
    if (instrucaoDeComposicao(r) !== "") comInstrucao++;
  }
  assert(comInstrucao === 5, `os 5 com extrator deveriam receber instrucao, ${comInstrucao} receberam`);
  console.log(`  OK  os 5 com extrator recebem a instrucao`);
}

// ============================================================================
// 6. IMPRESSAO DIGITAL DOS MAPAS
// ============================================================================
{
  const partes: string[] = [];
  for (const { codigo, tools } of [
    { codigo: "EST_CAMPANHAS_ATIVAS", tools: [OVERVIEW_OK] },
    { codigo: "EST_ALERTAS_ABERTOS", tools: [ALERTS_OK, RECOS_OK] },
    { codigo: "ATO_CONFIRMACAO_CARD", tools: [PROPOSE_OK] },
    { codigo: "EST_SAUDE_INTEGRACOES", tools: [SAUDE_OK] },
  ]) {
    const e = extrairValoresDoMolde({ codigo, toolResults: tools, ctx });
    if (e.ok) {
      partes.push(`${codigo}\u0000${Object.keys(e.valores).sort().map((k) => `${k}=${JSON.stringify(e.valores[k])}`).join("|")}`);
    }
  }
  console.log(`\nIMPRESSAO_DIGITAL_DOS_MAPAS=${await sha256(partes.join("\u0001"))}`);
}

if (falhas) {
  console.error(`\nfalhou: ${falhas} erro(s)`);
  Deno.exit(1);
}
console.log(`\nok: _prova_valores_do_molde`);
