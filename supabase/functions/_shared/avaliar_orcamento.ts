// ESP-26 — uma unica forma de julgar orcamento diario, na proposta E na execucao.
// A doutrina mora na RPC public.avaliar_orcamento_diario; este modulo so chama e traduz
// o resultado para o formato que traffic-chat e meta-actions consomem. Fail-closed:
// verificador que nao respondeu NAO autoriza.

export type AvaliacaoOrcamento =
  | {
      ok: true;
      permitido: true;
      avaliacao: Record<string, unknown>;
      mensagem_para_o_gestor: string;
    }
  | {
      ok: false;
      permitido: false;
      motivo: string;
      detalhe: string;
      avaliacao: Record<string, unknown> | null;
    };

// PromiseLike, nao Promise: supabase-js devolve um PostgrestFilterBuilder, que e
// awaitable mas nao tem catch/finally/Symbol.toStringTag. Exigir Promise aqui
// fazia o deno check recusar todo chamador real (traffic-chat, meta-actions),
// sem que houvesse qualquer problema em runtime - o codigo so faz `await`.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Chama a RPC e devolve ok/motivo. Nunca inventa permitido=true. */
export async function julgarOrcamentoDiario(
  client: RpcClient,
  companyId: string,
  reais: number,
  campanhas: number | null = 1,
): Promise<AvaliacaoOrcamento> {
  if (!(Number(reais) > 0)) {
    return {
      ok: false,
      permitido: false,
      motivo: "valor_invalido",
      detalhe: "Orcamento tem de ser um valor positivo em reais por dia.",
      avaliacao: null,
    };
  }
  const { data, error } = await client.rpc("avaliar_orcamento_diario", {
    p_company_id: companyId,
    p_reais: Number(reais),
    p_campanhas: campanhas,
  });
  if (error || !data || typeof data !== "object") {
    return {
      ok: false,
      permitido: false,
      motivo: "avaliacao_de_orcamento_indisponivel",
      detalhe: `Nao consegui avaliar o orcamento (${error?.message ?? "resposta vazia"}). Sem essa avaliacao, nao autorizo a escrita.`,
      avaliacao: null,
    };
  }
  const orc = data as Record<string, unknown>;
  const mensagem = String(orc.mensagem_para_o_gestor ?? "").trim();
  if (orc.permitido !== true) {
    return {
      ok: false,
      permitido: false,
      motivo: String(orc.motivo ?? "orcamento_nao_permitido"),
      detalhe: mensagem || "Orcamento nao permitido pelo teto de sanidade.",
      avaliacao: orc,
    };
  }
  return {
    ok: true,
    permitido: true,
    avaliacao: orc,
    mensagem_para_o_gestor: mensagem,
  };
}
