// Prova de que o portao SQL da forca-tarefa Ritmo recusa fechado.
//
// POR QUE EXISTE. Escrita na Meta sem card so pode passar se
// pode_executar_ato_ritmo autenticar a concessao. Sem esta leitura de fonte,
// um GRANT a authenticated, um skip_approval, ou o join uuid=text do gasto
// (metric_snapshots.campaign_id vs ritmo_missoes.campaign_id) voltariam
// calados — o teto somaria zero e a acao passaria.
//
// LEITURA. 20260910210000 cria a funcao (join ingenuo) e o REVOKE.
// 20260910211000 substitui o corpo (join via campaigns.external_id).
// A definicao VIVA e a ultima; uma prova que so grepa 210000 certificaria
// o join obsoleto. Nao reescreve 210000; nao cria migration.
//
// Caminho: supabase/functions/_shared -> ../../migrations/ (= supabase/migrations).
// Roda com: deno run --allow-read supabase/functions/_shared/_prova_ritmo_portao.ts

const falhas: string[] = [];

function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

async function fonte(rel: string): Promise<string> {
  const url = new URL(rel, import.meta.url);
  try {
    return await Deno.readTextFile(url);
  } catch (e) {
    falhas.push(`nao leu ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    return "";
  }
}

function corposPodeExecutar(sql: string): string[] {
  const re =
    /create\s+or\s+replace\s+function\s+public\.pode_executar_ato_ritmo\s*\([\s\S]*?\$\$;/gi;
  return sql.match(re) ?? [];
}

const REL_210000 = "../../migrations/20260910210000_ritmo_forca_tarefa.sql";
const REL_211000 = "../../migrations/20260910211000_ritmo_portao_soma_gasto_pelo_external_id.sql";

const sql210000 = await fonte(REL_210000);
const sql211000 = await fonte(REL_211000);

ok(sql210000.length > 0, "migration 20260910210000_ritmo_forca_tarefa.sql ausente ou vazia");
ok(
  sql211000.length > 0,
  "migration 20260910211000_ritmo_portao_soma_gasto_pelo_external_id.sql ausente: " +
    "sem ela esta prova certificaria o join uuid=text obsoleto de 210000",
);

const sql = `${sql210000}\n${sql211000}`;
const corpos = corposPodeExecutar(sql);
ok(
  corpos.length >= 2,
  `esperava >=2 definicoes de pode_executar_ato_ritmo (210000+211000); achei ${corpos.length}`,
);

const vivo = corpos.at(-1) ?? "";
ok(vivo.length > 0, "corpo vivo de pode_executar_ato_ritmo vazio");

const MOTIVOS = [
  "campanha",
  "status",
  "teto",
  "master_desligado",
  "acao_proibida",
  "fora_do_prazo",
  "sem_concessao",
] as const;

for (const motivo of MOTIVOS) {
  ok(
    new RegExp(`'motivo'\\s*,\\s*'${motivo}'`).test(vivo),
    `corpo vivo (211000) tem de devolver motivo '${motivo}'`,
  );
}

ok(
  /revoke\s+all\s+on\s+function\s+public\.pode_executar_ato_ritmo\s*\([^;]*\)\s+from\s+[^;]*\bauthenticated\b/i
    .test(sql),
  "revoke all ... pode_executar_ato_ritmo tem de incluir authenticated",
);
ok(
  /revoke\s+all\s+on\s+function\s+public\.pode_executar_ato_ritmo\s*\([^;]*\)\s+from\s+[^;]*\banon\b/i
    .test(sql),
  "revoke all ... pode_executar_ato_ritmo tem de incluir anon",
);
ok(
  !/grant\s+execute\s+on\s+function\s+public\.pode_executar_ato_ritmo[\s\S]{0,200}\b(authenticated|anon)\b/i
    .test(sql211000),
  "211000 nao pode devolver EXECUTE de pode_executar_ato_ritmo a authenticated/anon",
);

ok(!/skip_approval/i.test(vivo), "corpo vivo de pode_executar_ato_ritmo nao pode conter skip_approval");
ok(!/skip_approval/i.test(sql), "SQL do portao Ritmo (210000+211000) nao pode conter skip_approval");

ok(
  /p_acao\s*=\s*'criar_campanha'[\s\S]*?'motivo'\s*,\s*'acao_proibida'/i.test(vivo),
  "criar_campanha tem de estar no ramo que nega (acao_proibida) do corpo vivo",
);

const listaBranca = vivo.match(/p_acao\s+not\s+in\s*\(([\s\S]*?)\)/i);
ok(!!listaBranca, "corpo vivo tem de ter lista branca (p_acao not in ...)");
ok(
  !listaBranca || !/'criar_campanha'/.test(listaBranca[1]),
  "criar_campanha nao pode entrar na lista branca do portao",
);

ok(
  /s\.campaign_id\s*=\s*c\.id/.test(vivo),
  "corpo vivo tem de juntar metric_snapshots via s.campaign_id = c.id",
);
ok(
  /c\.external_id\s*=\s*m\.campaign_id/.test(vivo) ||
    /campaigns\.external_id\s*=\s*m\.campaign_id/.test(vivo),
  "corpo vivo tem de juntar gasto via campaigns.external_id = missao.campaign_id",
);
ok(
  !/s\.campaign_id\s*=\s*m\.campaign_id/.test(vivo),
  "corpo vivo nao pode voltar ao join ingenuo s.campaign_id = m.campaign_id (uuid=text)",
);

if (falhas.length > 0) {
  console.error("FALHOU: o portao Ritmo nao esta fail-closed no SQL.\n");
  for (const f of falhas) console.error(`  - ${f}`);
  console.error(
    "\nLembrete: escrita sem card so passa com concessao autenticada. " +
      "Join de gasto e via campaigns.external_id, nao uuid=text. Sem skip_approval.",
  );
  Deno.exit(1);
}

console.log(
  "OK  portao Ritmo fail-closed: motivos, revoke authenticated+anon, sem skip_approval, " +
    "criar_campanha negada, gasto via campaigns.external_id.",
);
