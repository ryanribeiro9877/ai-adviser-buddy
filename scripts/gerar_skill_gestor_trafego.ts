// Gera, a partir de supabase/conhecimento/gestor-trafego-meta/*.md:
//   1. a migracao que grava os temas em agent_knowledge (fonte que get_conhecimento le);
//   2. supabase/functions/_shared/doutrina_conteudo.gen.ts — o mesmo texto embutido no codigo,
//      reserva da injecao direta quando a leitura do banco falha.
// Rodar: deno run --allow-read --allow-write scripts/gerar_skill_gestor_trafego.ts
// Os .md sao a fonte. Editou um .md → rode de novo e aplique a migracao.

const raiz = new URL("../supabase/", import.meta.url);
const dir = new URL("conhecimento/gestor-trafego-meta/", raiz);
const MIGRACAO = "20261005150000_skill_gestor_trafego_meta_v2.sql";
const VERIFICADO_EM = "2026-10-05";

type Meta = { tema: string; descricao: string; revalidar_ate: string };
const temas: Meta[] = JSON.parse(await Deno.readTextFile(new URL("temas.json", dir)));

const conteudos: Record<string, string> = {};
for (const t of temas) {
  conteudos[t.tema] = (await Deno.readTextFile(new URL(`${t.tema}.md`, dir))).replace(/\r\n/g, "\n").trim() + "\n";
}

function dolar(s: string, tag: string): string {
  if (s.includes(`$${tag}$`)) throw new Error(`conteudo contem $${tag}$`);
  return `$${tag}$${s}$${tag}$`;
}

const sql: string[] = [
  "-- Skill gestor-trafego-meta v2 (05/10/2026) — GERADO por scripts/gerar_skill_gestor_trafego.ts",
  "-- Fonte: supabase/conhecimento/gestor-trafego-meta/*.md. Nao edite aqui: edite o .md e gere de novo.",
  "--",
  "-- O que muda: a skill local (10 referencias) era mais nova que a importada em 10/09 (8 principios).",
  "-- Entram 9 temas novos de METODO com validade propria e o tema mestre reescrito. Os temas antigos",
  "-- vencidos (otimizacao, metricas, criacao, compliance, api, diagnostico_especialista) NAO tem a",
  "-- data reaberta: o metodo novo nao confirma limiar de plataforma, e os limiares nos temas novos",
  "-- estao escritos como ponto de partida a confirmar.",
  "",
];
for (const t of temas) {
  sql.push(
    `insert into public.agent_knowledge (tema, descricao, conteudo, fonte, verificado_em, revalidar_ate, vigente)`,
    `values (`,
    `  '${t.tema}',`,
    `  ${dolar(t.descricao, "d")},`,
    `  ${dolar(conteudos[t.tema], "conteudo")},`,
    `  'skill gestor-trafego-meta v2 (revisada e importada em 05/10/2026)',`,
    `  date '${VERIFICADO_EM}',`,
    `  date '${t.revalidar_ate}',`,
    `  true`,
    `)`,
    `on conflict (tema) do update set`,
    `  descricao = excluded.descricao,`,
    `  conteudo = excluded.conteudo,`,
    `  fonte = excluded.fonte,`,
    `  verificado_em = excluded.verificado_em,`,
    `  revalidar_ate = excluded.revalidar_ate,`,
    `  vigente = true,`,
    `  updated_at = now();`,
    "",
  );
}
const lista = temas.map((t) => t.tema).filter((t) => t !== "gestor_trafego_meta").join(", ");
sql.push(
  `update public.agent_ferramentas`,
  `   set descricao = ${dolar(`BASE DE CONHECIMENTO TECNICA da casa. Pedido de METODO: comece por tema='gestor_trafego_meta' (mapa de temas). Temas de metodo v2: ${lista}. Historicos (alguns vencidos): otimizacao, metricas, criacao, api, diagnostico_especialista, unidade_economica, compliance. Criativo: criativo_hooks, criativo_formatos, criativo_mecanicas, criativo_voz. Use em pergunta conceitual, de metodo, de politica ou de definicao de metrica.`, "d")},`,
  `       doutrina = ${dolar("Pedido de metodo: leia primeiro tema=gestor_trafego_meta e so depois o tema especifico. Tema extenso volta parcial com o indice das secoes: chame de novo com 'secao' e nao conclua que o assunto nao esta coberto. Tema com validade vencida: use como metodo e declare que o numero de plataforma precisa ser reverificado. compliance_credito so em empresa de credito.", "d")},`,
  `       atualizado_em = now()`,
  ` where chave = 'get_conhecimento';`,
  "",
  `update public.agents`,
  `   set papel = ${dolar("Serve fundamento a quem pedir e responde pela validade da base. Dono da skill mestra gestor_trafego_meta v2 e dos temas de metodo: doutrina_diagnostico, metas_conjuntas, metricas_bases, mecanica_meta, contrato_card, whatsapp_ativos, auditoria_meta, armadilhas_operacao, compliance_credito (so credito), alem dos historicos e da biblioteca de criativo. Declara validade vencida quando o tema passou do revalidar_ate.", "ag")},`,
  `       updated_at = now()`,
  ` where codigo = 'AG-08';`,
  "",
  `update public.agent_context set vigente = false`,
  ` where categoria = 'sistema' and fato like 'SKILL MESTRA GESTOR-TRAFEGO-META (10/09/2026):%';`,
  "",
  `insert into public.agent_context (categoria, fato, vigente, desde, company_id)`,
  `select 'sistema',`,
  `  ${dolar(`SKILL GESTOR-TRAFEGO-META V2 (05/10/2026): metodo revisado no banco (gestor_trafego_meta + ${lista}). Os papeis que escrevem analise recebem as secoes pertinentes direto no prompt; get_conhecimento continua servindo o resto. Limiar de plataforma e ponto de partida a confirmar, nao regra. compliance_credito so em empresa de credito. Escrita so via card.`, "f")},`,
  `  true, date '${VERIFICADO_EM}', null`,
  `where not exists (`,
  `  select 1 from public.agent_context`,
  `  where categoria = 'sistema' and fato like 'SKILL GESTOR-TRAFEGO-META V2 (05/10/2026):%'`,
  `);`,
  "",
);
const corpoSql = sql.join("\n");
await Deno.writeTextFile(new URL(`migrations/${MIGRACAO}`, raiz), corpoSql);
await Deno.writeTextFile(new URL(`espelhos/${MIGRACAO}`, raiz), corpoSql);

const ts = [
  "// GERADO por scripts/gerar_skill_gestor_trafego.ts — nao edite a mao.",
  "// Fonte: supabase/conhecimento/gestor-trafego-meta/*.md (mesmo texto da migracao",
  `// ${MIGRACAO}). Reserva da injecao de doutrina quando a leitura do banco falha.`,
  "",
  `export const DOUTRINA_VERIFICADA_EM = "${VERIFICADO_EM}";`,
  "",
  "export const DOUTRINA_EMBUTIDA: Record<string, { conteudo: string; revalidar_ate: string }> = {",
  ...temas.map((t) => `  ${t.tema}: { revalidar_ate: "${t.revalidar_ate}", conteudo: ${JSON.stringify(conteudos[t.tema])} },`),
  "};",
  "",
].join("\n");
await Deno.writeTextFile(new URL("functions/_shared/doutrina_conteudo.gen.ts", raiz), ts);
console.log(`ok: ${temas.length} temas → migrations/${MIGRACAO} + _shared/doutrina_conteudo.gen.ts`);
