// Caminho no bucket privado. URL http é resíduo da Meta e não entra na grade:
// ela expira e o navegador só mostra o quadrado vazio.

const CAMINHO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9A-Za-z_-]+\.(jpg|jpeg|png|webp|gif)$/i;

export function caminhoNosso(valor: string | null | undefined): string | null {
  const s = String(valor ?? "").trim();
  return CAMINHO.test(s) ? s : null;
}

export function textoSemMiniatura(motivo: string | null | undefined): string {
  const m = String(motivo ?? "").trim();
  if (!m) return "Miniatura ainda não coletada";
  if (m.startsWith("sem_imagem")) return "A Meta não devolveu imagem deste criativo";
  if (m.startsWith("tentar_de_novo")) return "A coleta da miniatura falhou e será tentada de novo";
  if (m.startsWith("sem_acesso")) return "A conta deste anúncio não está no token da empresa";
  return "A miniatura não está disponível";
}

export function urlDoDrive(driveFileId: string | null | undefined): string | null {
  const id = String(driveFileId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
  return `https://drive.google.com/file/d/${id}/view`;
}
