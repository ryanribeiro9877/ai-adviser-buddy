// supabase/functions/_shared/posicionamento.ts
// PADRAO DE POSICIONAMENTO (decisoes Ryan 11/08/2026; IG Explore off 21/08/2026).
//
// 1) VIDEO + Facebook selecionado: facebook_positions manuais observados nos 3 conjuntos
//    ACTIVE (8 posicoes), SEM right_hand_column. Coluna da direita nao veicula video.
// 2) Threads: DESABILITADO por padrao. A empresa NAO tem cadastro nessa rede; nunca entra em
//    publisher_platforms nem threads_positions. Pedir Threads => recusa nomeada.
// 3) Plataformas de publicacao: o agente PERGUNTA (facebook, instagram, audience_network,
//    messenger). Nao assume em silencio. Instagram usa a identidade oficial da config
//    (@jcr2_legaleviver quando o id estiver comprovado).
// 4) Instagram Explore / explore_home: DESCONTINUADOS pela Meta API (erro 2490589,
//    21/08/2026) — nunca enviar.
// Puro e sem efeito colateral de import, para prova isolada.

export const PLATAFORMAS_PUBLICACAO_SUPORTADAS = [
  "facebook",
  "instagram",
  "audience_network",
  "messenger",
] as const;

export type PlataformaPublicacao = (typeof PLATAFORMAS_PUBLICACAO_SUPORTADAS)[number];

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

/** IG Explore descontinuado (Meta API subcode 2490589, 21/08/2026). */
export const INSTAGRAM_POSITIONS_DESCONTINUADAS = [
  "explore",
  "explore_home",
] as const;

export const INSTAGRAM_POSITIONS_PADRAO = [
  "stream",
  "story",
  "reels",
  "ig_search",
  "profile_feed",
] as const;

export const AUDIENCE_NETWORK_POSITIONS_PADRAO = [
  "classic",
  "rewarded_video",
  "instream_video",
] as const;

export const MESSENGER_POSITIONS_PADRAO = ["messenger_home", "story"] as const;

function normPlataformas(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => String(p ?? "").trim().toLowerCase())
    .filter(Boolean);
}

/** Normaliza e valida a lista pedida pelo gestor. Threads nunca passa. */
export function validarPlataformasPublicacao(raw: unknown): {
  plataformas?: PlataformaPublicacao[];
  erro?: string;
  detalhe?: string;
} {
  const lista = normPlataformas(raw);
  if (lista.length === 0) {
    return {
      erro: "plataformas_de_publicacao_obrigatorias",
      detalhe:
        "Antes de criar o conjunto, pergunte ao gestor em quais redes publicar. Opcoes suportadas: facebook, instagram, audience_network, messenger. Threads esta desabilitado (empresa sem cadastro nessa rede).",
    };
  }
  if (lista.some((p) => p === "threads")) {
    return {
      erro: "threads_desabilitado_empresa_sem_cadastro",
      detalhe:
        "Threads esta desabilitado por padrao: a empresa nao possui perfil/cadastro nessa rede. Nao ha identidade Threads a preencher; o remedia e excluir Threads dos posicionamentos, nao inventar conta. Escolha entre facebook, instagram, audience_network e messenger.",
    };
  }
  const invalidas = lista.filter(
    (p) => !(PLATAFORMAS_PUBLICACAO_SUPORTADAS as readonly string[]).includes(p),
  );
  if (invalidas.length) {
    return {
      erro: "plataforma_de_publicacao_nao_suportada",
      detalhe: `Plataforma(s) nao suportada(s): ${invalidas.join(", ")}. Use apenas: ${PLATAFORMAS_PUBLICACAO_SUPORTADAS.join(", ")}.`,
    };
  }
  const unicas = Array.from(new Set(lista)) as PlataformaPublicacao[];
  return { plataformas: unicas };
}

/**
 * Aplica posicionamento manual conforme plataformas escolhidas + formato.
 * - Sempre remove Threads.
 * - Facebook + video => 8 facebook_positions observados, sem right_hand_column.
 * - Facebook + imagem => nao aplica a exclusao da Coluna (imagem veicula la); se o molde
 *   ja tinha facebook_positions, remove so threads e filtra publishers.
 * - Instagram/AN/Messenger => placements padrao da plataforma quando selecionados.
 */
export function aplicarPosicionamentoPorPlataformas(
  targetingAtual: Record<string, unknown>,
  formato: string,
  plataformasRaw: unknown,
): {
  targeting?: Record<string, unknown>;
  excluidos: string[];
  plataformas?: PlataformaPublicacao[];
  erro?: string;
  detalhe?: string;
  perfil?: string;
  declaracao?: string;
} {
  const validacao = validarPlataformasPublicacao(plataformasRaw);
  if (validacao.erro || !validacao.plataformas) {
    return {
      excluidos: [],
      erro: validacao.erro,
      detalhe: validacao.detalhe,
    };
  }
  const plataformas = validacao.plataformas;
  const f = String(formato ?? "").trim().toLowerCase();
  const novo: Record<string, unknown> = { ...(targetingAtual ?? {}) };

  // Threads nunca.
  delete novo.threads_positions;
  novo.publisher_platforms = [...plataformas];

  const excluidos: string[] = ["threads"];
  const notes: string[] = [
    "Threads desabilitado por padrao (empresa sem cadastro nessa rede).",
  ];

  if (plataformas.includes("facebook")) {
    if (f === "video") {
      novo.facebook_positions = [...FACEBOOK_POSITIONS_VIDEO_PADRAO];
      excluidos.push("facebook.right_hand_column");
      notes.push(
        "Facebook+video: posicionamentos manuais dos 3 conjuntos ativos; Coluna da direita excluida por incompatibilidade de formato.",
      );
    } else if (f === "imagem") {
      // Imagem: Coluna elegivel. Se o molde ja tinha lista manual, preserva (sem forcar exclusao).
      // Se nao tinha, nao inventamos lista de imagem — Advantage+/automatico no Facebook permanece
      // possivel via ausencia de facebook_positions; publisher ja esta restrito a selecao.
      notes.push(
        "Facebook+imagem: Coluna da direita permanece elegivel; nenhuma exclusao automatica de right_hand_column.",
      );
    } else {
      return {
        excluidos: [],
        erro: "formato_de_midia_obrigatorio_quando_facebook_selecionado",
        detalhe:
          "Facebook foi selecionado, mas formato_midia_previsto nao foi declarado (video|imagem). Sem o formato nao sei se a Coluna da direita deve sair. Declare o formato.",
      };
    }
  } else {
    delete novo.facebook_positions;
  }

  if (plataformas.includes("instagram")) {
    novo.instagram_positions = [...INSTAGRAM_POSITIONS_PADRAO];
    excluidos.push("instagram.explore", "instagram.explore_home");
    notes.push(
      "Instagram selecionado: stream/story/reels/ig_search/profile_feed. Explore e explore_home DESCONTINUADOS (Meta 2490589) — nunca enviar.",
    );
  } else {
    delete novo.instagram_positions;
  }

  if (plataformas.includes("audience_network")) {
    novo.audience_network_positions = [...AUDIENCE_NETWORK_POSITIONS_PADRAO];
  } else {
    delete novo.audience_network_positions;
  }

  if (plataformas.includes("messenger")) {
    novo.messenger_positions = [...MESSENGER_POSITIONS_PADRAO];
  } else {
    delete novo.messenger_positions;
  }

  return {
    targeting: novo,
    excluidos,
    plataformas,
    perfil: "plataformas_escolhidas_pelo_gestor_v1",
    declaracao: notes.join(" "),
  };
}

/**
 * Remove posicionamentos Instagram descontinuados (explore / explore_home) de qualquer
 * targeting — molde antigo ou lista manual. Meta API 2490589 (21/08/2026).
 */
export function sanitizarPosicionamentosInstagramDescontinuados(
  targeting: Record<string, unknown>,
): { targeting: Record<string, unknown>; removidos: string[] } {
  const novo: Record<string, unknown> = { ...(targeting ?? {}) };
  const ban = new Set(INSTAGRAM_POSITIONS_DESCONTINUADAS as readonly string[]);
  const removidos: string[] = [];
  if (Array.isArray(novo.instagram_positions)) {
    const antes = (novo.instagram_positions as unknown[]).map(String);
    const depois = antes.filter((p) => {
      if (ban.has(p)) {
        removidos.push(`instagram.${p}`);
        return false;
      }
      return true;
    });
    if (depois.length) novo.instagram_positions = depois;
    else delete novo.instagram_positions;
  }
  return { targeting: novo, removidos };
}

/** Compat: video-only facebook padrao (acao corretiva / criacao legada sem lista). */
export function aplicarPadraoPosicionamentoVideo(
  targetingAtual: Record<string, unknown>,
): { targeting: Record<string, unknown>; excluidos: string[] } {
  const r = aplicarPosicionamentoPorPlataformas(targetingAtual, "video", ["facebook"]);
  return {
    targeting: r.targeting ?? { ...(targetingAtual ?? {}) },
    excluidos: r.excluidos,
  };
}

/**
 * Acao CORRETIVA (ajustar_posicionamentos_do_conjunto).
 * Video: padrao facebook manual sem Coluna + Threads off.
 * Imagem: nao exclui Coluna; ainda assim remove Threads (empresa sem cadastro).
 */
export function targetingCompativelComFormato(
  targetingAtual: Record<string, unknown>,
  formato: string,
): { targeting?: Record<string, unknown>; excluidos: string[]; erro?: string; perfil?: string } {
  const f = String(formato ?? "").trim().toLowerCase();
  if (f !== "video" && f !== "imagem") {
    return { excluidos: [], erro: "formato_de_midia_nao_suportado_para_posicionamento" };
  }

  const base = { ...(targetingAtual ?? {}) };
  // Sempre corta Threads no corretivo (decisao Ryan 11/08).
  delete base.threads_positions;
  const pubs = Array.isArray(base.publisher_platforms)
    ? (base.publisher_platforms as unknown[]).map(String).filter((p) => p !== "threads")
    : null;
  if (pubs) base.publisher_platforms = pubs;

  if (f === "imagem") {
    const tinhaThreads =
      Array.isArray((targetingAtual ?? {}).publisher_platforms) &&
      ((targetingAtual as any).publisher_platforms as unknown[]).map(String).includes("threads");
    if (!tinhaThreads && !(targetingAtual as any)?.threads_positions) {
      return {
        excluidos: [],
        erro: "nenhum_posicionamento_incompativel_detectado",
        perfil: "imagem_sem_threads_e_sem_exclusao_de_coluna",
      };
    }
    return {
      targeting: base,
      excluidos: ["threads"],
      perfil: "imagem_remove_threads_mantem_coluna_direita",
    };
  }

  const { targeting, excluidos } = aplicarPadraoPosicionamentoVideo(base);
  return {
    targeting,
    excluidos: Array.from(new Set([...excluidos, "threads"])),
    perfil: "padrao_video_facebook_manual_observado_3_conjuntos_ativos_threads_off",
  };
}
