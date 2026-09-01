// Prova de approvalIdsInventados: o caso real do CONJ.3_VISTTA (01/09/2026), em que a
// resposta misturou 4 approval_id reais com 2 inventados na mesma tabela e o guarda por
// frase nao viu nada. Roda com: deno run supabase/functions/_shared/_prova_card_inventado.ts

import { approvalIdsInventados, avisoDeCardInventado } from "./aprovacoes.ts";

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
}

console.log("ok: _prova_card_inventado");
