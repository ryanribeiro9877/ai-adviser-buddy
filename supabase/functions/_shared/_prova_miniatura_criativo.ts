import { caminhoDaMiniatura, jaEArquivoDesteCriativo, tipoDeImagem } from "./miniatura_criativo.ts";
import { srcDoIframe, formatoDe } from "./previa_anuncio.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const empresa = "57f755b9-c23d-4f58-a488-8173d697c010";
assert(caminhoDaMiniatura(empresa, "12345", "jpg") === `${empresa}/12345.jpg`, "caminho deriva do criativo");
assert(caminhoDaMiniatura("nao-uuid", "12345", "jpg") === null, "empresa invalida nao gera caminho");
assert(jaEArquivoDesteCriativo(`${empresa}/12345.jpg`, empresa, "12345"), "o mesmo criativo nao baixa de novo");
assert(!jaEArquivoDesteCriativo(`${empresa}/999.jpg`, empresa, "12345"), "criativo trocado baixa de novo");
assert(!jaEArquivoDesteCriativo("https://cdn/x.jpg", empresa, "12345"), "url da Meta nao conta como arquivo nosso");
assert(tipoDeImagem(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), null)?.ext === "jpg", "jpeg pelo magic");
assert(tipoDeImagem(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]), "text/html") === null, "html nao vira imagem");

assert(formatoDe("stories") === "stories", "stories");
assert(formatoDe("qualquer") === "feed", "formato desconhecido cai no feed");
const src = srcDoIframe(
  '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=2" width="320"></iframe>',
);
assert(src === "https://www.facebook.com/ads/api/preview_iframe.php?d=1&t=2", "src do iframe, com amp desfeito");
assert(srcDoIframe('<iframe src="https://evil.example/x"></iframe>') === null, "host fora da Meta e recusado");

console.log("ok: _prova_miniatura_criativo");
