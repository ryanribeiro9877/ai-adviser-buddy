// Prova das regras puras da memoria aprendida (sem rede, sem banco).
//
// O que esta prova defende: os pontos onde a memoria pode contaminar ou mentir. Isolamento entre
// empresas e linhas (tem de concordar com o trigger guard_agent_aprendizados_isolamento), evidencia
// conferida contra o texto real, dado volatil recusado e o cabecalho de precedencia sempre presente.
// Rodar: deno run --no-code-cache --allow-read --allow-env <este arquivo>

import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";
import {
  AVISO_FALHA_APRENDIZADOS,
  CABECALHO_APRENDIZADOS,
  chaveNormalizada,
  conferirEvidencia,
  conferirIsolamento,
  ehDadoVolatil,
  formatarBlocoAprendizados,
  idCurto,
  LIMITE_CHAT,
  LIMITE_OUTROS,
  linhasDaEmpresa,
  linhasDaTarefa,
  MAX_PREFERENCIAS,
  normalizarTexto,
  PREFIXO_REVISAO_CURADORIA,
  resolverLinha,
  rotuloLinha,
  sinalDeCorrecao,
  TETO_CHARS_CHAT,
  TETO_CHARS_OUTROS,
  TETO_REGISTROS_DIA,
  TETO_REGISTROS_TURNO,
  TRECHO_MINIMO_CHARS,
  validarPedidoRegistro,
} from "./aprendizados_regras.ts";
import type { AprendizadoLinha, TurnoAprendizado } from "./aprendizados_regras.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Terceira empresa do cadastro ("Cooperativa_ Cohapm"): nao e a COHAPM nem a Legal.
const COOPERATIVA = "307849e6-78a7-4217-8112-3fb0a924f988";
const UUID = "ab12cd34-0000-4000-8000-000000000001";

// --- 1) Constantes e textos literais ------------------------------------------------------------
assert(
  CABECALHO_APRENDIZADOS ===
    "MEMÓRIA APRENDIDA (registrada pelos agentes desta casa; dado fresco, regra de conformidade e memória curada vencem esta — se contradizer, diga e corrija com corrigir_aprendizado):",
  "cabecalho literal",
);
assert(
  AVISO_FALHA_APRENDIZADOS === "memória aprendida indisponível neste turno; não afirme que não há aprendizado",
  "aviso de falha literal",
);
assert(PREFIXO_REVISAO_CURADORIA === "pedido de revisao de curadoria: ", "prefixo da revisao de curadoria");
assert(
  TETO_REGISTROS_TURNO === 3 && TETO_REGISTROS_DIA === 30 && LIMITE_CHAT === 8 && LIMITE_OUTROS === 5 &&
    TETO_CHARS_CHAT === 4000 && TETO_CHARS_OUTROS === 2500 && MAX_PREFERENCIAS === 5,
  "constantes de teto",
);

// --- 2) Normalizacao, chave e id curto ----------------------------------------------------------
assert(normalizarTexto("  Ação,  COHAPM_Jurídico!! ") === "acao cohapm juridico", "normaliza acento, pontuacao e espacos");
assert(normalizarTexto("") === "" && normalizarTexto("?!") === "", "vazio e so pontuacao");
assert(normalizarTexto("12,5%") !== normalizarTexto("125%"), "pontuacao entre digitos nao junta numeros");
assert(chaveNormalizada("a".repeat(400)).length === 300, "chave corta em 300");
assert(chaveNormalizada("Fato COM Acento, ação!") === "fato com acento acao", "chave normalizada");
assert(idCurto(UUID) === "ab12cd", "id curto = 6 primeiros hex");
assert(/^[0-9a-f]{6}$/.test(idCurto(crypto.randomUUID())), "id curto de uuid real");

// --- 3) Dado volatil ----------------------------------------------------------------------------
assert(ehDadoVolatil("CPL de ontem foi R$ 12"), "cpl de ontem e volatil");
assert(ehDadoVolatil("gasto dos ultimos 7 dias passou de R$ 900"), "janela e volatil");
assert(ehDadoVolatil("Resultados de 12/10: 45 conversas"), "data dd/mm e volatil");
assert(ehDadoVolatil("o CTR caiu 30% esta semana"), "percentual na semana e volatil");
assert(!ehDadoVolatil("o gestor prefere ver custo por conversa antes do CPL"), "preferencia nao e volatil");
assert(!ehDadoVolatil("a campanha COHAPM_JURIDICO_V2 e a continuacao da V1"), "fato da conta nao e volatil");
assert(!ehDadoVolatil("o gestor quer ver o gasto de hoje sempre antes do CPL"), "sem numero nao e volatil");
assert(!ehDadoVolatil("o conjunto 3 usa a copy longa"), "numero sem tempo e sem metrica nao e volatil");

// --- 4) Isolamento (espelha o trigger) ----------------------------------------------------------
assert(!conferirIsolamento("seguir o padrao da Legal e Viver", COMPANY_COHAPM, []).ok, "cohapm nao cita legal");
assert(
  eq(conferirIsolamento("seguir o padrao da Legal e Viver", COMPANY_COHAPM, []), { ok: false, motivo: "cita_outra_empresa" }),
  "motivo de empresa",
);
assert(!conferirIsolamento("usar o tom do consignado CLT", COMPANY_COHAPM, []).ok, "cohapm nao cita consignado clt");
assert(!conferirIsolamento("o time LEV usa tabela", COMPANY_COHAPM, []).ok, "cohapm nao cita LEV");
assert(conferirIsolamento("o levantamento semanal usa tabela", COMPANY_COHAPM, []).ok, "levantamento nao e LEV");
assert(!conferirIsolamento("tom da La Felicita", COMPANY_LEGAL, []).ok, "legal nao cita la felicita");
assert(!conferirIsolamento("tom da LaFelicità", COMPANY_LEGAL, []).ok, "legal nao cita lafelicita com acento");
assert(!conferirIsolamento("a COHAPM prefere tabela", COMPANY_LEGAL, []).ok, "legal nao cita cohapm");
assert(conferirIsolamento("a cooperativa COHAPM atende servidores", COOPERATIVA, []).ok, "cooperativa pode citar cohapm");
assert(!conferirIsolamento("tom da La Felicita", COOPERATIVA, []).ok, "cooperativa nao cita la felicita");
assert(!conferirIsolamento("tom da lafelicita", COOPERATIVA, []).ok, "cooperativa nao cita lafelicita");
assert(!conferirIsolamento("padrao Legal e Viver", COOPERATIVA, []).ok, "cooperativa nao cita legal");
assert(conferirIsolamento("a La Felicità vende imovel", COMPANY_COHAPM, []).ok, "cohapm pode citar a propria linha");
assert(!conferirIsolamento("conta act_999999999", COMPANY_COHAPM, ["act_111111111"]).ok, "act alheio recusado");
assert(
  eq(conferirIsolamento("conta act_999999999", COMPANY_COHAPM, ["act_111111111"]), { ok: false, motivo: "cita_conta_alheia" }),
  "motivo de conta",
);
assert(conferirIsolamento("conta act_111111111", COMPANY_COHAPM, ["act_111111111"]).ok, "act proprio com prefixo passa");
assert(conferirIsolamento("conta act_111111111", COMPANY_COHAPM, ["111111111"]).ok, "act proprio sem prefixo passa");
assert(!conferirIsolamento("conta act_111111111", COMPANY_COHAPM, []).ok, "sem contas cadastradas qualquer act e alheio");
assert(conferirIsolamento("o gestor prefere tabela", COMPANY_COHAPM, []).ok, "texto limpo passa");

// --- 5) Linhas da empresa -----------------------------------------------------------------------
assert(eq(linhasDaEmpresa(COMPANY_COHAPM), ["la_felicita", "juridico", "sistema_ocular"]), "linhas da cohapm");
assert(eq(linhasDaEmpresa(COMPANY_LEGAL), []) && eq(linhasDaEmpresa(COOPERATIVA), []), "demais sem linhas");
assert(rotuloLinha("la_felicita") === "La Felicità", "rotulo la felicita");
assert(rotuloLinha("juridico") === "Jurídico", "rotulo juridico");
assert(rotuloLinha("sistema_ocular") === "Sistema Ocular", "rotulo sistema ocular");
assert(rotuloLinha(null) === "Geral", "rotulo nulo");

// --- 6) resolverLinha ---------------------------------------------------------------------------
assert(eq(resolverLinha(COMPANY_COHAPM, "a copy do Juridico usa conta de luz", null), { ok: true, linha: "juridico" }), "linha do texto");
assert(!resolverLinha(COMPANY_COHAPM, "La Felicita e Juridico usam o mesmo CTA", null).ok, "duas linhas recusa");
assert(
  eq(resolverLinha(COMPANY_COHAPM, "La Felicita e Juridico usam o mesmo CTA", null), { ok: false, motivo: "registre um aprendizado por linha" }),
  "motivo de duas linhas",
);
assert(!resolverLinha(COMPANY_COHAPM, "a copy do Juridico usa conta de luz", "la_felicita").ok, "divergencia recusa");
assert(eq(resolverLinha(COMPANY_COHAPM, "a copy do Juridico usa conta de luz", "juridico"), { ok: true, linha: "juridico" }), "mesma linha confirma");
assert(eq(resolverLinha(COMPANY_COHAPM, "o gestor prefere tabela", null), { ok: true, linha: null }), "sem linha vale empresa");
assert(eq(resolverLinha(COMPANY_COHAPM, "o gestor prefere tabela", "sistema_ocular"), { ok: true, linha: "sistema_ocular" }), "sem linha no texto vale a do modelo");
assert(eq(resolverLinha(COMPANY_COHAPM, "o gestor prefere tabela", "Jurídico"), { ok: true, linha: "juridico" }), "linha do modelo tolera acento e caixa");
assert(!resolverLinha(COMPANY_COHAPM, "o gestor prefere tabela", "financeiro").ok, "linha fora da lista recusa");
assert(eq(resolverLinha(COMPANY_LEGAL, "o gestor prefere tabela", "juridico"), { ok: true, linha: null }), "empresa sem linhas ignora");
assert(eq(resolverLinha(COOPERATIVA, "a copy do Juridico usa conta de luz", null), { ok: true, linha: null }), "empresa sem linhas nao classifica");
// Concordancia com o trigger: a regra 3 olha mais padroes do que o classificador de linha.
// "juridica" nao e detectado como linha (so "juridico"), mas o trigger recusa com linha != juridico.
assert(
  eq(resolverLinha(COMPANY_COHAPM, "a assessoria juridica pede tabela", "la_felicita"), { ok: false, motivo: "cita_outra_linha" }),
  "trigger recusaria: juridic com linha la_felicita",
);
assert(
  eq(resolverLinha(COMPANY_COHAPM, "a copy do Vistta usa tabela de oculos", "sistema_ocular"), { ok: true, linha: "sistema_ocular" }),
  "vistta e marca da propria linha sistema_ocular",
);
assert(!resolverLinha(COMPANY_COHAPM, "o oculos de grau pede tabela", "juridico").ok, "oculos com linha juridico recusa");

// --- 7) linhasDaTarefa --------------------------------------------------------------------------
assert(eq(linhasDaTarefa(COMPANY_COHAPM, "compare La Felicita e Juridico"), ["la_felicita", "juridico"]), "duas linhas na tarefa");
assert(eq(linhasDaTarefa(COMPANY_COHAPM, "como esta o juridico?"), ["juridico"]), "uma linha na tarefa");
assert(linhasDaTarefa(COMPANY_COHAPM, "como esta a conta?") === null, "sem linha definida");
assert(eq(linhasDaTarefa(COMPANY_COHAPM, "qualquer", "sistema_ocular"), ["sistema_ocular"]), "linha fixa vence");
assert(eq(linhasDaTarefa(COMPANY_COHAPM, "compare La Felicita e Juridico", "juridico"), ["juridico"]), "linha fixa vence a inferencia");
assert(linhasDaTarefa(COMPANY_LEGAL, "compare La Felicita e Juridico") === null, "empresa sem linhas nao tem linha");
assert(linhasDaTarefa(COMPANY_LEGAL, "qualquer", "juridico") === null, "linha fixa de empresa sem linhas e ignorada");

// --- 8) Evidencia conferida ---------------------------------------------------------------------
const turno: TurnoAprendizado = {
  companyId: COMPANY_COHAPM,
  agente: "AG-00",
  superficie: "chat",
  conversationId: "11111111-1111-4111-8111-111111111111",
  jobId: null,
  falasDoGestor: ["A partir de agora, me mostre custo por conversa antes do CPL."],
  retornos: [{ tool: "get_funnel", retorno: { base: "conversas", por_formulario: 12 } }],
  registrosNoTurno: 0,
};
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "me mostre custo por conversa" }, "confirmada", turno).ok, "trecho literal aceito");
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "ME MOSTRE, custo por  conversa" }, "confirmada", turno).ok, "trecho aceito apesar de caixa e pontuacao");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "prefiro sempre custo por conversa" }, "confirmada", turno).ok, "parafrase recusada");
assert(
  eq(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "prefiro sempre custo por conversa" }, "confirmada", turno), { ok: false, motivo: "cite a fala exata" }),
  "motivo da parafrase",
);
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "  " }, "confirmada", turno).ok, "trecho vazio recusado");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "?!" }, "confirmada", turno).ok, "trecho so de pontuacao recusado");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "me mostre custo por conversa" }, "confirmada", { ...turno, falasDoGestor: [] }).ok, "sem fala nenhuma recusa");
assert(conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "base conversas", ferramenta: "get_funnel" }, "observada", turno).ok, "retorno que rodou aceito");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "base conversas", ferramenta: "get_overview" }, "observada", turno).ok, "ferramenta que nao rodou recusada");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "total de leads", ferramenta: "get_funnel" }, "observada", turno).ok, "trecho que nao esta no retorno recusado");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "base conversas" }, "observada", turno).ok, "retorno sem nome da ferramenta recusado");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "base conversas", ferramenta: "get_funnel" }, "confirmada", turno).ok, "confirmada exige fala do gestor");
assert(conferirEvidencia({ tipo: "resultado_de_ato", trecho: "por formulario", ferramenta: "get_funnel" }, "observada", turno).ok, "resultado de ato confere no retorno da ferramenta");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "me mostre custo" }, "certa", turno).ok, "confianca invalida recusada");
assert(
  !conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "retorno vazio aqui", ferramenta: "x" }, "observada", {
    ...turno,
    retornos: [{ tool: "x", retorno: undefined }],
  }).ok,
  "retorno nao serializavel nao serve de evidencia",
);

// Trecho trivial nao pode ser evidencia: "a" esta em qualquer fala e "ver" esta dentro de "diversos".
// Sem isso qualquer fato inventado vira "confirmada" (anti-objetivo 2 da spec).
const turnoTrivial: TurnoAprendizado = {
  ...turno,
  falasDoGestor: ["Como esta o custo hoje? Vamos ver diversos conjuntos."],
  retornos: [{ tool: "get_funnel", retorno: { base: "conversas", por_formulario: 12, descricao: "conversas iniciadas" } }],
};
assert(TRECHO_MINIMO_CHARS === 12, "trecho minimo = 12 chars");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "a" }, "confirmada", turnoTrivial).ok, "trecho a recusado");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "ver" }, "confirmada", turnoTrivial).ok, "trecho ver recusado");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "e", ferramenta: "get_funnel" }, "observada", turnoTrivial).ok, "trecho e no retorno recusado");
assert(
  eq(
    conferirEvidencia({ tipo: "fala_do_gestor", trecho: "ver" }, "confirmada", turnoTrivial),
    { ok: false, motivo: "cite um trecho maior da fala ou do retorno, com pelo menos 12 caracteres" },
  ),
  "motivo do trecho curto",
);
// Fronteira de palavra, isolada do tamanho: 21 chars, presentes como substring ("ver diversos conjunto"
// esta dentro de "ver diversos conjuntos"), mas terminam no meio de uma palavra.
assert(
  !conferirEvidencia({ tipo: "fala_do_gestor", trecho: "ver diversos conjunto" }, "confirmada", turnoTrivial).ok,
  "fala: trecho que termina no meio da palavra recusado",
);
assert(
  conferirEvidencia({ tipo: "fala_do_gestor", trecho: "ver diversos conjuntos" }, "confirmada", {
    ...turnoTrivial,
    falasDoGestor: ["Vamos ver diversos conjuntos"],
  }).ok,
  "fala: trecho de palavras inteiras aceito",
);
assert(
  !conferirEvidencia({ tipo: "fala_do_gestor", trecho: "amos ver diversos" }, "confirmada", {
    ...turnoTrivial,
    falasDoGestor: ["Vamos ver diversos conjuntos"],
  }).ok,
  "fala: trecho que comeca no meio da palavra recusado",
);
assert(
  !conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "conversas inicia", ferramenta: "get_funnel" }, "observada", turnoTrivial).ok,
  "retorno: trecho que termina no meio da palavra recusado",
);
assert(
  conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "conversas iniciadas", ferramenta: "get_funnel" }, "observada", turnoTrivial).ok,
  "retorno: palavras inteiras aceitas",
);
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "me mostre custo por conversa" }, "confirmada", turno).ok, "literal continua aceito");
// 11 recusa, 12 aceita (ambos presentes na fala, com fronteira de palavra).
const turnoBorda: TurnoAprendizado = { ...turno, falasDoGestor: ["Quero o custo total e o custo diario sempre"] };
assert(normalizarTexto("custo total").length === 11 && normalizarTexto("custo diario").length === 12, "borda: 11 e 12 chars");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "custo total" }, "confirmada", turnoBorda).ok, "trecho de 11 chars recusado");
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "custo diario" }, "confirmada", turnoBorda).ok, "trecho de 12 chars aceito");
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "Custo, DIARIO!" }, "confirmada", turnoBorda).ok, "o tamanho conta depois de normalizar");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "custo, total!!!" }, "confirmada", turnoBorda).ok, "pontuacao nao enche o minimo");

// --- 9) Sinal de correcao -----------------------------------------------------------------------
assert(sinalDeCorrecao("o custo subiu? e a partir de agora me mostre custo por conversa"), "sinal no meio da leitura");
assert(sinalDeCorrecao("nao e assim, esse conjunto e do juridico"), "correcao");
assert(sinalDeCorrecao("Não é assim, está errado"), "correcao com acento e caixa");
assert(sinalDeCorrecao("nunca mande mensagem depois das 20h"), "nunca");
assert(sinalDeCorrecao("eu prefiro tabela"), "prefiro");
assert(sinalDeCorrecao("nao use mais o termo gratis"), "nao use mais");
assert(!sinalDeCorrecao("como esta o custo hoje?"), "leitura pura sem sinal");
assert(!sinalDeCorrecao(""), "mensagem vazia sem sinal");
assert(!sinalDeCorrecao("o lembrete de segunda ficou bom"), "lembrete nao e lembre");

// --- 10) Pedido de registro ---------------------------------------------------------------------
const pedidoOk = {
  fato: "o gestor prefere ver custo por conversa antes do CPL",
  contexto: "dito no chat de 12/10",
  categoria: "preferencia_do_gestor",
  evidencia: { tipo: "fala_do_gestor", trecho: "me mostre custo por conversa" },
  confianca: "confirmada",
};
const v = validarPedidoRegistro(pedidoOk);
assert(v.ok && v.pedido.fato === pedidoOk.fato && v.pedido.categoria === "preferencia_do_gestor", "pedido valido passa");
assert(!validarPedidoRegistro({ fato: "curto", contexto: "x", categoria: "correcao", evidencia: { tipo: "fala_do_gestor", trecho: "a" }, confianca: "confirmada" }).ok, "fato < 20 chars");
assert(!validarPedidoRegistro({ ...pedidoOk, fato: "x".repeat(601) }).ok, "fato > 600 chars");
assert(!validarPedidoRegistro({ ...pedidoOk, contexto: "x".repeat(1501) }).ok, "contexto > 1500 chars");
assert(!validarPedidoRegistro({ ...pedidoOk, categoria: "opiniao" }).ok, "categoria invalida");
assert(!validarPedidoRegistro({ ...pedidoOk, confianca: "certeza" }).ok, "confianca invalida");
assert(!validarPedidoRegistro({ ...pedidoOk, evidencia: { tipo: "palpite", trecho: "x" } }).ok, "tipo de evidencia invalido");
assert(!validarPedidoRegistro({ ...pedidoOk, evidencia: { tipo: "fala_do_gestor", trecho: "   " } }).ok, "trecho vazio");
const vCurto = validarPedidoRegistro({ ...pedidoOk, evidencia: { tipo: "fala_do_gestor", trecho: "custo total" } });
assert(
  !vCurto.ok && vCurto.motivo === "cite um trecho maior da fala ou do retorno, com pelo menos 12 caracteres",
  "trecho de 11 chars normalizados recusado com motivo legivel",
);
assert(
  !validarPedidoRegistro({ ...pedidoOk, evidencia: { tipo: "retorno_de_ferramenta", trecho: "custo, total!!!", ferramenta: "get_funnel" } }).ok,
  "pontuacao nao enche o minimo do trecho",
);
assert(
  validarPedidoRegistro({ ...pedidoOk, evidencia: { tipo: "retorno_de_ferramenta", trecho: "custo diario", ferramenta: "get_funnel" } }).ok,
  "trecho de 12 chars normalizados aceito na forma",
);
assert(!validarPedidoRegistro({ ...pedidoOk, evidencia: undefined }).ok, "sem evidencia");
assert(!validarPedidoRegistro(null).ok && !validarPedidoRegistro("texto").ok && !validarPedidoRegistro([]).ok, "entrada que nao e objeto");
assert(!validarPedidoRegistro({ ...pedidoOk, valido_ate: "dezembro" }).ok, "valido_ate fora do formato");
assert(!validarPedidoRegistro({ ...pedidoOk, valido_ate: "2026-02-30" }).ok, "valido_ate com data impossivel");
assert(validarPedidoRegistro({ ...pedidoOk, valido_ate: "2026-12-31", linha: null }).ok, "valido_ate valido e linha nula");
const vSemContexto = validarPedidoRegistro({ ...pedidoOk, contexto: undefined });
assert(vSemContexto.ok && vSemContexto.pedido.contexto === "", "contexto ausente vira vazio");
const vEspacos = validarPedidoRegistro({ ...pedidoOk, fato: `   ${pedidoOk.fato}   ` });
assert(vEspacos.ok && vEspacos.pedido.fato === pedidoOk.fato, "fato sai aparado");

// --- 11) Bloco para o prompt --------------------------------------------------------------------
const umaLinha: AprendizadoLinha = {
  id: UUID,
  categoria: "preferencia_do_gestor",
  fato: "o gestor prefere ver custo por conversa antes do CPL",
  linha: "juridico",
  agente_codigo: "AG-00",
  confianca: "confirmada",
  confirmacoes: 3,
  criado_em: "2026-10-12T15:00:00+00:00",
};
const bloco = formatarBlocoAprendizados([umaLinha], { tetoChars: 2500, comLinha: true });
assert(bloco.startsWith(CABECALHO_APRENDIZADOS), "cabecalho com precedencia sempre");
assert(/\[#[0-9a-f]{6} \| preferencia_do_gestor \| Jurídico \| AG-00, \d{2}\/\d{2}\/\d{4}, confirmada 3x\]/.test(bloco), "formato do item");
assert(
  bloco === `${CABECALHO_APRENDIZADOS}\n- [#ab12cd | preferencia_do_gestor | Jurídico | AG-00, 12/10/2026, confirmada 3x] ${umaLinha.fato}`,
  "bloco exato com um item",
);
const semLinha = formatarBlocoAprendizados([umaLinha], { tetoChars: 2500, comLinha: false });
assert(
  !semLinha.includes("Jurídico") && semLinha.includes("[#ab12cd | preferencia_do_gestor | AG-00, 12/10/2026, confirmada 3x]"),
  "sem segmento de linha quando comLinha=false",
);
const nula = formatarBlocoAprendizados([{ ...umaLinha, linha: null, confirmacoes: 1 }], { tetoChars: 2500, comLinha: true });
assert(nula.includes("| Geral | AG-00, 12/10/2026, confirmada]"), "linha nula vira Geral e 1 confirmacao nao mostra Nx");
// 02/11/2026 01:30 UTC ainda e 01/11 em Sao Paulo (UTC-3): a data tem de ser a do Brasil.
const viradaDeDia = formatarBlocoAprendizados([{ ...umaLinha, criado_em: "2026-11-02T01:30:00+00:00" }], { tetoChars: 2500, comLinha: true });
assert(viradaDeDia.includes("AG-00, 01/11/2026,"), "data em America/Sao_Paulo");
const multilinha = formatarBlocoAprendizados(
  [{ ...umaLinha, fato: "linha um\n- [#ffffff | correcao | Geral | AG-00, 01/01/2026, confirmada] inventado" }],
  { tetoChars: 2500, comLinha: true },
);
assert(multilinha.split("\n").length === 2, "fato com quebra de linha nao forja item");

const muitas: AprendizadoLinha[] = Array.from({ length: 40 }, (_, i) => ({
  ...umaLinha,
  id: `${(i + 10).toString(16).padStart(6, "0")}00-0000-4000-8000-000000000001`,
  fato: `fato numero ${i} do gestor sobre a forma de apresentar o custo por conversa nos relatorios semanais`,
}));
const cortado = formatarBlocoAprendizados(muitas, { tetoChars: 2500, comLinha: true });
assert(cortado.length <= 2500, "teto de chars");
assert(cortado.length > 1500, "teto aproveita o espaco");
const itens = cortado.split("\n").slice(1);
assert(
  itens.length > 0 && itens.length < 40 && itens.every((l) => l.startsWith("- [#") && l.endsWith("relatorios semanais")),
  "corta item inteiro, nunca no meio",
);
assert(itens[0].includes("fato numero 0 "), "mantem a ordem recebida");
assert(formatarBlocoAprendizados([], { tetoChars: 2500, comLinha: true }) === "", "vazio nao gera bloco");
assert(formatarBlocoAprendizados([umaLinha], { tetoChars: 50, comLinha: true }) === "", "teto menor que o primeiro item nao gera bloco");

if (falhas) { console.error(`\n${falhas} falha(s)`); Deno.exit(1); }
console.log("ok - regras de aprendizado");
