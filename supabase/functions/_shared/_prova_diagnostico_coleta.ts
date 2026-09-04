// Prova do instrumento de coleta do modo profundo.
//
// O que esta prova defende NAO e a existencia dos campos — e a capacidade de DISTINGUIR. O
// diagnostico anterior falhou duas vezes por instrumento cego: "encerrou sozinho" e "morreu de
// relogio" chegavam com o mesmo rotulo, e coleta era medida por comprimento de saida (que ja foi
// medido como ruido do modelo). Entao o que tem de ficar vermelho aqui e:
//
//   1. motivo de saida voltar a se confundir com finish_reason do provider;
//   2. o piso do teto por chamada deixar de ser declarado como piso;
//   3. a fidelidade passar a premiar comprimento em vez de conteudo conferivel;
//   4. relatorio que FALHOU voltar a entrar no denominador do aproveitamento.

import {
  ancorasVerificaveis,
  ehSaidaPorRelogio,
  ehSaidaVoluntaria,
  fidelidadeDaColeta,
  janelaLivre,
  resumirTetos,
  tetoDaChamadaMs,
} from "./diagnostico_coleta.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}

// --- 1) TETO POR CHAMADA: a aritmetica medida em 04/09 tem de continuar reproduzivel ---------
//
// Parametros reais do deep: teto de provider 150s, reserva 195s (150s sintese + 45s reinvocacao),
// piso 20s. `prazo()` comeca em ~260s (270s por invocacao - 10s de reserva final).
const P = { tetoProviderMs: 150_000, reservaMs: 195_000, pisoMs: 20_000 };

const inicio = tetoDaChamadaMs({ prazoMs: 260_000, ...P });
assert(inicio.ms === 65_000, `no inicio da coleta o teto deveria ser 65s, veio ${inicio.ms}`);
assert(!inicio.no_piso, "teto de 65s nao e piso");

const meio = tetoDaChamadaMs({ prazoMs: 230_000, ...P });
assert(meio.ms === 35_000, `aos 30s de coleta o teto deveria ser 35s, veio ${meio.ms}`);
assert(!meio.no_piso, "teto de 35s nao e piso");

// FRONTEIRA EXATA: com 215s de prazo a reserva autoriza exatamente 20s. Ainda NAO e piso — e o
// ultimo instante em que o teto concedido e um teto de verdade. Isso acontece aos 45s de coleta.
const fronteira = tetoDaChamadaMs({ prazoMs: 215_000, ...P });
assert(fronteira.ms === 20_000, `na fronteira o teto e 20s, veio ${fronteira.ms}`);
assert(fronteira.autorizado_ms === 20_000, "na fronteira a reserva autoriza exatamente 20s");
assert(!fronteira.no_piso, "20s autorizados nao sao piso: a reserva concedeu esse tempo");

// AQUI ESTA O ACHADO: passada a fronteira, o teto NAO cai abaixo de 20s nem sobe nunca mais —
// toda chamada seguinte sai no piso, com mais tempo do que a reserva autoriza. Foram essas as
// chamadas que a medicao de 04/09 viu abortar em `openrouter_timeout_20000`.
const colapso = tetoDaChamadaMs({ prazoMs: 210_000, ...P });
assert(colapso.ms === 20_000, `depois da fronteira o teto fica travado em 20s, veio ${colapso.ms}`);
assert(colapso.autorizado_ms === 15_000, `a reserva autorizava 15s, veio ${colapso.autorizado_ms}`);
assert(colapso.no_piso, "teto de 20s com 15s autorizados TEM de ser declarado como piso");

const negativo = tetoDaChamadaMs({ prazoMs: 150_000, ...P });
assert(negativo.autorizado_ms === -45_000, `reserva deveria autorizar -45s, veio ${negativo.autorizado_ms}`);
assert(negativo.ms === 20_000 && negativo.no_piso, "orcamento negativo tem de sair no piso E declarar");

// A parede global (480s) NAO e quem produz o piso — e o teto por invocacao. Com 470s de prazo o
// teto e o do provider, cheio. Se algum dia esta linha ficar vermelha, alguem mexeu na reserva.
const paredeCheia = tetoDaChamadaMs({ prazoMs: 470_000, ...P });
assert(paredeCheia.ms === 150_000 && !paredeCheia.no_piso, "com parede cheia o teto e o do provider");

const resumo = resumirTetos([inicio, meio, fronteira, colapso, negativo]);
assert(resumo.chamadas === 5, "resumo deveria contar 5 chamadas");
assert(resumo.no_piso === 2, `resumo deveria achar 2 chamadas no piso, achou ${resumo.no_piso}`);
assert(resumo.min_ms === 20_000 && resumo.max_ms === 65_000, "resumo deveria dar min 20s e max 65s");
const vazio = resumirTetos([]);
assert(vazio.chamadas === 0 && vazio.min_ms === null, "resumo de lista vazia nao deve inventar numero");

// --- 2) MOTIVO DE SAIDA: voluntario e SO voluntario -----------------------------------------
assert(ehSaidaVoluntaria("voluntario"), "voluntario e voluntario");
for (const m of ["reserva_sintese", "prazo_do_job", "erro_llm", "iteracoes_esgotadas", "resposta_vazia"] as const) {
  assert(!ehSaidaVoluntaria(m), `${m} NAO pode contar como encerramento voluntario`);
}
assert(!ehSaidaVoluntaria(null) && !ehSaidaVoluntaria(undefined), "ausencia de motivo nao e voluntaria");
for (const m of ["reserva_sintese", "prazo_do_job", "erro_llm"] as const) {
  assert(ehSaidaPorRelogio(m), `${m} e saida por relogio`);
}
assert(!ehSaidaPorRelogio("voluntario"), "voluntario nao e saida por relogio");
assert(!ehSaidaPorRelogio("iteracoes_esgotadas"), "iteracoes esgotadas nao e relogio, e teto de laco");

// --- 3) ANCORAS: numero significativo entra, ruido nao --------------------------------------
const a = ancorasVerificaveis("Gasto R$ 1.234,56 em 18.470 impressoes, CTR 2,41%, custo 12,47.");
assert(a.numeros.has("1234.56"), "dinheiro brasileiro deveria normalizar para 1234.56");
assert(a.numeros.has("18470"), "18.470 deveria normalizar para 18470");
assert(a.numeros.has("2.41") && a.numeros.has("12.47"), "decimais de 2 casas sao ancoras");

// Numero de 1-2 digitos fica FORA: casaria por acidente e inflaria o aproveitamento.
const triviais = ancorasVerificaveis("temos 3 campanhas, 12 anuncios e 0 conversas");
assert(triviais.numeros.size === 0, `1-2 digitos nao sao ancora, veio ${[...triviais.numeros]}`);

// Data tambem fica fora: aparece nos dois lados por construcao (contrato do pedido).
const datas = ancorasVerificaveis("janela 2026-09-01 a 2026-09-04, medido em 04/09/2026");
assert(datas.numeros.size === 0, `data nao e ancora de coleta, veio ${[...datas.numeros]}`);

// Entidade: nomenclatura da conta entra; rotulo do arcabouco nao.
const ent = ancorasVerificaveis("=== RELATORIO criativos [COMPLETO] ===\nJURIDICO_CONJ.01 da COHAPM. LACUNAS: nenhuma");
assert(ent.entidades.has("JURIDICO_CONJ.01"), "nome de conjunto deveria ser ancora");
assert(ent.entidades.has("COHAPM"), "sigla da casa deveria ser ancora");
for (const ruido of ["RELATORIO", "COMPLETO", "LACUNAS", "NENHUMA"]) {
  assert(!ent.entidades.has(ruido), `${ruido} e rotulo de formato, nao dado coletado`);
}

// --- 4) FIDELIDADE: mede conteudo, nunca comprimento ---------------------------------------
const rel = [{
  nome: "desempenho_campanhas",
  relatorio: "JURIDICO_CONJ.01 gastou R$ 1.234,56 com 18.470 impressoes e CTR 2,41%. "
    + "LA_FELICITA_CONJ.02 gastou R$ 987,00 com 5.120 impressoes.",
}];

// Resposta CURTA que cita os numeros: aproveitamento alto. Se a metrica olhasse comprimento,
// esta resposta seria julgada pior que a longa e vaga abaixo — e e o contrario.
const curtaFiel = "JURIDICO_CONJ.01: R$ 1.234,56 / 18.470 impressoes / CTR 2,41%. LA_FELICITA_CONJ.02: R$ 987,00 / 5.120.";
const fCurta = fidelidadeDaColeta(rel, curtaFiel);
assert(fCurta.aproveitamento === 1, `resposta curta e fiel deveria dar 1, deu ${fCurta.aproveitamento}`);

// Resposta LONGA e vaga, sem numero nenhum: aproveitamento zero, apesar de ser muito maior.
const longaVaga = "Analisando o desempenho das campanhas ao longo da janela, observa-se que os "
  + "resultados apresentam variacao relevante entre os conjuntos, com oportunidades de "
  + "otimizacao em entrega e criativo, recomendando-se acompanhamento continuo do pacing.".repeat(3);
const fLonga = fidelidadeDaColeta(rel, longaVaga);
assert(fLonga.aproveitamento === 0, `resposta longa sem dado deveria dar 0, deu ${fLonga.aproveitamento}`);
assert(longaVaga.length > curtaFiel.length, "sanity: a vaga e mesmo a mais longa");
assert(
  fCurta.aproveitamento > fLonga.aproveitamento,
  "DEFEITO CENTRAL: a metrica voltou a premiar comprimento em vez de conteudo",
);
assert(fLonga.ausentes_amostra.length > 0, "o que a resposta nao citou tem de ficar listado");

// Parcial: metade dos numeros chega.
const parcial = fidelidadeDaColeta(rel, "JURIDICO_CONJ.01 gastou R$ 1.234,56 em 18.470 impressoes, CTR 2,41%.");
assert(
  parcial.aproveitamento > 0 && parcial.aproveitamento < 1,
  `resposta parcial deveria ficar entre 0 e 1, deu ${parcial.aproveitamento}`,
);
assert(parcial.entidades.coletadas === 2 && parcial.entidades.na_resposta === 1, "1 de 2 entidades citadas");

// --- 5) ESPECIALISTA QUE FALHOU SAI DO DENOMINADOR -----------------------------------------
//
// Cobrar da sintese o que ninguem leu daria aproveitamento baixo por motivo errado — e foi
// justamente confundir falha com coleta que produziu o relato errado de "coleta completa".
const comFalha = fidelidadeDaColeta([
  ...rel,
  { nome: "criativos", relatorio: "(subagente criativos falhou: openrouter_timeout_20000)", erro: "openrouter_timeout_20000" },
], curtaFiel);
assert(comFalha.aproveitamento === 1, `relatorio que falhou nao pode derrubar o aproveitamento, deu ${comFalha.aproveitamento}`);
assert(comFalha.relatorios_ignorados.includes("criativos"), "a exclusao tem de ser auditavel, nunca silenciosa");
assert(comFalha.por_especialista.length === 1, "especialista que falhou nao entra no detalhe por especialista");

// Nada medivel nao vira zero: zero significaria "a sintese ignorou a coleta", e nao houve coleta.
const semNada = fidelidadeDaColeta([{ nome: "x", relatorio: "(falhou)", erro: "timeout" }], "qualquer resposta");
assert(semNada.aproveitamento === -1, "sem relatorio valido o aproveitamento e -1 (nao medivel), nao 0");
assert(fidelidadeDaColeta([], "").aproveitamento === -1, "lista vazia nao e aproveitamento zero");

// --- 6) JANELA: a hipotese que morreu tem de ficar consultavel ------------------------------
const jan = janelaLivre(8_604, 500_000);
assert(jan.livre_tokens === 491_396, `janela livre deveria ser 491.396, veio ${jan.livre_tokens}`);
assert(jan.ocupacao < 0.02, `entrada da sintese ocupa <2% da janela, veio ${jan.ocupacao}`);
// Mesmo a entrada de ANTES do estreitamento (21.205) cabia folgada: liberar janela nao destravou
// coleta porque janela nunca foi o recurso escasso.
assert(janelaLivre(21_205, 500_000).ocupacao < 0.05, "a entrada antiga tambem ocupava <5% da janela");
assert(janelaLivre(600_000, 500_000).livre_tokens === 0, "entrada acima do contexto nao gera janela negativa");

if (falhas) { console.error(`\n${falhas} falha(s)`); Deno.exit(1); }
console.log("ok - diagnostico da coleta (piso do teto declarado, motivo de saida limpo, fidelidade por conteudo)");
