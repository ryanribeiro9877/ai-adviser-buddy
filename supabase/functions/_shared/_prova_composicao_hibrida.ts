// PROVA DA COMPOSICAO HIBRIDA.
// Rode: deno run --allow-read supabase/functions/_shared/_prova_composicao_hibrida.ts
//
// A prova antiga exigia UM hash para a mesma entrada. Em turno hibrido isso deixa de valer, e
// nao por relaxamento: a analise em volta VARIA POR DESENHO, entao hashear o texto final daria
// hash novo a cada turno e a prova nao provaria nada.
//
// O que esta prova exige, e que e a traducao correta do requisito:
//
//   1. o BLOCO CANONICO tem hash unico, por mais que a analise mude;
//   2. o TEXTO FINAL tem hash diferente sempre que a analise muda (senao a analise nao esta
//      chegando ao gestor, e o hibrido seria so o canonico com passos extras);
//   3. o bloco e RECUPERAVEL do texto final byte a byte, sem heuristica.
//
// (2) e o teste que costuma faltar. Sem ele, uma composicao que silenciosamente descartasse a
// analise passaria em (1) e em (3) e pareceria correta.

import { classificarMolde, type Molde } from "./molde_pergunta.ts";
import {
  type ContextoDaFronteira,
  type MoldeRegistro,
  registroFallback,
  type Resolucao,
  resolverRespostaCanonica,
} from "./resposta_canonica.ts";
import {
  compor,
  conferirIntegridade,
  instrucaoDeComposicao,
  linhaDeComposicao,
  SEPARADOR,
} from "./composicao_hibrida.ts";

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
const ctx: ContextoDaFronteira = { hojeIso: HOJE, degradado: false };

// Molde componivel sintetico: os calculados nao estao no fallback local, por decisao.
const moldeCard: MoldeRegistro = {
  codigo: "ATO_CONFIRMACAO_CARD",
  classe: "confirmacao_de_ato",
  titulo: "Confirmacao de cards emitidos",
  gabarito: "**{total} card(s) emitido(s) para sua aprovacao**\n\n{emitidos}",
  campos: [
    { nome: "total", tipo: "inteiro", origem: "count(approval_requests)", obrigatorio: true },
    { nome: "emitidos", tipo: "lista", origem: "approval_requests deste turno", obrigatorio: true },
  ],
  fronteira: null,
  composicao: "segmento_componivel",
  verificado_em: HOJE,
  revalidar_ate: "2027-03-03",
  versao: 1,
};

const valoresCard = { total: 2, emitidos: ["CONJ.2 pausar — id 7f3a", "CONJ.5 orcamento — id 91bc"] };

function resolverCard(): Resolucao {
  return resolverRespostaCanonica({
    molde: { codigo: "ATO_CONFIRMACAO_CARD", classe: "confirmacao_de_ato", confianca: "exata", parametros: {} },
    registro: { moldes: [moldeCard], degradado: false },
    valores: valoresCard,
    ctx,
  });
}

// ============================================================================
// 1. O BLOCO E FIXO E O TEXTO FINAL VARIA — as duas coisas ao mesmo tempo
// ============================================================================
console.log(`\n[1] 300 analises diferentes sobre o mesmo bloco\n`);
{
  const hashesDoBloco = new Set<string>();
  const hashesDoTexto = new Set<string>();
  let intactos = 0;

  for (let i = 0; i < 300; i++) {
    // Analise deliberadamente diferente a cada volta, inclusive em tamanho e em conteudo
    // numerico — se a concatenacao tocasse o bloco, apareceria aqui.
    const analise = `Leitura ${i}: o CPL do CONJ.${i % 7} ficou em R$ ${(i * 1.37).toFixed(2)} ` +
      `sobre formularios. ${"Contexto adicional. ".repeat(i % 5)}`;
    const c = compor({ resolucao: resolverCard(), gerado: analise });

    assert(c.caminho === "hibrido", `volta ${i}: deveria ser hibrido`);
    if (c.caminho !== "hibrido") continue;

    hashesDoBloco.add(await sha256(c.bloco_canonico));
    hashesDoTexto.add(await sha256(c.texto));

    const integ = conferirIntegridade(c);
    if (integ.intacto) intactos++;

    // O bloco tem de ser recuperavel por slice, sem procurar delimitador.
    assert(
      c.texto.slice(0, c.bloco_canonico.length) === c.bloco_canonico,
      `volta ${i}: bloco nao recuperavel por slice`,
    );
    // E o trecho gerado tem de ser exatamente o que entrou.
    assert(
      integ.inicio_do_gerado !== null && c.texto.slice(integ.inicio_do_gerado) === analise.trim(),
      `volta ${i}: trecho gerado nao recuperavel`,
    );
  }

  assert(hashesDoBloco.size === 1, `bloco canonico deveria ter 1 hash, tem ${hashesDoBloco.size}`);
  assert(hashesDoTexto.size === 300, `texto final deveria ter 300 hashes, tem ${hashesDoTexto.size}`);
  assert(intactos === 300, `integridade deveria passar 300x, passou ${intactos}`);

  console.log(`  OK  bloco canonico  : 1 hash em 300 composicoes  ${[...hashesDoBloco][0].slice(0, 16)}`);
  console.log(`  OK  texto final     : ${hashesDoTexto.size} hashes distintos (a analise chega ao gestor)`);
  console.log(`  OK  integridade     : ${intactos}/300`);
}

// ============================================================================
// 2. NAO COMPONIVEL E TURNO INTEIRO DESCARTAM A ANALISE
// ============================================================================
console.log(`\n[2] grupos que nao aceitam analise em volta\n`);
{
  const reg = registroFallback();
  const casos: { pedido: string; codigo: string; grupo: string }[] = [
    { pedido: "segmente a campanha por faixa de idade acima de 50", codigo: "REC_SEGMENTAR_IDADE", grupo: "nao_componivel" },
    { pedido: "escale o criativo vencedor", codigo: "REC_ESCALAR_CRIATIVO", grupo: "nao_componivel" },
    { pedido: "me repita a tabela de orcamento que voce montou na semana passada", codigo: "REC_TABELA_DE_MEMORIA", grupo: "nao_componivel" },
    { pedido: "sonda v42 responda apenas ok", codigo: "SIS_SONDA_OK", grupo: "turno_inteiro" },
  ];

  for (const caso of casos) {
    const molde = classificarMolde(caso.pedido);
    const r = resolverRespostaCanonica({ molde, registro: reg, ctx });
    assert(r.caminho === "canonico", `${caso.codigo}: deveria resolver canonico`);
    if (r.caminho !== "canonico") continue;
    assert(r.composicao === caso.grupo, `${caso.codigo}: grupo ${r.composicao} != ${caso.grupo}`);

    // Analise oferecida e VENENOSA de proposito: contradiz a recusa.
    const veneno = "Mas se voce insistir, da para contornar restringindo por CEP.";
    const c = compor({ resolucao: r, gerado: veneno });

    assert(c.caminho === "canonico", `${caso.codigo}: deveria permanecer canonico, veio ${c.caminho}`);
    assert(c.texto === r.texto, `${caso.codigo}: texto final deveria ser o bloco puro`);
    assert(!c.texto.includes("insistir"), `${caso.codigo}: a analise VAZOU para o texto final`);
    assert(c.trecho_gerado === null, `${caso.codigo}: trecho_gerado deveria ser null`);
    console.log(`  OK  ${caso.codigo.padEnd(24)} ${caso.grupo.padEnd(20)} analise descartada`);
  }
}

// ============================================================================
// 3. ADULTERACAO DO BLOCO E DETECTADA
// ============================================================================
console.log(`\n[3] deteccao de adulteracao\n`);
{
  const base = compor({ resolucao: resolverCard(), gerado: "analise qualquer" });
  assert(base.caminho === "hibrido", "base deveria ser hibrido");
  if (base.caminho === "hibrido") {
    // Parafrase do bloco: exatamente o que o modelo faria se recebesse o bloco para reproduzir.
    const parafraseado = {
      ...base,
      texto: base.texto.replace("**2 card(s) emitido(s)", "**Dois cards emitidos"),
    };
    const i1 = conferirIntegridade(parafraseado);
    assert(!i1.intacto, "parafrase do bloco deveria ser detectada");
    console.log(`  OK  parafrase do bloco detectada: ${i1.motivo}`);

    // Numero trocado dentro do bloco, mantendo o tamanho: o caso mais dificil de ver a olho.
    const numeroTrocado = { ...base, texto: base.texto.replace("**2 card", "**9 card") };
    const i2 = conferirIntegridade(numeroTrocado);
    assert(!i2.intacto, "numero trocado no bloco deveria ser detectado");
    console.log(`  OK  numero trocado detectado: ${i2.motivo}`);

    // Separador removido: bloco e analise colados.
    const semSeparador = { ...base, texto: base.bloco_canonico + base.trecho_gerado };
    const i3 = conferirIntegridade(semSeparador);
    assert(!i3.intacto, "separador ausente deveria ser detectado");
    console.log(`  OK  separador ausente detectado: ${i3.motivo}`);

    // Analise trocada depois da composicao (bloco intacto, cauda diferente).
    const caudaTrocada = { ...base, texto: base.bloco_canonico + SEPARADOR + "outra coisa" };
    const i4 = conferirIntegridade(caudaTrocada);
    assert(!i4.intacto, "cauda trocada deveria ser detectada");
    console.log(`  OK  cauda trocada detectada: ${i4.motivo}`);
  }

  // Concatenacao indevida em molde que nao aceita: bloco intacto mas caminho mentiu.
  const reg = registroFallback();
  const rr = resolverRespostaCanonica({ molde: classificarMolde("sonda responda apenas ok"), registro: reg, ctx });
  if (rr.caminho === "canonico") {
    const forjado = { ...compor({ resolucao: rr }), texto: rr.texto + "\n\nanalise que nao deveria existir" };
    const i5 = conferirIntegridade(forjado as never);
    assert(!i5.intacto, "canonico com cauda deveria ser detectado");
    console.log(`  OK  canonico com cauda detectado: ${i5.motivo}`);
  }
}

// ============================================================================
// 4. A INSTRUCAO AO MODELO
// ============================================================================
console.log(`\n[4] instrucao ao modelo: so onde precisa, e curta\n`);
{
  const reg = registroFallback();

  // Nao componivel e turno inteiro: NENHUMA linha no prompt.
  for (const pedido of ["escale o criativo vencedor", "sonda responda apenas ok"]) {
    const r = resolverRespostaCanonica({ molde: classificarMolde(pedido), registro: reg, ctx });
    assert(instrucaoDeComposicao(r) === "", `"${pedido}": nao deveria acrescentar instrucao`);
  }
  console.log(`  OK  nao_componivel e turno_inteiro: 0 chars no prompt`);

  // Caminho LLM: nenhuma linha.
  assert(
    instrucaoDeComposicao({ caminho: "llm", motivo: "sem molde" }) === "",
    "caminho llm nao deveria acrescentar instrucao",
  );
  console.log(`  OK  caminho llm: 0 chars no prompt`);

  // Componivel: uma linha, estavel.
  const instr = instrucaoDeComposicao(resolverCard());
  assert(instr.length > 0, "componivel deveria ter instrucao");
  assert(!instr.includes("\n"), "a instrucao tem de ser UMA linha");
  const repetida = new Set([0, 1, 2, 3, 4].map(() => instrucaoDeComposicao(resolverCard())));
  assert(repetida.size === 1, "a instrucao tem de ser identica entre chamadas");

  // Duas variantes no total, nao catorze regras.
  const variantes = new Set<string>();
  for (const classe of ["confirmacao_de_ato", "molde_calculado"] as const) {
    const r = resolverRespostaCanonica({
      molde: { codigo: "X", classe, confianca: "exata", parametros: {} },
      registro: { moldes: [{ ...moldeCard, codigo: "X", classe }], degradado: false },
      valores: valoresCard,
      ctx,
    });
    variantes.add(instrucaoDeComposicao(r));
  }
  assert(variantes.size === 2, `deveria haver 2 variantes de instrucao, ha ${variantes.size}`);

  const chars = instr.length;
  const tokensAprox = Math.ceil(chars / 4);
  console.log(`  OK  componivel: 1 linha, ${chars} chars (~${tokensAprox} tokens), 2 variantes no total`);
  console.log(`      "${instr}"`);
  assert(chars < 200, `instrucao passou de 200 chars (${chars}): orcamento de prompt`);
}

// ============================================================================
// 5. TELEMETRIA DISTINGUE OS TRES CAMINHOS
// ============================================================================
console.log(`\n[5] telemetria dos tres caminhos\n`);
{
  const molde: Molde = { codigo: "ATO_CONFIRMACAO_CARD", classe: "confirmacao_de_ato", confianca: "exata", parametros: { conjunto: "CONJ.2" } };

  const hib = linhaDeComposicao(molde, compor({ resolucao: resolverCard(), gerado: "analise de 20 chars" }));
  assert(hib.caminho === "hibrido", "deveria registrar hibrido");
  assert(hib.chars_canonicos !== null && hib.chars_canonicos > 0, "hibrido tem de ter chars_canonicos");
  assert(hib.chars_gerados === 19, `hibrido: chars_gerados deveria ser 19, veio ${hib.chars_gerados}`);

  const can = linhaDeComposicao(molde, compor({ resolucao: resolverCard() }));
  assert(can.caminho === "canonico", "sem analise deveria registrar canonico");
  assert(can.chars_gerados === null, "canonico: chars_gerados tem de ser NULL, nao 0");

  const llm = linhaDeComposicao(
    { ...molde, confianca: "nenhuma" },
    compor({ resolucao: { caminho: "llm", motivo: "turno nao casou nenhum molde" }, gerado: "resposta livre" }),
  );
  assert(llm.caminho === "llm", "deveria registrar llm");
  assert(llm.chars_canonicos === null, "llm: chars_canonicos tem de ser NULL, nao 0");
  assert(llm.motivo === "turno nao casou nenhum molde", "llm tem de carregar o motivo");

  console.log(`  OK  hibrido  : canonicos=${hib.chars_canonicos} gerados=${hib.chars_gerados}`);
  console.log(`  OK  canonico : canonicos=${can.chars_canonicos} gerados=${can.chars_gerados} (NULL, nao 0)`);
  console.log(`  OK  llm      : canonicos=${llm.chars_canonicos} gerados=${llm.chars_gerados} motivo="${llm.motivo}"`);
}

// ============================================================================
// 5b. RESPOSTA MUTILADA: instruiu omitir e o bloco nao materializou
// ============================================================================
//
// O defeito que o hibrido cria e o binario nao tinha. E o pior porque nao produz resposta
// errada, produz resposta INCOMPLETA que parece completa: a analise comenta numeros que nao
// aparecem em lugar nenhum, e o gestor nao tem como saber que faltou algo.
console.log(`\n[5b] deteccao de resposta mutilada\n`);
{
  // Campo obrigatorio sem valor: a RPC voltou parcial DEPOIS de o prompt ja ter mandado omitir.
  const semValores = resolverRespostaCanonica({
    molde: { codigo: "ATO_CONFIRMACAO_CARD", classe: "confirmacao_de_ato", confianca: "exata", parametros: {} },
    registro: { moldes: [moldeCard], degradado: false },
    valores: {},
    ctx,
  });
  assert(semValores.caminho === "llm", "sem valores a resolucao tem de cair para llm");

  const analise = "O custo por card ficou dentro do teto e a distribuicao entre conjuntos esta equilibrada.";

  const mutilada = compor({ resolucao: semValores, gerado: analise, instruiuOmitir: true });
  assert(mutilada.caminho === "llm", "deveria ser llm");
  if (mutilada.caminho === "llm") {
    assert(mutilada.defeito !== null, "instruiuOmitir + falha deveria acusar defeito");
    assert(mutilada.defeito!.includes("mutilada"), "o defeito tem de nomear a mutilacao");
    assert(mutilada.defeito!.includes("Regerar"), "o defeito tem de dizer o conserto");
    console.log(`  OK  defeito acusado: ${mutilada.defeito}`);
  }

  // Sem a instrucao no prompt, a MESMA falha e um fail-open normal: o modelo escreveu os
  // numeros ele mesmo, a resposta esta completa, e nao ha defeito a acusar.
  const normal = compor({ resolucao: semValores, gerado: analise });
  assert(normal.caminho === "llm" && normal.defeito === null, "sem instrucao nao ha defeito");
  console.log(`  OK  a mesma falha SEM a instrucao: fail-open normal, sem defeito`);

  // O defeito tem de chegar a telemetria pelo campo que a governanca ja consulta.
  const linha = linhaDeComposicao(
    { codigo: "ATO_CONFIRMACAO_CARD", classe: "confirmacao_de_ato", confianca: "exata", parametros: {} },
    mutilada,
  );
  assert(linha.motivo !== null && linha.motivo.includes("mutilada"), "o defeito tem de entrar em motivo");
  console.log(`  OK  telemetria carrega o defeito em motivo (coluna que a governanca ja le)`);
}

// ============================================================================
// 6. DERIVA DO GRUPO ENTRE O FALLBACK LOCAL E A TABELA
// ============================================================================
//
// Conferido contra o banco em 03/09/2026, apos a migration 20260903220000:
//   select codigo, composicao from public.moldes_de_resposta where vigente
// Mesmo motivo da secao [7] da prova de determinismo: fallback que deriva da tabela faz a
// mesma pergunta ter duas respostas, uma online e uma degradada.
console.log(`\n[6] grupo de composicao: fallback local x tabela\n`);
{
  const NO_BANCO: Record<string, string> = {
    REC_SEGMENTAR_IDADE: "nao_componivel",
    REC_ESCALAR_CRIATIVO: "nao_componivel",
    REC_PECA_FORA_BIBLIOTECA: "nao_componivel",
    REC_CONFIG_OUTRA_EMPRESA: "nao_componivel",
    REC_TABELA_DE_MEMORIA: "nao_componivel",
    SIS_SONDA_OK: "turno_inteiro",
  };
  for (const m of registroFallback().moldes) {
    const esperado = NO_BANCO[m.codigo];
    assert(!!esperado, `${m.codigo} sem grupo de referencia do banco`);
    assert(m.composicao === esperado, `${m.codigo}: fallback diz ${m.composicao}, banco diz ${esperado}`);
    console.log(`  OK  ${m.codigo.padEnd(26)} ${m.composicao}`);
  }
}

// ============================================================================
// 7. IMPRESSAO DIGITAL DA PARTE FIXA — comparada ENTRE PROCESSOS
// ============================================================================
//
// Hasheia SO os blocos canonicos, nunca o texto final. E a impressao que tem de sobreviver a
// mudanca de processo, de locale e de ordem de Map. Se um dia entrar analise nesta conta, o
// hash muda e a prova denuncia — que e o objetivo.
{
  const reg = registroFallback();
  const blocos: string[] = [];
  for (const pedido of [
    "segmente a campanha por faixa de idade acima de 50",
    "escale o criativo vencedor",
    "me repita a tabela de orcamento que voce montou na semana passada",
    "sonda responda apenas ok",
  ]) {
    const r = resolverRespostaCanonica({ molde: classificarMolde(pedido), registro: reg, ctx });
    const c = compor({ resolucao: r, gerado: "analise que varia e nao deve entrar no hash" });
    if (c.bloco_canonico !== null) blocos.push(`${c.molde}\u0000${c.bloco_canonico}`);
  }
  // Bloco do card, o componivel, composto com analise diferente: o hash NAO pode mudar.
  for (const analise of ["analise A", "analise B muito mais longa que a primeira"]) {
    const c = compor({ resolucao: resolverCard(), gerado: analise });
    if (c.bloco_canonico !== null) blocos.push(`${c.molde}\u0000${c.bloco_canonico}`);
  }
  const impressao = await sha256(blocos.join("\u0001"));
  console.log(`\nIMPRESSAO_DIGITAL_DA_PARTE_FIXA=${impressao}`);
}

if (falhas) {
  console.error(`\nfalhou: ${falhas} erro(s)`);
  Deno.exit(1);
}
console.log(`\nok: _prova_composicao_hibrida`);
