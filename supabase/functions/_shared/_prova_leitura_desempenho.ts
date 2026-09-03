// Prova: deno run supabase/functions/_shared/_prova_leitura_desempenho.ts
import {
  casarCampanhas,
  escolherCampanhaUnica,
  parseJanelaDatasPedido,
  janelaDetalhe,
} from "./leitura_desempenho.ts";
import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";
import { replyLeituraIncompleta, ehPedidoDetalhamentoCampanha } from "./intencao_turno.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const camps = [
  { id: "u1", name: "[LEV][LP][LEADS][CLT][TESTE][MIX][AGO26]", external_id: "120236111111111111" },
  { id: "u2", name: "[LEV][SOCIAL][ENGAJAMENTO][TESTE][IMPULSAO][AGO26]", external_id: "120236222222222222" },
];

assert(casarCampanhas(camps, "120236111111111111").length === 1, "casa por ID Meta");
assert(casarCampanhas(camps, "MIX][AGO26").length === 1, "casa por trecho de nome");
assert(casarCampanhas(camps, "999999999999").length === 0, "ID inexistente");
assert(escolherCampanhaUnica(casarCampanhas(camps, "120236222222222222"), "120236222222222222").unica?.id === "u2", "unica por ID");
assert(escolherCampanhaUnica(camps, "LEV").ambiguo?.length === 2, "substring comum fica ambigua");

const j = parseJanelaDatasPedido("detalhe 21/08 a 27/08/2026 das duas campanhas", "2026-08-27");
assert(j.date_from === "2026-08-21", `from=${j.date_from}`);
assert(j.date_to === "2026-08-27", `to=${j.date_to}`);

const j2 = parseJanelaDatasPedido("de 2026-08-21 a 2026-08-27");
assert(j2.date_from === "2026-08-21" && j2.date_to === "2026-08-27", "iso");

const jan = janelaDetalhe("2026-08-21", "2026-08-27");
assert(jan.from === "2026-08-21" && jan.to === "2026-08-27", "janela explícita");

assert(
  ehPedidoDetalhamentoCampanha(
    "detalhamento das campanhas 120236111 e 120236222, janela 21/08 a 27/08, por anúncio e diário",
  ),
  "pedido de detalhamento",
);
assert(
  ehPedidoDetalhamentoCampanha(
    "analise as campanhas 120236111111111111 e 120236222222222222, janela 21/08 a 27/08",
  ),
  "pedido com ID Meta e janela",
);
assert(!ehPedidoDetalhamentoCampanha("qual o status da conta?"), "status simples nao e detalhamento");

const prosaIncompleta = `
A configuração das campanhas e dos conjuntos foi lida; o detalhamento de desempenho diário por conjunto e anúncio não foi retornado nesta rodada.
O detalhamento dos anúncios de ambos os conjuntos não foi lido nesta rodada.
A série diária separada por conjunto e anúncio não ficou disponível nesta rodada.
`;
assert(replyLeituraIncompleta(prosaIncompleta), "prosa de lacuna deve continuar");
assert(
  replyLeituraIncompleta("Não foi possível verificar nesta rodada. Envie novamente uma nova pergunta."),
  "pede eco",
);
assert(
  !replyLeituraIncompleta("As duas campanhas estão ativas. Gasto da janela: R$ 420,00. Ranking por anúncio abaixo."),
  "relatorio fechado nao dispara",
);

// A definicao passou para o registro (public.agent_ferramentas / ferramentas_base.ts). A
// prova continua a mesma: o contrato de que exclusos ficam fora do inventario precisa estar
// declarado ANTES da chamada — o modelo decide o que pedir pela descricao, nao pelo retorno.
assert(
  FERRAMENTAS_BASE.get_detalhe_anuncios.descricao.includes("PAGINADO"),
  "tool detalhe declara paginacao",
);

console.log("ok leitura_desempenho");
