// Prova da classificacao efeito/setor das 57 ferramentas.
//
// POR QUE UMA PROVA E NAO UMA REVISAO. Classificar 57 ferramentas e o tipo de trabalho em que o
// erro nao se anuncia: uma ferramenta marcada 'leitura' por engano nao quebra nada hoje, so
// desliga em silencio a guarda de ato que depende dela amanha. E a mesma familia de falha que
// o campo veio consertar, aplicada ao proprio campo.
//
// O QUE ESTE ARQUIVO COMPARA, e por que essa comparacao vale alguma coisa:
//   snapshot local (ferramentas_base.ts)  <->  migration (a fonte que popula o banco)
// Sao dois arquivos que precisam concordar e que ninguem edita junto por habito. Comparar o
// snapshot com ele mesmo, ou com uma lista escrita aqui, provaria so que eu digitei duas vezes
// a mesma coisa. Comparar com a migration pega a divergencia real: alguem acrescenta ferramenta
// no snapshot e esquece o UPDATE, ou muda o efeito no SQL e o turno degradado continua com o
// valor velho.
//
// A TABELA VIVA entra por cima quando ha credencial no ambiente (SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY). Sem credencial a prova NAO falha: ela declara que rodou offline.
// Prova que so roda com segredo e prova que ninguem roda — e essa e exatamente a doenca que a
// suite perguntas_ouro tinha.
//
// Roda com:
//   deno run --allow-read supabase/functions/_shared/_prova_efeito_ferramentas.ts
//   deno run --allow-read --allow-env --allow-net supabase/functions/_shared/_prova_efeito_ferramentas.ts

import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    falhas++;
  }
}

const RAIZ = new URL("../../../", import.meta.url);
const MIGRATION = new URL(
  "supabase/migrations/20260903213000_efeito_e_setor_da_ferramenta_limites_do_agente_e_suite_v3.sql",
  RAIZ,
);

// Os 9 setores de public.agents. Setor fora desta lista nao e erro de digitacao inofensivo: a
// regra "ferramenta de escrita do dono de X" casa setor por IGUALDADE, entao um setor com grafia
// propria nunca encontra dono e a guarda desliga sem reclamar.
const SETORES_DOS_AGENTES: Record<string, string> = {
  "AG-00": "Recepcao, voz e entrega",
  "AG-01": "Triagem e despacho",
  "AG-02": "Desempenho e estrutura de midia",
  "AG-03": "Ativo criativo e copy",
  "AG-04": "Conformidade",
  "AG-05": "Canal WhatsApp",
  "AG-06": "Atos na conta Meta",
  "AG-07": "Saude da plataforma e pendencias",
  "AG-08": "Conhecimento tecnico",
};

// Dono de cada ferramenta de ESCRITA, lido de public.agent_unidades (tipo='ferramenta',
// vigente) em 03/09/2026. So as de escrita estao pinadas: e sobre elas que a guarda decide, e
// pinar as 57 transformaria este arquivo numa segunda copia do registro.
const DONO_DA_ESCRITA: Record<string, string> = {
  registrar_legenda_da_conversa: "AG-00",
  registrar_peca_da_conversa: "AG-00",
  computar_perfil_vencedor: "AG-02",
  gerar_legendas: "AG-03",
  registrar_veredito_peca_em_revisao: "AG-04",
  alterar_categoria_especial: "AG-06",
  propose_action: "AG-06",
  renomear_campanha: "AG-06",
  upload_midia: "AG-06",
  vincular_instagram_dos_anuncios: "AG-06",
};

/** Le os UPDATE de classificacao da migration e devolve chave -> {efeito, setor}. */
function classificacaoDaMigration(sql: string): Map<string, { efeito: string; setor: string }> {
  const mapa = new Map<string, { efeito: string; setor: string }>();
  const re =
    /update\s+public\.agent_ferramentas\s+set\s+efeito\s*=\s*'(leitura|escrita)'\s*,\s*setor\s*=\s*'([^']+)'\s*where\s+chave\s+(?:in\s*\(([\s\S]*?)\)|=\s*'([a-z0-9_]+)')/gi;
  for (const m of sql.matchAll(re)) {
    const efeito = m[1];
    const setor = m[2];
    const chaves = m[4] ? [m[4]] : [...(m[3] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((c) => c[1]);
    for (const chave of chaves) {
      if (mapa.has(chave)) {
        console.error(`FALHOU: ${chave} classificada duas vezes na migration`);
        falhas++;
      }
      mapa.set(chave, { efeito, setor });
    }
  }
  return mapa;
}

const sql = await Deno.readTextFile(MIGRATION);
const daMigration = classificacaoDaMigration(sql);
const doSnapshot = Object.entries(FERRAMENTAS_BASE);

// 1) Toda ferramenta do snapshot tem efeito preenchido e valido.
for (const [chave, base] of doSnapshot) {
  ok(
    base.efeito === "leitura" || base.efeito === "escrita",
    `${chave}: efeito ausente ou invalido (${JSON.stringify(base.efeito)})`,
  );
  ok(!!base.setor, `${chave}: setor vazio`);
}

// 2) Setor do snapshot tem de ser um setor de agente. Igualdade literal, sem normalizacao: e
//    assim que a regra vai casar em producao, entao e assim que ela tem de ser testada.
const setoresValidos = new Set(Object.values(SETORES_DOS_AGENTES));
for (const [chave, base] of doSnapshot) {
  ok(
    setoresValidos.has(base.setor),
    `${chave}: setor "${base.setor}" nao existe em public.agents`,
  );
}

// 3) Snapshot e migration cobrem exatamente o mesmo conjunto de chaves.
for (const [chave] of doSnapshot) {
  ok(daMigration.has(chave), `${chave} esta no snapshot e nao recebe efeito na migration`);
}
for (const chave of daMigration.keys()) {
  ok(chave in FERRAMENTAS_BASE, `${chave} e classificada na migration e nao existe no snapshot`);
}

// 4) E concordam valor a valor. Este e o teste que pega a edicao de um lado so.
for (const [chave, base] of doSnapshot) {
  const m = daMigration.get(chave);
  if (!m) continue;
  ok(
    m.efeito === base.efeito,
    `${chave}: efeito diverge — snapshot=${base.efeito}, migration=${m.efeito}`,
  );
  ok(
    m.setor === base.setor,
    `${chave}: setor diverge — snapshot="${base.setor}", migration="${m.setor}"`,
  );
}

// 5) Nenhuma ferramenta de escrita pertence a agente sem permissao de escrita naquele setor.
//    "Permissao de escrita" aqui NAO e uma flag: e a coincidencia entre o setor da ferramenta e
//    o setor do agente que a possui. Se elas divergirem, a guarda procuraria a ferramenta de
//    escrita do setor X e nao acharia a que existe — falha aberta, ato nao verificado.
const escritas = doSnapshot.filter(([, b]) => b.efeito === "escrita").map(([k]) => k);
for (const chave of escritas) {
  const dono = DONO_DA_ESCRITA[chave];
  ok(!!dono, `${chave} escreve e nao tem dono declarado em agent_unidades`);
  if (!dono) continue;
  ok(
    SETORES_DOS_AGENTES[dono] === FERRAMENTAS_BASE[chave].setor,
    `${chave}: dono ${dono} e do setor "${SETORES_DOS_AGENTES[dono]}", ` +
      `mas a ferramenta esta em "${FERRAMENTAS_BASE[chave].setor}"`,
  );
}
for (const chave of Object.keys(DONO_DA_ESCRITA)) {
  ok(
    FERRAMENTAS_BASE[chave]?.efeito === "escrita",
    `${chave} esta pinada como ferramenta de escrita e o snapshot diz "${FERRAMENTAS_BASE[chave]?.efeito}"`,
  );
}

// 6) O total. 57 e o numero vigente em 03/09/2026; ferramenta nova faz este teste falhar de
//    proposito, para que a classificacao dela seja uma decisao e nao um esquecimento.
ok(
  doSnapshot.length === 57,
  `o snapshot tem ${doSnapshot.length} ferramentas, esperava 57 — classifique a nova e atualize este numero`,
);

// ===== Tabela viva (opcional) =====
// Sem --allow-env o proprio Deno.env.get lanca. Ler dentro do try e o que faz o modo offline
// ser o DEFAULT de verdade, e nao um modo que exige lembrar de uma flag.
function doAmbiente(nome: string): string | undefined {
  try {
    return Deno.env.get(nome);
  } catch {
    return undefined;
  }
}

const url = doAmbiente("SUPABASE_URL");
const chaveServico = doAmbiente("SUPABASE_SERVICE_ROLE_KEY");
if (url && chaveServico) {
  const resp = await fetch(
    `${url}/rest/v1/agent_ferramentas?select=chave,efeito,setor,vigente&vigente=eq.true`,
    { headers: { apikey: chaveServico, Authorization: `Bearer ${chaveServico}` } },
  );
  if (!resp.ok) {
    console.error(`FALHOU: leitura de agent_ferramentas devolveu ${resp.status}`);
    falhas++;
  } else {
    const linhas = (await resp.json()) as Array<
      { chave: string; efeito: string | null; setor: string | null }
    >;
    ok(
      linhas.length === doSnapshot.length,
      `a tabela tem ${linhas.length} ferramentas vigentes e o snapshot tem ${doSnapshot.length}`,
    );
    for (const l of linhas) {
      const base = FERRAMENTAS_BASE[l.chave];
      ok(!!base, `${l.chave} esta na tabela e nao esta no snapshot`);
      if (!base) continue;
      ok(l.efeito === base.efeito, `${l.chave}: tabela=${l.efeito}, snapshot=${base.efeito}`);
      ok(l.setor === base.setor, `${l.chave}: tabela="${l.setor}", snapshot="${base.setor}"`);
    }
    console.log(`conferencia contra a tabela viva: ${linhas.length} linhas`);
  }
} else {
  console.log(
    "sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: conferido snapshot x migration apenas (offline).",
  );
}

if (falhas) {
  console.error(`_prova_efeito_ferramentas: ${falhas} falha(s)`);
  Deno.exit(1);
}
console.log(
  `ok: _prova_efeito_ferramentas (${doSnapshot.length} ferramentas, ${escritas.length} de escrita)`,
);
