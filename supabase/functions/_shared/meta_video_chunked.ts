// Contrato do envio em partes Graph (Ad Video / upload_phase).
// Offsets: start inclusivo, end exclusivo — o SDK oficial da Meta le (end - start)
// bytes a partir de start. Quando start === end, a transferencia acabou e vem finish.

export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB = teto da biblioteca de anuncios
export const MAX_IMG_BYTES = 8 * 1024 * 1024;
export const VIDEO_WALL_MS = 90_000;
export const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

export type GraphOffsets = { start: number; end: number };

export type VideoSessao = {
  session_id: string;
  video_id: string;
  start: number;
  end: number;
};

export function parseGraphOffsets(j: { start_offset?: unknown; end_offset?: unknown }): GraphOffsets {
  const start = Number(j.start_offset ?? 0);
  const end = Number(j.end_offset ?? 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    throw new Error(`offsets Graph invalidos: start=${j.start_offset} end=${j.end_offset}`);
  }
  return { start, end };
}

export function chunkByteLength(start: number, end: number): number {
  return end - start;
}

export function transferComplete(start: number, end: number): boolean {
  return start === end;
}

export function nextPhase(start: number, end: number): "transfer" | "finish" {
  return transferComplete(start, end) ? "finish" : "transfer";
}

/** Range HTTP (bytes inclusivos nos dois lados) para o intervalo Graph [start, end). */
export function driveRangeHeader(start: number, endExclusive: number): string {
  if (endExclusive <= start) throw new Error(`faixa Drive vazia: ${start}-${endExclusive}`);
  return `bytes=${start}-${endExclusive - 1}`;
}

/** Se a Graph pediu um bloco maior que o teto de RAM, envia so o teto a partir de start. */
export function faixaAEnviar(start: number, end: number, tetoChunk = MAX_CHUNK_BYTES): GraphOffsets {
  const len = chunkByteLength(start, end);
  if (len <= tetoChunk) return { start, end };
  return { start, end: start + tetoChunk };
}

export function sessaoDeLinha(row: {
  upload_session_id?: unknown;
  upload_video_id?: unknown;
  meta_video_id?: unknown;
  upload_start_offset?: unknown;
  upload_end_offset?: unknown;
} | null | undefined): VideoSessao | null {
  const session_id = String(row?.upload_session_id ?? "").trim();
  const video_id = String(row?.upload_video_id ?? row?.meta_video_id ?? "").trim();
  const start = Number(row?.upload_start_offset);
  const end = Number(row?.upload_end_offset);
  if (!session_id || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { session_id, video_id, start, end };
}

export function recusaTamanhoVideo(tamanho: number): string {
  const mb = (tamanho / 1048576).toFixed(1);
  return `arquivo de ${mb} MB excede o teto da biblioteca da Meta (4 GB / ${MAX_VIDEO_BYTES} bytes). ` +
    `Nao ha corte nem compressao automatica — envie um MP4/MOV de no maximo 4 GB.`;
}

export function recusaTamanhoImagem(tamanho: number): string {
  const mb = (tamanho / 1048576).toFixed(1);
  return `arquivo de ${mb} MB excede o teto operacional de 8 MB para imagem neste carregador.`;
}

export function limitesUploadCopy(): string {
  return `TETO OPERACIONAL = TETO DA META para video: ${MAX_VIDEO_BYTES} bytes (4 GB). ` +
    `Envio em partes (upload_phase start/transfer/finish). Imagem <= 8 MB. ` +
    `Video abaixo de 4 GB NAO e recusado por tamanho.`;
}
