// Prova: deno run --allow-read supabase/functions/_shared/_prova_fatos_da_leitura.ts
// Dados: coleta real do job dee35d98 (La Felicità, 02/10 → 05/10/2026, 107 conv/dia a R$ 7,00).
import { analiseDeReserva, blocoFatosParaLeitura, fatosDeDetalhe } from "./fatos_da_leitura.ts";
import { extrairCriteriosDoPedido } from "./intencao_turno.ts";
import { lerStreamOpenRouter } from "./openrouter_stream.ts";

function assert(c: unknown, m: string) {
  if (!c) throw new Error(`FALHOU: ${m}`);
}

type D = [string, number, number];
const ad = (nome: string, conjunto: string, dias: D[]) => ({
  nome,
  conjunto,
  status: "ACTIVE",
  conjunto_status: "ACTIVE",
  serie_diaria: dias.map(([dia, gasto, conversas]) => ({
    dia,
    gasto: `R$ ${gasto.toFixed(2)}`,
    impressoes: 1,
    conversas,
    ...(dia === "2026-10-05" ? { dia_parcial: true } : {}),
  })),
});
const C1 = "CONJ.1", C2 = "CONJ.2", C3 = "CONJ.3", C4 = "CONJ.4";
const det = {
  campanha: { nome: "COHAPM_LAFELICITA_ENGAJ_TOFU_2026-10", status: "ACTIVE" },
  conjuntos: [
    { nome: C1, status: "ACTIVE", orcamento_diario_reais: 300 },
    { nome: C4, status: "ACTIVE", orcamento_diario_reais: 110 },
    { nome: C3, status: "ACTIVE", orcamento_diario_reais: 150 },
    { nome: C2, status: "ACTIVE", orcamento_diario_reais: 190 },
  ],
  anuncios: [
    ad("AD_C1_ENTRANDO_LA_FELICITA", C1, [["2026-10-02", 50.53, 1], ["2026-10-03", 95.54, 1], ["2026-10-04", 180.95, 6], ["2026-10-05", 143.26, 5]]),
    ad("AD_C1_SETEMBRO_02", C1, [["2026-10-03", 117.56, 7], ["2026-10-04", 67.10, 1], ["2026-10-05", 13.52, 1]]),
    ad("AD_C1_SETEMBRO_05", C1, [["2026-10-03", 26.61, 2], ["2026-10-04", 14.73, 0], ["2026-10-05", 11.67, 1]]),
    ad("AD_C1_SETEMBRO_08", C1, [["2026-10-02", 3.90, 1], ["2026-10-03", 7.33, 2], ["2026-10-04", 4.99, 0], ["2026-10-05", 3.01, 0]]),
    ad("AD_C2_SETEMBRO_09", C1, [["2026-10-03", 9.17, 0], ["2026-10-04", 6.82, 0], ["2026-10-05", 3.13, 1]]),
    ad("AD_C1_SETEMBRO_04", C1, [["2026-10-03", 3.96, 1], ["2026-10-04", 5.12, 1], ["2026-10-05", 4.12, 0]]),
    ad("AD_C3_AGOSTO_10", C3, [["2026-10-02", 36.70, 8], ["2026-10-03", 130.76, 7], ["2026-10-04", 140.95, 11], ["2026-10-05", 75.29, 4]]),
    ad("AD_C3_SETEMBRO_07", C3, [["2026-10-02", 10.75, 0], ["2026-10-03", 3.13, 0], ["2026-10-04", 1.37, 0], ["2026-10-05", 0.92, 0]]),
    ad("AD_C4_PISCINA", C4, [["2026-10-02", 9.06, 2], ["2026-10-03", 75.65, 4], ["2026-10-04", 96.03, 2], ["2026-10-05", 48.86, 3]]),
    ad("AD_C4_NOITE", C4, [["2026-10-02", 3.25, 2], ["2026-10-03", 21.05, 0], ["2026-10-04", 11.53, 0], ["2026-10-05", 1.46, 0]]),
    ad("AD_C2_FUTEVOLEI", C2, [["2026-10-02", 6.18, 0], ["2026-10-03", 41.81, 1], ["2026-10-04", 81.56, 7], ["2026-10-05", 57.34, 1]]),
    ad("AD_C2_SETEMBRO_12", C2, [["2026-10-02", 5.25, 0], ["2026-10-03", 78.49, 1], ["2026-10-04", 49.33, 1], ["2026-10-05", 9.95, 0]]),
    ad("AD_C2_SETEMBRO_03", C2, [["2026-10-02", 3.57, 0], ["2026-10-03", 48.58, 2], ["2026-10-04", 56.03, 1], ["2026-10-05", 12.68, 1]]),
  ],
};

const f = fatosDeDetalhe(det, true);
assert(f, "fatos saem da coleta com serie");
const c = f!.campanhaLinha;
assert(c.fechados.length === 3, `3 dias fechados (${c.fechados.length})`);
assert(c.aberto?.dia === "2026-10-05", "05/10 fica em aberto");
const totalConv = c.dias.reduce((s, d) => s + d.conversas, 0);
assert(totalConv === 89, `soma bate com o total da coleta: ${totalConv}`);
assert(c.conversasFechado === 72, `72 conversas nos fechados (${c.conversasFechado})`);
assert(Math.abs(c.mediaDia - 24) < 1e-9, `media 24/dia (${c.mediaDia})`);
assert(f!.orcamentoDiaTotal === 750, `orcamento somado 750 (${f!.orcamentoDiaTotal})`);
assert(c.custoFechado! > 7, "custo da campanha estoura o teto");
const c3 = f!.conjuntos.find((x) => x.nome === C3)!;
assert(c3.conversasFechado === 26, `conj.3 com 26 conversas fechadas (${c3.conversasFechado})`);
const s02 = f!.criativos.find((x) => x.nome === "AD_C1_SETEMBRO_02")!;
assert(s02.fechados.length === 2 && s02.fechados[0].dia === "2026-10-03", "criativo conta a partir da estreia");
assert(s02.tendencia === "caindo", `SETEMBRO_02 caindo (${s02.tendencia})`);
const ent = f!.criativos.find((x) => x.nome === "AD_C1_ENTRANDO_LA_FELICITA")!;
assert(ent.tendencia === "subindo", `ENTRANDO subindo (${ent.tendencia})`);
const noite = f!.criativos.find((x) => x.nome === "AD_C4_NOITE")!;
assert(noite.tendencia === "caindo", `NOITE caindo (${noite.tendencia})`);
const s12 = f!.criativos.find((x) => x.nome === "AD_C2_SETEMBRO_12")!;
assert(s12.tendencia === "estavel", `0 -> 1 conversa nao e subida (${s12.tendencia})`);

const crit = extrairCriteriosDoPedido(
  "preciso atingir 107 conversas por dia, sendo que o teto limite de cada conversa gerada é 7,00 (no máximo). tendência dos criativos",
);
const bloco = blocoFatosParaLeitura([f!], crit);
assert(bloco.includes("FATOS CALCULADOS"), "bloco rotulado");
assert(bloco.includes("meta 107/dia"), "criterio 1 no bloco");
assert(bloco.includes("R$ 749,00/dia"), "conta 107 x 7 = 749");
assert(bloco.includes("05/10*"), "dia aberto marcado");
const reserva = analiseDeReserva([f!], crit);
assert(reserva.includes("Critério 1 — 107 conversas/dia"), "reserva responde criterio 1");
assert(reserva.includes("Critério 2"), "reserva responde criterio 2");
assert(reserva.includes("ESTOURA o teto"), "reserva declara estouro");
assert(!reserva.includes("| Conjunto |"), "reserva nao e a tabela");
assert(reserva.includes("AD_C3_AGOSTO_10"), "quem segura o volume pelo nome");
assert(reserva.includes("custo por conversa SUBIU junto"), "volume subindo com custo subindo e declarado");

// Stream: texto parcial sobrevive ao corte do relogio.
const enc = new TextEncoder();
const ac = new AbortController();
const corpo = new ReadableStream<Uint8Array>({
  start(ctrl) {
    ctrl.enqueue(enc.encode(": OPENROUTER PROCESSING\n\n"));
    ctrl.enqueue(enc.encode('data: {"model":"x-ai/grok-4.7","choices":[{"delta":{"content":"## Veredito\\n"}}]}\n\n'));
    ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Estagnado."}}]}\n'));
    setTimeout(() => {
      ac.abort();
      ctrl.error(new DOMException("aborted", "AbortError"));
    }, 20);
  },
});
const lido = await lerStreamOpenRouter(corpo, ac.signal);
assert(lido.cortado, "corte detectado");
assert(lido.content === "## Veredito\nEstagnado.", `parcial preservado: ${JSON.stringify(lido.content)}`);
assert((lido.parsed.choices as any)[0].finish_reason === "timeout_parcial", "finish parcial");

const inteiro = new ReadableStream<Uint8Array>({
  start(ctrl) {
    ctrl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'));
    ctrl.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n'));
    ctrl.close();
  },
});
const ok = await lerStreamOpenRouter(inteiro);
assert(!ok.cortado && ok.content === "ok", "stream inteiro");
assert((ok.parsed.usage as any).prompt_tokens === 10, "usage do ultimo chunk");

const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
assert(job.includes("analiseDeReserva(fatos, criterios)"), "job usa a analise de reserva");
assert(job.includes("stream: true"), "leitura em streaming");
assert(!/secoes: \["Diagnosticar"/.test(job), "metodo nao pede secao inexistente");

console.log(reserva);
console.log("\nok fatos_da_leitura + openrouter_stream");
