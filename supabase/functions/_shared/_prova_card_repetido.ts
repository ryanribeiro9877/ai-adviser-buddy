// Prova da recusa de card repetido em criar_anuncio_a_partir_de. Incidente de 15/10/2026,
// conversa bf4a8869 (COHAPM juridico): o gestor pediu AD_C2 / AD_C3 / AD_C1 no CONJ.4
// MELHORES_CRIATIVOS (adset 120250525505760182) e o AD_C1_JUROS_ALTO virou DOIS anuncios ACTIVE
// no mesmo conjunto. Conferido no banco e no log do gateway:
//   - card ed6a402d criado 19:03:22, aprovado 19:04:03, executado 19:04:30 -> anuncio
//     120250525697670182;
//   - turno 1a3e5a64 ("emita o proximo card") leu get_aprovacoes as 19:04:24, seis segundos
//     antes de a execucao terminar, viu "aguardando_execucao" e escreveu "aprovado e a execucao
//     nao rodou"; chamou propose_action do AD_C1 mesmo assim e abriu continuacao;
//   - a continuacao 4ef806b0 escreveu "Nao ha card novo a emitir" e chamou propose_action; o ramo
//     criar_anuncio_a_partir_de LEU approval_requests desta conversa as 19:05:53 (ed6a402d ja
//     executado, mesmo conjunto, mesmo molde 120250395919090182) e usou a leitura so para
//     desempatar conjunto; as 19:06:27 inseriu o card 9817d6c5, aprovado 19:06:35 e executado
//     19:06:45 -> anuncio 120250525725040182.
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_card_repetido.ts

import { cardRepetidoDoAnuncio, ehRecusaDeCardRepetido, ERRO_CARD_REPETIDO, recusaDeCardRepetido } from "./card_repetido.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

const CONJ4 = "120250525505760182";
const MOLDE_C1 = "120250395919090182";

// Linhas como o ramo le de approval_requests (payload cortado ao que importa).
const ed6a402d = {
  id: "ed6a402d-3140-4950-b2a5-92008c0fadf8",
  status: "approved",
  created_at: "2026-10-15T19:03:22.213577+00:00",
  executed_at: "2026-10-15T19:04:30.389+00:00",
  ultima_falha: null,
  execution_result: { ok: true, id_criado: "120250525697670182" },
  payload: {
    conjunto_destino_external_id: CONJ4,
    molde_external_id: MOLDE_C1,
    molde_nome: "AD_C1_JUROS_ALTO",
    creative_id: "1132790659273239",
    nome_novo: "AD_C1_JUROS_ALTO",
  },
};
// O mesmo card como get_aprovacoes o viu as 19:04:24: aprovado, execucao ainda em curso.
const ed6a402dEmVoo = { ...ed6a402d, executed_at: null, execution_result: null };
const c3Executado = {
  id: "26b0737b-df37-409c-b128-0b310858fd2d",
  status: "approved",
  created_at: "2026-10-15T19:02:34.801771+00:00",
  executed_at: "2026-10-15T19:04:17.679+00:00",
  ultima_falha: null,
  execution_result: { ok: true, id_criado: "120250525694540182" },
  payload: {
    conjunto_destino_external_id: CONJ4,
    molde_external_id: "120250395919100182",
    molde_nome: "AD_C3_VALOR_INCORRETO",
    nome_novo: "AD_C3_VALOR_INCORRETO",
  },
};
const c2Pendente = {
  id: "32701d3c-c6d3-4434-8381-675e42b465be",
  status: "pending",
  created_at: "2026-10-15T18:56:40.105798+00:00",
  executed_at: null,
  ultima_falha: null,
  execution_result: null,
  payload: {
    conjunto_destino_external_id: CONJ4,
    molde_external_id: "120250395919080182",
    molde_nome: "AD_C2_CARTAO_ARMADILHA",
    nome_novo: "AD_C2_CARTAO_ARMADILHA",
  },
};
const fila = [ed6a402d, c3Executado, c2Pendente];

// O pedido do card 9817d6c5, resolvido pelo ramo antes do compliance.
const pedidoC1 = {
  conjuntoDestinoExternalId: CONJ4,
  moldeExternalId: MOLDE_C1,
  moldeNome: "AD_C1_JUROS_ALTO",
  moldeCreativeId: "1132790659273239",
};

// ===== 1) O incidente: o card 9817d6c5 nao pode nascer =====
{
  const r = cardRepetidoDoAnuncio(fila, pedidoC1);
  ok(r?.approval_id === ed6a402d.id, `o pedido do 9817d6c5 passou sem citar o ed6a402d: ${JSON.stringify(r)}`);
  ok(r?.estado === "executado", `estado do card existente errado: ${r?.estado}`);
  ok(r?.id_criado_na_meta === "120250525697670182", "o anuncio ja criado nao aparece na recusa");
}

// ===== 2) A leitura das 19:04:24: aprovado e execucao em curso tambem e repetido =====
// "aguardando_execucao" NAO e "a execucao nao rodou": ela dispara com a aprovacao e dura
// segundos. Foi esse estado que o turno 1a3e5a64 leu e chamou de falha.
{
  const r = cardRepetidoDoAnuncio([ed6a402dEmVoo, c3Executado, c2Pendente], pedidoC1);
  ok(r?.approval_id === ed6a402d.id, "card aprovado com execucao em curso nao segurou o repetido");
  ok(r?.estado === "aguardando_execucao", `estado lido errado: ${r?.estado}`);
}

// ===== 3) Card pendente segura o repetido (AD_C2 pedido de novo na mesma leva) =====
{
  const r = cardRepetidoDoAnuncio(fila, {
    conjuntoDestinoExternalId: CONJ4,
    moldeExternalId: "120250395919080182",
    moldeNome: "AD_C2_CARTAO_ARMADILHA",
  });
  ok(r?.approval_id === c2Pendente.id && r?.estado === "aguardando_decisao", "card pendente do AD_C2 nao segurou o repetido");
}

// ===== 4) Molde resolvido pela COPIA: depois da execucao existem dois anuncios com o nome
// AD_C1_JUROS_ALTO no espelho, e o ramo acha o molde por nome. Se cair na copia do CONJ.4, o
// external_id do molde e o id criado pelo card anterior — e repetido do mesmo jeito. =====
{
  const r = cardRepetidoDoAnuncio(fila, {
    conjuntoDestinoExternalId: CONJ4,
    moldeExternalId: "120250525697670182",
    moldeNome: "AD_C1_JUROS_ALTO",
    moldeCreativeId: "1412408511061146",
  });
  ok(r?.approval_id === ed6a402d.id, "molde resolvido na copia escapou da recusa");
}

// ===== 5) O que NAO e repetido =====
{
  // Mesmo molde, outro conjunto: e o pedido normal de replicar para outro conjunto.
  ok(
    cardRepetidoDoAnuncio(fila, { ...pedidoC1, conjuntoDestinoExternalId: "120250395919000182" }) === null,
    "replicar o mesmo molde para OUTRO conjunto foi recusado",
  );
  // Outro molde no mesmo conjunto: e o resto da leva.
  ok(
    cardRepetidoDoAnuncio(fila, {
      conjuntoDestinoExternalId: CONJ4,
      moldeExternalId: "120250395919999182",
      moldeNome: "AD_C4_OUTRA_PECA",
    }) === null,
    "outro molde no mesmo conjunto foi recusado",
  );
  // Card recusado/expirado nao criou nada.
  ok(
    cardRepetidoDoAnuncio([{ ...ed6a402d, status: "rejected", executed_at: null, execution_result: null }], pedidoC1) === null,
    "card recusado segurou um pedido novo",
  );
  // Execucao que falhou antes de escrever: nada foi criado na Meta.
  ok(
    cardRepetidoDoAnuncio([{
      ...ed6a402dEmVoo,
      ultima_falha: { em: "2026-10-15T19:04:10Z", recusa: "conexao_meta_expirada", re_executavel: true },
    }], pedidoC1) === null,
    "card com execucao falha segurou um pedido novo",
  );
  // Falha pos-escrita: card fechado com ok=false, retry exige card novo.
  ok(
    cardRepetidoDoAnuncio([{ ...ed6a402d, execution_result: { ok: false, etapa: "criar_anuncio" } }], pedidoC1) === null,
    "card fechado com falha pos-escrita segurou o card novo",
  );
  // O anuncio criado foi apagado na Meta (espelho DELETED/ARCHIVED): recriar e legitimo.
  ok(
    cardRepetidoDoAnuncio(fila, pedidoC1, { anunciosRemovidos: ["120250525697670182"] }) === null,
    "anuncio ja apagado na Meta segurou a recriacao",
  );
  // Fila vazia / sem conjunto resolvido.
  ok(cardRepetidoDoAnuncio([], pedidoC1) === null, "fila vazia recusou");
  ok(cardRepetidoDoAnuncio(fila, { ...pedidoC1, conjuntoDestinoExternalId: "" }) === null, "sem conjunto destino recusou");
}

// ===== 6) Peca nova do acervo (sem molde): mesma midia + mesmo nome ou mesma legenda =====
{
  const pecaPendente = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    status: "pending",
    executed_at: null,
    execution_result: null,
    ultima_falha: null,
    payload: {
      conjunto_destino_external_id: CONJ4,
      drive_file_id: "1AbCdEfGh",
      nome_novo: "AD_C5_VIDEO_NOVO",
      legenda: "Juros alto consome o seu salario.\n\nFale com a equipe.",
    },
  };
  const r = cardRepetidoDoAnuncio([pecaPendente], {
    conjuntoDestinoExternalId: CONJ4,
    driveFileId: "1AbCdEfGh",
    nomeNovo: "AD_C5_VIDEO_NOVO",
    legenda: "outra legenda",
  });
  ok(r?.approval_id === pecaPendente.id, "mesma peca do acervo com o mesmo nome passou");
  const r2 = cardRepetidoDoAnuncio([pecaPendente], {
    conjuntoDestinoExternalId: CONJ4,
    driveFileId: "1AbCdEfGh",
    nomeNovo: "AD_C5_VIDEO_NOVO_B",
    legenda: "  juros alto consome o seu salario. fale com a equipe. ",
  });
  ok(r2?.approval_id === pecaPendente.id, "mesma peca do acervo com a mesma legenda passou");
  // Mesmo video, outro nome e outra legenda: teste A/B de texto no mesmo conjunto e legitimo.
  ok(
    cardRepetidoDoAnuncio([pecaPendente], {
      conjuntoDestinoExternalId: CONJ4,
      driveFileId: "1AbCdEfGh",
      nomeNovo: "AD_C5_VIDEO_NOVO_LEGENDA_B",
      legenda: "Texto diferente para testar.",
    }) === null,
    "variacao de legenda da mesma peca foi recusada",
  );
}

// ===== 7) A recusa diz o que o modelo leu errado e e erro DURO no fim do turno =====
{
  const r = cardRepetidoDoAnuncio(fila, pedidoC1)!;
  const rec = recusaDeCardRepetido(r, { conjuntoNome: "CONJ.4 MELHORES_CRIATIVOS", peca: "AD_C1_JUROS_ALTO" });
  ok(rec.erro === ERRO_CARD_REPETIDO, "nome do erro mudou");
  ok(rec.detalhe.includes(ed6a402d.id) && rec.detalhe.includes("120250525697670182"), "a recusa nao cita card e anuncio existentes");
  ok(/aguardando_execucao/.test(rec.instrucao) && /segundos/.test(rec.instrucao), "a recusa nao corrige a leitura 'execucao nao rodou'");
  ok(ehRecusaDeCardRepetido(rec.erro), "a recusa nao e reconhecida como erro duro");
  ok(!ehRecusaDeCardRepetido("orcamento_tempo_compliance"), "falta de janela virou erro duro");
}

// ===== 8) O traffic-chat consulta a fila do conjunto ANTES do compliance e trata a recusa
// como erro duro (sem isso o bloco seguinte so repete o propose e leva a mesma recusa) =====
{
  const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
  const ini = chat.indexOf('if (action === "criar_anuncio_a_partir_de") {');
  ok(ini > 0, "ramo criar_anuncio_a_partir_de nao encontrado");
  const comp = chat.indexOf("await t_check_compliance(", ini);
  const guarda = chat.indexOf("cardRepetidoDoAnuncio(", ini);
  ok(guarda > ini && guarda < comp, "o ramo nao confere card repetido antes do compliance");
  const trecho = chat.slice(ini, guarda);
  ok(/conjunto_destino_external_id/.test(trecho) && /\.in\("status", \["pending", "approved"\]\)/.test(trecho),
    "o ramo nao le a fila do conjunto destino (pendente/aprovado) antes de conferir");
  const duros = chat.indexOf("const proposesDuros");
  ok(duros > 0 && chat.indexOf("ehRecusaDeCardRepetido(", duros) > duros &&
    chat.indexOf("ehRecusaDeCardRepetido(", duros) < chat.indexOf("const soFalhaDuraSemCard", duros),
    "recusa de card repetido nao entra em proposesDuros");
}

console.log("OK — card repetido no mesmo conjunto e recusado antes do compliance");
