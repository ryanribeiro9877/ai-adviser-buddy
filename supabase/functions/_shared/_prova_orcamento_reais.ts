// Prova do extrator de orcamento diario e do wiring de alterar_orcamento.
// Incidente 12/09/2026: JUR_WA_CONJ.04_9331-6245 para R$ 20 — o extrator leu 4 do NOME
// e propose_action recusou com orcamento_diferente_do_contrato.
// Roda: deno run --allow-read supabase/functions/_shared/_prova_orcamento_reais.ts

import {
  conferirOrcamentoReais,
  extrairOrcamentoDiarioDaFala,
  reaisPedidoAlterarOrcamento,
} from "./orcamento_reais.ts";
import { FERRAMENTAS_BASE } from "./ferramentas_base.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

{
  const fala =
    "2= região metropolitana de Salvador e pessoas com idade de 30 à 65 anos.\n" +
    "a diferença entre os dois grupos não será o orçamento e sim os criativos, " +
    "o conjunto 4 receberá 10 criativos, os outros apenas 8 cada um.\n" +
    "o orçamento será o mesmo nos 4 (30,00).\n" +
    "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26";
  assert(extrairOrcamentoDiarioDaFala(fala) === 30, "contrato dos 4 conjuntos continua 30");
}

{
  const incidente =
    "altere o orçamento desse conjunto JUR_WA_CONJ.04_9331-6245 para 20,00 por favor";
  assert(
    extrairOrcamentoDiarioDaFala(incidente) === 20,
    `incidente CONJ.04 tem de extrair 20, veio ${extrairOrcamentoDiarioDaFala(incidente)}`,
  );
  assert(
    extrairOrcamentoDiarioDaFala(
      "o orçamento do CONJ.1_LAF_8CRIATIVOS_JUN/JUL26 fica (30,00)",
    ) === 30,
    "JUL26/8CRIATIVOS nao vencem o (30,00)",
  );
}

{
  const r = conferirOrcamentoReais({ reais: 20, contrato: 20 });
  assert(r.ok === true && r.ok && r.reais === 20, "20 contra contrato 20 passa");
  const recusa = conferirOrcamentoReais({ reais: 20, contrato: 4 });
  assert(!recusa.ok && recusa.erro === "orcamento_diferente_do_contrato", "20 vs 4 ainda recusa");
}

{
  assert(reaisPedidoAlterarOrcamento({ orcamento_diario_reais: 20 }) === 20, "alias raiz");
  assert(
    reaisPedidoAlterarOrcamento({ params: { orcamento_diario_reais: 20 } }) === 20,
    "alias params (primeira chamada do incidente)",
  );
  assert(reaisPedidoAlterarOrcamento({ novo_orcamento_diario_reais: 20 }) === 20, "campo canonico");
}

{
  const tool = FERRAMENTAS_BASE.alterar_orcamento;
  assert(!!tool, "alterar_orcamento no snapshot");
  assert(tool.efeito === "escrita", "escrita");
  assert(tool.setor === "Atos na conta Meta", "setor AG-06");
  assert(tool.superficies.includes("chat"), "chat");
  assert(!tool.superficies.includes("job"), "job continua sem escrita de orcamento");
  assert(/CONJ\.04/.test(tool.descricao), "descricao cita o incidente CONJ.04");
}

{
  const chat = Deno.readTextFileSync(new URL("../traffic-chat/index.ts", import.meta.url));
  assert(chat.includes("t_alterar_orcamento"), "handler dedicado no chat");
  assert(chat.includes("contratoOrcamentoDaUltimaFala"), "alterar usa a ultima fala");
  assert(chat.includes("reaisPedidoAlterarOrcamento"), "alias no propose");
  assert(/ORCAMENTO E REAIS[\s\S]{0,1200}CONJ\.04/.test(chat), "prompt cita CONJ.04");
  assert(/nome === "alterar_orcamento"/.test(chat), "toolsIncluemPropose conta a tool dedicada");
  assert(chat.includes('case "alterar_orcamento"'), "switch do chat");
}

if (falhas) {
  console.error(`_prova_orcamento_reais: ${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("ok: _prova_orcamento_reais");
