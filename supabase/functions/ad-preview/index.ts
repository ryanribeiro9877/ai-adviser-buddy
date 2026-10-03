// Prévia do anúncio na Meta, sob demanda. Nada é gravado: o iframe expira
// e o dado certo é o que está no ar agora.
// Auth: JWT do usuário. A edge confirma que ele é membro da empresa do anúncio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tokenAdsPorCompanyId } from "../_shared/meta_company_tokens.ts";
import { FORMATOS_PREVIAS, formatoDe, srcDoIframe } from "../_shared/previa_anuncio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function limpar(msg: string): string {
  return msg.replace(/access_token=[^&\s]+/gi, "access_token").replace(/\s+/g, " ").trim().slice(0, 180);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const header = req.headers.get("authorization") ?? "";
  const jwt = header.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ ok: false, erro: "Sessão ausente." }, 401);
  const { data: auth, error: authErro } = await supa.auth.getUser(jwt);
  if (authErro || !auth.user) return json({ ok: false, erro: "Sessão inválida." }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const adId = String(body?.ad_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adId)) {
    return json({ ok: false, erro: "Anúncio inválido." }, 400);
  }
  const formato = formatoDe(body?.formato);

  const { data: ad, error: adErro } = await supa
    .from("ads")
    .select("id,company_id,external_id,name")
    .eq("id", adId)
    .maybeSingle();
  if (adErro) return json({ ok: false, erro: "Não foi possível ler o anúncio." }, 500);
  if (!ad?.company_id || !ad.external_id) return json({ ok: false, erro: "Anúncio não encontrado." }, 404);

  const { data: membro, error: membroErro } = await supa.rpc("is_company_member", {
    _company_id: ad.company_id,
    _user_id: auth.user.id,
  });
  if (membroErro) return json({ ok: false, erro: "Não foi possível confirmar a empresa." }, 500);
  if (!membro) return json({ ok: false, erro: "Este anúncio não está na sua empresa." }, 403);

  const tok = tokenAdsPorCompanyId(String(ad.company_id));
  if (!tok) return json({ ok: false, erro: "Esta empresa não tem token da Meta para abrir a prévia." }, 409);

  const url = new URL(`${GRAPH}/${ad.external_id}/previews`);
  url.searchParams.set("ad_format", FORMATOS_PREVIAS[formato]);
  url.searchParams.set("access_token", tok.token);
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return json({ ok: false, erro: `A Meta não respondeu. ${limpar(String((e as Error)?.message ?? e))}` }, 502);
  }
  const texto = await resposta.text();
  let corpo: any = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = null;
  }
  if (!resposta.ok || corpo?.error) {
    return json({
      ok: false,
      erro: `A Meta não abriu a prévia. ${limpar(String(corpo?.error?.message ?? `http ${resposta.status}`))}`,
    }, 502);
  }
  const html = String(corpo?.data?.[0]?.body ?? "");
  const src = srcDoIframe(html);
  if (!src) return json({ ok: false, erro: "A Meta não devolveu um endereço de prévia." }, 502);
  return json({
    ok: true,
    src,
    formato,
    nome: ad.name ?? null,
  });
});
