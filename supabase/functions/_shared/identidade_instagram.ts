// supabase/functions/_shared/identidade_instagram.ts
//
// Identidade Instagram no object_story_spec. Modulo separado (e nao dentro de meta-actions) para
// que as funcoes puras possam ser provadas sem subir o Deno.serve da edge.
//
// A Meta tem DOIS objetos diferentes cumprindo o papel de identidade, e o campo do spec depende de
// qual deles e o id:
//   - instagram_user_id  -> id de Instagram Business Account (IBA). Formato 1784 + 13 digitos.
//     O Pipeboard descreve esse parametro literalmente como "Instagram business account ID"
//     em create_existing_post_ad_creative (tools/list, request 620).
//   - instagram_actor_id -> id de ator Instagram LEGADO (formato curto, sem o prefixo 1784).
//     E o UNICO parametro de identidade que o Pipeboard create_ad_creative expoe ("Instagram Actor
//     Id"), que e a tool usada no caminho de criacao de peca nova.
//
// Ate a v5.15 o valor da config ia SEMPRE para instagram_user_id. A escolha do campo do spec
// passa a ser pelo FORMATO do id — nunca por hardcode —, para que IBA (1784...) va para
// instagram_user_id e ator legado va para instagram_actor_id. Oficial Legal: @legaleviver_.

/** Handles/ids Instagram banidos — nunca oferecer nem gravar em peca nova. */
export const INSTAGRAM_HANDLES_PROIBIDOS = ["@jcr2_legaleviver", "jcr2_legaleviver"] as const;
export const INSTAGRAM_IDS_PROIBIDOS = ["1296945687078272"] as const;

export function identidadeInstagramProibida(idOuHandle: string | null | undefined): boolean {
  const s = String(idOuHandle ?? "").trim().toLowerCase();
  if (!s) return false;
  if (INSTAGRAM_IDS_PROIBIDOS.some((x) => s === x)) return true;
  return INSTAGRAM_HANDLES_PROIBIDOS.some((h) => s === h.toLowerCase() || s.includes("jcr2_legaleviver"));
}

export type IdentidadeInstagramResolvida = {
  encontrada: boolean;
  instagram_actor_id: string | null;
  instagram_handle: string | null;
  fonte: "molde_creative_estado_graph" | "config_empresa" | null;
  procedencia: string | null;
  vinculo_pagina_confirmado: boolean | null;
};

export const SEM_IDENTIDADE_INSTAGRAM: IdentidadeInstagramResolvida = {
  encontrada: false,
  instagram_actor_id: null,
  instagram_handle: null,
  fonte: null,
  procedencia: null,
  vinculo_pagina_confirmado: null,
};

export type CampoIdentidadeInstagram = "instagram_user_id" | "instagram_actor_id";

/** 1784+13 digitos = Instagram Business Account; qualquer outro formato = ator legado. */
export function campoIdentidadeInstagramPorFormato(id: string): CampoIdentidadeInstagram {
  return /^1784\d{13,}$/.test(String(id ?? "").trim())
    ? "instagram_user_id"
    : "instagram_actor_id";
}

/** Aplica a identidade resolvida sem deixar dois ids conflitantes no story spec. */
export function aplicarIdentidadeInstagramNoSpec(
  spec: Record<string, unknown>,
  identidade: IdentidadeInstagramResolvida,
): Record<string, unknown> {
  if (!identidade.encontrada || !identidade.instagram_actor_id) return { ...spec };
  const novo = { ...spec };
  delete novo.instagram_user_id;
  delete novo.instagram_actor_id;
  novo[campoIdentidadeInstagramPorFormato(identidade.instagram_actor_id)] =
    identidade.instagram_actor_id;
  return novo;
}

export function avisoIdentidadeInstagram(identidade: IdentidadeInstagramResolvida): string {
  if (!identidade.encontrada || !identidade.instagram_actor_id) {
    return "Sem identidade Instagram comprovada na config/molde. O anuncio nasce sem identidade Instagram. Threads ja esta desabilitado por padrao (empresa sem cadastro). Nenhum id foi inventado.";
  }
  const handle = identidade.instagram_handle ? ` (${identidade.instagram_handle})` : "";
  const origem =
    identidade.fonte === "molde_creative_estado_graph"
      ? "copiada do molde observado em creative_estado_graph"
      : "lida da configuracao da empresa em meta_execution_config";
  const campo = campoIdentidadeInstagramPorFormato(identidade.instagram_actor_id);
  const ressalva =
    campo === "instagram_actor_id"
      ? " IDENTIDADE LEGADA: o id nao tem formato de Instagram Business Account (1784...), entao entra no campo object_story_spec.instagram_actor_id. O vinculo com a pagina NAO foi confirmado por endpoint autenticado (o token nao tem pages_read_engagement) e o GET direto na Graph responde 36106 (endpoint/objeto legado descontinuado) — isso indica objeto existente, mas nao verificavel por leitura. Se a Meta recusar a criacao por identidade, o id precisa ser revalidado no Gerenciador."
      : " Id em formato de Instagram Business Account (1784...), entao entra no campo object_story_spec.instagram_user_id.";
  return `Com identidade Instagram${handle}, id ${identidade.instagram_actor_id}, ${origem}.${ressalva} Posicionamentos de Instagram passam a ser elegiveis. Threads permanece DESABILITADO (empresa sem cadastro nessa rede) — identidade Instagram nao habilita Threads.`;
}
