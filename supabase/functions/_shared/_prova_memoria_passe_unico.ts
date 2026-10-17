// Prova por leitura de fonte: as edges de passe unico (traffic-reco-job, gerar-legendas e o
// REDATOR de waba-template-create/replicate) consultam a memoria aprendida antes do modelo, e os
// portoes de conformidade ficam fora dela (spec 7.0, 7.5). Nao sobe a edge: le o texto de cada
// index.ts.
//
// O que esta prova defende:
//  - cada uma das quatro faz UMA consulta (uma por chamada ao modelo), com o papel certo, e o
//    gerar-legendas recorta pela marca escolhida (linhaFixa: meio);
//  - a consulta fica DEPOIS das recusas que saem antes do modelo (sem chave, sem produto): consultar
//    antes marcaria uso de item que nao entrou em prompt nenhum;
//  - o bloco entra no FIM do `sys`, fora do template original: com bloco vazio o `sys` e byte a byte
//    o de hoje, e o prompt cacheavel nao muda quando a chave esta desligada;
//  - passe unico so le: nenhuma delas importa registrar/corrigir/extrair;
//  - o compliance-check e o guardiao dos templates WABA (a partir de "GUARDIÃO A") nao citam a
//    memoria: portao de conformidade nao e influenciado por preferencia aprendida.
// Rodar: deno run --no-code-cache --allow-read --allow-env <este arquivo>

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}

const EDGES = ["traffic-reco-job", "gerar-legendas", "waba-template-create", "waba-template-replicate"];
const FONTES = new Map<string, string>();
for (const f of [...EDGES, "compliance-check"]) {
  FONTES.set(f, await Deno.readTextFile(new URL(`../${f}/index.ts`, import.meta.url)));
}
const fonte = (f: string): string => FONTES.get(f) ?? "";

// --- as asserções do brief (Tarefa 6) ---
for (const f of EDGES) {
  assert(/consultarMemoria\(/.test(fonte(f)), `${f} consulta`);
}
assert(/linhaFixa:\s*meio/.test(fonte("gerar-legendas")), "legendas recorta pela marca");
assert(!/consultarMemoria|aprendizados/.test(fonte("compliance-check")), "compliance-check fora");
for (const f of ["waba-template-create", "waba-template-replicate"]) {
  const i = fonte(f).indexOf("GUARDIÃO A");
  assert(i > 0, `${f}: marcador "GUARDIÃO A" existe (sem ele o corte abaixo seria vazio)`);
  const guardiao = fonte(f).slice(i);
  assert(!/consultarMemoria|blocoAprendizados/.test(guardiao), `${f}: guardiao fora`);
}

// --- o que o brief nao diz, mas a spec exige ---
const PAPEL: Record<string, string> = {
  "traffic-reco-job": "reco",
  "gerar-legendas": "legendas",
  "waba-template-create": "waba_redator",
  "waba-template-replicate": "waba_redator",
};
// Recusa que sai ANTES do modelo; a consulta tem de vir depois dela.
const ANTES_DO_MODELO: Record<string, string> = {
  "traffic-reco-job": "if (!OPENROUTER_KEY)",
  "gerar-legendas": "produto_obrigatorio",
  "waba-template-create": "if (!OR_KEY)",
  "waba-template-replicate": "if (!OR_KEY)",
};

for (const f of EDGES) {
  const src = fonte(f);
  const chamadas = src.match(/consultarMemoria\(/g) ?? [];
  assert(chamadas.length === 1, `${f}: uma consulta por chamada ao modelo (achou ${chamadas.length})`);
  assert(
    /import \{ consultarMemoria \} from "\.\.\/_shared\/aprendizados\.ts";/.test(src),
    `${f}: importa so consultarMemoria`,
  );
  assert(
    new RegExp(`papel:\\s*"${PAPEL[f]}"`).test(src),
    `${f}: papel "${PAPEL[f]}"`,
  );
  assert(/const blocoAprendizados = /.test(src), `${f}: o texto fica em blocoAprendizados`);
  assert(
    /const memAprendida = await consultarMemoria\(\{/.test(src) && /const blocoAprendizados = memAprendida\.texto;/.test(src),
    `${f}: o bloco e o texto da consulta`,
  );

  // Passe unico so le.
  assert(
    !/registrarAprendizado|corrigirAprendizado|extrairAprendizadosDoTurno|registrar_aprendizado|corrigir_aprendizado/.test(src),
    `${f}: passe unico nao grava memoria`,
  );

  // Ordem: recusa antes do modelo < consulta < sys < chamada ao modelo.
  const iRecusa = src.indexOf(ANTES_DO_MODELO[f]);
  const iConsulta = src.indexOf("consultarMemoria(");
  const iSys = src.indexOf("const sys = ");
  const iModelo = src.indexOf("openrouter.ai/api/v1/chat/completions");
  assert(iRecusa >= 0, `${f}: achou a recusa "${ANTES_DO_MODELO[f]}"`);
  assert(iRecusa < iConsulta, `${f}: consulta depois da recusa que sai antes do modelo`);
  assert(iConsulta < iSys, `${f}: consulta antes de montar o sys`);
  assert(iSys < iModelo, `${f}: sys antes da chamada ao modelo`);

  // O bloco entra no fim do sys, fora do template literal original (sys identico com bloco vazio).
  assert(
    /const sys = `[\s\S]*?` \+ \(blocoAprendizados \? `\\n\\n\$\{blocoAprendizados\}` : ""\);/.test(src),
    `${f}: sys = <template de hoje> + bloco no fim (vazio = byte a byte o de hoje)`,
  );
}

// --- recortes por edge ---
assert(/consultarMemoria\(\{\s*supa,\s*companyId:\s*c\.company_id,/.test(fonte("traffic-reco-job")), "reco: a empresa e a do candidato");
assert(/consultarMemoria\(\{\s*supa,\s*companyId,/.test(fonte("gerar-legendas")), "legendas: a empresa e a da chamada");
for (const f of ["waba-template-create", "waba-template-replicate"]) {
  assert(/consultarMemoria\(\{\s*supa,\s*companyId:\s*comp\.id,/.test(fonte(f)), `${f}: a empresa e a da chamada (comp.id)`);
}

if (falhas) {
  console.error(`${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("ok - memoria nas edges de passe unico");
