// Prova por leitura de fonte: o traffic-chat consulta, grava e tem rede de seguranca da memoria
// aprendida (spec 7.0, 7.2, 7.3, 7.4, 7.5, 7.9). Nao sobe a edge: le o texto de
// traffic-chat/index.ts e o snapshot de ferramentas_base.ts.
//
// O que esta prova defende:
//  - as duas ferramentas sao despachadas no runTool e tem teto proprio por turno;
//  - o bloco aprendido fica FORA do systemPrompt cacheado e depois do bloco de agentes: o prefixo
//    cacheado precisa ser byte a byte o mesmo entre turnos (spec 8, "Chat");
//  - a consulta parte antes da espera do Roteador (corre em paralelo, nao soma parede);
//  - o turno entrega ao handler as falas do gestor e a MESMA lista de retornos que o laco enche;
//  - a rede de seguranca roda depois do insert da resposta e em segundo plano (waitUntil);
//  - as ferramentas sao do AG-00, de escrita, nas duas superficies, com descricao curta e ASCII.
// Rodar: deno run --no-code-cache --allow-read --allow-env <este arquivo>

import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";
import { PREFIXO_REVISAO_CURADORIA, TRECHO_MINIMO_CHARS } from "./aprendizados_regras.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}

const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));

// --- as asserções do brief (Tarefa 4) ---
assert(/case "registrar_aprendizado":/.test(chat) && /case "corrigir_aprendizado":/.test(chat), "despacho das duas");
assert(!/systemPrompt\([^)]*aprendiz/i.test(chat), "bloco aprendido fora do systemPrompt cacheado");
assert(/cache_control[\s\S]{0,400}blocoAgentes[\s\S]{0,200}blocoAprendizados/.test(chat), "bloco depois do cacheado e do de agentes");
assert(/aprendizado:\s*\{[\s\S]{0,300}falasDoGestor[\s\S]{0,300}retornos:\s*toolResults/.test(chat), "ctx leva falas e retornos");
assert(/sinalDeCorrecao\(/.test(chat) && /waitUntil/.test(chat), "rede de seguranca em segundo plano");
assert(FERRAMENTAS_BASE.registrar_aprendizado?.efeito === "escrita" && FERRAMENTAS_BASE.registrar_aprendizado?.setor === "Recepcao, voz e entrega", "dono AG-00");
assert((FERRAMENTAS_BASE.registrar_aprendizado?.descricao.length ?? Infinity) <= 600, "descricao curta");

// --- ferramentas: dono, superficies e descricao ---
for (const chave of ["registrar_aprendizado", "corrigir_aprendizado"]) {
  const f = FERRAMENTAS_BASE[chave];
  assert(!!f, `${chave} no snapshot`);
  if (!f) continue;
  assert(f.efeito === "escrita" && f.setor === "Recepcao, voz e entrega", `${chave}: escrita do AG-00`);
  assert(f.superficies.includes("chat") && f.superficies.includes("job"), `${chave}: chat e job`);
  assert(/^[\x20-\x7e]+$/.test(f.descricao), `${chave}: descricao em ASCII`);
  assert(f.descricao.length <= 600, `${chave}: descricao curta`);
  const props = (f.parametros as { properties?: Record<string, unknown> }).properties ?? {};
  assert("evidencia" in props, `${chave}: parametro evidencia`);
}
{
  const d = FERRAMENTAS_BASE.registrar_aprendizado?.descricao ?? "";
  assert(/fala exata/i.test(d), "registrar: a evidencia e a fala exata");
  assert(d.includes(String(TRECHO_MINIMO_CHARS)) && /palavras inteiras/i.test(d), "registrar: 12+ caracteres em palavras inteiras");
  assert(d.includes(PREFIXO_REVISAO_CURADORIA.trim()) && /correcao/.test(d), "registrar: contradiz curada vira correcao com o prefixo de curadoria");
  const p = FERRAMENTAS_BASE.registrar_aprendizado?.parametros as { required?: string[] } | undefined;
  for (const r of ["fato", "categoria", "evidencia", "confianca"]) {
    assert(!!p?.required?.includes(r), `registrar: ${r} obrigatorio`);
  }
  const pc = FERRAMENTAS_BASE.corrigir_aprendizado?.parametros as { required?: string[]; properties?: Record<string, any> } | undefined;
  for (const r of ["id", "acao", "motivo", "evidencia"]) {
    assert(!!pc?.required?.includes(r), `corrigir: ${r} obrigatorio`);
  }
  assert(JSON.stringify(pc?.properties?.acao?.enum ?? []) === JSON.stringify(["substituir", "aposentar"]), "corrigir: acao substituir|aposentar");
}

// --- teto por ferramenta e ordem estavel ---
assert(/MAX_POR_FERRAMENTA[^=]*=\s*\{[\s\S]*?registrar_aprendizado:\s*3,[\s\S]*?\};/.test(chat), "teto de registrar_aprendizado = 3");
assert(/MAX_POR_FERRAMENTA[^=]*=\s*\{[\s\S]*?corrigir_aprendizado:\s*2,[\s\S]*?\};/.test(chat), "teto de corrigir_aprendizado = 2");
{
  const ordem = chat.match(/const ORDEM_TOOLS = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert(ordem.includes(`"registrar_aprendizado"`) && ordem.includes(`"corrigir_aprendizado"`), "as duas em ORDEM_TOOLS");
}

// --- consulta: papel chat, tarefa do fio, em paralelo com o Roteador ---
{
  const chamada = chat.match(/consultarMemoria\(\{([\s\S]{0,300}?)\}\)/)?.[1] ?? "";
  assert(/papel:\s*"chat"/.test(chamada) && /tarefa:\s*objetivoOriginal/.test(chamada) && /companyId:\s*company\.id/.test(chamada), "consulta com papel chat, tarefa = objetivoOriginal e empresa do turno");
  const iConsulta = chat.indexOf("consultarMemoria({");
  const iEspera = chat.indexOf("await promessaAgentes");
  assert(iConsulta > 0 && iEspera > 0 && iConsulta < iEspera, "a consulta parte antes de aguardar o Roteador (corre em paralelo)");
  assert(/\.\.\.\(blocoAprendizados \? \[\{ type: "text", text: blocoAprendizados \}\] : \[\]\)/.test(chat), "bloco so entra quando nao esta vazio, sem cache_control");
}

// --- ctx.aprendizado: o turno que o handler confere ---
{
  const bloco = chat.match(/aprendizado:\s*\{([\s\S]{0,600}?)\}\s*satisfies TurnoAprendizado/)?.[1] ?? "";
  assert(!!bloco, "ctx.aprendizado tipado como TurnoAprendizado");
  assert(/companyId:\s*company\.id/.test(bloco), "ctx.aprendizado: empresa do turno");
  assert(/superficie:\s*"chat"/.test(bloco) && /jobId:\s*null/.test(bloco), "ctx.aprendizado: superficie chat e sem job");
  assert(/conversationId:\s*convId/.test(bloco), "ctx.aprendizado: conversa do turno");
  assert(/registrosNoTurno:\s*0/.test(bloco), "ctx.aprendizado: teto do turno comeca em zero");
  assert(/agente:\s*agenteDoAprendizado/.test(bloco) && /agenteDoAprendizado\s*=\s*agentesDoTurno\.find\([\s\S]{0,80}NUCLEO_SEMPRE[\s\S]{0,40}\?\?\s*"AG-00"/.test(chat), "ctx.aprendizado: primeiro agente fora do nucleo, ou AG-00");
  assert(/falasDoGestor\s*=\s*\[[\s\S]{0,200}cronologico[\s\S]{0,120}"user"[\s\S]{0,200}msgText/.test(chat), "falas do gestor = mensagens user do fio + a atual");
}

// --- despacho: o handler recebe o turno do ctx e o resultado entra na telemetria ---
{
  const reg = chat.match(/case "registrar_aprendizado":([\s\S]{0,400}?)\n\s{6}case /)?.[1] ?? "";
  assert(/registrarAprendizado\(supa,\s*args,\s*ctx\.aprendizado\)/.test(reg), "registrar despacha com o turno do ctx");
  const cor = chat.match(/case "corrigir_aprendizado":([\s\S]{0,400}?)\n\s{6}case /)?.[1] ?? "";
  assert(/corrigirAprendizado\(supa,\s*args,\s*ctx\.aprendizado\)/.test(cor), "corrigir despacha com o turno do ctx");
}

// --- rede de seguranca e telemetria ---
{
  assert(/aprendizados:\s*\{[\s\S]{0,200}consulta:[\s\S]{0,200}registro:\s*ctx\.[\s\S]{0,200}rede:\s*\{[\s\S]{0,80}disparou/.test(chat), "diagnostico.aprendizados = { consulta, registro (do ctx), rede }");
  // O insert da RESPOSTA em chat_messages (nao os messages.push do laco, que tem o mesmo texto).
  const iInsert = chat.search(/from\("chat_messages"\)\.insert\(\{[^\n]*role: "assistant", content: reply/);
  const iRede = chat.indexOf("extrairAprendizadosDoTurno(");
  assert(iInsert > 0 && iRede > iInsert, "a rede roda depois do insert da resposta");
  assert(/waitUntil[\s\S]{0,40}\(\s*extrairAprendizadosDoTurno\(/.test(chat), "a extracao vai para o waitUntil, sem segurar o turno");
  assert(/sinalDeCorrecao\(msgText\)/.test(chat), "o sinal e lido na mensagem atual do gestor");
  assert(/!toolsUsed\.some\(\([^)]*\)\s*=>\s*[^)]*"registrar_aprendizado"\)/.test(chat), "so dispara se o turno nao chamou registrar_aprendizado");
  assert(/redeDisparou\s*=[\s\S]{0,200}waitUntil/.test(chat), "sem EdgeRuntime.waitUntil a rede nao dispara");
  assert(/turno:\s*ctx\.aprendizado/.test(chat), "a rede usa o mesmo turno (mesmas checagens e mesmo teto)");
}

if (falhas) { console.error(`\n${falhas} falha(s)`); Deno.exit(1); }
console.log("ok - memoria no chat");
