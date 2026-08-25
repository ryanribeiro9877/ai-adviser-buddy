/** Relatorio deterministico de lote de upload (Drive -> biblioteca Meta). */

export type PecaRef = { drive_file_id: string; nome: string };

export type LinhaUpload = {
  drive_file_id: string;
  nome: string;
  estado: "enviado" | "dedup" | "em_andamento" | "recusado" | "erro";
  detalhe: string;
};

export type RelatorioUpload = {
  teveAcervo: boolean;
  pendentesAcervo: PecaRef[];
  jaNaMeta: PecaRef[];
  totalAcervo: number;
  linhas: LinhaUpload[];
  faltam: PecaRef[];
  tetoHora: boolean;
  incompleto: boolean;
  markdown: string;
};

type ToolRes = { tool: string; args?: unknown; retorno?: unknown; erro?: string };

function objDe(retorno: unknown): Record<string, unknown> | null {
  if (!retorno) return null;
  if (typeof retorno === "object" && !Array.isArray(retorno)) {
    return retorno as Record<string, unknown>;
  }
  if (typeof retorno === "string") {
    try {
      const j = JSON.parse(retorno);
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch { /* recorte de payload */ }
  }
  return null;
}

function nomeDeArquivo(o: Record<string, unknown> | null, fallback: string): string {
  if (!o) return fallback;
  const direto = String(o.nome ?? "").trim();
  if (direto) return direto;
  const arq = o.arquivo;
  if (arq && typeof arq === "object") {
    const n = String((arq as Record<string, unknown>).nome ?? "").trim();
    if (n) return n;
  }
  return fallback;
}

export function inventarioDoAcervo(retorno: unknown): { total: number; naMeta: PecaRef[]; fora: PecaRef[] } {
  const o = objDe(retorno);
  if (!o) return { total: 0, naMeta: [], fora: [] };
  const itens = Array.isArray(o.itens) ? o.itens : [];
  const naMeta: PecaRef[] = [];
  const fora: PecaRef[] = [];
  for (const it of itens) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const id = String(r.drive_file_id ?? "").trim();
    if (!id) continue;
    const peca = { drive_file_id: id, nome: String(r.nome ?? id) };
    if (r.na_biblioteca_da_meta === true) naMeta.push(peca);
    else fora.push(peca);
  }
  return { total: naMeta.length + fora.length, naMeta, fora };
}

export function itensPendentesDoAcervo(retorno: unknown): PecaRef[] {
  return inventarioDoAcervo(retorno).fora;
}

export function apurarUploadLote(
  results: ToolRes[],
  seedPendentes?: PecaRef[] | null,
  seedJaNaMeta?: PecaRef[] | null,
): RelatorioUpload {
  let pendentesAcervo: PecaRef[] = seedPendentes?.length ? [...seedPendentes] : [];
  let jaNaMeta: PecaRef[] = seedJaNaMeta?.length ? [...seedJaNaMeta] : [];
  let teveAcervo = !!(seedPendentes && seedPendentes.length) || !!(seedJaNaMeta && seedJaNaMeta.length);
  let totalAcervo = pendentesAcervo.length + jaNaMeta.length;
  const linhas: LinhaUpload[] = [];
  let tetoHora = false;

  for (const t of results) {
    const nomeTool = String(t.tool ?? "");
    if (nomeTool === "get_acervo_para_anuncio") {
      const inv = inventarioDoAcervo(t.retorno);
      const o = objDe(t.retorno);
      if (o) {
        teveAcervo = true;
        pendentesAcervo = inv.fora;
        jaNaMeta = inv.naMeta;
        totalAcervo = inv.total;
      }
    }
    if (nomeTool !== "upload_midia") continue;
    const o = objDe(t.retorno);
    const args = (t.args && typeof t.args === "object") ? t.args as Record<string, unknown> : {};
    const id = String(o?.drive_file_id ?? args.drive_file_id ?? "").trim();
    const nome = nomeDeArquivo(o, id);
    const motivo = String(o?.motivo ?? o?.erro ?? o?.error ?? t.erro ?? "");
    if (/teto por hora/i.test(motivo) || /teto por hora/i.test(String(t.erro ?? ""))) tetoHora = true;
    let estado: LinhaUpload["estado"] = "erro";
    let detalhe = motivo || String(t.erro ?? "falhou");
    if (o?.recusado) {
      estado = "recusado";
      detalhe = motivo || "recusado";
    } else if (o?.em_andamento) {
      estado = "em_andamento";
      const enviados = o.bytes_enviados ?? "?";
      const total = o.tamanho_bytes ?? "?";
      detalhe = `${enviados}/${total} bytes`;
    } else if (o?.dedup) {
      estado = "dedup";
      detalhe = "ja estava na biblioteca";
    } else if (
      o && o.ok !== false &&
      (o.enviado || o.meta_video_id || o.video_id || o.meta_image_hash || o.image_hash)
    ) {
      estado = "enviado";
      detalhe = String(o.meta_video_id ?? o.video_id ?? o.meta_image_hash ?? o.image_hash ?? "ok");
    } else if (t.erro) {
      estado = "erro";
      detalhe = String(t.erro);
    }
    if (id) linhas.push({ drive_file_id: id, nome: nome || id, estado, detalhe });
  }

  const feitos = new Set(
    linhas.filter((l) => l.estado === "enviado" || l.estado === "dedup").map((l) => l.drive_file_id),
  );
  const faltam = pendentesAcervo.filter((p) => !feitos.has(p.drive_file_id));
  const emAndamento = linhas.some((l) => l.estado === "em_andamento");
  const incompleto = faltam.length > 0 || emAndamento;
  for (const l of linhas) {
    if ((l.estado === "enviado" || l.estado === "dedup") &&
      !jaNaMeta.some((p) => p.drive_file_id === l.drive_file_id)) {
      jaNaMeta.push({ drive_file_id: l.drive_file_id, nome: l.nome });
    }
  }
  if (!totalAcervo) totalAcervo = jaNaMeta.length + faltam.length;

  const bloco = (titulo: string, itens: string[]) =>
    itens.length ? `**${titulo}**\n${itens.map((x) => `- ${x}`).join("\n")}` : "";

  const enviados = linhas
    .filter((l) => l.estado === "enviado" || l.estado === "dedup")
    .map((l) => `${l.nome} — ${l.estado === "dedup" ? "ja estava na biblioteca" : `na biblioteca (${l.detalhe})`}`);
  const andamento = linhas
    .filter((l) => l.estado === "em_andamento")
    .map((l) => `${l.nome} — envio em partes (${l.detalhe})`);
  const erros = linhas
    .filter((l) => l.estado === "recusado" || l.estado === "erro")
    .map((l) => `${l.nome} — ${l.detalhe}`);
  const naMetaLinhas = jaNaMeta.map((p) => `${p.nome} (${p.drive_file_id})`);
  const faltaLinhas = faltam.map((p) => `${p.nome} (${p.drive_file_id})`);

  const partes = [
    "## Status do upload",
    (teveAcervo || totalAcervo)
      ? `**Recorte:** ${totalAcervo || "?"} pecas. Ja na Meta: ${jaNaMeta.length}. Fora: ${faltam.length}.`
      : "",
    bloco("Ja na Meta", naMetaLinhas),
    bloco("Enviados neste bloco", enviados),
    bloco("Em andamento", andamento),
    bloco("Recusados ou com erro", erros),
    faltaLinhas.length
      ? bloco("Ainda fora da Meta", faltaLinhas)
      : (teveAcervo || linhas.length
        ? "**Ainda fora da Meta:** nenhum — todos os faltantes deste recorte ja estao na biblioteca."
        : ""),
    tetoHora
      ? "_Parou porque a ferramenta recusou teto horario de verdade. Os nomes acima continuam pendentes; nao peca ao gestor para repetir o pedido — retome quando houver folga._"
      : (incompleto
        ? "_O sistema continua automaticamente os que faltam neste pedido. Nao peca ao gestor para repetir \"suba os restantes\"._"
        : ""),
  ].filter(Boolean);

  return {
    teveAcervo,
    pendentesAcervo,
    jaNaMeta,
    totalAcervo,
    linhas,
    faltam,
    tetoHora,
    incompleto,
    markdown: partes.join("\n\n"),
  };
}

export function anexarRelatorioUpload(reply: string, rel: RelatorioUpload): string {
  const base = String(reply ?? "")
    .replace(/\n*_Continuando automaticamente[^\n]*_/gi, "")
    .trim();
  if (!rel.markdown) return base;
  if (/##\s*status do upload/i.test(base)) return base;
  return (base ? base + "\n\n" : "") + rel.markdown;
}
