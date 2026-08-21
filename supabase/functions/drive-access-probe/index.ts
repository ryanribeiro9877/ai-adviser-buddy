// supabase/functions/drive-access-probe/index.ts
// Sonda somente-leitura: valida SA do Drive e lista pastas compartilhadas com a conta.
// NAO grava no banco. Auth: x-mcp-key / Bearer mcp.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const VERSAO = "drive-access-probe-v1";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pemParaDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(dados: Uint8Array | string): string {
  const bin = typeof dados === "string" ? dados : String.fromCharCode(...dados);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function driveToken(): Promise<{ token: string; client_email: string }> {
  if (!GOOGLE_SA_KEY_B64) throw new Error("GOOGLE_SA_KEY_B64 ausente");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const agora = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600,
  }));
  const chave = await crypto.subtle.importKey(
    "pkcs8",
    pemParaDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      chave,
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  );
  const jwt = `${header}.${claims}.${b64url(assinatura)}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) {
    throw new Error(`falha no token do Drive: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return { token: j.access_token, client_email: String(sa.client_email ?? "") };
}

async function driveGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await r.json();
  return { ok: r.ok, status: r.status, body };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const folderIds: string[] = Array.isArray(body?.folder_ids)
    ? body.folder_ids.map(String).filter(Boolean).slice(0, 20)
    : [];

  try {
    const { token, client_email } = await driveToken();

    const about = await driveGet("about", token, { fields: "user(emailAddress,displayName),storageQuota" });

    // Pastas compartilhadas com a SA (sharedWithMe)
    const shared = await driveGet("files", token, {
      q: "sharedWithMe=true and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id,name,owners(emailAddress,displayName),shared,driveId,parents),nextPageToken",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });

    // Shared drives (Team Drives) visiveis
    const drives = await driveGet("drives", token, {
      pageSize: "50",
      fields: "drives(id,name)",
    });

    const testes: any[] = [];
    for (const fid of folderIds) {
      const meta = await driveGet(`files/${fid}`, token, {
        fields: "id,name,mimeType,owners(emailAddress),shared,driveId,capabilities",
        supportsAllDrives: "true",
      });
      const kids = meta.ok
        ? await driveGet("files", token, {
          q: `'${fid}' in parents and trashed=false`,
          fields: "files(id,name,mimeType),nextPageToken",
          pageSize: "20",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        })
        : null;
      testes.push({
        folder_id: fid,
        meta_ok: meta.ok,
        meta_http: meta.status,
        meta_erro: meta.body?.error?.message ?? null,
        nome: meta.body?.name ?? null,
        filhos_ok: kids?.ok ?? false,
        filhos_http: kids?.status ?? null,
        filhos_count: Array.isArray(kids?.body?.files) ? kids!.body.files.length : 0,
        amostra_filhos: Array.isArray(kids?.body?.files)
          ? kids!.body.files.slice(0, 10).map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
          }))
          : [],
      });
    }

    const pastasShared = Array.isArray(shared.body?.files) ? shared.body.files : [];
    const classifica = (nome: string) => {
      const n = nome.toLowerCase();
      if (/jur[ií]dico|jur\b/.test(n)) return "COHAPM_JURIDICO_hint";
      if (/felicit|lafelicita|\blf\b/.test(n)) return "COHAPM_LA_FELICITA_hint";
      if (/legal|viver|junho|julho/.test(n)) return "LEGAL_hint";
      return "outro";
    };

    return json({
      ok: true,
      versao: VERSAO,
      sa_client_email: client_email,
      sa_esperada: "gestor-trafego-drive@gestor-trafego-ia.iam.gserviceaccount.com",
      sa_bate: client_email === "gestor-trafego-drive@gestor-trafego-ia.iam.gserviceaccount.com",
      about_ok: about.ok,
      about_http: about.status,
      shared_folders: {
        http: shared.status,
        erro: shared.body?.error?.message ?? null,
        count: pastasShared.length,
        pastas: pastasShared.map((f: any) => ({
          id: f.id,
          name: f.name,
          owners: f.owners ?? [],
          hint: classifica(String(f.name ?? "")),
        })),
      },
      shared_drives: {
        http: drives.status,
        erro: drives.body?.error?.message ?? null,
        count: Array.isArray(drives.body?.drives) ? drives.body.drives.length : 0,
        drives: Array.isArray(drives.body?.drives) ? drives.body.drives : [],
      },
      testes_folder_ids: testes,
      nota:
        "Pastas so entram no sistema apos INSERT em drive_pastas_monitoradas com company_id correto. COHAPM Juridico e La Felicita devem ser DUAS linhas separadas (mesmo company_id COHAPM, folder_id distintos).",
    });
  } catch (e) {
    return json({ ok: false, versao: VERSAO, erro: String((e as any)?.message ?? e) }, 500);
  }
});
