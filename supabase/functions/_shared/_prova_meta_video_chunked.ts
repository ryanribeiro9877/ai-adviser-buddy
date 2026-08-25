// deno run --allow-read supabase/functions/_shared/_prova_meta_video_chunked.ts
import {
  MAX_VIDEO_BYTES,
  chunkByteLength,
  driveRangeHeader,
  faixaAEnviar,
  limitesUploadCopy,
  nextPhase,
  parseGraphOffsets,
  recusaTamanhoVideo,
  sessaoDeLinha,
  transferComplete,
} from "./meta_video_chunked.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const start = parseGraphOffsets({ start_offset: "0", end_offset: "1048576" });
assert(start.start === 0 && start.end === 1048576, "offsets string da Graph");
assert(chunkByteLength(start.start, start.end) === 1048576, "1 MiB exclusivo");
assert(driveRangeHeader(0, 1048576) === "bytes=0-1048575", "Range Drive inclusivo");
assert(nextPhase(0, 1048576) === "transfer", "ainda tem bytes");
assert(!transferComplete(0, 1048576), "nao acabou");

const fim = parseGraphOffsets({ start_offset: 4294967296, end_offset: 4294967296 });
assert(transferComplete(fim.start, fim.end), "start===end fecha transfer");
assert(nextPhase(fim.start, fim.end) === "finish", "proxima fase e finish");

const cap = faixaAEnviar(0, 200 * 1024 * 1024, 64 * 1024 * 1024);
assert(cap.end - cap.start === 64 * 1024 * 1024, "teto de RAM recorta o pedido da Graph");
assert(faixaAEnviar(10, 20, 64 * 1024 * 1024).end === 20, "bloco pequeno segue inteiro");

const sessao = sessaoDeLinha({
  upload_session_id: "sess-1",
  upload_video_id: "vid-9",
  upload_start_offset: 1048576,
  upload_end_offset: 2097152,
});
assert(sessao?.session_id === "sess-1" && sessao.start === 1048576, "retoma da linha");
assert(sessaoDeLinha({ upload_session_id: "", upload_start_offset: 0, upload_end_offset: 1 }) === null, "sem sessao");

assert(MAX_VIDEO_BYTES === 4 * 1024 * 1024 * 1024, "4 GiB");
assert(!recusaTamanhoVideo(50 * 1024 * 1024).includes("45"), "50 MB nao e recusa de 45");
assert(recusaTamanhoVideo(MAX_VIDEO_BYTES + 1).includes("4 GB"), "acima de 4 GB cita Meta");
assert(limitesUploadCopy().includes("4 GB"), "copy operacional casa com a Meta");

const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const edge = await Deno.readTextFile(new URL("../upload-midia/index.ts", import.meta.url));
assert(!/teto OPERACIONAL de 45 MB|recusa video acima de 45 MB|video <= 45 MB/.test(chat), "chat sem teto 45 MB");
assert(!/video <= 45 MB|teto_operacional_video_mb: 45/.test(job), "job sem teto 45 MB");
assert(edge.includes("enviarVideoEmPartes"), "edge usa envio em partes");
assert(edge.includes("upload_phase"), "edge fala as fases Graph");
assert(!edge.includes("MAX_VIDEO_BYTES = 45 * 1024 * 1024"), "constante 45 MB removida");

console.log("ok meta_video_chunked");
