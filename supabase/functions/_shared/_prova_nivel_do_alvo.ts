// PROVA DA RECUSA MECANICA POR NIVEL DO ALVO.
// Roda com: deno run --allow-all supabase/functions/_shared/_prova_nivel_do_alvo.ts
//
// ============================================================================
// O QUE ESTA PROVA TEM DE MATAR
// ============================================================================
//
// Esta guarda existe para impedir que `pausar_criativo` apontado a uma campanha PAUSE A CAMPANHA.
// Ela tem duas maneiras de morrer, e as duas deixariam o painel verde:
//
//   (A) MORRER CALADA. Se a assinatura do #100 mudar de forma, ou se o regex nao casar, toda
//       leitura derrubada passa a ser "indisponivel" e a escrita segue como antes. Nenhum teste de
//       "nao acuse falso" pega isso — um verificador morto nunca acusa falso. Por isso [1] e [2]
//       sao CONTROLES POSITIVOS: casos que TEM de ser recusados, com as mensagens literais que a
//       Graph produziu neste repositorio (GT-12 na coleta, v5.3 na reconciliacao).
//
//   (B) MORRER PARALISANDO. Se indisponibilidade virar recusa, limite de taxa ou token vencido
//       passam a bloquear ato legitimo, e o erro aparece longe da causa. [3] a [7] fixam que
//       ausencia de informacao NUNCA vira recusa.
//
// A terceira forma de morrer nao esta no modulo e sim na fiacao: a guarda pode existir e ser
// chamada DEPOIS do POST. [10] e [11] provam a ordem e o alcance no executor.

import {
  classificarLeituraDoAlvo,
  decidirEscritaNoAlvo,
  nivelDoNoDaGraph,
  NIVEL_PARA_ESPELHO,
  type EspelhoDoAlvo,
} from "./nivel_do_alvo.ts";

const falhas: string[] = [];
function ok(cond: boolean, msg: string) {
  if (!cond) falhas.push(msg);
}

const ESPELHO_VAZIO: EspelhoDoAlvo = { consultado: true, niveis: [] };
const OK_200 = { status: 200, body: { id: "120249829825270182", status: "ACTIVE" } };

// ============================================================================
// [1] CONTROLE POSITIVO: pausar_criativo apontado a uma campanha.
// ============================================================================
// Mensagem literal da forma que o repositorio ja registrou duas vezes. `pausar_criativo` pede os
// campos do nivel de anuncio; se o id e de campanha, a Graph derruba a consulta inteira.
{
  const leitura = {
    status: 400,
    body: {
      error: {
        message: "(#100) Tried accessing nonexisting field (creative) on node type (Campaign)",
        type: "OAuthException",
        code: 100,
      },
    },
  };
  const c = classificarLeituraDoAlvo(leitura);
  ok(c.classe === "nivel_errado", "[1] CONTROLE POSITIVO MORTO: #100 de campo inexistente nao foi classificado como nivel errado");
  ok(c.classe === "nivel_errado" && c.nivel_observado === "campanha", "[1] a Graph nomeou o tipo (Campaign) e a traducao nao chegou em 'campanha'");

  const d = decidirEscritaNoAlvo({ nivelDaAcao: "anuncio", espelho: ESPELHO_VAZIO, leitura });
  ok(d.escrever === false, "[1] CONTROLE POSITIVO MORTO: pausar_criativo em campanha seria ESCRITO — e o buraco original, aberto de novo");
  ok(d.escrever === false && d.recusa === "alvo_de_outro_nivel_na_graph", "[1] recusa sem nome estavel para auditar");
  ok(d.escrever === false && /campanha/.test(d.detalhe), "[1] o detalhe da recusa nao diz o que o alvo e de fato");
  console.log("  OK  [1] #100 de campo inexistente recusa a escrita e nomeia o tipo real");
}

// ============================================================================
// [2] CONTROLE POSITIVO: o espelho sabe, mesmo com a Graph de pe.
// ============================================================================
// Fonte deterministica, independente da Graph. E o caso que mais importa: um alvo de nivel errado
// quase sempre ESTA no espelho, porque e de la que o emissor tirou o id que confundiu.
{
  const d = decidirEscritaNoAlvo({
    nivelDaAcao: "anuncio",
    espelho: { consultado: true, niveis: ["campanha"] },
    leitura: OK_200,
  });
  ok(d.escrever === false, "[2] CONTROLE POSITIVO MORTO: espelho dizia campanha e a escrita de anuncio passou");
  ok(d.escrever === false && d.recusa === "alvo_de_outro_nivel_no_espelho", "[2] recusa do espelho sem nome estavel");
  console.log("  OK  [2] espelho conhecendo o id em outro nivel recusa sem depender da Graph");
}

// ============================================================================
// [3]-[6] INDISPONIBILIDADE NAO E ALVO ERRADO.
// ============================================================================
{
  const indisponiveis: Array<[string, { status: number; body: unknown }]> = [
    ["limite de taxa do app (#4)", { status: 400, body: { error: { code: 4, message: "Application request limit reached" } } }],
    ["limite de taxa do usuario (#17)", { status: 400, body: { error: { code: 17, message: "User request limit reached" } } }],
    ["limite de Ads (#80004)", { status: 400, body: { error: { code: 80004, message: "There have been too many calls" } } }],
    ["token vencido (#190)", { status: 400, body: { error: { code: 190, message: "Error validating access token" } } }],
    ["servico indisponivel (#2)", { status: 500, body: { error: { code: 2, message: "Service temporarily unavailable" } } }],
    ["http 502 sem envelope", { status: 502, body: "<html>Bad Gateway</html>" }],
    ["#100 genérico sem assinatura", { status: 400, body: { error: { code: 100, message: "Invalid parameter" } } }],
  ];
  for (const [nome, leitura] of indisponiveis) {
    const c = classificarLeituraDoAlvo(leitura);
    ok(c.classe === "indisponivel", `[3] ${nome} foi classificado como ${c.classe} — indisponibilidade virou juizo sobre o objeto`);

    // Sem espelho: nao ha informacao nenhuma. Ainda assim NAO se recusa.
    const semEspelho = decidirEscritaNoAlvo({ nivelDaAcao: "anuncio", espelho: ESPELHO_VAZIO, leitura });
    ok(semEspelho.escrever === true, `[4] ${nome} BLOQUEOU a escrita — fechar por indisponibilidade troca um risco por uma paralisia`);
    ok(semEspelho.escrever === true && semEspelho.confirmado_por === "ninguem", `[4] ${nome} passou sem registrar que ninguem conferiu`);
    ok(semEspelho.escrever === true && !!semEspelho.declaracao, `[5] ${nome} passou SEM DECLARAR: seria o silencio de antes, com codigo novo`);

    // Com espelho confirmando o nivel, a Graph caida nao atrapalha nada.
    const comEspelho = decidirEscritaNoAlvo({ nivelDaAcao: "anuncio", espelho: { consultado: true, niveis: ["anuncio"] }, leitura });
    ok(comEspelho.escrever === true && comEspelho.confirmado_por === "espelho", `[6] ${nome} com espelho confirmando nao registrou o espelho como fonte`);
  }
  console.log(`  OK  [3]-[6] ${indisponiveis.length} falhas de disponibilidade nao recusam e nao passam caladas`);
}

// ============================================================================
// [7] FALHA DA CONSULTA AO ESPELHO NAO PODE VIRAR ACUSACAO.
// ============================================================================
// Esta e a forma exata que apareceu cinco vezes no sistema esta semana pelo lado oposto: erro de
// consulta voltando como lista vazia. Aqui lista vazia significaria "nao esta em nenhum nivel", e
// o risco e o inverso do fail-open — acusar card bom. Espelho que nao respondeu nao e espelho
// vazio, e nem um nem outro pode recusar.
{
  const erro: EspelhoDoAlvo = { consultado: false, erro: "timeout na consulta ao espelho" };
  const d = decidirEscritaNoAlvo({ nivelDaAcao: "anuncio", espelho: erro, leitura: OK_200 });
  ok(d.escrever === true, "[7] erro na consulta ao espelho bloqueou a escrita");
  ok(d.escrever === true && d.confirmado_por === "graph", "[7] com espelho fora do ar a Graph deveria ser a fonte da confirmacao");
  ok(d.escrever === true && /espelho nao respondeu/.test(d.declaracao ?? ""), "[7] falha do espelho passou sem aparecer na declaracao");

  const tudoCego = decidirEscritaNoAlvo({
    nivelDaAcao: "anuncio",
    espelho: erro,
    leitura: { status: 400, body: { error: { code: 17, message: "User request limit reached" } } },
  });
  ok(tudoCego.escrever === true && tudoCego.confirmado_por === "ninguem", "[7] duas fontes cegas deveriam escrever declarando, nao recusar");
  console.log("  OK  [7] espelho sem resposta nao e espelho vazio e nunca vira recusa");
}

// ============================================================================
// [8] O ID QUE NAO RESOLVE.
// ============================================================================
{
  const leitura = {
    status: 400,
    body: {
      error: {
        message:
          "Unsupported get request. Object with ID '120249829825270182' does not exist, cannot be loaded due to missing permissions, or does not support this operation",
        type: "GraphMethodException",
        code: 100,
        error_subcode: 33,
      },
    },
  };
  const c = classificarLeituraDoAlvo(leitura);
  ok(c.classe === "alvo_nao_resolve", "[8] subcodigo 33 nao foi lido como id que nao resolve");
  const d = decidirEscritaNoAlvo({ nivelDaAcao: "campanha", espelho: ESPELHO_VAZIO, leitura });
  ok(d.escrever === false && d.recusa === "alvo_nao_resolve_na_graph", "[8] id que nao resolve seguiu para a escrita");
  console.log("  OK  [8] id inexistente ou fora do token recusa antes do POST");
}

// ============================================================================
// [9] CAMINHO LIMPO E TRADUCOES.
// ============================================================================
{
  const d = decidirEscritaNoAlvo({
    nivelDaAcao: "anuncio",
    espelho: { consultado: true, niveis: ["anuncio"] },
    leitura: OK_200,
  });
  ok(d.escrever === true && d.confirmado_por === "espelho_e_graph", "[9] caminho limpo nao registrou as duas fontes");
  ok(d.escrever === true && d.declaracao === null, "[9] caminho limpo declarou coisa que nao precisa: ruido treina a ignorar a linha");

  // Objeto recem-criado ainda nao espelhado NAO pode ser tratado como alvo errado.
  const novo = decidirEscritaNoAlvo({ nivelDaAcao: "conjunto", espelho: ESPELHO_VAZIO, leitura: OK_200 });
  ok(novo.escrever === true && novo.confirmado_por === "graph", "[9] objeto fora do espelho com Graph de pe deveria escrever confirmado pela Graph");

  ok(nivelDoNoDaGraph("Campaign") === "campanha", "[9] traducao de Campaign");
  ok(nivelDoNoDaGraph("AdSet") === "conjunto", "[9] traducao de AdSet");
  ok(nivelDoNoDaGraph("Ad") === "anuncio", "[9] traducao de Ad");
  ok(nivelDoNoDaGraph("AdCampaignGroup") === "campanha", "[9] traducao do apelido antigo de campanha");
  ok(nivelDoNoDaGraph("Coisa") === null, "[9] no desconhecido deveria virar null, nao um palpite de nivel");
  ok(NIVEL_PARA_ESPELHO.campanha === "campaigns" && NIVEL_PARA_ESPELHO.conjunto === "ad_sets" && NIVEL_PARA_ESPELHO.anuncio === "ads", "[9] mapa de espelhos por nivel");
  console.log("  OK  [9] caminho limpo silencioso e traducoes de tipo de no");
}

// ============================================================================
// [10]-[11] A FIACAO NO EXECUTOR: ORDEM E ALCANCE.
// ============================================================================
// Guarda certa chamada depois do POST nao guarda nada. E guarda presa a uma acao deixaria as
// outras onze descobertas — o mesmo defeito de replicar conferencia em varios pontos.
{
  const bruto = Deno.readTextFileSync(
    new URL("../meta-actions/index.ts", import.meta.url),
  ).replace(/\r\n/g, "\n");

  const iGuarda = bruto.indexOf("decidirEscritaNoAlvo({");
  const iEscrita = bruto.indexOf("await escreverUpdate(driver, acao, alvoExt, post!, pbToken)");
  const iPortao = bruto.indexOf("if (!EXECUTAVEIS.includes(acao))");
  ok(iGuarda > 0, "[10] a guarda nao esta ligada em meta-actions");
  ok(iEscrita > 0, "[10] o ponto de escrita mudou de forma; a prova de ordem precisa ser reescrita");
  ok(iGuarda > 0 && iEscrita > 0 && iGuarda < iEscrita, "[10] a guarda esta DEPOIS da escrita: nao guarda nada");
  ok(iPortao > 0 && iGuarda > iPortao, "[11] a guarda esta antes do portao de EXECUTAVEIS; fora do alcance certo");

  // Um so ponto de conferencia, como no funil de resposta do chat e do job.
  const chamadas = bruto.split("decidirEscritaNoAlvo({").length - 1;
  ok(chamadas === 1, `[11] a guarda e chamada ${chamadas} vezes; copias divergem e a que divergir e a que deixa passar`);

  // Nao pode estar dentro de um if por acao.
  const trecho = bruto.slice(Math.max(0, iGuarda - 700), iGuarda);
  ok(!/if \(acao === "/.test(trecho), "[11] a guarda parece estar dentro de um if por acao: as doze acoes executaveis precisam dela");

  // A recusa tem de usar o idioma de bloqueio que ja existe, e sair do card.
  const depois = bruto.slice(iGuarda, iGuarda + 1800);
  ok(/meta_action_blocked/.test(depois), "[11] a recusa nao vai para a auditoria como bloqueio");
  ok(/resultado: "bloqueado"/.test(depois), "[11] a recusa nao aparece no resultado do card");
  ok(/\bcontinue;/.test(depois), "[11] a recusa nao interrompe o card: cairia na escrita mesmo assim");
  console.log("  OK  [10]-[11] guarda antes da escrita, uma vez, valendo para as doze acoes");
}

// ============================================================================
// [12] OS DOIS LADOS NAO PODEM DERIVAR.
// ============================================================================
// A recusa mora em dois momentos com informacao diferente: a emissao (segundo eixo, so o espelho)
// e a execucao (executor, espelho + sinal #100 da Graph). Nao sao copias da mesma conferencia, mas
// tem uma parte comum — qual espelho e de qual nivel — escrita em SQL de um lado e em TypeScript
// do outro. Parte comum escrita duas vezes e a forma que sempre divergiu neste repositorio, e a
// que divergir e a que deixa passar. Aqui as duas ficam amarradas.
{
  const migracao = Deno.readTextFileSync(
    new URL(
      "../../migrations/20260905114000_recusa_de_alvo_de_outro_nivel_no_segundo_eixo.sql",
      import.meta.url,
    ),
  ).replace(/\r\n/g, "\n");

  for (const [nivel, tabela] of Object.entries(NIVEL_PARA_ESPELHO)) {
    const prop = `alvo_conhecido_em_outro_nivel_que_${nivel}`;
    ok(migracao.includes(prop), `[12] a migration nao conhece a propriedade de ${nivel}`);
    // No SQL, a propriedade do nivel EXCLUI o proprio espelho da busca por "outro nivel".
    const i = migracao.indexOf(`<> '${prop}'`);
    ok(i > 0, `[12] a migration nao exclui o proprio nivel em ${nivel}`);
    ok(
      i > 0 && migracao.slice(i, i + 320).includes(`public.${tabela}`),
      `[12] DERIVA: em TypeScript ${nivel} e a tabela ${tabela}, e o SQL amarra a propriedade de ${nivel} a outra tabela`,
    );
    // E o par (acao, nivel) da lista de regras tem de citar o mesmo nome de nivel.
    ok(
      new RegExp(`'${nivel}', '${prop}'`).test(migracao),
      `[12] a lista de regras nao amarra o nivel ${nivel} a sua propriedade`,
    );
  }

  // Alcance: as DOZE acoes executaveis, nao as quatro recem-contratadas.
  const executor = Deno.readTextFileSync(
    new URL("../meta-actions/index.ts", import.meta.url),
  ).replace(/\r\n/g, "\n");
  const bloco = /const EXECUTAVEIS = \[([\s\S]*?)\];/.exec(executor)?.[1] ?? "";
  const executaveis = [...bloco.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  ok(executaveis.length === 12, `[12] EXECUTAVEIS tem ${executaveis.length} acoes; a regra foi semeada para 12`);
  for (const acao of executaveis) {
    ok(
      new RegExp(`\\('${acao}', '(campanha|conjunto|anuncio)'`).test(migracao),
      `[12] a acao executavel ${acao} ficou SEM regra de nivel: e o buraco aberto so para ela`,
    );
  }
  console.log(`  OK  [12] espelho por nivel amarrado nos dois lados; ${executaveis.length} acoes executaveis cobertas`);
}

// ============================================================================
if (falhas.length) {
  console.error(`\nFALHOU: ${falhas.length} problema(s) na recusa por nivel do alvo.\n`);
  for (const f of falhas) console.error(`  - ${f}`);
  console.error(
    "\nLembrete do porque isto e bloqueante: sem esta guarda um `pausar_criativo` apontado a uma " +
      "campanha pausa a campanha, e o unico sinal que existia (o #100 da leitura) ja estava sendo " +
      "jogado fora. Se os CONTROLES POSITIVOS [1] ou [2] cairam, a guarda esta morta e o painel " +
      "continuaria verde. Se [3]-[7] cairam, ela virou paralisia e o erro vai aparecer longe da causa.",
  );
  Deno.exit(1);
}
console.log("\nok: _prova_nivel_do_alvo");
