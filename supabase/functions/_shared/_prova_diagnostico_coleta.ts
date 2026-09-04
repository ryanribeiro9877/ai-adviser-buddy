// Prova do instrumento de coleta do modo profundo.
//
// O que esta prova defende NAO e a existencia dos campos — e a capacidade de DISTINGUIR. O
// diagnostico anterior falhou duas vezes por instrumento cego: "encerrou sozinho" e "morreu de
// relogio" chegavam com o mesmo rotulo, e coleta era medida por comprimento de saida (que ja foi
// medido como ruido do modelo). Entao o que tem de ficar vermelho aqui e:
//
//   1. motivo de saida voltar a se confundir com finish_reason do provider;
//   2. o piso VOLTAR — isto e, uma chamada sair com mais tempo do que a reserva autorizou;
//   3. a fidelidade passar a premiar comprimento em vez de conteudo conferivel;
//   4. relatorio que FALHOU voltar a entrar no denominador do aproveitamento.
//
// O item 2 mudou de sentido em 04/09/2026 com os itens (b) e (c). Antes ele defendia que o piso
// fosse DECLARADO como piso; agora defende que ele nao exista, porque chamada no piso teve 0 de 4
// sucessos medidos e queimava parede antes de abortar. O que substitui e a parada honesta.

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

// --- 1) TETO POR CHAMADA: parada honesta no lugar do piso ------------------------------------
//
// Parametros reais do deep no segmento 1: teto de provider 150s, reserva 195s (150s de sintese +
// 45s de reinvocacao, que ali ainda pode ocorrer) e minimo de 45s. `prazo()` comeca em ~260s
// (270s por invocacao - 10s de reserva final).
const P = { tetoProviderMs: 150_000, reservaMs: 195_000, minimoMs: 45_000 };

const inicio = tetoDaChamadaMs({ prazoMs: 260_000, ...P });
assert(inicio.ms === 65_000, `no inicio da coleta o teto deveria ser 65s, veio ${inicio.ms}`);
assert(inicio.viavel, "65s autorizados sao chamada viavel");

// ITEM (b): a MESMA coleta, no ultimo segmento ou em tier que nunca reinvoca, nao paga o pedagio
// de reinvocacao. E o mesmo instante do relogio; muda so a reserva — e a pista salta de 65s para
// 110s. Se esta linha ficar vermelha, os 45s voltaram a ser cobrados de quem nao vai reinvocar.
const semReinvocacao = tetoDaChamadaMs({ prazoMs: 260_000, ...P, reservaMs: 150_000 });
assert(semReinvocacao.ms === 110_000, `sem reinvocacao possivel o teto e 110s, veio ${semReinvocacao.ms}`);
assert(
  semReinvocacao.ms - inicio.ms === 45_000,
  "o item (b) tem de devolver exatamente os 45s do pedagio que nao vai ser cobrado",
);

// FRONTEIRA EXATA: a reserva autoriza exatamente o minimo. Ainda emite — o minimo e o que precisa
// ser autorizado, nao o que precisa ser excedido.
const fronteira = tetoDaChamadaMs({ prazoMs: 240_000, ...P });
assert(fronteira.autorizado_ms === 45_000, "na fronteira a reserva autoriza exatamente 45s");
assert(fronteira.viavel && fronteira.ms === 45_000, "minimo autorizado no limite ainda e chamada real");

// AQUI ESTAVA O DEFEITO. Um milissegundo abaixo do minimo, o codigo antigo emitia a chamada com o
// piso de 20s; agora ela nao sai. Nao ha "chamada pequena": ha chamada ou parada.
const abaixo = tetoDaChamadaMs({ prazoMs: 239_999, ...P });
assert(!abaixo.viavel, "abaixo do minimo a chamada NAO pode ser emitida");
assert(abaixo.ms === 0, `chamada recusada nao recebe timeout, veio ${abaixo.ms}`);
assert(abaixo.autorizado_ms === 44_999, "a recusa continua dizendo de quanto a coleta ficou devendo");

// O caso literal que a medicao de 04/09 viu abortar em `openrouter_timeout_20000`: 15s autorizados
// saindo como 20s de chamada. Hoje ele para, e o relogio que sobra fica para a escrita.
const exPiso = tetoDaChamadaMs({ prazoMs: 210_000, ...P });
assert(exPiso.autorizado_ms === 15_000, `a reserva autorizava 15s, veio ${exPiso.autorizado_ms}`);
assert(!exPiso.viavel && exPiso.ms === 0, "15s autorizados nao viram mais uma chamada de 20s");

const negativo = tetoDaChamadaMs({ prazoMs: 150_000, ...P });
assert(negativo.autorizado_ms === -45_000, `reserva deveria autorizar -45s, veio ${negativo.autorizado_ms}`);
assert(!negativo.viavel && negativo.ms === 0, "orcamento negativo nao emite chamada nenhuma");

/**
 * ITEM (c), O QUE ELE DE FATO COMPRA: a coleta para ENQUANTO a escrita ainda cabe.
 *
 * Parar por parar nao preservaria nada. O laco de coleta soma `CHAMADA_MINIMA_MS` a reserva depois
 * da primeira ferramenta (`guardarEscrita`), justamente para que, quando ele parar, a escrita de
 * salvamento — que reserva so o basico — ainda tenha orcamento. E este par que transforma coleta
 * paga em relatorio em vez de perde-la.
 */
const coletaComEscritaGuardada = tetoDaChamadaMs({ prazoMs: 260_000, ...P, reservaMs: 195_000 + 45_000 });
assert(!coletaComEscritaGuardada.viavel, "com escrita guardada, esta chamada de coleta nao sai");
const escritaDepoisDaParada = tetoDaChamadaMs({ prazoMs: 260_000, ...P });
assert(
  escritaDepoisDaParada.viavel && escritaDepoisDaParada.ms === 65_000,
  "DEFEITO CENTRAL DO ITEM (c): a coleta parou e a escrita de salvamento ficou sem orcamento",
);

// A parede global (480s) NAO era quem produzia o piso — era o teto por invocacao. Com 470s de
// prazo o teto e o do provider, cheio. Se esta linha ficar vermelha, alguem mexeu na reserva.
const paredeCheia = tetoDaChamadaMs({ prazoMs: 470_000, ...P });
assert(paredeCheia.ms === 150_000 && paredeCheia.viavel, "com parede cheia o teto e o do provider");

// INVARIANTE QUE O PISO VIOLAVA, e a unica linha que precisa ficar de pe se todo o resto mudar:
// nenhuma chamada emitida recebe mais tempo do que a reserva autorizou.
for (const t of [inicio, semReinvocacao, fronteira, paredeCheia, escritaDepoisDaParada]) {
  assert(t.ms <= t.autorizado_ms, `chamada de ${t.ms}ms com ${t.autorizado_ms}ms autorizados: o piso voltou`);
}

const resumo = resumirTetos([inicio, fronteira, exPiso, negativo, paredeCheia]);
assert(resumo.chamadas === 3, `resumo deveria contar 3 chamadas emitidas, contou ${resumo.chamadas}`);
assert(resumo.recusadas === 2, `resumo deveria contar 2 chamadas recusadas, contou ${resumo.recusadas}`);
// min/max olham so as emitidas: incluir o zero da recusa faria `min_ms` marcar 0 e sugerir chamada
// instantanea onde nao houve chamada.
assert(resumo.min_ms === 45_000, `min das emitidas deveria ser 45s, veio ${resumo.min_ms}`);
assert(resumo.max_ms === 150_000, `max das emitidas deveria ser 150s, veio ${resumo.max_ms}`);
const soRecusadas = resumirTetos([exPiso, negativo]);
assert(
  soRecusadas.chamadas === 0 && soRecusadas.min_ms === null,
  "execucao que nao emitiu chamada nenhuma nao pode reportar teto minimo",
);
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
console.log("ok - diagnostico da coleta (parada honesta sem piso, motivo de saida limpo, fidelidade por conteudo)");
