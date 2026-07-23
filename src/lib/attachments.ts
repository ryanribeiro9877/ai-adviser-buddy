export const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.csv,.xlsx,.xls,.txt";
export const MAX_FILES = 4;
export const MAX_BYTES = 8 * 1024 * 1024; // ~8MB por arquivo

// Anexo pronto para a edge (traffic-chat v6).
export type OutgoingAttachment = { name: string; mime: string; data_base64: string };

export type AttachmentKind = "image" | "pdf" | "sheet" | "text" | "file";

export function kindFromMime(mime: string | undefined, name = ""): AttachmentKind {
  const m = (mime ?? "").toLowerCase();
  const n = name.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (
    m.includes("csv") ||
    m.includes("sheet") ||
    m.includes("excel") ||
    /\.(csv|xlsx|xls)$/.test(n)
  )
    return "sheet";
  if (m.startsWith("text/") || n.endsWith(".txt")) return "text";
  return "file";
}

function isSpreadsheet(file: File): boolean {
  return (
    /\.(xlsx|xls)$/i.test(file.name) ||
    file.type.includes("sheet") ||
    file.type.includes("ms-excel")
  );
}

// base64 puro (sem o prefixo "data:...;base64,").
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(r.error ?? new Error("Falha ao ler o arquivo"));
    r.readAsDataURL(file);
  });
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Converte um arquivo em anexo para a edge. Planilhas xlsx/xls são convertidas
 * para CSV no navegador (SheetJS, importado sob demanda) — o parse aqui é mais
 * robusto que o fallback lazy da edge. CSV/imagem/PDF/txt vão como base64 puro.
 */
export async function toOutgoing(file: File): Promise<OutgoingAttachment> {
  if (isSpreadsheet(file)) {
    const mod = await import("xlsx");
    const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const parts = wb.SheetNames.map(
      (name) => `--- aba: ${name} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`,
    );
    const base = file.name.replace(/\.(xlsx|xls)$/i, "");
    return { name: `${base}.csv`, mime: "text/csv", data_base64: utf8ToBase64(parts.join("\n\n")) };
  }
  return {
    name: file.name,
    mime: file.type || "application/octet-stream",
    data_base64: await fileToBase64(file),
  };
}
