// ESP-12 (06/08/2026) — orquestrador Drive -> transcribe-audio -> drive_midia_analises.
//
// A edge transcribe-audio NAO e alterada: ela continua sendo o ditado do chat. Esta edge apenas
// seleciona uma peca de video ainda nao tentada na base visual vigente, mede o arquivo no Drive,
// chama a edge existente e persiste a transcricao. Uma peca por chamada mantem download, base64
// e transcricao dentro do teto de parede; o cron diario converge o backlog e depois vira no-op.
//
// Contrato de ausencia:
// - acima de 15 MB: transcricao_audio e transcricao_em seguem NULL; transcricao_fonte explica;
// - resposta vazia: nunca vira ""; fica NULL e a fonte declara que nao houve transcricao;
// - erro transitorio: nenhuma coluna e tocada, para a proxima corrida tentar novamente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const MAX_BYTES = 15 * 1024 * 1024;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let cachedToken: { token: string; exp: number } | null = null;
function pemDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function b64url(data: Uint8Array | string): string {
  const bin = typeof data === "string" ? data : String.fromCharCode(...data);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  if (!GOOGLE_SA_KEY_B64) throw new Error("GOOGLE_SA_KEY_B64 ausente");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)),
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}` +
      `&assertion=${input}.${b64url(signature)}`,
  });
  const parsed = await response.json();
  if (!parsed.access_token) {
    throw new Error(`token do Drive falhou: ${JSON.stringify(parsed).slice(0, 160)}`);
  }
  cachedToken = {
    token: parsed.access_token,
    exp: Date.now() + (Number(parsed.expires_in ?? 3600) - 120) * 1000,
  };
  return cachedToken.token;
}

async function driveMeta(fileId: string) {
  const token = await driveToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const parsed = await response.json();
  if (!response.ok)
    throw new Error(`Drive meta ${response.status}: ${JSON.stringify(parsed).slice(0, 160)}`);
  return parsed;
}

async function driveDownload(fileId: string): Promise<Uint8Array> {
  const token = await driveToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Drive download ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as any);
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = chaveMcpDe(req, "header-or-bearer");
  const auth = await mcpKeyValida(supa, key);
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body vazio = proxima peca pendente
  }
  const requestedId = String(body?.drive_file_id ?? "").trim();

  let query = supa
    .from("drive_midia_analises")
    .select("id,drive_file_id,nome,mime,base_da_analise")
    .like("mime", "video%")
    .like("base_da_analise", "%criterio%")
    .is("transcricao_audio", null)
    .is("transcricao_fonte", null)
    .order("nome")
    .limit(1);
  if (requestedId) query = query.eq("drive_file_id", requestedId);
  const { data: rows, error: readError } = await query;
  if (readError) return json({ error: "leitura_falhou", detalhe: readError.message }, 500);
  const row = rows?.[0];
  if (!row) {
    return json({
      ok: true,
      processados: 0,
      nota: requestedId ? "peca nao encontrada ou ja tentada" : "nenhum video pendente",
    });
  }

  let meta: any;
  try {
    meta = await driveMeta(String(row.drive_file_id));
  } catch (error) {
    return json({ error: "drive_meta_falhou", detalhe: String(error), peca: row.nome }, 502);
  }
  const size = Number(meta.size ?? 0);
  if (!(size > 0)) {
    return json(
      { error: "drive_sem_tamanho", peca: row.nome, drive_file_id: row.drive_file_id },
      502,
    );
  }
  if (size > MAX_BYTES) {
    const fonte = `nao_transcrito: acima do teto de 15MB (${size} bytes)`;
    const { error } = await supa
      .from("drive_midia_analises")
      .update({ transcricao_fonte: fonte })
      .eq("id", row.id);
    if (error) return json({ error: "gravacao_falhou", detalhe: error.message }, 500);
    return json({
      ok: true,
      processados: 1,
      transcrito: false,
      peca: row.nome,
      tamanho_bytes: size,
      transcricao_audio: null,
      transcricao_em: null,
      transcricao_fonte: fonte,
    });
  }

  let bytes: Uint8Array;
  try {
    bytes = await driveDownload(String(row.drive_file_id));
  } catch (error) {
    return json({ error: "drive_download_falhou", detalhe: String(error), peca: row.nome }, 502);
  }
  if (bytes.byteLength > MAX_BYTES) {
    const fonte = `nao_transcrito: acima do teto de 15MB (${bytes.byteLength} bytes medidos)`;
    const { error } = await supa
      .from("drive_midia_analises")
      .update({ transcricao_fonte: fonte })
      .eq("id", row.id);
    if (error) return json({ error: "gravacao_falhou", detalhe: error.message }, 500);
    return json({
      ok: true,
      processados: 1,
      transcrito: false,
      peca: row.nome,
      transcricao_fonte: fonte,
    });
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-audio`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": key },
    body: JSON.stringify({ audio_base64: b64(bytes), mime: String(meta.mimeType ?? row.mime) }),
  });
  const raw = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!response.ok || !parsed?.ok) {
    // Erro transitorio fica sem marca para a proxima corrida repetir.
    return json(
      {
        error: "transcribe_audio_falhou",
        status: response.status,
        detalhe: parsed ?? raw.slice(0, 300),
        peca: row.nome,
      },
      502,
    );
  }
  const text = String(parsed.text ?? "").trim();
  if (!text) {
    const fonte = `nao_transcrito: resposta vazia de transcribe-audio (${parsed.provider ?? "fonte desconhecida"})`;
    const { error } = await supa
      .from("drive_midia_analises")
      .update({ transcricao_fonte: fonte })
      .eq("id", row.id);
    if (error) return json({ error: "gravacao_falhou", detalhe: error.message }, 500);
    return json({
      ok: true,
      processados: 1,
      transcrito: false,
      peca: row.nome,
      transcricao_fonte: fonte,
    });
  }

  const fonte = `transcribe-audio / ${parsed.provider ?? "desconhecido"} / ${parsed.model ?? "modelo nao informado"}`;
  const now = new Date().toISOString();
  const { error: writeError } = await supa
    .from("drive_midia_analises")
    .update({
      transcricao_audio: text,
      transcricao_em: now,
      transcricao_fonte: fonte,
    })
    .eq("id", row.id);
  if (writeError) return json({ error: "gravacao_falhou", detalhe: writeError.message }, 500);

  return json({
    ok: true,
    processados: 1,
    transcrito: true,
    peca: row.nome,
    caracteres: text.length,
    transcricao_fonte: fonte,
    mcp_chamador: auth.chamador,
  });
});
