// Prévia sob demanda. O iframe da Meta vale por pouco tempo e mostra o
// anúncio como ele está agora — não se guarda.

export const FORMATOS_PREVIAS = {
  feed: "MOBILE_FEED_STANDARD",
  stories: "INSTAGRAM_STORY",
  reels: "INSTAGRAM_REELS",
} as const;

export type FormatoPrevia = keyof typeof FORMATOS_PREVIAS;

export function formatoDe(valor: unknown): FormatoPrevia {
  const s = String(valor ?? "feed").trim().toLowerCase();
  if (s === "stories" || s === "story") return "stories";
  if (s === "reels" || s === "reel") return "reels";
  return "feed";
}

export function srcDoIframe(html: string): string | null {
  const achado = String(html ?? "").match(/src\s*=\s*["']([^"']+)["']/i);
  if (!achado) return null;
  let bruto = achado[1].replace(/&amp;/g, "&").trim();
  if (bruto.startsWith("//")) bruto = `https:${bruto}`;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const permitido =
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host.endsWith(".fbcdn.net");
  if (!permitido) return null;
  return url.toString();
}
