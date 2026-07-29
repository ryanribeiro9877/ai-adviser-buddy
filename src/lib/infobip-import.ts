import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// Importação do export da Infobip (.xlsx, aba "Data"). Dois formatos com o mesmo
// parser: o de mensagens (31 colunas) e o de billing/MAU (subconjunto). O tipo é
// deduzido do Service Name — "Monthly Active User" no billing.
// Tudo roda no navegador; o SheetJS entra por import dinâmico.

const ABA = "Data";
const LOTE = 500;

// Cabeçalho exato do export → coluna da tabela.
const MAPA: Record<string, string> = {
  "Message Id": "message_id",
  "Service Name": "service_name",
  "Traffic Source": "traffic_source",
  "Communication Name": "communication_name",
  "Communication Template": "template_name",
  From: "from_number",
  To: "to_number",
  "Send At": "send_at",
  "Done At": "done_at",
  "Seen At": "seen_at",
  Status: "status",
  Reason: "reason",
  "Error Group": "error_group",
  "Error Name": "error_name",
  "Network Name": "network_name",
  "Country Prefix": "country_prefix",
  "Purchase Price": "price_raw",
  Clicks: "clicks",
  "Messages Count": "messages_count",
  "User Name": "user_name",
};
const NUMERICAS = new Set(["price_raw", "clicks", "messages_count"]);
const DATAS = new Set(["send_at", "done_at", "seen_at"]);

/**
 * "22/07/2026 14:35:09" → "2026-07-22T14:35:09-03:00".
 * O export não declara timezone e a operação é brasileira, então o horário é
 * lido como America/Sao_Paulo (-03:00, sem horário de verão desde 2019).
 * Também aceita Date (quando o SheetJS já converte a célula) e serial do Excel.
 */
export function parseDataBR(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString();
  const s = String(v).trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const [, d, mo, y, hh = "00", mi = "00", ss = "00"] = m;
    return `${y}-${mo}-${d}T${hh}:${mi}:${ss}-03:00`;
  }
  // Serial do Excel (dias desde 30/12/1899), caso a célula venha como número.
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 90000) {
    const ms = Math.round((n - 25569) * 86400 * 1000);
    return new Date(ms).toISOString();
  }
  const solto = new Date(s);
  return isNaN(solto.getTime()) ? null : solto.toISOString();
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  // O export usa ponto decimal; toleramos vírgula por segurança.
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export type LinhaImport = Record<string, string | number | null | Json>;

export type ResultadoImport = {
  arquivo: string;
  tipo: "mensagens" | "billing";
  linhas: number;
  ignoradas: number;
  periodo: { inicio: string | null; fim: string | null };
};

/** Lê um .xlsx e devolve as linhas prontas para o upsert. */
export async function lerArquivoInfobip(
  file: File,
  companyId: string,
): Promise<{ rows: LinhaImport[]; meta: ResultadoImport }> {
  const mod = await import("xlsx");
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const aba = wb.SheetNames.includes(ABA) ? ABA : wb.SheetNames[0];
  const bruto = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba], { defval: null });

  const rows: LinhaImport[] = [];
  let ignoradas = 0;
  let temMau = false;
  const datas: string[] = [];

  for (const linha of bruto) {
    const row: LinhaImport = { company_id: companyId, source_file: file.name };
    for (const [cabecalho, valor] of Object.entries(linha)) {
      const col = MAPA[cabecalho.trim()];
      if (!col) continue;
      if (DATAS.has(col)) row[col] = parseDataBR(valor);
      else if (NUMERICAS.has(col)) row[col] = numero(valor);
      else row[col] = valor == null ? null : String(valor).trim();
    }
    // Sem message_id não há como deduplicar: a linha é inútil e seria lixo.
    if (!row.message_id) {
      ignoradas++;
      continue;
    }
    // O índice de dedup é (message_id, service_name) e NULL não colide com NULL
    // em Postgres — sem este fallback, reimportar duplicaria as linhas sem serviço.
    if (row.service_name == null || row.service_name === "") row.service_name = "-";
    if (String(row.service_name).toLowerCase().includes("monthly active user")) temMau = true;
    row.raw = linha as Json;
    if (typeof row.send_at === "string") datas.push(row.send_at.slice(0, 10));
    rows.push(row);
  }

  datas.sort();
  return {
    rows,
    meta: {
      arquivo: file.name,
      tipo: temMau ? "billing" : "mensagens",
      linhas: rows.length,
      ignoradas,
      periodo: { inicio: datas[0] ?? null, fim: datas[datas.length - 1] ?? null },
    },
  };
}

/** Upsert em lotes. Reimportar o mesmo arquivo não duplica (índice único). */
export async function enviarLotes(rows: LinhaImport[]): Promise<{ gravadas: number }> {
  let gravadas = 0;
  for (let i = 0; i < rows.length; i += LOTE) {
    const lote = rows.slice(i, i + LOTE);
    const { error } = await supabase
      .from("infobip_dispatches")
      // @ts-expect-error linhas montadas dinamicamente a partir do cabeçalho do export
      .upsert(lote, { onConflict: "message_id,service_name" });
    if (error) throw error;
    gravadas += lote.length;
  }
  return { gravadas };
}
