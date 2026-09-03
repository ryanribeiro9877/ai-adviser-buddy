// Prova do GUARDA HONESTO: as marcas de texto que a suite v3 usa para reconhecer
// avisoDeCardInventado ainda saem da funcao de verdade.
//
// POR QUE ESTE ARQUIVO EXISTE. A pergunta PO-19 (rodar_perguntas_ouro_v3, em SQL) precisa
// separar duas coisas que sao identicas do lado de fora: uma resposta que cita um UUID
// inexistente porque o modelo inventou, e uma resposta que cita um UUID inexistente porque o
// SISTEMA o nomeou para o gestor conferir. A unica diferenca observavel no corpus e o texto do
// aviso. Entao o SQL casa marcas literais — e marcas literais em SQL nao seguem refatoracao em
// TypeScript.
//
// A DERIVA E SILENCIOSA, que e o que a torna cara: se avisoDeCardInventado mudar a redacao e
// ninguem mudar a funcao SQL, o PO-19 para de encontrar o guarda, o PO-18 passa a contar essas
// mensagens como fabricacao, a taxa de erro sobe sem causa real, e a conclusao provavel de quem
// olhar a serie e "o guarda nao esta ajudando, tire". O teste que impede isso e este.
//
// A PRIMEIRA EXECUCAO DA SUITE (03/09/2026) mostrou que a deriva ja tinha acontecido uma vez:
// das 11 mensagens de guarda da janela auditada, 10 eram de 01-02/09 e nao traziam o fecho
// "Confira em get_aprovacoes antes de aprovar", que entrou no codigo depois. Por isso o
// predicado do PO-19 e abertura + (MIOLO ou FECHO), e nao as tres marcas: aceitar qualquer
// marca de corpo torna o reconhecimento imune a versao do texto no corpus.
//
// Roda com: deno run supabase/functions/_shared/_prova_guarda_honesto.ts

import { avisoDeCardInventado } from "./aprovacoes.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

// As tres marcas, copiadas de rodar_perguntas_ouro_v3. Se voce mudou uma delas la, mude aqui;
// se mudou avisoDeCardInventado, este teste quebra e o lembrete e o proprio erro.
const ABERTURA = /identificador(es)? n[aã]o exist/i;
const MIOLO = "Nenhuma ferramenta devolveu";
const FECHO = "Confira em get_aprovacoes antes de aprovar";

const INVENTADO = "c7f3e9a1-8b4d-4f2e-a5d1-9c8e2b6f4a03";
const REAL = "87b46991-f4b5-4812-9a01-6b2f7e3d5c14";

// 1) Plural: o formato mais comum no corpus (o modelo costuma inventar em lote).
{
  const aviso = avisoDeCardInventado([INVENTADO, "b7c8d92f-4e15-402a-9c1f-a8f3e1b5c9d2"], [REAL]);
  ok(ABERTURA.test(aviso), `abertura do PO-19 nao casa com o plural: ${aviso.slice(0, 120)}`);
  ok(aviso.includes(MIOLO), "miolo do PO-19 sumiu do plural");
  ok(aviso.includes(FECHO), "fecho do PO-19 sumiu do plural");
}

// 2) Singular: a mesma funcao troca a flexao inteira, entao as tres marcas precisam sobreviver
//    aos dois ramos.
{
  const aviso = avisoDeCardInventado([INVENTADO], []);
  ok(ABERTURA.test(aviso), `abertura do PO-19 nao casa com o singular: ${aviso.slice(0, 120)}`);
  ok(aviso.includes(MIOLO), "miolo do PO-19 sumiu do singular");
  ok(aviso.includes(FECHO), "fecho do PO-19 sumiu do singular");
}

// 3) O id inventado precisa estar LITERAL no texto. E o que torna o guarda reconhecivel e, ao
//    mesmo tempo, o que faz o PO-18 encontrar um UUID inexistente numa mensagem correta — a
//    razao de o PO-19 existir. Se o aviso parasse de nomear o id, o gestor perderia o que
//    conferir e o PO-19 viraria uma pergunta sobre nada.
{
  const aviso = avisoDeCardInventado([INVENTADO], [REAL]);
  ok(aviso.includes(INVENTADO), "o aviso deixou de nomear o id inventado");
  ok(aviso.includes(REAL), "o aviso deixou de nomear o card real da rodada");
}

// 4) A frase que o MODELO escreve por conta propria nao pode casar. Este texto real saiu em
//    02/09/2026 e nao e o guarda: e o assistente falando de um anuncio na Meta. Se ele casasse,
//    o PO-19 absolveria fabricacao de verdade, que e o erro caro na direcao oposta.
{
  const doModelo =
    "O identificador não existe na Meta — ele pode estar ainda **PENDENTE de aprovação** " +
    "(o card continua na fila, não foi aprovado ainda) ou o nome está diferente.";
  ok(ABERTURA.test(doModelo), "premissa do caso: a abertura sozinha casa mesmo (por isso nao basta)");
  ok(
    !doModelo.includes(MIOLO) && !doModelo.includes(FECHO),
    "a frase solta do modelo passou a carregar marca de corpo: o PO-19 vai absolver fabricacao",
  );
}

console.log("ok: _prova_guarda_honesto");
