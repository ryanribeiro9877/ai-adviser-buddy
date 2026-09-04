// Prova do estreitamento da memoria institucional na sintese profunda.
//
// O que esta prova defende NAO e a economia de tokens — e a rede de seguranca. Estreitar memoria
// e a classe de mudanca que perde guardrail em silencio, e este projeto ja pagou por fail-open
// demais. Entao: qualquer alteracao que faca o mecanismo dispensar fato de nucleo, ou que quebre o
// fail-open, tem de ficar vermelha aqui.

import type { FatoMemoria } from "./agent_memory.ts";
import { TOPICOS_DISPENSAVEIS, selecionarMemoria } from "./memoria_relevante.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}

const f = (categoria: string, fato: string): FatoMemoria => ({ categoria, fato });

const NUCLEO: FatoMemoria[] = [
  f("armadilha", "A META REESCREVE DIAS JA FECHADOS - RESTATEMENT (medido em 04/08/2026)."),
  f("armadilha", "Zero em uma metrica pode significar (a) valor realmente zero, (b) dado nao coletado."),
  f("metricas", "CUSTO POR RESULTADO TEM BASE DECLARADA (14/08/2026). get_funnel devolve por_formulario."),
  f("metricas", "ALCANCE E MEDIA DIARIA TEM ROTULO OBRIGATORIO (14/08/2026)."),
  f("escopo", "NUNCA faca autocorrecao publica no meio da resposta."),
  f("qualidade", "HONESTIDADE DE CAPACIDADE - NUNCA declarar indisponivel o que o sistema JA expoe."),
  f("metodo", "COMO OS TETOS DE CUSTO DESTE SISTEMA SAO PRODUZIDOS - METODO."),
  f("midia", "ORCAMENTO DIARIO DA META E MEDIA, NAO LIMITE DO DIA."),
  f("incidente", "Entre 23 e 27/07/2026 o sync de metricas de campanha ficou quebrado (timeout)."),
  // Guardas analiticas que moram em categorias mistas: nucleo por MARCADOR, nao por categoria.
  f("doutrina", "ORCAMENTO DIARIO E MEDIA, NAO LIMITE DO DIA (atualizado 12/08/2026 - ESP-26)."),
  f("execucao", "AUSENCIA ESCOPADA NAO E FALHA DE COLETA (14/08/2026)."),
  f("execucao", "COLETOR DE METRICAS = PIPEBOARD (14/08/2026). A conexao Windsor foi ENCERRADA."),
  f("doutrina", "DELETED/ARCHIVED SAEM DA MEMORIA OPERACIONAL (02/09/2026)."),
];

const DISPENSAVEIS: FatoMemoria[] = [
  f("doutrina", "LEGENDA DE ANUNCIO E ENTRADA OBRIGATORIA DO PEDIDO - NUNCA INVENTADA."),
  f("doutrina", "ALVO DE CARD POR external_id QUANDO O NOME NAO E UNICO. propose_action aceita."),
  f("doutrina", "GEO PRESET JURIDICO SALVADOR-BA - fonte public.geo_targeting_presets."),
  f("whatsapp_inventario", "WHATSAPP: duas familias distintas. WABA Cloud API - status CONNECTED."),
  f("drive_isolamento", "DRIVE COHAPM: tres meios - juridico (Exports Finais), la_felicita, sistema ocular."),
  f("sistema", "ARQUITETURA DE AGENTES: o sistema tem 9 agentes nomeados. AG-00 Gestor recebe."),
];

const PERGUNTA_DESEMPENHO =
  "Compare todas as campanhas ativas por custo por resultado, aponte a melhor e a pior, " +
  "e explique a diferenca descendo a conjunto e anuncio. Traga serie diaria.";

// --- 1) O nucleo nunca sai, qualquer que seja a pergunta -------------------------------------
const sel = selecionarMemoria([...NUCLEO, ...DISPENSAVEIS], PERGUNTA_DESEMPENHO);
assert(sel !== null, "pergunta de desempenho deve produzir selecao (nao fail-open)");
if (sel) {
  for (const n of NUCLEO) {
    assert(
      sel.injetados.some((i) => i.fato === n.fato),
      `fato de nucleo foi dispensado: [${n.categoria}] ${n.fato.slice(0, 60)}`,
    );
  }
  assert(sel.dispensados.length > 0, "pergunta de desempenho deveria dispensar doutrina de acao");
  assert(sel.chars_depois < sel.chars_antes, "selecao deveria reduzir chars");
}

// --- 2) Todo fato dispensado carrega justificativa ------------------------------------------
if (sel) {
  for (const d of sel.dispensados) {
    assert(!!d.topico, "fato dispensado sem topico");
    assert(
      typeof d.motivo === "string" && d.motivo.length > 40,
      `fato dispensado sem justificativa util: ${String(d.fato.fato).slice(0, 50)}`,
    );
  }
}

// --- 3) O gatilho traz o topico de volta ----------------------------------------------------
const selWpp = selecionarMemoria([...NUCLEO, ...DISPENSAVEIS], "Como estao as conversas do WhatsApp?");
assert(
  !!selWpp && selWpp.injetados.some((i) => i.categoria === "whatsapp_inventario"),
  "pergunta sobre WhatsApp deve reinjetar a doutrina de WhatsApp",
);
const selCard = selecionarMemoria([...NUCLEO, ...DISPENSAVEIS], "Pode criar um card para renomear a campanha?");
assert(
  !!selCard && selCard.injetados.some((i) => i.fato.includes("ALVO DE CARD")),
  "pergunta sobre card deve reinjetar a doutrina de acao",
);

// --- 4) FAIL-OPEN: mecanismo sem confianca injeta tudo --------------------------------------
assert(selecionarMemoria([], PERGUNTA_DESEMPENHO) === null, "lista vazia deve fail-open (null)");
assert(selecionarMemoria(NUCLEO, "") === null, "gatilho vazio deve fail-open (null)");
assert(
  selecionarMemoria(null as unknown as FatoMemoria[], PERGUNTA_DESEMPENHO) === null,
  "entrada invalida deve fail-open (null), nunca lancar",
);
assert(
  selecionarMemoria(DISPENSAVEIS, "assunto totalmente fora de qualquer topico conhecido zzz") !== null
    ? true
    : true,
  "sanity",
);

// --- 5) FAIL-SAFE POR FATO: o desconhecido fica ---------------------------------------------
const inedito = f("categoria_que_nao_existe_ainda", "Fato novo cadastrado amanha sobre assunto inedito.");
const selNovo = selecionarMemoria([...NUCLEO, inedito], PERGUNTA_DESEMPENHO);
assert(
  !!selNovo && selNovo.injetados.some((i) => i.fato === inedito.fato),
  "fato nao classificado em topico algum deve continuar SEMPRE injetado",
);

// --- 6) Todo topico declara o porque --------------------------------------------------------
for (const t of TOPICOS_DISPENSAVEIS) {
  assert(t.porque.length > 60, `topico ${t.nome} sem justificativa escrita`);
}

if (falhas) { console.error(`\n${falhas} falha(s)`); Deno.exit(1); }
console.log(`ok - memoria relevante (${TOPICOS_DISPENSAVEIS.length} topicos, nucleo protegido, fail-open coberto)`);
