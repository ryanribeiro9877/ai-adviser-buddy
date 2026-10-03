// Rótulos e a conferência da lista. A classificação mora no banco.
// Seleção para um card futuro: no máximo 25. Esta tela não apaga arquivo.

export const MAX_ATIVOS_POR_CARD = 25;

export type AnuncioDoAtivo = { id: string; nome: string | null };

export type AtivoOrfao = {
  tipo: "video" | "imagem";
  id: string;
  nome: string | null;
  motivo: string | null;
  anuncios: AnuncioDoAtivo[];
  ultimo_gasto_em: string | null;
  gasto_total: number | null;
  bloqueado_por: string | null;
  duplicata_de: string | null;
  candidato: boolean;
};

export type ListaDeAtivos = {
  ok: true;
  account_id: string;
  dias_sem_uso: number;
  videos: number;
  imagens: number;
  anuncios: number;
  miniaturas_nossas: number | null;
  miniaturas_faltando: number | null;
  faxina_adiada_ate: string | null;
  aprendizado_desconhecido: boolean;
  ativos: AtivoOrfao[];
};

const MOTIVOS: Record<string, string> = {
  nunca_usado: "Nunca usado",
  duplicata: "Duplicata",
  sem_uso_90d: "Sem uso na janela",
  residuo_de_teste: "Resíduo de teste",
  anuncio_inativo: "Anúncio inativo, com gasto na janela",
  divergencia: "A Meta não devolveu o arquivo",
};

const BLOQUEIOS: Record<string, string> = {
  em_uso: "Em uso por anúncio ativo",
  with_issues: "Anúncio com problema",
  em_revisao: "Em revisão ou reprovado",
  status_desconhecido: "Status do anúncio não veio",
  card_aprovado: "Card aprovado, ainda não executado",
  card_pendente: "Card pendente",
  copia_que_fica: "Cópia que fica",
  duplicata_sem_data: "Duplicata sem data — não dá para escolher qual fica",
};

export function rotuloMotivo(motivo: string | null): string {
  if (!motivo) return "—";
  return MOTIVOS[motivo] ?? motivo;
}

export function rotuloBloqueio(bloqueio: string | null): string {
  if (!bloqueio) return "";
  return BLOQUEIOS[bloqueio] ?? bloqueio;
}

export function podeMarcar(jaMarcados: number, esteJaEsta: boolean): boolean {
  if (esteJaEsta) return true;
  return jaMarcados < MAX_ATIVOS_POR_CARD;
}

export function chaveDoAtivo(tipo: string, id: string): string {
  return `${tipo}:${id}`;
}

/** Dia inicial da janela, em UTC, no formato da coluna date. */
export function diaLimite(dias: number, hoje: Date): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export type ConferenciaDaLista = {
  setembro: number;
  fica: string | null;
  laFelicita: number;
  comGasto: number;
  limite: string;
};

/** As três conferências do briefing, em cima da lista já classificada. */
export function conferenciaDaLista(rows: AtivoOrfao[], dias: number, hoje = new Date()): ConferenciaDaLista {
  const limite = diaLimite(dias, hoje);
  const setembro = rows.filter((r) => /01\.\s*setembro\.mp4/i.test(r.nome ?? ""));
  const fica = setembro.map((r) => r.duplicata_de).find((id): id is string => !!id) ?? null;
  const laFelicita = rows.filter(
    (r) => r.candidato && (r.anuncios ?? []).some((a) => /felic/i.test(a.nome ?? "")),
  ).length;
  const comGasto = rows.filter(
    (r) => r.candidato && !!r.ultimo_gasto_em && r.ultimo_gasto_em >= limite,
  ).length;
  return { setembro: setembro.length, fica, laFelicita, comGasto, limite };
}
