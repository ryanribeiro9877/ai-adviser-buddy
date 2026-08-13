import { describe, it, expect, vi, beforeEach } from "vitest";
import { decideApproval } from "./action-card";

// decideApproval e o portao humano: e a unica porta do front para a RPC
// decide_approval, que sanciona acao em conta de anuncio real. O contrato dos
// parametros importa - p_reason errado grava justificativa no lugar errado, e
// erro engolido faz o gestor acreditar que aprovou o que nao foi aprovado.

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
});

const ID = "7c4be527-92d9-4f55-add1-c988f898acf4";

describe("decideApproval", () => {
  it("chama a RPC decide_approval com os parametros nomeados", async () => {
    await decideApproval(ID, "approved");
    expect(rpcMock).toHaveBeenCalledWith("decide_approval", {
      p_id: ID,
      p_decision: "approved",
      p_reason: null,
    });
  });

  it("encaminha a decisao de rejeicao tal como recebida", async () => {
    await decideApproval(ID, "rejected", "orcamento acima do teto");
    expect(rpcMock).toHaveBeenCalledWith("decide_approval", {
      p_id: ID,
      p_decision: "rejected",
      p_reason: "orcamento acima do teto",
    });
  });

  it("apara espaco do motivo", async () => {
    await decideApproval(ID, "rejected", "   fora de faixa   ");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_reason: "fora de faixa" });
  });

  it.each(["", "   ", "\t\n"])("motivo em branco (%j) vira null, nao string vazia", async (r) => {
    // Diferenca real no banco: '' e um motivo gravado (vazio); null e ausencia
    // de motivo. A coluna e nullable justamente para distinguir os dois.
    await decideApproval(ID, "approved", r);
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_reason: null });
  });

  it("devolve null quando deu certo", async () => {
    expect(await decideApproval(ID, "approved")).toEqual({ error: null });
  });

  it("devolve a mensagem do erro em vez de lancar", async () => {
    // Quem chama faz rollback otimista com base neste retorno; se lancasse, o
    // rollback nao aconteceria e a tela mentiria.
    rpcMock.mockResolvedValue({ error: { message: "permission denied for function" } });
    expect(await decideApproval(ID, "approved")).toEqual({
      error: "permission denied for function",
    });
  });

  it("erro sem message nao vira 'undefined' de texto", async () => {
    rpcMock.mockResolvedValue({ error: {} });
    expect(await decideApproval(ID, "approved")).toEqual({ error: null });
  });
});
