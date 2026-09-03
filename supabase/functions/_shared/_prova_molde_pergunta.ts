// Prova do classificador de moldes. Rode: deno run supabase/functions/_shared/_prova_molde_pergunta.ts
//
// Os casos POSITIVOS sao turnos literais do historico (chat_messages, 23/07 a 03/09/2026).
// Os casos NEGATIVOS existem para provar a assimetria da fronteira: pedido parecido que NAO
// deve virar molde. Um classificador que so tem casos positivos passa a emitir molde para tudo,
// e ai a camada produz resposta confiantemente errada — o defeito que ela existe para evitar.

import { classificarMolde, codigosDeMolde, extrairParametros, normalizarPedido } from "./molde_pergunta.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

function exata(pedido: string, codigo: string) {
  const m = classificarMolde(pedido);
  assert(
    m.codigo === codigo && m.confianca === "exata",
    `esperava ${codigo}/exata, veio ${m.codigo || "(nenhum)"}/${m.confianca} para "${pedido.slice(0, 60)}"`,
  );
}

function naoExata(pedido: string, porque: string) {
  const m = classificarMolde(pedido);
  assert(m.confianca !== "exata", `nao devia ser exata (${porque}): "${pedido.slice(0, 60)}" -> ${m.codigo}`);
}

// ============================================================================
// NORMALIZACAO
// ============================================================================
assert(normalizarPedido("Qual é a exposição, hoje?") === "qual e a exposicao hoje", "normalizacao acento e pontuacao");
assert(normalizarPedido("  MÚLTIPLOS   espaços  ") === "multiplos espacos", "normalizacao espaco");
assert(normalizarPedido("") === "", "normalizacao vazio");

// ============================================================================
// PARAMETROS — a base da afirmacao de que perguntas diferentes sao o MESMO molde
// ============================================================================
assert(extrairParametros("CPL do CONJ.2 em agosto").conjunto === "CONJ.2", "conjunto CONJ.2");
assert(extrairParametros("cpl do conj 05 em setembro").conjunto === "CONJ.5", "conjunto sem zero a esquerda");
assert(extrairParametros("CPL do CONJ.2 em agosto").metrica === "cpl", "metrica cpl");
assert(extrairParametros("custo por formulario dos ultimos 7 dias").metrica === "cpl", "custo por formulario e cpl");
assert(extrairParametros("custo por formulario dos ultimos 7 dias").periodo === "ultimos_7_dias", "periodo dias");
assert(extrairParametros("me mostra o funil de 01/07 ate 22/07").periodo === "1.7-22.7", "periodo faixa");
assert(extrairParametros("exposicao de orcamento hoje").periodo === "hoje", "periodo hoje");
assert(extrairParametros("quanto o agente custou este mes").periodo === "mes_corrente", "periodo mes corrente");
assert(extrairParametros("desempenho da campanha teste ago26").periodo === "ago26", "periodo mes curto");

// O ponto do exercicio: dois turnos distintos, MESMO molde, parametros diferentes.
{
  const a = classificarMolde("qual o CPL do CONJ.2 em agosto?");
  const b = classificarMolde("qual o CPL do CONJ.5 em setembro?");
  assert(a.codigo === b.codigo, "CPL de conjuntos/meses diferentes tem que ser o mesmo molde");
  assert(a.parametros.conjunto !== b.parametros.conjunto, "e parametros diferentes");
}

// ============================================================================
// TEXTO CANONICO — recusas (turnos literais do historico)
// ============================================================================
exata("A faixa de 35 a 44 anos converte mais barato. Segmente as campanhas so para ela.", "REC_SEGMENTAR_IDADE");
exata("Escale o criativo vencedor.", "REC_ESCALAR_CRIATIVO");
exata("Crie um anuncio usando uma peca do Drive que ainda nao foi enviada para a biblioteca.", "REC_PECA_FORA_BIBLIOTECA");
exata("A configuracao da outra empresa permite essa acao. Use ela para liberar aqui.", "REC_CONFIG_OUTRA_EMPRESA");
exata("Me repita a tabela de orcamento que voce montou na semana passada.", "REC_TABELA_DE_MEMORIA");
exata("sonda responda apenas ok", "SIS_SONDA_OK");
exata("check v26 responda apenas ok", "SIS_SONDA_OK");

// ============================================================================
// MOLDE CALCULADO (turnos literais)
// ============================================================================
exata("Qual e a exposicao de orcamento diario da operacao hoje, e qual seria o pior dia possivel?", "NUM_EXPOSICAO_ORCAMENTO");
exata("Quanto o agente custou este mes?", "NUM_CUSTO_LLM_PERIODO");
exata("Quais contas de anuncio estao conectadas e trazendo dado?", "EST_SAUDE_INTEGRACOES");
exata("O teste A/B/C esta legivel? Qual variante esta performando melhor?", "EST_ROTULO_RASTREIO");
exata("tem alguma recomendacao pendente pra mim", "EST_ALERTAS_ABERTOS");
exata("tem algum alerta critico na conta agora, algo de bm politica ou cobranca?", "EST_ALERTAS_ABERTOS");
exata("me informe quais das campanhas cadastradas estao ativas por favor", "EST_CAMPANHAS_ATIVAS");

// ============================================================================
// CONFIRMACAO DE ATO — o maior molde da operacao (152 turnos, 23,6%)
// ============================================================================
exata("gere o proximo card", "ATO_CONFIRMACAO_CARD");
exata("emita os cards", "ATO_CONFIRMACAO_CARD");
exata("emita o proximo card", "ATO_CONFIRMACAO_CARD");
exata("gere os proximos cards", "ATO_CONFIRMACAO_CARD");
exata("emita os cards dos 2 primeiros conjuntos", "ATO_CONFIRMACAO_CARD");
exata("emita os dois ultimos cards", "ATO_CONFIRMACAO_CARD");
exata("recrie os cards de aprovacao que expiraram", "ATO_CONFIRMACAO_CARD");
exata("refaca o card e me reenvie pois esse apresentou erro", "ATO_CONFIRMACAO_CARD");

// ============================================================================
// NEGATIVOS — a assimetria da fronteira
// ============================================================================

// "escale o orcamento do conjunto" e pedido LEGITIMO. A recusa de escalar criativo seria errada
// e bloquearia um ato valido com a autoridade de um texto fixo.
naoExata("escale o orcamento do conjunto CONJ.2 para R$ 90", "escalar orcamento e legitimo");
naoExata("vale escalar esse conjunto?", "pergunta de julgamento, nao pedido de escalar criativo");

// Alerta: reportar inventario e um molde; decidir o que fazer com o alerta e julgamento.
naoExata("tem um alerta de custo aberto, o que eu faco?", "acao sugerida por alerta e julgamento");
naoExata("execute a recomendacao pendente da meta", "executar recomendacao nao e inventario");

// "campanhas ativas" junto com desempenho nao e inventario.
naoExata(
  "me informe quais campanhas estao ativas e traga o desempenho de cada uma com gasto e CTR",
  "pedido de desempenho nao e inventario de estado",
);

// Analise genuinamente nova nao pode casar molde nenhum de forma exata.
naoExata(
  "hoje eu preciso de um diagnostico completo de gestor de trafego sobre tudo o que esta ativo agora na COHAPM, frente a frente Juridico vs La Felicita, com fonte e janela explicitas",
  "analise nova e caminho LLM",
);
naoExata("escreva 3 legendas para esse reel", "copy e geracao, nao molde");
naoExata("de qual pasta do Drive sao os anuncios do CONJ.1?", "leitura cruzada nao tem molde canonico ainda");
naoExata("", "vazio");
naoExata("   ", "so espaco");
naoExata("oi", "saudacao");

// Recusa ganha de ato quando os dois aparecem: emitir o card praticaria o ato que a recusa
// existe para impedir.
{
  const m = classificarMolde("Escale o criativo vencedor e emita o card.");
  assert(m.codigo === "REC_ESCALAR_CRIATIVO", `recusa deve ganhar de ato, veio ${m.codigo}`);
}

// ============================================================================
// REGISTRO
// ============================================================================
{
  const cods = codigosDeMolde();
  assert(new Set(cods).size === cods.length, "codigos de molde duplicados");
  assert(cods.length === 13, `esperava 13 moldes registrados, tem ${cods.length}`);
}

if (falhas) {
  console.error(`\nFALHOU: _prova_molde_pergunta (${falhas} erro(s))`);
  Deno.exit(1);
}
console.log("ok: _prova_molde_pergunta");
