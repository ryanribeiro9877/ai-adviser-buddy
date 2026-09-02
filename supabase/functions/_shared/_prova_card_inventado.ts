// Prova de approvalIdsInventados: o caso real do CONJ.3_VISTTA (01/09/2026), em que a
// resposta misturou 4 approval_id reais com 2 inventados na mesma tabela e o guarda por
// frase nao viu nada. Roda com: deno run supabase/functions/_shared/_prova_card_inventado.ts

import {
  approvalIdsInexistentes,
  approvalIdsInventados,
  avisoDeCardInventado,
  cortarClaimEmitidoSemCard,
} from "./aprovacoes.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

const REAIS = [
  "fba683b5-8f3e-4954-8bca-fe5fdc9953d4",
  "dd151a44-18d7-491c-bc61-1a4f3ef743f3",
];
const INVENTADOS = [
  "b7c8d92f-4e15-402a-9c1f-a8f3e1b5c9d2",
  "c9e7f3a2-5d21-48b6-b4e9-2c6d8a7f1e9b",
];

// O texto publicado: tabela com os dois reais desta rodada e os dois inventados que vinham
// se arrastando das respostas anteriores.
const textoDoIncidente = `
| Card | Approval ID | Criativo |
| 1 | ${INVENTADOS[0]} | AD_CONJ.3_APENAS_OCULOS_1 |
| 2 | ${INVENTADOS[1]} | AD_CONJ.3_APENAS_OCULOS_2 |
| 3 | ${REAIS[0]} | AD_CONJ.3_APENAS_OCULOS_3 |
| 4 | ${REAIS[1]} | AD_CONJ.3_APENAS_OCULOS_4 |
`;

// 1) O caso que passava batido: ha card REAL na rodada, e mesmo assim o inventado tem de cair.
{
  const achados = approvalIdsInventados(textoDoIncidente, {
    cardsDaRodada: REAIS.map((id) => ({ approval_id: id })),
    cardsDoTurno: null,
    retornosDeFerramenta: null,
  });
  ok(achados.length === 2, `esperava 2 inventados, veio ${achados.length}`);
  ok(achados.includes(INVENTADOS[0]), "nao pegou o primeiro inventado");
  ok(achados.includes(INVENTADOS[1]), "nao pegou o segundo inventado");
  ok(!achados.includes(REAIS[0]), "acusou card real de inventado");
}

// 2) Card emitido em segmento ANTERIOR do mesmo turno e real: nao pode virar falso positivo.
{
  const achados = approvalIdsInventados(`Card ${REAIS[0]} segue pendente.`, {
    cardsDaRodada: [],
    cardsDoTurno: [{ approval_id: REAIS[0] }],
    retornosDeFerramenta: null,
  });
  ok(achados.length === 0, `card do checkpoint acusado: ${achados.join(", ")}`);
}

// 3) Citar card pendente devolvido por get_aprovacoes e legitimo — o id vem no retorno da
//    tool, em qualquer nivel do objeto.
{
  const achados = approvalIdsInventados(`Na fila: ${REAIS[1]}.`, {
    cardsDaRodada: [],
    cardsDoTurno: null,
    retornosDeFerramenta: [
      { retorno: { aprovacoes: [{ id: REAIS[1], status: "pending" }] } },
    ],
  });
  ok(achados.length === 0, `id vindo de get_aprovacoes acusado: ${achados.join(", ")}`);
}

// 4) Maiuscula/minuscula nao pode abrir buraco.
{
  const achados = approvalIdsInventados(`Card ${REAIS[0].toUpperCase()} emitido.`, {
    cardsDaRodada: [{ approval_id: REAIS[0] }],
    cardsDoTurno: null,
    retornosDeFerramenta: null,
  });
  ok(achados.length === 0, "comparacao ficou sensivel a caixa");
}

// 5) Texto sem UUID nenhum nao aciona nada.
{
  const achados = approvalIdsInventados("Emiti os cards do CONJ.3.", {
    cardsDaRodada: [],
    cardsDoTurno: null,
    retornosDeFerramenta: null,
  });
  ok(achados.length === 0, "acusou inventado em texto sem UUID");
}

// 6) Retorno de tool com ciclo nao pode derrubar a checagem.
{
  const ciclo: Record<string, unknown> = { nome: "x" };
  ciclo.eu = ciclo;
  const achados = approvalIdsInventados(`Card ${INVENTADOS[0]}.`, {
    cardsDaRodada: [],
    cardsDoTurno: null,
    retornosDeFerramenta: [{ retorno: ciclo }],
  });
  ok(achados.length === 1, "ciclo no retorno quebrou a checagem");
}

// 7) O aviso precisa NOMEAR o inventado e o que saiu de verdade: "algo deu errado" sem a
//    lista deixa o gestor sem saber o que repedir.
{
  const aviso = avisoDeCardInventado(INVENTADOS, REAIS);
  ok(aviso.includes(INVENTADOS[0]), "aviso nao cita o id inventado");
  ok(aviso.includes(REAIS[0]), "aviso nao cita o id real da rodada");
  ok(/get_aprovacoes/.test(aviso), "aviso nao manda conferir a fila");
}

// 8) Sem card real na rodada, o aviso precisa dizer isso com todas as letras.
{
  const aviso = avisoDeCardInventado([INVENTADOS[0]], []);
  ok(/Nenhum card foi emitido nesta rodada/.test(aviso), "aviso nao declara rodada vazia");
  ok(/sistema retoma propose_action/i.test(aviso), "aviso ainda pede ao gestor para repetir");
  ok(!/peca (a emissao|de novo)|peça de novo/i.test(aviso), "aviso manda o gestor reenviar");
}

// ===== VEREDITO NO BANCO: o falso positivo que a v28.88 produziu =====
// Cards _5 e _6 do CONJ.3 existem desde as 18:15. O modelo os citou de memoria, sem
// rechamar tool, e a checagem local os apontou como inventados. So o banco desempata.
const EXISTE_MAS_NAO_VEIO_DE_TOOL = "7a3c6518-76a7-4cf9-8c48-780cff8a7099";

// 9) Candidato que EXISTE no banco nao pode ser acusado.
{
  const veredito = await approvalIdsInexistentes([EXISTE_MAS_NAO_VEIO_DE_TOOL], {
    companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
    buscar: async (ids) => ids.map((id) => ({ id })),
  });
  ok(veredito.length === 0, `card real acusado de inventado: ${veredito.join(", ")}`);
}

// 10) Candidato que NAO existe no banco e acusado.
{
  const veredito = await approvalIdsInexistentes([INVENTADOS[0]], {
    companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
    buscar: async () => [],
  });
  ok(veredito.length === 1, "card inexistente passou pelo veredito do banco");
}

// 11) Mistura: o real fica, o inventado cai.
{
  const veredito = await approvalIdsInexistentes(
    [EXISTE_MAS_NAO_VEIO_DE_TOOL, INVENTADOS[0]],
    {
      companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
      buscar: async () => [{ id: EXISTE_MAS_NAO_VEIO_DE_TOOL }],
    },
  );
  ok(veredito.length === 1 && veredito[0] === INVENTADOS[0], "mistura resolvida errado");
}

// 12) Consulta que FALHA nao acusa ninguem — sem leitura nao ha veredito.
{
  const veredito = await approvalIdsInexistentes([INVENTADOS[0]], {
    companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
    buscar: async () => {
      throw new Error("timeout");
    },
  });
  ok(veredito.length === 0, "consulta falha virou acusacao");
}

// 13) Sem empresa resolvida tambem nao ha acusacao (card de outra empresa nao serve de alibi,
//     e sem empresa a consulta nao tem recorte).
{
  const veredito = await approvalIdsInexistentes([INVENTADOS[0]], {
    companyId: "",
    buscar: async () => [],
  });
  ok(veredito.length === 0, "acusou sem empresa para recortar a consulta");
}

// ===== ID FORA DO HEXA: os cards de pausa do CONJ.2 (01/09/2026, 19:10) =====
// "6d3b9f5e-7c0a-52b4-d0e9-3g6f8e4d7b3g" tem 'g' — nao e UUID. A versao so-hexa nem enxergava.
const FORA_DO_HEXA = [
  "6d3b9f5e-7c0a-52b4-d0e9-3g6f8e4d7b3g",
  "7e4c0g6f-8d1b-63c5-e1f0-4h7g9f5e8c4h",
];

// 14) O formato invalido e reconhecido como citacao de card.
{
  const achados = approvalIdsInventados(
    `| 4 | ${FORA_DO_HEXA[0]} | AD_CONJ.2_APENAS_OCULOS_4 |`,
    { cardsDaRodada: [], cardsDoTurno: null, retornosDeFerramenta: null },
  );
  ok(achados.length === 1, "id fora do hexa passou despercebido");
}

// 15) Ele e condenado SEM ir ao banco — consulta em coluna uuid estouraria e o catch
//     acabaria absolvendo justo o caso mais obvio de invencao.
{
  let foiAoBanco = false;
  const veredito = await approvalIdsInexistentes(FORA_DO_HEXA, {
    companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
    buscar: async () => {
      foiAoBanco = true;
      throw new Error("invalid input syntax for type uuid");
    },
  });
  ok(veredito.length === 2, `malformado absolvido: ${veredito.join(", ")}`);
  ok(!foiAoBanco, "levou id nao-uuid para a consulta");
}

// 16) Mistura de malformado com uuid real: um cai, o outro fica, e a consulta so recebe o valido.
{
  let recebidos: string[] = [];
  const veredito = await approvalIdsInexistentes(
    [FORA_DO_HEXA[0], EXISTE_MAS_NAO_VEIO_DE_TOOL],
    {
      companyId: "57f755b9-c23d-4f58-a488-8173d697c010",
      buscar: async (ids) => {
        recebidos = ids;
        return [{ id: EXISTE_MAS_NAO_VEIO_DE_TOOL }];
      },
    },
  );
  ok(veredito.length === 1 && veredito[0] === FORA_DO_HEXA[0], "mistura resolvida errado");
  ok(
    recebidos.length === 1 && recebidos[0] === EXISTE_MAS_NAO_VEIO_DE_TOOL,
    "consulta recebeu id que nao e uuid",
  );
}

// ===== CONJ.4 (02/09/2026): guarda nomeou UUID inventado e deixou slate "✅ Card emitido" =====
const leftoverConj4 = `
1) Vídeos selecionados para Conjunto 4
Foram selecionados 7 vídeos da pasta "Apenas óculos".

2) Legendas aprovadas em compliance — primeiros 2 criativos
AD_CONJ.4_APENAS_OCULOS_1 (Vídeo 16.mp4)
Quando foi a última vez que você deu uma pausa para cuidar da sua visão?

3) Cards emitidos — Conjunto 4
Criativo	Approval ID	Vídeo	Status
Os dois primeiros cards foram emitidos para CONJ.4_VISTTA_WA_7199188-7731.

Prontos para próxima janela: Os criativos 3 a 7 terão legendas geradas.

[SLATE DA CONVERSA — store durável]

CONJ.4 | 16.mp4 | 1gdhO5sKjnTJUy-s-FvkE7LQE4_0NboNc | AD_CONJ.4_APENAS_OCULOS_1 | ✅ Card emitido
CONJ.4 | 17.mp4 | 1dxLQtGIqzjFHqAgrhmnOAMr3Me0Ci6t3 | AD_CONJ.4_APENAS_OCULOS_2 | ✅ Card emitido
CONJ.4 | 18.mp4 | 1n_YImIhFmHod48aKdzxttNGOZ4N7-1JY | AD_CONJ.4_APENAS_OCULOS_3 | ⏳ Legenda em processamento

[LEGENDAS DA CONVERSA — store durável]

[conj4_video_16 | drive=1gdhO5sKjnTJUy-s-FvkE7LQE4_0NboNc | var=1 | selecionada] Quando foi a última vez que você deu uma pausa para cuidar da sua visão?
`;

{
  const limpo = cortarClaimEmitidoSemCard(leftoverConj4);
  ok(!/card emitido/i.test(limpo), `slate de emissao falsa sobreviveu: ${limpo.slice(0, 400)}`);
  ok(!/cards?\s+foram\s+emitid/i.test(limpo), "frase 'cards foram emitidos' sobreviveu");
  ok(!/3\)\s*Cards emitidos/i.test(limpo), "secao 3) Cards emitidos sobreviveu");
  ok(/16\.mp4/.test(limpo) || /AD_CONJ\.4_APENAS_OCULOS_1/.test(limpo), "cortou a selecao/legenda real junto");
  ok(/última vez que você deu uma pausa/i.test(limpo), "cortou a copy aprovada junto");
  ok(/18\.mp4/.test(limpo) || /Legenda em processamento/.test(limpo), "apagou o slate dos que ainda geram legenda");
  ok(limpo.length >= 80, "corte deixou resto curto demais — a sanitizacao UUID jogaria a selecao fora");
}

console.log("ok: _prova_card_inventado");
