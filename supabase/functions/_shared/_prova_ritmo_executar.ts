// Prova de que ritmo-executar so escreve na Meta via meta-actions origem ritmo.
//
// POR QUE EXISTE. Sem esta leitura de fonte, a edge voltaria a chamar Graph
// ou a inserir approval_requests "para reusar o executor" — o card
// reapareceria na fila de Aprovacoes e o tique furaria o portao.
//
// Roda com: deno run --allow-read supabase/functions/_shared/_prova_ritmo_executar.ts

const falhas: string[] = [];

function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

const src = await Deno.readTextFile(new URL("../ritmo-executar/index.ts", import.meta.url));
const toml = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));

ok(src.includes('chaveMcpDe(req, "header-only")'), "auth tem de ser chaveMcpDe header-only");
ok(src.includes("mcpKeyValida"), "auth tem de chamar mcpKeyValida");
ok(src.includes("listar_ritmo_tiques_devidos"), "dispatcher tem de chamar listar_ritmo_tiques_devidos");
ok(src.includes("encerrar_ritmo_missao"), "leve tem de chamar encerrar_ritmo_missao");
ok(src.includes("verificar_parada"), "parada sem escrita vira ato verificar_parada");
ok(src.includes("atosDoPrimeiroPasse"), "primeiro_passe/fundo usam atosDoPrimeiroPasse");
ok(
  src.includes("atosDoPrimeiroPasse(novos)"),
  "cap de significativa aplica-se aos novos, nao ao prefixo do plano",
);
ok(
  /const novos = executaveis[\s\S]{0,240}atosDoPrimeiroPasse\(novos\)/.test(src),
  "filtra existentes (novos) antes de atosDoPrimeiroPasse",
);
ok(
  !src.includes("atosDoPrimeiroPasse(executaveis)"),
  "nao capar o plano inteiro antes de filtrar acao+alvo ja inseridos",
);
ok(
  /function imediatosDoPlano\([^)]*existentes/.test(src),
  "imediatosDoPlano recebe o set de chaves ja inseridas",
);
ok(src.includes("parsePlanoRitmo"), "plano vem de parsePlanoRitmo");
ok(src.includes("motivoParada"), "leve calcula motivoParada");
ok(src.includes("sonhoAtingido"), "leve calcula sonhoAtingido");
ok(src.includes("gastoNaJanela"), "leve soma gastoNaJanela");
ok(src.includes("hojeYmdBrasilia"), "datas civis em America/Sao_Paulo");
ok(src.includes("target_external_id"), "payload do ato tem de incluir target_external_id");
ok(
  src.includes('origem: "ritmo"') || src.includes('origem:"ritmo"'),
  'POST meta-actions tem de levar origem: "ritmo"',
);
ok(src.includes("ritmo_ato_id"), "POST meta-actions tem de levar ritmo_ato_id");
ok(src.includes("/functions/v1/meta-actions"), "unica saida de escrita e meta-actions");
ok(src.includes('modo: "ritmo_replano"') || src.includes('modo:"ritmo_replano"'), "fundo invoca ritmo_replano");
{
  const fundoIdx = src.indexOf("async function rodarFundo");
  const falhouIdx = src.indexOf('replano: "falhou"', fundoIdx);
  const imediatosIdx = src.indexOf("imediatosDoPlano(atual.plano_json", fundoIdx);
  ok(
    fundoIdx >= 0 && falhouIdx > fundoIdx && imediatosIdx > falhouIdx,
    "fundo so seleciona imediatos depois de replano ok; falhou retorna inseridos: 0",
  );
  ok(
    falhouIdx >= 0 && src.slice(falhouIdx, falhouIdx + 180).includes("inseridos: 0"),
    "replano falhou nao inventa atos",
  );
}
ok(src.includes("emBackground") && src.includes("waitUntil"), "dispatcher usa emBackground/waitUntil");
ok(src.includes("body.resultado"), "HTTP de meta-actions tem de ler resultado, nao so ok");
ok(src.includes("re_executavel === false"), "retry leve respeita re_executavel === false");
ok(!/graph\.facebook/i.test(src), "ritmo-executar nao pode chamar Graph");
ok(
  !/\.from\(\s*"approval_requests"\s*\)/.test(src),
  'ritmo-executar nao pode from("approval_requests")',
);
ok(!/skip_approval/i.test(src), "ritmo-executar nao pode expor skip_approval");
ok(
  /\[functions\.ritmo-executar\]\s*\nverify_jwt\s*=\s*false/.test(toml),
  "config.toml tem [functions.ritmo-executar] verify_jwt = false",
);

const idxMeta = toml.indexOf("[functions.meta-actions]");
const idxRitmo = toml.indexOf("[functions.ritmo-executar]");
ok(idxMeta >= 0 && idxRitmo > idxMeta, "bloco ritmo-executar vem depois de meta-actions no config.toml");

if (falhas.length > 0) {
  console.error("FALHOU: ritmo-executar nao escreve so via meta-actions.\n");
  for (const f of falhas) console.error(`  - ${f}`);
  Deno.exit(1);
}

console.log("OK  ritmo-executar: tiques so via meta-actions origem ritmo, sem Graph nem card.");
