// PROVA DA VERIFICACAO POS-RESPOSTA.
// Roda com: deno run --allow-all supabase/functions/_shared/_prova_verificacao_pos_resposta.ts
//
// ============================================================================
// POR QUE ESTA PROVA E ESCRITA AO CONTRARIO DAS OUTRAS
// ============================================================================
//
// A maioria das provas deste repositorio afirma que o codigo faz o que deve. Esta afirma duas
// coisas, e a segunda e a que importa:
//
//   (A) cada caminho de falha produz `nao_conferido`, e NUNCA `conferido`;
//   (B) o portao esta VIVO — existe um caso que TEM de ser pego, e se ele passar, a prova cai.
//
// (B) e o CONTROLE POSITIVO, e ele esta aqui por causa de um episodio concreto. Em 03/09/2026,
// apurando risco no audio dos videos da COHAPM, a comparacao foi escrita lendo
// `resultado->>'aprovado'` — chave que nao existe em retorno algum do compliance. Toda leitura
// deu NULL, NULL foi lido como "sem risco", e a conclusao a um passo de ser reportada era "o
// audio nao adiciona risco", baseada em nada. O que desmentiu foi um texto que TINHA de ser
// barrado e nao foi. Sem esse controle, o achado teria sido enterrado por uma chave escrita
// errado — e as tres conferencias deste arquivo sao exatamente a mesma forma de codigo.
//
// Um verificador morto passa em todo teste de "nao acuse falso". So o controle positivo o mata.

import {
  conferirApprovalIds,
  approvalIdsInexistentes,
} from "./aprovacoes.ts";
import {
  conferirContratoDoPedido,
  conferirCobertura,
  conferirIdentificadores,
  envelopesDosRetornos,
  escopoDaVerificacao,
  linhaDeVerificacao,
  MARCA_DO_AVISO_DE_ID,
  MARCA_DO_ENVELOPE,
  verificarAntesDeResponder,
  vereditoDe,
} from "./verificacao_pos_resposta.ts";

const falhas: string[] = [];
function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

const EMPRESA = "57f755b9-c23d-4f58-a488-8173d697c010";
// Ids reais do incidente CONJ.3_VISTTA (01/09/2026): 2 inventados, 1 real.
const INVENTADO = "b7c8d92f-4e15-402a-9c1f-a8f3e1b5c9d2";
const INVENTADO2 = "c9e7f3a2-5d21-48b6-b4e9-2c6d8a7f1e9b";
const REAL = "fba683b5-8f3e-4954-8bca-fe5fdc9953d4";
// Card de pausa do CONJ.2 (01/09/2026, 19:10): tem 'g', nao e uuid.
const FORA_DO_HEXA = "6d3b9f5e-7c0a-52b4-d0e9-3g6f8e4d7b3g";

const buscarVazio = async () => [] as Array<{ id?: unknown }>;
const buscarAchando = async (ids: string[]) => ids.map((id) => ({ id }));
const buscarQuebrado = async () => {
  throw new Error("timeout na consulta");
};
const buscarMudo = async () => null;

// ============================================================================
// [1] CONTROLE POSITIVO DAS TRES CONFERENCIAS — se algum destes passar, o portao morreu
// ============================================================================
console.log("\n[1] controle positivo: casos que TEM de ser pegos\n");

// 1.1 Identificador fabricado. O caso literal do CONJ.3: tabela com real e inventado juntos.
{
  const c = await conferirIdentificadores({
    trecho: `| 1 | ${INVENTADO} | AD_CONJ.3_1 |\n| 3 | ${REAL} | AD_CONJ.3_3 |`,
    companyId: EMPRESA,
    cardsDaRodada: [{ approval_id: REAL }],
    buscar: buscarVazio,
  });
  ok(c.veredito === "reprovado", `CONTROLE POSITIVO MORTO: id fabricado devolveu "${c.veredito}"`);
  ok(c.itens.includes(INVENTADO), "o veredito nao nomeia o id fabricado");
  ok(!c.itens.includes(REAL), "o veredito acusou o card real da rodada");
  console.log(`  OK  identificador fabricado pego: ${c.itens.join(", ")}`);
}

// 1.2 Cobertura omitida. `restantes: 12` no retorno e nada na resposta.
{
  const c = conferirCobertura({
    textoCompleto: "Os anuncios do CONJ.1 estao com CPL de R$ 18,40 e o melhor e o Reel02.",
    toolResults: [{ tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 18, restantes: 12 } }],
  });
  ok(c.veredito === "reprovado", `CONTROLE POSITIVO MORTO: cobertura omitida devolveu "${c.veredito}"`);
  ok(c.envelope.includes("12 restante"), `o envelope nao carrega o numero real: ${c.envelope}`);
  ok(c.envelope.includes(MARCA_DO_ENVELOPE), "o envelope perdeu a marca que a auditoria casa");
  ok(/EXISTEM/.test(c.envelope), "o envelope nao diz que o que faltou EXISTE");
  console.log(`  OK  cobertura omitida pega, envelope montado de codigo`);
}

// 1.3 Contrato divergente. Campo obrigatorio ausente no payload do card emitido.
{
  const c = await conferirContratoDoPedido({
    approvalIds: [REAL],
    buscarCards: async () => [{ id: REAL, action: "criar_campanha", payload: { nome_novo: "X" } }],
    validar: async () => ({ valido: false, faltando: ["special_ad_categories", "conta_destino"] }),
  });
  ok(c.veredito === "reprovado", `CONTROLE POSITIVO MORTO: contrato divergente devolveu "${c.veredito}"`);
  ok(
    c.itens.some((i) => i.includes("special_ad_categories")),
    "o veredito nao nomeia o campo que divergiu",
  );
  console.log(`  OK  contrato divergente pego: ${c.itens.join("; ")}`);
}

// 1.4 O portao inteiro, pela porta da frente. Se `verificarAntesDeResponder` devolver limpo
//     aqui, nenhuma das tres esta ligada — e as 1.1-1.3 nao pegariam isso.
{
  const r = await verificarAntesDeResponder({
    texto: `Emiti o card ${INVENTADO}. CPL medio de R$ 18,40.`,
    companyId: EMPRESA,
    toolResults: [{ tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 18, restantes: 12 } }],
    cardsDaRodada: [],
    buscarIds: buscarVazio,
  });
  ok(!r.limpo, "CONTROLE POSITIVO MORTO: o ponto unico devolveu limpo com id fabricado e cobertura omitida");
  ok(r.nota.length > 0, "o ponto unico nao produziu nota nenhuma");
  ok(r.nota.includes(INVENTADO), "a nota nao nomeia o id fabricado");
  ok(r.nota.includes(MARCA_DO_ENVELOPE), "a nota nao carrega o envelope de cobertura");
  console.log(`  OK  ponto unico pegou os dois modos no mesmo turno`);
}

// ============================================================================
// [2] AUSENCIA DE SINAL NAO VIRA PERMISSAO — o defeito que a semana repetiu cinco vezes
// ============================================================================
console.log("\n[2] fonte que nao responde: nao_conferido, nunca conferido\n");

// 2.1 Consulta que ESTOURA.
{
  const c = await conferirIdentificadores({
    trecho: `Card ${INVENTADO} na fila.`,
    companyId: EMPRESA,
    buscar: buscarQuebrado,
  });
  ok(c.veredito === "nao_conferido", `consulta quebrada virou "${c.veredito}"`);
  ok(!!c.motivo && /timeout/.test(c.motivo), `o motivo nao carrega a falha real: ${c.motivo}`);
  ok(c.itens.includes(INVENTADO), "o nao_conferido nao nomeia o que ficou sem veredito");
  console.log(`  OK  consulta quebrada -> nao_conferido (${c.motivo})`);
}

// 2.2 Consulta que responde VAZIO SEM ERRO. E a forma exata do episodio do gerar-legendas em
//     03/09: `parData` nulo sem `parErr`, e o verificador mudo liberava a publicacao.
{
  const c = await conferirIdentificadores({
    trecho: `Card ${INVENTADO} na fila.`,
    companyId: EMPRESA,
    buscar: buscarMudo,
  });
  ok(c.veredito === "nao_conferido", `resposta vazia sem erro virou "${c.veredito}"`);
  ok(!!c.motivo && /vazia/.test(c.motivo), `resposta vazia sem motivo proprio: ${c.motivo}`);
  console.log(`  OK  resposta vazia sem erro -> nao_conferido`);
}

// 2.3 Empresa nao resolvida: sem recorte, nao ha o que conferir. Nao e "esta tudo bem".
{
  const v = await conferirApprovalIds([INVENTADO], { companyId: "", buscar: buscarVazio });
  ok(v.inventados.length === 0, "acusou sem empresa para recortar a consulta");
  ok(v.nao_conferidos.length === 1, "sem empresa o id deveria ficar em nao_conferidos");
  ok(!!v.motivo, "nao_conferidos sem motivo: beco para o plantao");
  console.log(`  OK  sem empresa -> nao_conferido com motivo`);
}

// 2.4 A REGRESSAO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR. `approvalIdsInexistentes` descarta
//     `nao_conferidos` de proposito (compatibilidade), e o descarte E o fail-open. A prova
//     afirma as duas metades: ela nao acusa (correto) E o estado existe do outro lado.
{
  const lista = await approvalIdsInexistentes([INVENTADO], { companyId: EMPRESA, buscar: buscarQuebrado });
  ok(lista.length === 0, "consulta falha virou acusacao: o falso positivo do CONJ.3 voltou");
  const v = await conferirApprovalIds([INVENTADO], { companyId: EMPRESA, buscar: buscarQuebrado });
  ok(
    v.nao_conferidos.length === 1,
    "o estado nao_conferido desapareceu: a lista de dois estados voltou a ser a unica verdade",
  );
  console.log(`  OK  a lista de compatibilidade nao acusa, e o terceiro estado nao se perde`);
}

// 2.5 RPC de contrato que quebra, que responde vazio, e que responde vocabulario desconhecido.
//     Os tres em nao_conferido. O terceiro e o `veredito === "reprova"` da meta-actions ao
//     contrario: aqui o desconhecido NAO passa.
{
  for (const [nome, validar] of [
    ["quebra", async () => { throw new Error("PGRST202"); }],
    ["vazio", async () => null],
    ["desconhecido", async () => ({ valido: "talvez" })],
  ] as const) {
    const c = await conferirContratoDoPedido({
      approvalIds: [REAL],
      buscarCards: async () => [{ id: REAL, action: "criar_campanha", payload: {} }],
      validar: validar as never,
    });
    ok(c.veredito === "nao_conferido", `contrato "${nome}" virou "${c.veredito}"`);
    ok(!!c.motivo, `contrato "${nome}" sem motivo`);
  }
  console.log(`  OK  contrato: quebra, vazio e vocabulario desconhecido -> nao_conferido`);
}

// 2.6 `valido` ausente. A chave fantasma na forma que causa dano: undefined NAO pode liberar.
{
  const c = await conferirContratoDoPedido({
    approvalIds: [REAL],
    buscarCards: async () => [{ id: REAL, action: "criar_campanha", payload: {} }],
    validar: async () => ({ mensagem: "tudo certo" }),
  });
  ok(
    c.veredito === "nao_conferido",
    `chave 'valido' ausente virou "${c.veredito}": e o defeito de 03/09 nesta camada`,
  );
  console.log(`  OK  'valido' ausente -> nao_conferido (nao libera por omissao)`);
}

// 2.7 Card emitido numa superficie que nao liga a conferencia de contrato. Nao ganha verde
//     por nao ter ligado — a superficie nao conferida se declara.
{
  const r = await verificarAntesDeResponder({
    texto: "Card emitido.",
    companyId: EMPRESA,
    cardsDaRodada: [{ approval_id: REAL }],
    toolResults: [],
    buscarIds: buscarAchando,
  });
  ok(!r.limpo, "superficie sem conferencia de contrato devolveu limpo");
  const contrato = r.conferencias.find((c) => c.nome === "contrato_do_pedido");
  ok(contrato?.veredito === "nao_conferido", `esperava nao_conferido, veio ${contrato?.veredito}`);
  ok(/nao conferi o pedido contra o contrato/i.test(r.nota), `a nota nao declara a lacuna: ${r.nota}`);
  console.log(`  OK  superficie sem contrato ligado -> nao_conferido e declarado`);
}

// 2.8 `vereditoDe` normaliza por LISTA DE LIBERADOS. Todo vocabulario de fora cai no seguro.
{
  ok(vereditoDe("conferido") === "conferido", "'conferido' deveria ser aceito");
  for (const v of [undefined, null, "", "ok", "aprovado", "valido", "true", 1, {}, "CONFERIDO!"]) {
    ok(vereditoDe(v) === "nao_conferido", `vereditoDe(${JSON.stringify(v)}) abriu buraco`);
  }
  ok(vereditoDe("CONFERIDO") === "conferido", "a normalizacao de caixa quebrou");
  console.log(`  OK  vereditoDe: 9 vocabularios de fora caem em nao_conferido`);
}

// ============================================================================
// [3] A PROPRIA VERIFICACAO QUEBRANDO TEM DE APARECER (R4)
// ============================================================================
console.log("\n[3] verificador que morre nao morre calado\n");
{
  // `toolResults` com getter que estoura: quebra dentro de `conferirCobertura`, nao na borda.
  const venenoso = [{
    tool: "get_detalhe_anuncios",
    get retorno(): unknown {
      throw new Error("retorno corrompido");
    },
  }];
  const r = await verificarAntesDeResponder({
    texto: "Leitura entregue.",
    companyId: EMPRESA,
    toolResults: venenoso as never,
    cardsDaRodada: [],
    buscarIds: buscarAchando,
  });
  ok(r.defeito !== null, "a verificacao quebrou e `defeito` ficou null");
  ok(!r.limpo, "verificacao quebrada devolveu limpo");
  ok(
    /NAO foi conferida/i.test(r.nota),
    `a quebra nao chegou ao gestor — ficou so na telemetria: ${r.nota}`,
  );
  console.log(`  OK  quebra interna -> defeito + nota ao gestor`);
}

// ============================================================================
// [4] O QUE NAO PODE SER ACUSADO — o falso positivo custa igual
// ============================================================================
console.log("\n[4] falso positivo: o erro na direcao oposta\n");

// 4.1 Card real citado de MEMORIA da conversa, sem rechamar tool. A v28.88 acusou dois cards
//     do CONJ.3 assim, 20 minutos depois de entrar. Quem desempata e o banco.
{
  const c = await conferirIdentificadores({
    trecho: `O card ${REAL} segue pendente desde as 18:15.`,
    companyId: EMPRESA,
    cardsDaRodada: [],
    buscar: buscarAchando,
  });
  ok(c.veredito === "conferido", `card real lembrado da conversa foi acusado: ${c.motivo}`);
  console.log(`  OK  card real citado de memoria nao e acusado`);
}

// 4.2 Ferramenta que NAO paginou nao produz envelope. Envelope inventado seria ruido em toda
//     leitura completa, e ensinaria a ignorar a linha.
{
  const c = conferirCobertura({
    textoCompleto: "Os 6 anuncios do CONJ.1.",
    toolResults: [
      { tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 6, restantes: 0 } },
      { tool: "get_overview", retorno: { campanhas: 3 } },
      { tool: "propose_action", retorno: "texto solto, nem objeto" },
    ],
  });
  ok(c.veredito === "conferido", `leitura completa recebeu envelope indevido: ${c.envelope}`);
  ok(c.envelope === "", "montou envelope sem corte nenhum");
  console.log(`  OK  restantes=0 nao gera envelope`);
}

// 4.3 Idempotencia: a mensagem que JA tem o envelope nao recebe um segundo. Turno continuado
//     reentra aqui, e dois envelopes na mesma mensagem se contradizem.
{
  const primeiro = conferirCobertura({
    textoCompleto: "Leitura parcial.",
    toolResults: [{ tool: "get_criativos_conteudo", retorno: { exibidos: 20, omitidos: 13 } }],
  });
  const jaComNota = `Leitura parcial.\n\n${primeiro.envelope}`;
  const segundo = conferirCobertura({
    textoCompleto: jaComNota,
    toolResults: [{ tool: "get_criativos_conteudo", retorno: { exibidos: 20, omitidos: 13 } }],
  });
  ok(segundo.veredito === "conferido", "a segunda passada reprovou uma mensagem ja declarada");
  ok(segundo.envelope === "", "a segunda passada montaria um envelope duplicado");
  console.log(`  OK  envelope nao duplica em turno continuado`);
}

// 4.4 Segmento intermediario nao paga cobertura: os restantes ainda podem ser lidos no proximo
//     bloco. Mas fabricacao NAO tem essa folga — id inventado num stub chega ao gestor igual.
{
  const meio = await verificarAntesDeResponder({
    texto: `Continuando automaticamente… card ${INVENTADO}.`,
    companyId: EMPRESA,
    toolResults: [{ tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 18, restantes: 12 } }],
    cardsDaRodada: [],
    turnoVaiFechar: false,
    buscarIds: buscarVazio,
  });
  ok(
    !meio.conferencias.some((c) => c.nome === "cobertura"),
    "cobrou o envelope em segmento intermediario",
  );
  ok(
    meio.conferencias.find((c) => c.nome === "identificadores")?.veredito === "reprovado",
    "id fabricado ganhou folga em segmento intermediario",
  );
  console.log(`  OK  segmento intermediario: cobertura espera, fabricacao nao`);
}

// 4.5 `contrato_desconhecido` NAO e reprovacao. 22 dos 269 cards da base caem aqui
//     (pausar_criativo 15, pausar_campanha 4, renomear_criativo 2, ativar_criativo 1): ninguem
//     declarou o contrato daquelas acoes. Dizer "o pedido esta errado" seria inventar recusa.
{
  const c = await conferirContratoDoPedido({
    approvalIds: [REAL],
    buscarCards: async () => [{ id: REAL, action: "pausar_criativo", payload: { alvo: "AD_1" } }],
    validar: async () => ({ valido: false, motivo: "contrato_desconhecido" }),
  });
  ok(c.veredito === "nao_conferido", `contrato_desconhecido virou "${c.veredito}"`);
  ok(
    !!c.motivo && /nenhum contrato declarado/i.test(c.motivo),
    `o motivo confunde 'nao declarado' com 'pedido errado': ${c.motivo}`,
  );
  console.log(`  OK  contrato_desconhecido -> nao_conferido, nao reprovado`);
}

// 4.6 A divergencia de contrato NAO e apresentada como recusa. Medido: das 15 reprovacoes do
//     historico, 10 executaram com ok=true na Meta — o contrato desta base e mais restrito que
//     o executor. Alarme de recusa com 67% de falso positivo treina o gestor a ignorar.
{
  const r = await verificarAntesDeResponder({
    texto: "Card de campanha emitido.",
    companyId: EMPRESA,
    cardsDaRodada: [{ approval_id: REAL }],
    toolResults: [],
    buscarIds: buscarAchando,
    buscarCards: async () => [{ id: REAL, action: "criar_campanha", payload: { nome_novo: "X" } }],
    validarContrato: async () => ({ valido: false, faltando: ["special_ad_categories"] }),
  });
  ok(/NAO recusa o card/i.test(r.nota), `a nota apresenta divergencia como recusa: ${r.nota}`);
  ok(/special_ad_categories/.test(r.nota), "a nota nao nomeia o campo divergente");
  ok(!/n[ãa]o emiti|card cancelado|suprimi/i.test(r.nota), "a nota afirma que o card nao saiu");
  console.log(`  OK  divergencia de contrato e declarada, nao convertida em recusa`);
}

// 4.7 O chat JA escreveu a acusacao (avisoDeCardInventado). A nota nao escreve a segunda, mas o
//     veredito continua `reprovado`: presentacao e uma coisa, telemetria e outra. Se o veredito
//     virasse `conferido` aqui, o numerador do modo 1 zeraria justamente nos turnos pegos.
{
  const jaAcusado = await import("./aprovacoes.ts").then((m) =>
    `Emiti os cards.\n\n${m.avisoDeCardInventado([INVENTADO], [REAL])}`
  );
  ok(MARCA_DO_AVISO_DE_ID.test(jaAcusado), "a marca do aviso nao casa o texto de avisoDeCardInventado");
  const r = await verificarAntesDeResponder({
    texto: jaAcusado,
    companyId: EMPRESA,
    cardsDaRodada: [{ approval_id: REAL }],
    toolResults: [],
    buscarIds: buscarVazio,
  });
  const ids = r.conferencias.find((c) => c.nome === "identificadores");
  ok(ids?.veredito === "reprovado", `veredito virou "${ids?.veredito}" so porque a nota nao repetiu`);
  ok(!r.limpo, "turno com id fabricado devolveu limpo");
  ok(
    !/Identificador nao confirmado/.test(r.nota),
    `a nota duplicou a acusacao que o chat ja fez: ${r.nota}`,
  );
  ok(linhaDeVerificacao(r).reprovadas === 1, "a telemetria perdeu o turno reprovado");
  console.log(`  OK  acusacao ja feita: veredito reprovado, nota nao duplica`);
}

// 4.8 Turno limpo nao acrescenta caractere nenhum. Selo verde em toda resposta e ruido.
{
  const r = await verificarAntesDeResponder({
    texto: `Card ${REAL} emitido. Os 6 anuncios do CONJ.1 estao lidos.`,
    companyId: EMPRESA,
    cardsDaRodada: [{ approval_id: REAL }],
    toolResults: [{ tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 6, restantes: 0 } }],
    buscarIds: buscarAchando,
    buscarCards: async () => [{ id: REAL, action: "criar_campanha", payload: {} }],
    validarContrato: async () => ({ valido: true }),
  });
  ok(r.limpo, `turno limpo veio sujo: ${JSON.stringify(linhaDeVerificacao(r))}`);
  ok(r.nota === "", `turno limpo produziu nota: ${r.nota}`);
  ok(r.defeito === null, "turno limpo com defeito");
  console.log(`  OK  turno limpo: 0 chars anexados`);
}

// ============================================================================
// [5] O CONTRATO DE ESCOPO POR TRECHO (o desenho de 03/09, condicao (c) incluida)
// ============================================================================
console.log("\n[5] escopo: fabricacao no trecho gerado, completude na mensagem inteira\n");

const BLOCO = "**2 card(s) emitido(s) para sua aprovacao**";
const GERADO = "O CPL do CONJ.2 ficou em R$ 18,40 sobre formularios.";
const HIBRIDO = `${BLOCO}\n\n${GERADO}`;

// 5.1 Hibrido: fabricacao ve SO o gerado; completude ve a mensagem toda. E a resolucao da
//     condicao (c): um verificador de completude que visse so o slice reprovaria o trecho por
//     obedecer a instrucao de nao repetir o bloco.
{
  const e = escopoDaVerificacao({
    texto: HIBRIDO,
    caminho: "hibrido",
    inicioDoGerado: BLOCO.length + 2,
    integridadeIntacta: true,
  });
  ok(e.fabricacao === GERADO, `o slice de fabricacao veio errado: ${JSON.stringify(e.fabricacao)}`);
  ok(e.completude === HIBRIDO, "completude deveria ver a mensagem inteira");
  ok(!e.recorte_invalido, "recorte valido marcado como invalido");
  console.log(`  OK  hibrido: fabricacao=${e.fabricacao.length} chars, completude=${e.completude.length} chars`);
}

// 5.2 Canonico nao e conferido por fabricacao: nao passou por geracao, e reprovar ali e sempre
//     falso positivo. O conserto de texto canonico errado e no registro de moldes.
{
  const e = escopoDaVerificacao({ texto: BLOCO, caminho: "canonico", integridadeIntacta: true });
  ok(e.fabricacao === "", "canonico entrou no escopo de fabricacao");
  ok(e.completude === BLOCO, "canonico deveria contar para completude");
  console.log(`  OK  canonico: fora do escopo de fabricacao`);
}

// 5.3 Integridade reprovada = caso (b) do contrato. NAO confere por trecho: o offset nao
//     aponta para o que se pensa. Conferir o slice errado em silencio e pior que nao conferir.
{
  const e = escopoDaVerificacao({
    texto: HIBRIDO,
    caminho: "hibrido",
    inicioDoGerado: BLOCO.length + 2,
    integridadeIntacta: false,
  });
  ok(e.recorte_invalido, "integridade reprovada nao invalidou o recorte");
  ok(e.fabricacao === "", "conferiu por trecho um texto adulterado");
  const r = await verificarAntesDeResponder({
    texto: HIBRIDO,
    companyId: EMPRESA,
    caminho: "hibrido",
    inicioDoGerado: BLOCO.length + 2,
    integridadeIntacta: false,
    toolResults: [],
    cardsDaRodada: [],
    buscarIds: buscarAchando,
  });
  ok(!r.limpo, "recorte invalido devolveu limpo");
  ok(/integridade da composicao/i.test(r.nota), `o incidente de composicao nao chegou a nota: ${r.nota}`);
  console.log(`  OK  integridade reprovada -> incidente declarado, sem conferir slice errado`);
}

// 5.4 Hibrido declarado SEM offset utilizavel nao cai para "confere o texto inteiro". Cair
//     para o texto inteiro reprovaria o bloco canonico por obediencia — o falso positivo que
//     o recorte existe para evitar.
{
  for (const ini of [null, undefined, -1, 99999, "10" as never]) {
    const e = escopoDaVerificacao({ texto: HIBRIDO, caminho: "hibrido", inicioDoGerado: ini as never });
    ok(e.recorte_invalido, `hibrido com inicio_do_gerado=${JSON.stringify(ini)} nao invalidou o recorte`);
    ok(e.fabricacao !== HIBRIDO, `hibrido sem offset caiu para o texto inteiro (${JSON.stringify(ini)})`);
  }
  console.log(`  OK  hibrido sem offset: 5 formas de offset ruim, nenhuma cai no texto inteiro`);
}

// 5.5 O ramo que roda HOJE em producao. A composicao esta pronta e provada, mas nao esta
//     ligada (o ponto de ligacao em resposta_canonica.ts segue "NAO APLICADO DE PROPOSITO"),
//     entao todo turno e `llm` e os dois escopos coincidem. Se um dia divergirem aqui sem
//     ninguem ligar a composicao, algo mudou sem aviso.
{
  const e = escopoDaVerificacao({ texto: HIBRIDO, caminho: "llm" });
  ok(e.fabricacao === HIBRIDO && e.completude === HIBRIDO, "no ramo llm os dois escopos divergiram");
  console.log(`  OK  llm: os dois escopos coincidem (o unico ramo vivo hoje)`);
}

// ============================================================================
// [6] LEITURA DOS ENVELOPES E DA TELEMETRIA
// ============================================================================
console.log("\n[6] envelopes lidos do retorno, e a telemetria que os conta\n");

// 6.1 As tres formas de corte que as ferramentas desta base usam, mais o retorno que nao e
//     objeto (propose_action devolve string em erro).
{
  const envs = envelopesDosRetornos([
    { tool: "get_detalhe_anuncios", retorno: { exibidos: 6, total_anuncios: 18, restantes: 12 } },
    { tool: "get_criativos_conteudo", retorno: { exibidos: 20, omitidos: 13, aviso_corte: "truncado" } },
    { tool: "get_acervo_para_anuncio", retorno: { aviso_corte: "Inventario truncado nos tetos" } },
    { tool: "get_overview", retorno: { campanhas: 3 } },
    { tool: "propose_action", retorno: "erro em texto" },
    { tool: "nula", retorno: null },
    { tool: "lista", retorno: [1, 2, 3] },
  ]);
  ok(envs.length === 3, `esperava 3 envelopes, veio ${envs.length}`);
  ok(envs[0].restantes === 12 && envs[0].total === 18, "nao leu restantes/total de get_detalhe_anuncios");
  ok(envs[1].omitidos === 13, "nao leu omitidos de get_criativos_conteudo");
  ok(envs[2].aviso_corte !== null, "nao leu aviso_corte sem numero");
  console.log(`  OK  3 envelopes lidos, 4 retornos sem corte ignorados`);
}

// 6.2 `nao_conferido` NUNCA e somado a `conferido` (R2). Se essas duas contagens se juntarem,
//     o numerador desta camada morre e o painel fica verde sobre nada.
{
  const r = await verificarAntesDeResponder({
    texto: `Card ${INVENTADO} emitido.`,
    companyId: EMPRESA,
    toolResults: [],
    cardsDaRodada: [],
    buscarIds: buscarQuebrado,
  });
  const l = linhaDeVerificacao(r);
  ok(l.nao_conferidas === 1, `esperava 1 nao_conferida, veio ${l.nao_conferidas}`);
  ok(l.reprovadas === 0, `nao_conferido contado como reprovado: ${JSON.stringify(l)}`);
  ok(l.limpo === false, "nao_conferido satisfez `limpo`");
  ok(
    (l.conferidas as number) + (l.nao_conferidas as number) !== (l.conferidas as number),
    "as contagens se somaram",
  );
  ok(Array.isArray(l.motivos) && (l.motivos as string[]).length > 0, "a telemetria saiu sem motivo");
  console.log(`  OK  telemetria: conferidas=${l.conferidas} reprovadas=${l.reprovadas} nao_conferidas=${l.nao_conferidas}`);
}

// 6.3 Id fora do hexa e conferido POR FORMATO, sem ir ao banco. Consulta em coluna uuid
//     estouraria e o nao_conferido acabaria absolvendo o caso mais obvio de invencao.
{
  let foiAoBanco = false;
  const c = await conferirIdentificadores({
    trecho: `| 4 | ${FORA_DO_HEXA} | AD_CONJ.2_4 |`,
    companyId: EMPRESA,
    buscar: async () => {
      foiAoBanco = true;
      throw new Error("invalid input syntax for type uuid");
    },
  });
  ok(c.veredito === "reprovado", `id fora do hexa virou "${c.veredito}"`);
  ok(!foiAoBanco, "levou id nao-uuid para a consulta");
  console.log(`  OK  fora do hexa: reprovado por formato, sem consulta`);
}

// ============================================================================
// [7] O MODULO NAO PODE CONTER OS IDIOMAS DE FAIL-OPEN QUE ELE EXISTE PARA IMPEDIR
// ============================================================================
//
// Leitura da propria fonte, no espirito de _prova_portao_fail_closed.ts. O que se afirma aqui
// nao e comportamento: e que a camada continua ESCRITA em fail-closed. Um refactor futuro que
// reintroduza `catch { return conferido }` passa em todos os testes de comportamento acima se
// ele for aplicado a um caminho que nenhum deles exercita. Este bloco pega isso.
console.log("\n[7] a fonte do modulo nao contem idioma de aprovacao-por-ausencia\n");
{
  const bruto = await Deno.readTextFile(new URL("./verificacao_pos_resposta.ts", import.meta.url));

  // Le so o CODIGO. O modulo documenta os idiomas errados para explicar por que nao os usa —
  // `v.valido !== false` esta escrito la, num comentario, ao lado da linha que faz o certo.
  // Varrer o arquivo cru reprovaria o codigo correto pela propria documentacao dele, e o
  // conserto tentador (tirar o comentario) apagaria justamente o registro do motivo.
  //
  // O `[^\r\n]` nao e estilo: `.` em JS nao casa `\r`, entao `//.*$` NUNCA fecha em arquivo
  // com CRLF e o recorte vira no-op silencioso. Foi o que aconteceu na primeira rodada desta
  // prova, neste checkout (Windows). Um recorte que nao recorta e a mesma familia de defeito
  // que esta camada existe para pegar, e aqui ele apareceu dentro da propria prova.
  const src = bruto
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/[^\r\n]*$/, ""))
    .join("\n");

  // CONTROLE POSITIVO DO RECORTE. `[R1]` so existe em comentario no modulo: se ele sobreviver,
  // o recorte nao rodou e as buscas abaixo estao lendo prosa em vez de codigo.
  ok(bruto.includes("[R1]"), "o modulo perdeu as regras [R1..R5]: a prova nao tem mais o que ancorar");
  ok(!src.includes("[R1]"), "o recorte de comentarios virou no-op: as buscas abaixo nao valem nada");

  const PERIGOSOS: Array<[RegExp, string]> = [
    [/catch\s*(\([^)]*\))?\s*\{\s*(\/\/[^\n]*\n\s*)*return\s*\{\s*[^}]*veredito:\s*"conferido"/, 'catch devolvendo veredito "conferido"'],
    [/veredito\s*:\s*[\w.]+\s*\?\?\s*"conferido"/, '?? "conferido" (ausencia vira conferido)'],
    [/veredito\s*!==\s*"reprovado"/, 'veredito !== "reprovado" (desconhecido passa)'],
    [/valido\s*!==\s*false/, "valido !== false (ausente libera)"],
    [/!\s*[\w?.]*\.valido\b/, "!x.valido (ausente libera)"],
    [/every\(\(?\w+\)?\s*=>\s*\w+\.veredito\s*!==/, "`limpo` definido por ausencia de reprovacao"],
  ];
  const achados = PERIGOSOS.filter(([re]) => re.test(src)).map(([, n]) => n);
  ok(achados.length === 0, `idioma de fail-open na fonte do verificador: ${achados.join(" | ")}`);

  // E as duas afirmacoes positivas: `limpo` por lista de liberados, e `valido` por igualdade
  // com true. Sem elas o bloco acima seria satisfeito por um arquivo vazio.
  ok(
    /every\(\(c\)\s*=>\s*c\.veredito\s*===\s*"conferido"\)/.test(src),
    "`limpo` deixou de ser definido por igualdade com 'conferido'",
  );
  ok(/v\.valido\s*===\s*true/.test(src), "o contrato deixou de ser lido por igualdade com true");
  console.log(`  OK  6 idiomas perigosos ausentes, 2 afirmacoes positivas presentes`);
}

// ============================================================================
if (falhas.length) {
  console.error(`\nFALHOU: ${falhas.length} problema(s) na verificacao pos-resposta.\n`);
  for (const f of falhas) console.error(`  - ${f}`);
  console.error(
    "\nLembrete do porque isto e bloqueante: esta camada existe para impedir que ausencia de " +
      "sinal vire permissao, e ela e a classe de codigo mais provavel de conter o proximo " +
      "fail-open. Se o CONTROLE POSITIVO [1] caiu, o portao esta morto e o painel continuaria verde.",
  );
  Deno.exit(1);
}
console.log("\nok: _prova_verificacao_pos_resposta");
