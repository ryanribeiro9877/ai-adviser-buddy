// Prova: deno run --allow-read supabase/functions/_shared/_prova_doutrina_agentes.ts
// Cobra o raciocinio e o encanamento (cada papel recebe as secoes certas, credito so em credito,
// fonte e espelho iguais), nao um texto congelado.
import {
  baseEmbutida,
  blocoDoutrina,
  carregarBaseDoutrina,
  DOUTRINA_POR_PAPEL,
  montarDoutrina,
  type PapelDoutrina,
  TEMAS_DA_DOUTRINA,
} from "./doutrina_agentes.ts";
import { DOUTRINA_EMBUTIDA } from "./doutrina_conteudo.gen.ts";

function assert(c: unknown, m: string) {
  if (!c) throw new Error(`FALHOU: ${m}`);
}

const base = baseEmbutida("2026-10-05");
const papeis = Object.keys(DOUTRINA_POR_PAPEL) as PapelDoutrina[];

// 1. Todo recorte do mapa existe na skill (com credito ligado, para cobrir os soCredito).
for (const p of papeis) {
  const d = montarDoutrina(base, p, { credito: true });
  assert(d.faltando.length === 0, `${p}: secoes inexistentes ${d.faltando.join(", ")}`);
  assert(d.texto.length > 0, `${p}: doutrina vazia`);
  assert(d.texto.length <= DOUTRINA_POR_PAPEL[p].teto + 50, `${p}: estourou o teto (${d.texto.length})`);
}

// 2. Credito so em credito.
const compNao = montarDoutrina(base, "compliance", { credito: false });
assert(!compNao.secoes.some((s) => s.startsWith("compliance_credito")), "COHAPM nao recebe compliance de credito");
assert(compNao.secoes.some((s) => s.startsWith("armadilhas_operacao")), "par peca+copy vale para todos");
assert(blocoDoutrina(base, "legendas", { credito: false }) === "", "legenda nao-credito sem doutrina de credito");
assert(montarDoutrina(base, "compliance", { credito: true }).secoes.some((s) => s.startsWith("compliance_credito")), "credito recebe");

// 3. Papeis que antes nao recebiam nada agora recebem o essencial.
const sint = montarDoutrina(base, "sintese").secoes.join("|");
assert(/Hierarquia/.test(sint) && /Anti-alucina/.test(sint) && /Recomenda/.test(sint), `sintese: ${sint}`);
const leit = montarDoutrina(base, "leitura").secoes.join("|");
assert(/metas_conjuntas\/Conta de viabilidade/.test(leit), "leitura recebe a conta de viabilidade");
assert(/Tend[eê]ncia com janela curta/.test(leit), "leitura recebe tendencia em janela curta");
const sent = montarDoutrina(base, "sentinela").secoes.join("|");
assert(/Manter mexer ou matar/.test(sent), "sentinela recebe manter/mexer/matar");
assert(/Recomenda/.test(montarDoutrina(base, "reco").secoes.join("|")), "reco recebe as cinco partes");
assert(/Campos obrigat/.test(montarDoutrina(base, "ritmo").secoes.join("|")), "ritmo recebe contrato do card");

// 4. Validade vencida aparece como aviso, nao some.
const futuro = baseEmbutida("2027-02-01");
assert(futuro.get("mecanica_meta")?.vencido === true, "mecanica vence antes");
assert(blocoDoutrina(futuro, "estrutura").includes("validade vencida"), "aviso de validade no bloco");

// 5. Banco vence o embutido; erro do banco cai no embutido.
const fakeOk = {
  from: () => ({
    select: () => ({
      eq: () => ({
        in: () => Promise.resolve({
          data: [{ tema: "metas_conjuntas", conteudo: "# x\n\n## Conta de viabilidade\nVERSAO DO BANCO", revalidar_ate: "2027-04-05" }],
          error: null,
        }),
      }),
    }),
  }),
};
const doBanco = await carregarBaseDoutrina(fakeOk, "2026-10-05");
assert(doBanco.get("metas_conjuntas")?.origem === "banco", "banco sobrepoe");
assert(montarDoutrina(doBanco, "leitura").texto.includes("VERSAO DO BANCO"), "texto do banco chega ao papel");
assert(doBanco.get("doutrina_diagnostico")?.origem === "embutida", "tema ausente no banco usa o embutido");
const fakeErro = { from: () => ({ select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: "x" } }) }) }) }) };
assert((await carregarBaseDoutrina(fakeErro)).size === Object.keys(DOUTRINA_EMBUTIDA).length, "erro do banco nao apaga doutrina");

// 6. Espelho embutido = fonte .md (gerador rodado) e migracao cobre todos os temas.
const dir = new URL("../../conhecimento/gestor-trafego-meta/", import.meta.url);
const temas: { tema: string }[] = JSON.parse(await Deno.readTextFile(new URL("temas.json", dir)));
for (const { tema } of temas) {
  const md = (await Deno.readTextFile(new URL(`${tema}.md`, dir))).replace(/\r\n/g, "\n").trim() + "\n";
  assert(DOUTRINA_EMBUTIDA[tema]?.conteudo === md, `${tema}: espelho desatualizado — rode scripts/gerar_skill_gestor_trafego.ts`);
}
for (const t of TEMAS_DA_DOUTRINA) assert(DOUTRINA_EMBUTIDA[t], `tema do mapa sem fonte: ${t}`);
const mig = await Deno.readTextFile(new URL("../../migrations/20261005150000_skill_gestor_trafego_meta_v2.sql", import.meta.url));
for (const { tema } of temas) assert(mig.includes(`'${tema}',`), `migracao sem ${tema}`);

// 7. Encanamento nos consumidores.
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
for (const trecho of [
  'doutrina("sintese"', 'doutrina("coordenacao")', 'doutrina("relatorio")', 'doutrina("ritmo")',
  "PAPEL_DO_SUBAGENTE[nome]", '"leitura", {', "alertas_recomendacoes: \"sentinela\"",
]) assert(job.includes(trecho), `job sem ${trecho}`);
assert(!job.includes("secao Diagnosticar"), "mapa fixo antigo de temas saiu do subagente");
const reco = await Deno.readTextFile(new URL("../traffic-reco-job/index.ts", import.meta.url));
assert(reco.includes('"reco")'), "reco-job injeta doutrina");
const vigia = await Deno.readTextFile(new URL("./correcao_custo_passe.ts", import.meta.url));
assert(vigia.includes('blocoDoutrina(base, "vigia")'), "vigia de regua injeta doutrina");
const comp = await Deno.readTextFile(new URL("../compliance-check/index.ts", import.meta.url));
assert(/ehCredito\s*\?\s*blocoDoutrina/.test(comp), "compliance-check so em credito");
const leg = await Deno.readTextFile(new URL("../gerar-legendas/index.ts", import.meta.url));
assert(/ehCredito\s*\?\s*blocoDoutrina/.test(leg), "gerar-legendas so em credito");

for (const p of papeis) console.log(`${p.padEnd(12)} ${String(montarDoutrina(base, p, { credito: true }).texto.length).padStart(6)} chars`);
console.log("ok doutrina_agentes");
