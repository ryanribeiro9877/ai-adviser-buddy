// Prova pura do formato de julgarOrcamentoDiario (sem rede).
import { julgarOrcamentoDiario } from "./avaliar_orcamento.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const fakeOk = {
    async rpc() {
      return {
        data: {
          permitido: true,
          motivo: "dentro_do_teto_de_sanidade",
          mensagem_para_o_gestor: "ok",
          exposicao_atual_por_dia: 100,
        },
        error: null,
      };
    },
  };
  const r1 = await julgarOrcamentoDiario(fakeOk, "00000000-0000-0000-0000-000000000001", 60, 1);
  assert(r1.ok === true && r1.permitido === true, "permitido=true deve passar");

  const fakeNao = {
    async rpc() {
      return {
        data: {
          permitido: false,
          motivo: "acima_do_teto_de_sanidade",
          mensagem_para_o_gestor: "acima",
        },
        error: null,
      };
    },
  };
  const r2 = await julgarOrcamentoDiario(fakeNao, "00000000-0000-0000-0000-000000000001", 9999, 1);
  assert(r2.ok === false && r2.motivo === "acima_do_teto_de_sanidade", "acima do teto deve bloquear");

  const fakeErro = {
    async rpc() {
      return { data: null, error: { message: "boom" } };
    },
  };
  const r3 = await julgarOrcamentoDiario(fakeErro, "00000000-0000-0000-0000-000000000001", 60, 1);
  assert(
    r3.ok === false && r3.motivo === "avaliacao_de_orcamento_indisponivel",
    "RPC fora = fail-closed",
  );

  const r4 = await julgarOrcamentoDiario(fakeOk, "00000000-0000-0000-0000-000000000001", 0, 1);
  assert(r4.ok === false && r4.motivo === "valor_invalido", "zero invalido");

  console.log("prova_avaliar_orcamento: 4/4 OK");
}

main().catch((e) => {
  console.error(e);
  Deno.exit(1);
});
