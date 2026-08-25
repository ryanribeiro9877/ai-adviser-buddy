// Detecção de pedido de INVENTÁRIO DO DRIVE (pastas Reels/Vídeos, distribuição de criativos).
// Separado do overview de campanhas: "análise completa de criativos das pastas" NÃO é
// visão geral de gasto/CTR. Histórico da conversa não substitui coleta nesta rodada.

export type MeioDrive = "la_felicita" | "juridico";

export type RecorteDrive = {
  meio?: MeioDrive | null;
  soReelsVideos?: boolean;
};

export function deaccPedido(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Pedido de legendas/copy sobre pecas JA selecionadas — nao e inventario novo do Drive. */
export function pedidoUsaSlateExistente(pedido: string): boolean {
  const p = deaccPedido(pedido);
  const pedeLegenda = /\blegendas?\b/.test(p) || /\b(gerar|gere|produzir)\s+copy\b/.test(p);
  const pedeConj = /\bconj(?:unto)?\.?\s*0*[1-9]\d?\b/.test(p);
  const pedeSel =
    /\b(que selecionou|que voce escolheu|sua analise|definicao dos|os 8 videos|8 videos que)\b/.test(p);
  return pedeLegenda && (pedeConj || pedeSel);
}

export function inferirMeioDeProduto(produto: string): MeioDrive | null {
  const p = deaccPedido(produto);
  if (!p) return null;
  if (/imovel|residencial|felicita|la_felicita|\blaf\b|morar|condominio/.test(p)) return "la_felicita";
  if (/juridico|conta_de_luz|cobranca|emprestimo_abusivo/.test(p)) return "juridico";
  return null;
}

/** Pedido que obriga abrir o Drive nesta rodada — não anúncios já publicados na Meta. */
export function pedidoExigeInventarioDrive(pedido: string): boolean {
  if (pedidoUsaSlateExistente(pedido)) return false;
  const p = deaccPedido(pedido);
  if (/\b(google\s*drive|\bno drive\b|\bdo drive\b|\bno google drive\b)\b/.test(p)) return true;
  if (/\bdrive\b/.test(p) && /\b(pasta|pastas|criativ|video|reels|acervo)\b/.test(p)) return true;
  if (/\bdistribuir (os )?criativos\b/.test(p)) return true;
  if (/\breels\b/.test(p) && /\bvideos\b/.test(p) && /\b(junho|julho|agosto|pasta|pastas)\b/.test(p)) return true;
  if (/\bcriativos? (novos?|da pasta|das pastas|do acervo|determinados)\b/.test(p)) return true;
  if (/\bpastas? que possuem o nome\b/.test(p) && /\b(reels|videos)\b/.test(p)) return true;
  return false;
}

export function inferirMeioDrive(pedido: string): MeioDrive | null {
  const p = deaccPedido(pedido);
  const lf = /\bla\s*felicita|\blafelicita|\bfelicita|\bconj\.?\s*[1-4]_laf|\blaf_/.test(p)
    || (/\blf\b/.test(p) && !/\bjuridico\b/.test(p));
  const jur = /\bjuridico\b/.test(p);
  if (lf) return "la_felicita";
  if (jur) return "juridico";
  return null;
}

export function pedidoSoReelsVideos(pedido: string): boolean {
  const p = deaccPedido(pedido);
  if (/\bquaisquer outro nome ignore\b/.test(p) || /\bqualquer outro nome ignore\b/.test(p)) return true;
  if (/\bapenas as pastas\b/.test(p) && /\b(reels|videos)\b/.test(p)) return true;
  if (/\bpastas que possuem o nome\b/.test(p) && /\breels\b/.test(p) && /\bvideos\b/.test(p)) return true;
  if (/\breels\b/.test(p) && /\bvideos\b/.test(p) && /\b(ignore|ignorar)\b/.test(p)) return true;
  return false;
}

export function recorteDriveDoPedido(pedido: string, args?: Record<string, unknown> | null): RecorteDrive {
  const meioArg = String(args?.meio ?? "").trim().toLowerCase();
  const meio: MeioDrive | null = meioArg === "la_felicita" || meioArg === "juridico"
    ? meioArg
    : inferirMeioDrive(pedido);
  const formatos = args?.formatos ?? args?.pastas_formato;
  const soPorArg = Array.isArray(formatos)
    && formatos.map((x) => deaccPedido(String(x))).some((x) => x === "reels" || x === "videos");
  return {
    meio,
    soReelsVideos: soPorArg || pedidoSoReelsVideos(pedido),
  };
}

export function caminhoEhReelsOuVideos(caminho: string): boolean {
  const t = deaccPedido(caminho).replace(/\\/g, "/");
  return /(^|\/)reels(\/|$)/.test(t) || /(^|\/)videos(\/|$)/.test(t);
}

export function pastaFormatoIgnorada(nome: string): boolean {
  const n = deaccPedido(nome).trim();
  return /^(adesivo|adesivos|brutos|cards|card)$/.test(n);
}

export function itemDriveDoMeio(
  item: { caminho?: unknown; arquivo?: unknown; pasta?: unknown; meio?: unknown; pasta_monitorada?: unknown },
  meio: MeioDrive | null | undefined,
): boolean {
  if (!meio) return true;
  const blob = deaccPedido(
    [item.meio, item.caminho, item.arquivo, item.pasta, item.pasta_monitorada].map((x) => String(x ?? "")).join(" "),
  );
  if (meio === "la_felicita") return /felicit|la_felicita|\blaf\b/.test(blob);
  if (meio === "juridico") return /juridic/.test(blob) && !/felicit/.test(blob);
  return true;
}

export function recortarItensDrive<T extends Record<string, unknown>>(itens: T[], recorte: RecorteDrive): T[] {
  return itens.filter((it) => {
    if (!itemDriveDoMeio(it, recorte.meio)) return false;
    if (recorte.soReelsVideos) {
      const caminho = String(it.caminho ?? it.arquivo ?? it.pasta ?? it.pasta_monitorada ?? "");
      const nome = String(it.nome ?? it.formato_pasta ?? "");
      if (!caminhoEhReelsOuVideos(`${caminho}/${nome}`)) return false;
    }
    return true;
  });
}

export function raizDriveDoMeio(
  raiz: { nome?: unknown; meio?: unknown },
  meio: MeioDrive | null | undefined,
): boolean {
  if (!meio) return true;
  return itemDriveDoMeio({ caminho: raiz.nome, meio: raiz.meio }, meio);
}

/** Auto-preenche meio/formatos a partir do pedido se o modelo nao passou. */
export function injetarArgsDrive(
  args: Record<string, unknown> | null | undefined,
  pedido: string,
): Record<string, unknown> {
  const a: Record<string, unknown> = { ...(args ?? {}) };
  const r = recorteDriveDoPedido(pedido, a);
  if (r.meio && !String(a.meio ?? "").trim()) a.meio = r.meio;
  if (r.soReelsVideos && a.formatos == null && a.pastas_formato == null) {
    a.formatos = ["Reels", "Videos"];
  }
  return a;
}

export function pastaFormatoDoPedido(nomePasta: string, recorte: RecorteDrive): boolean {
  if (!recorte.soReelsVideos) return true;
  if (pastaFormatoIgnorada(nomePasta)) return false;
  return caminhoEhReelsOuVideos(nomePasta);
}

/** Payload enxuto: thumbnail explode o teto de 14k e o modelo nao ve os nomes. */
export function arquivoDriveParaAgente(a: Record<string, unknown>): Record<string, unknown> {
  return {
    drive_file_id: a.drive_file_id ?? a.id ?? null,
    nome: a.nome ?? null,
    caminho: a.caminho ?? null,
    pasta_monitorada: a.pasta_monitorada ?? null,
    meio: a.meio ?? null,
    formato_pasta: a.formato_pasta ?? null,
    eixo_pasta: a.eixo_pasta ?? null,
    tipo: a.tipo ?? a.mime ?? null,
    tamanho_bytes: a.tamanho_bytes ?? null,
    modificado_em: a.modificado_em ?? null,
  };
}

export function compactarInventarioDriveParaAgente(
  out: Record<string, unknown>,
  recorte: RecorteDrive,
): Record<string, unknown> {
  const raw = Array.isArray(out.arquivos) ? (out.arquivos as Record<string, unknown>[]) : [];
  const filtrados = recortarItensDrive(raw, recorte).map(arquivoDriveParaAgente);
  const porFormato: Record<string, number> = {};
  const porEixo: Record<string, number> = {};
  for (const a of filtrados) {
    const f = String(a.formato_pasta ?? "(raiz)");
    porFormato[f] = (porFormato[f] ?? 0) + 1;
    if (a.eixo_pasta) porEixo[String(a.eixo_pasta)] = (porEixo[String(a.eixo_pasta)] ?? 0) + 1;
  }
  const recortou = !!(recorte.meio || recorte.soReelsVideos);
  return {
    ...out,
    total_arquivos: filtrados.length,
    recorte,
    resumo_por_formato: porFormato,
    resumo_por_eixo_de_mensagem: porEixo,
    arquivos: filtrados,
    ...(recortou
      ? {
        aviso_recorte:
          "Inventario recortado pelo pedido (meio e/ou so Reels/Videos). O total da empresa NAO e este recorte.",
      }
      : {}),
  };
}

export function aplicarRecorteAcervo(data: unknown, recorte: RecorteDrive): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = { ...(data as Record<string, unknown>) };
  if (!recorte.meio && !recorte.soReelsVideos) return obj;
  const itensIn = Array.isArray(obj.itens) ? (obj.itens as Record<string, unknown>[]) : [];
  const itens = recortarItensDrive(itensIn, recorte);
  const videos = itens.filter((i) => /video/i.test(String(i.tipo ?? i.mime ?? "")));
  const recorteCount = { arquivos: itens.length, videos: videos.length };
  return {
    ...obj,
    itens,
    recorte,
    inventario_global_empresa: obj.inventario_global ?? null,
    inventario_global: recorteCount,
    inventario_recorte: recorteCount,
    aviso_recorte:
      "itens recortados pelo pedido. inventario_global e o RECORTE. O total da empresa ficou em inventario_global_empresa — NAO cite esse total como videos La Felicita.",
  };
}

export function aplicarRecorteAnalisesDrive(data: unknown, recorte: RecorteDrive): unknown {
  if (!data || typeof data !== "object") return data;
  const obj = { ...(data as Record<string, unknown>) };
  if (!recorte.meio && !recorte.soReelsVideos) return obj;
  const itensIn = Array.isArray(obj.itens) ? (obj.itens as Record<string, unknown>[]) : [];
  const itens = recortarItensDrive(itensIn, recorte);
  return {
    ...obj,
    itens,
    recorte,
    total_analisados: itens.length,
    aviso_recorte: "analises recortadas pelo pedido (meio e/ou so Reels/Videos).",
  };
}

export function conjuntoNomeDoMeioLaFelicita(nome: string): boolean {
  const n = deaccPedido(nome);
  return /laf|felicita|conj\.\s*[1-4]/.test(n);
}

export const FOCO_CRIATIVOS_DRIVE =
  "Colete o inventario do Drive NESTA rodada (get_drive_criativos e get_acervo_para_anuncio). " +
  "Se o pedido for La Felicita, passe meio=la_felicita. Se pediu so Reels e Videos, ignore Adesivo/Brutos/Cards. " +
  "PROIBIDO usar get_criativos_conteudo (anuncios ja no ar) como substituto das pastas. " +
  "inventario_global da empresa NAO e 'videos La Felicita' — isole o meio. " +
  "Liste nome + pasta + drive_file_id. Se aviso_corte, recorte por mes/pasta; nao diga que a pasta nao existe. " +
  "Agosto (se pedido exclusivo do CONJ.4) nao entra em CONJ.1-3. Nao invente nome de arquivo.";

export const FOCO_ESTRUTURA_CONJUNTOS_DRIVE =
  "Leia get_estrutura_conjuntos dos conjuntos citados (CONJ.1 a CONJ.4 / nomes LAF). " +
  "Traga targeting (geo, idade), optimization_goal, orcamento e destination_type de CADA conjunto. " +
  "Nao inventarie criativos publicados no lugar do Drive.";
