// Prova por leitura de fonte: o traffic-agent-job e o passe de correcao de custo consultam e gravam
// a memoria aprendida (spec 7.0, 7.2, 7.5, 7.9). Nao sobe a edge: le o texto de
// traffic-agent-job/index.ts e de correcao_custo_passe.ts.
//
// O que esta prova defende:
//  - todo subagente com laco de ferramentas ganha registrar/corrigir com teto 1 cada e
//    maxToolsTotal + 1, menos o compliance (portao de conformidade fica fora da memoria, spec 7.0);
//    analise_visual_drive e pipeline codificado sem laco: continua sem ferramenta nenhuma;
//  - o job cria UM turno de memoria em processarJob e o entrega a toda coleta dele; o teto de 3
//    vale para o job inteiro (fila com copia rasa por escrita, contador devolvido ao turno do job);
//  - bater no teto dessas duas no subagente NAO vira "dado nao lido / LACUNAS";
//  - recibo de escrita nao entra no resgate nem na evidencia;
//  - consultam: cada subagente (menos compliance), as duas sinteses, a leitura da colheita, o
//    relatorio autonomo, o Ritmo (memoria inteira) e o redator da correcao de custo.
// Rodar: deno run --no-code-cache --allow-read --allow-env <este arquivo>

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}

const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const passe = await Deno.readTextFile(new URL("./correcao_custo_passe.ts", import.meta.url));

/** Corpo de uma funcao do fonte: da assinatura ate a proxima funcao de topo. */
function corpoDe(fonte: string, assinatura: string): string {
  const i = fonte.indexOf(assinatura);
  if (i < 0) return "";
  const resto = fonte.slice(i + assinatura.length);
  const fim = resto.search(/\n(?:async function|function|const|let|type|export) /);
  return fim < 0 ? resto : resto.slice(0, fim);
}

// --- SUBAGENTES extraido do texto: chave -> tools, maxPorTool, maxToolsTotal ---
type CfgFonte = { tools: string[]; maxPorTool: Record<string, number>; maxToolsTotal: number };
const blocoSub = job.match(/const SUBAGENTES[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const SUBAGENTES_DO_FONTE: Record<string, CfgFonte> = {};
for (const m of blocoSub.matchAll(/\n {2}(\w+): \{\s*tools:\s*\[([^\]]*)\],\s*maxPorTool:\s*\{([^}]*)\},\s*maxToolsTotal:\s*(\d+)/g)) {
  SUBAGENTES_DO_FONTE[m[1]] = {
    tools: [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]),
    maxPorTool: Object.fromEntries([...m[3].matchAll(/(\w+):\s*(\d+)/g)].map((x) => [x[1], Number(x[2])])),
    maxToolsTotal: Number(m[4]),
  };
}
// Os tetos de antes da memoria: a memoria soma UMA vaga, para nao comer o orcamento de leitura.
const TETO_ANTES: Record<string, number> = {
  desempenho_campanhas: 17, criativos: 8, compliance: 8, estrutura_conta: 16, whatsapp_waba: 6,
  alertas_recomendacoes: 6, analise_visual_drive: 0, criativos_drive: 10, conhecimento: 5,
};
assert(
  JSON.stringify(Object.keys(SUBAGENTES_DO_FONTE).sort()) === JSON.stringify(Object.keys(TETO_ANTES).sort()),
  `extracao de SUBAGENTES achou ${Object.keys(SUBAGENTES_DO_FONTE).join(",") || "nada"}`,
);

// --- as asserções do brief (Tarefa 5) ---
for (const [nome, cfg] of Object.entries(SUBAGENTES_DO_FONTE)) {
  const tem = cfg.tools.includes("registrar_aprendizado");
  // analise_visual_drive e pipeline codificado (rodarAnaliseVisual), sem laco de ferramenta: lista
  // de ferramenta ali seria enfeite. Ele nao chama modelo com tools, entao nao grava nem consulta.
  if (nome === "analise_visual_drive") {
    assert(cfg.tools.length === 0 && cfg.maxToolsTotal === 0, `subagente ${nome} continua pipeline sem ferramenta`);
    continue;
  }
  assert(nome === "compliance" ? !tem : tem, `subagente ${nome}`);
}
assert(/case "registrar_aprendizado":/.test(job) && /case "corrigir_aprendizado":/.test(job), "despacho no job");
assert((job.match(/consultarMemoria\(/g) ?? []).length >= 5, "subagente, sintese x2, relatorio, ritmo");
assert(/nome\s*[!=]==\s*"compliance"[\s\S]{0,200}consultarMemoria\(|consultarMemoria\([\s\S]{0,200}nome\s*[!=]==\s*"compliance"/.test(job), "subagente compliance nao consulta");
assert(/papel:\s*"ritmo"/.test(job) && !/papel:\s*"ritmo"[^}]*somenteConfirmadas:\s*true/.test(job), "ritmo recebe tudo");
assert(/memoria\s*=\s*""/.test(passe) && /papel:\s*"correcao_custo"/.test(passe), "correcao de custo consulta e repassa");

// --- tetos por subagente ---
for (const [nome, cfg] of Object.entries(SUBAGENTES_DO_FONTE)) {
  if (nome === "analise_visual_drive") continue;
  if (nome === "compliance") {
    assert(!cfg.tools.includes("corrigir_aprendizado"), "compliance sem corrigir_aprendizado");
    assert(!("registrar_aprendizado" in cfg.maxPorTool) && !("corrigir_aprendizado" in cfg.maxPorTool), "compliance sem teto de memoria");
    assert(cfg.maxToolsTotal === TETO_ANTES[nome], "compliance com o teto de antes");
    continue;
  }
  assert(cfg.tools.includes("corrigir_aprendizado"), `subagente ${nome}: corrigir_aprendizado`);
  assert(cfg.maxPorTool.registrar_aprendizado === 1, `subagente ${nome}: maxPorTool registrar 1`);
  assert(cfg.maxPorTool.corrigir_aprendizado === 1, `subagente ${nome}: maxPorTool corrigir 1`);
  assert(cfg.maxToolsTotal === TETO_ANTES[nome] + 1, `subagente ${nome}: maxToolsTotal ${TETO_ANTES[nome]} + 1 (achou ${cfg.maxToolsTotal})`);
}

// --- o turno do job ---
assert(/async function runTool\([^)]*aprendizado\?:\s*TurnoAprendizado/.test(job), "ctx do runTool leva aprendizado?: TurnoAprendizado");
const corpoJob = corpoDe(job, "async function processarJob(");
assert(
  /const aprendizadoDoJob: TurnoAprendizado = \{[\s\S]{0,200}superficie:\s*"job",[\s\S]{0,80}conversationId:\s*convId,[\s\S]{0,40}jobId,[\s\S]{0,40}falasDoGestor:\s*\[pergunta\],[\s\S]{0,40}retornos:\s*\[\],[\s\S]{0,40}registrosNoTurno:\s*0/.test(corpoJob),
  "processarJob cria um turno de memoria: job, conversa, pedido do gestor, retornos vazios, teto zerado",
);
assert((corpoJob.match(/pedido: pergunta, aprendizado: aprendizadoDoJob \}/g) ?? []).length >= 4, "toda coleta do processarJob leva o turno do job");
assert(!/\{ companyId, companyName, mcpKey, pedido: pergunta \}/.test(corpoJob), "nenhuma coleta do processarJob sem o turno");

// --- o laco do subagente ---
const corpoSub = corpoDe(job, "async function rodarSubagente(");
assert(/ctx\.aprendizado\s*\?\s*cfg\.tools\s*:\s*cfg\.tools\.filter/.test(corpoSub), "sem turno (relatorio, Ritmo) as ferramentas de escrita nao sao oferecidas");
assert(/montarFerramentas\(catFerr, "job", new Set\(toolsDoSub\), toolsDoSub\)/.test(corpoSub), "o subagente monta so as ferramentas que pode usar");
assert(/const tetoTotal = cfg\.maxToolsTotal - \(toolsDoSub\.length < cfg\.tools\.length \? 1 : 0\);/.test(corpoSub), "sem escrita de memoria a vaga extra sai: leitura do relatorio e do Ritmo igual a antes");
assert(/tools_teto: tetoTotal,/.test(corpoSub), "telemetria grava o teto que valeu");
assert(/papel:\s*"subagente"/.test(corpoSub), "consulta do subagente com papel subagente");
assert(/const sys = `[\s\S]*?LACUNAS:' \(ou 'nenhuma'\)\.`\s*\+\s*\(memSub\?\.texto/.test(corpoSub), "bloco aprendido concatenado ao sys do subagente");
assert(/naFilaDoAprendizado\(ctx\.aprendizado, agenteMemoria,/.test(corpoSub), "escrita do subagente passa pela fila do job");
assert(/const agenteMemoria = ag\?\.codigo \?\? nome;/.test(corpoSub), "autoria: codigo do agente ou nome da unidade");
assert(/ctx\.aprendizado\?\.retornos\.push\(\{ tool: nomeTc, retorno: result \}\)/.test(corpoSub), "retornos do laco vao para o turno");
{
  const iTeto = corpoSub.indexOf("usadas.length >= tetoTotal");
  const iFeito = corpoSub.indexOf("o registro NAO foi feito");
  const iLido = corpoSub.indexOf("consulta_nao_realizada");
  assert(iTeto >= 0 && iFeito > iTeto && iLido > iFeito, "teto da memoria recusa com 'registro NAO foi feito' antes do 'dado NAO foi lido'");
  const ramo = iFeito > 0 ? corpoSub.slice(iTeto, iLido) : "";
  assert(/if \(ehAprendizado\)/.test(ramo) && /continue;/.test(ramo), "ramo proprio da memoria no teto");
  assert(!/NAO foi lido/.test(ramo) && /nao entra em LACUNAS/.test(ramo), "recusa da memoria nao marca coleta incompleta");
}
assert(/if \(!ehAprendizado\) \{[\s\S]{0,300}ctx\.aprendizado\?\.retornos\.push[\s\S]{0,200}textoDeResgate\(/.test(corpoSub), "recibo de escrita fora da evidencia e do resgate");
assert(/aprendizados:\s*\{[\s\S]{0,120}consulta: memSub\.telemetria[\s\S]{0,40}registro:\s*registros\s*\}/.test(corpoSub), "subagente devolve consulta e registros");

// --- a fila do job ---
const corpoFila = corpoDe(job, "function naFilaDoAprendizado");
assert(/const copia: TurnoAprendizado = \{ \.\.\.turnoJob, agente \};/.test(corpoFila), "copia rasa por escrita com o agente do subagente");
assert(/finally \{\s*turnoJob\.registrosNoTurno = copia\.registrosNoTurno;/.test(corpoFila), "contador volta ao turno do job");
assert(/filaDeAprendizado\.set\(turnoJob/.test(corpoFila), "uma escrita por vez no job");

// --- consultas fora do subagente ---
const corpoSint = corpoDe(job, "async function sintetizar(");
assert(/papel:\s*"sintese"/.test(corpoSint), "sintese consulta com papel sintese");
assert(/montarSysSintese\([^)]*\) \+ \(blocoAprendido/.test(corpoSint), "sintese: bloco depois do sys");
assert(/sintetizarSegmentada\([^)]*\{ \.\.\.opts, aprendizados: blocoAprendido \}\)/.test(corpoSint), "sintese segmentada recebe o mesmo bloco (uma consulta so)");
const corpoSeg = corpoDe(job, "async function sintetizarSegmentada(");
assert(/montarSysSintese\([^)]*\) \+ \(opts\?\.aprendizados/.test(corpoSeg), "sintese segmentada: bloco depois do sys");
assert(/\$\{args\.aprendizados \? `\\n\\n\$\{args\.aprendizados\}` : ""\}`;/.test(corpoDe(job, "async function interpretarColheita(")), "leitura da colheita: bloco depois do sys");
assert(/papel:\s*"sintese"[\s\S]{0,400}interpretarColheita|blocoMetodoDaLeitura\(pergunta, companyId\),\s*consultarMemoria\(\{[^}]*papel:\s*"sintese"/.test(corpoJob), "leitura da colheita consulta com papel sintese");
assert(/aprendizados: memLeitura\.texto/.test(corpoJob), "leitura da colheita recebe o bloco");
const corpoRel = corpoDe(job, "async function processarRelatorio(");
assert(/papel:\s*"relatorio"/.test(corpoRel) && /aprendizados: memRelatorio\.texto/.test(corpoRel), "relatorio autonomo consulta e repassa");
assert(/\$\{\(await precarregarDoutrina\(\), doutrina\("relatorio"\)\)\}\$\{args\.aprendizados/.test(corpoDe(job, "async function sintetizarRelatorioAutonomo(")), "relatorio: bloco depois do sys");
const corpoRitmo = corpoDe(job, "async function processarPlanoRitmo(");
assert(/papel:\s*"ritmo"/.test(corpoRitmo) && /extraSys,/.test(corpoRitmo) && /memRitmo\.texto/.test(corpoRitmo), "Ritmo consulta e entra via extraSys");
assert(/RITMO_REPLANO_EXTRA/.test(corpoRitmo), "Ritmo mantem o extra do replano");
for (const corpo of [corpoJob, corpoRel, corpoRitmo, corpoSint]) {
  assert(/anotarConsultaDeMemoria\(tel, /.test(corpo), "telemetria da consulta em tel.aprendizados");
}
assert(/\(tel\.aprendizados \?\?= \{\}\)/.test(corpoDe(job, "function anotarConsultaDeMemoria")), "tel.aprendizados.consulta");
assert(/anotarRegistrosDeMemoria\(tel, /.test(corpoDe(job, "async function executarLote(")), "executarLote junta os registros em tel.aprendizados.registro");

// --- correcao de custo ---
const corpoRedigir = corpoDe(passe, "async function redigir(");
assert(/memoria = ""/.test(corpoRedigir) && /\]\.join\(" "\) \+ \(memoria \? `\\n\\n\$\{memoria\}` : ""\)/.test(corpoRedigir), "redigir concatena a memoria ao system prompt");
assert(/redigir\(opts\.openRouterKey, est, colheita, escada, await carregarBaseDoutrina\(opts\.supa\), memoria\)/.test(passe), "o chamador repassa a memoria");
assert(/opts\.openRouterKey && escada\.alavanca\s*\?\s*await consultarMemoria\(/.test(passe), "so consulta quando o redator vai rodar");
assert(/linhaFixa: txt\(est\.marca\) \|\| null/.test(passe), "linha da correcao = marca do estouro");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("ok - memoria no job");
