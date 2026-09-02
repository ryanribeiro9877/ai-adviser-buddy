// Detecção de pedido de INVENTÁRIO DO DRIVE (pastas Reels/Vídeos, distribuição de criativos).
// Separado do overview de campanhas: "análise completa de criativos das pastas" NÃO é
// visão geral de gasto/CTR. Histórico da conversa não substitui coleta nesta rodada.

import { ehPedidoOrigemDriveDosAnuncios } from "./intencao_turno.ts";

export const MEIOS_DRIVE = ["la_felicita", "juridico", "sistema_ocular"] as const;
export type MeioDrive = (typeof MEIOS_DRIVE)[number];

export function parseMeioDriveArg(raw: unknown): MeioDrive | null {
  const m = deaccPedido(String(raw ?? "")).trim().replace(/\s+/g, "_");
  if (!m) return null;
  if (m === "la_felicita" || m === "lafelicita" || m === "lf") return "la_felicita";
  if (m === "juridico" || m === "jur") return "juridico";
  if (m === "sistema_ocular" || m === "sistemaocular" || m === "ocular" || m === "vistta") {
    return "sistema_ocular";
  }
  return null;
}

/** Pasta/marca VISTTA = empreendimento Sistema Ocular (nao e Juridico nem La Felicita). */
export function textoTemSistemaOcular(p: string): boolean {
  const n = deaccPedido(p);
  return /vistta/.test(n) || /sistema[\s_-]*ocular/.test(n) || /\bocular\b/.test(n) || /oftalm/.test(n);
}

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
  if (textoTemSistemaOcular(p)) return "sistema_ocular";
  if (/imovel|residencial|felicita|la_felicita|\blaf\b|morar|condominio/.test(p)) return "la_felicita";
  if (/juridico|conta_de_luz|cobranca|emprestimo_abusivo/.test(p)) return "juridico";
  return null;
}

/** Pedido que obriga abrir o Drive nesta rodada — não anúncios já publicados na Meta. */
export function pedidoExigeInventarioDrive(pedido: string): boolean {
  if (pedidoUsaSlateExistente(pedido)) return false;
  if (ehPedidoOrigemDriveDosAnuncios(pedido)) return false;
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
  const oc = textoTemSistemaOcular(p);
  const lf = /\bla\s*felicita|\blafelicita|\bfelicita|\bconj\.?\s*[1-4]_laf|\blaf_/.test(p)
    || (/\blf\b/.test(p) && !/\bjuridico\b/.test(p) && !oc);
  const jur = /\bjuridico\b/.test(p);
  const hits: MeioDrive[] = [];
  if (oc) hits.push("sistema_ocular");
  if (lf) hits.push("la_felicita");
  if (jur) hits.push("juridico");
  if (hits.length === 1) return hits[0];
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
  const meio: MeioDrive | null = parseMeioDriveArg(args?.meio) ?? inferirMeioDrive(pedido);
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

/** "2Carrossel 1.png" / "3Carrossel 3.png" → "2" / "3". Slides do mesmo numero sao UM peca. */
export function serieCarrosselDrive(nome: string): string | null {
  const n = deaccPedido(nome).trim();
  const m = n.match(/^(\d+)\s*carrossel\b/);
  return m ? m[1] : null;
}

export function itemDriveDoMeio(
  item: { caminho?: unknown; arquivo?: unknown; pasta?: unknown; meio?: unknown; pasta_monitorada?: unknown },
  meio: MeioDrive | null | undefined,
): boolean {
  if (!meio) return true;
  const blob = deaccPedido(
    [item.meio, item.caminho, item.arquivo, item.pasta, item.pasta_monitorada].map((x) => String(x ?? "")).join(" "),
  );
  if (meio === "sistema_ocular") {
    return textoTemSistemaOcular(blob);
  }
  if (meio === "la_felicita") {
    return /felicit|la_felicita|\blaf\b/.test(blob) && !textoTemSistemaOcular(blob);
  }
  if (meio === "juridico") {
    return /juridic/.test(blob) && !/felicit/.test(blob) && !textoTemSistemaOcular(blob);
  }
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

/** 2026 / 08. Agosto — VISTTA nao tem Reels no 1o nivel da raiz. */
export function pastaIntermediariaCalendario(nome: string): boolean {
  const n = deaccPedido(nome).trim();
  if (/^\d{4}$/.test(n)) return true;
  if (/^(0?[1-9]|1[0-2])[.\-\s]+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(n)) {
    return true;
  }
  return false;
}

/**
 * Varredura do Drive: desce ano/mes e Reels/Videos; nao entra em Adesivo/Brutos/Cards.
 * Antes, soReelsVideos no nivel 0 pulava "2026" e o inventario VISTTA voltava vazio.
 */
export function deveDescerPastaDrive(nomePasta: string, recorte: RecorteDrive, nivel: number): boolean {
  if (pastaFormatoIgnorada(nomePasta)) return false;
  if (!recorte.soReelsVideos) return true;
  if (caminhoEhReelsOuVideos(nomePasta) || pastaIntermediariaCalendario(nomePasta)) return true;
  return nivel >= 1;
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
  "COHAPM tem TRES meios: juridico, la_felicita, sistema_ocular (pasta VISTTA / Sistema Ocular). " +
  "Se o pedido for La Felicita, passe meio=la_felicita. Se for Sistema Ocular/VISTTA, meio=sistema_ocular. " +
  "Se pediu so Reels e Videos, ignore Adesivo/Brutos/Cards. " +
  "PROIBIDO usar get_criativos_conteudo (anuncios ja no ar) como substituto das pastas. " +
  "inventario_global da empresa NAO e o recorte de um empreendimento — isole o meio. " +
  "Liste nome + pasta + drive_file_id. Se aviso_corte, recorte por mes/pasta; nao diga que a pasta nao existe. " +
  "Agosto (se pedido exclusivo do CONJ.4 La Felicita) nao entra em CONJ.1-3. Nao invente nome de arquivo.";

export const FOCO_ESTRUTURA_CONJUNTOS_DRIVE =
  "Leia get_estrutura_conjuntos dos conjuntos citados (CONJ.1 a CONJ.4 / nomes LAF). " +
  "Traga targeting (geo, idade), optimization_goal, orcamento e destination_type de CADA conjunto. " +
  "Nao inventarie criativos publicados no lugar do Drive.";
