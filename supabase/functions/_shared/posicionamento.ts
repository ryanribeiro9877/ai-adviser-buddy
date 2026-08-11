// supabase/functions/_shared/posicionamento.ts
// PADRAO DE POSICIONAMENTO DE VIDEO, OBSERVADO EM PRODUCAO (11/08/2026).
// Auditoria read-only dos 3 conjuntos com anuncios de VIDEO ACTIVE mostrou o MESMO targeting
// manual nos tres: publisher_platforms=["facebook"] e estes 8 facebook_positions, SEM
// right_hand_column (a Coluna da direita nao veicula video). Este modulo e a UNICA fonte desse
// padrao: a criacao do conjunto (montarCriacao) e a acao corretiva
// (ajustar_posicionamentos_do_conjunto) consomem daqui, para nunca divergirem. Puro e sem efeito
// colateral de import, de proposito, para poder ser provado em teste isolado.

export const PUBLISHER_PLATFORMS_VIDEO_PADRAO = ["facebook"] as const;

export const FACEBOOK_POSITIONS_VIDEO_PADRAO = [
  "feed",
  "instream_video",
  "marketplace",
  "story",
  "search",
  "facebook_reels",
  "facebook_reels_overlay",
  "profile_feed",
] as const;

// Aplica o padrao de video sobre um targeting existente: PRESERVA audiencia/geo/idade/automation
// e SUBSTITUI apenas as chaves de posicionamento pelo padrao facebook-only observado. Como o
// publisher passa a ser so facebook, as colocacoes de outras plataformas saem (senao a Meta
// recusa placement de plataforma nao declarada). right_hand_column nunca entra.
export function aplicarPadraoPosicionamentoVideo(
  targetingAtual: Record<string, unknown>,
): { targeting: Record<string, unknown>; excluidos: string[] } {
  const novo: Record<string, unknown> = { ...(targetingAtual ?? {}) };
  delete novo.instagram_positions;
  delete novo.threads_positions;
  delete novo.audience_network_positions;
  delete novo.messenger_positions;
  novo.publisher_platforms = [...PUBLISHER_PLATFORMS_VIDEO_PADRAO];
  novo.facebook_positions = [...FACEBOOK_POSITIONS_VIDEO_PADRAO];
  return { targeting: novo, excluidos: ["facebook.right_hand_column"] };
}

// Acao CORRETIVA (ajustar_posicionamentos_do_conjunto) para conjuntos antigos/de teste ja
// criados. Video: aplica o MESMO padrao observado, tornando o resultado deterministico e igual
// ao que a criacao passa a fazer. Imagem: nao exclui nada (a Coluna da direita veicula imagem).
export function targetingCompativelComFormato(
  targetingAtual: Record<string, unknown>,
  formato: string,
): { targeting?: Record<string, unknown>; excluidos: string[]; erro?: string; perfil?: string } {
  const f = String(formato ?? "").trim().toLowerCase();
  if (f !== "video" && f !== "imagem") {
    return { excluidos: [], erro: "formato_de_midia_nao_suportado_para_posicionamento" };
  }
  if (f === "imagem") {
    return {
      excluidos: [],
      erro: "nenhum_posicionamento_incompativel_detectado",
      perfil: "imagem_nao_exige_exclusao_da_coluna_direita",
    };
  }
  const { targeting, excluidos } = aplicarPadraoPosicionamentoVideo(targetingAtual ?? {});
  return {
    targeting,
    excluidos,
    perfil: "padrao_video_facebook_manual_observado_3_conjuntos_ativos",
  };
}
