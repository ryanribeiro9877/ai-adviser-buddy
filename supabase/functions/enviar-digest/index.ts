// supabase/functions/enviar-digest/index.ts (v1) — ESP-41
// Entrega do digest por e-mail + dreno dos alertas criticos enfileirados.
//
// O CORPO NAO E GERADO AQUI: vem de montar_corpo_digest(company_id, dia) no banco — a mesma
// fonte deterministica que o post_daily_report usa no chat. Esta edge so decide QUANDO enviar
// (slot pela hora local) e ENTREGA por e-mail, gravando o resultado em digest_entregas.
//
// modo=digest        -> cron horario; para cada empresa com digest_config.ativo cujo slot bate
//                       com a hora local (America/Bahia, UTC-3) e com emails cadastrados, monta
//                       o corpo e envia (dedup por empresa/slot/dia).
// modo=drenar_alertas -> cron */5 + poke do trigger de alerta critico; envia os alertas
//                       criticos com status 'pendente' e marca o resultado.
// modo=teste         -> envia um e-mail de teste para os destinatarios (ou os passados no body).
//
// E-mail via Resend (RESEND_API_KEY + DIGEST_FROM). SEM provedor: entrega fica 'sem_provedor'
// e o digest continua no chat (nenhuma falha dura). emails vazio => 'sem_destinatario'.
// Auth: x-mcp-key ou Bearer (a propria edge valida via mcp_key_valida).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
const DIGEST_FROM = (Deno.env.get("DIGEST_FROM") ?? "Gestor IA <onboarding@resend.dev>").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
// Data local America/Bahia (UTC-3), sem DST.
function agoraLocal() {
  const ms = Date.now() - 3 * 3600 * 1000;
  const d = new Date(ms);
  return { hora: d.getUTCHours(), dia: d.toISOString().slice(0, 10) };
}

type Envio = { status: string; provedor: string | null; provider_id: string | null; erro: string | null };

async function enviarEmail(to: string[], assunto: string, texto: string): Promise<Envio> {
  if (!to || to.length === 0) return { status: "sem_destinatario", provedor: null, provider_id: null, erro: null };
  if (!RESEND_API_KEY) return { status: "sem_provedor", provedor: null, provider_id: null, erro: "RESEND_API_KEY ausente" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: DIGEST_FROM,
        to,
        subject: assunto,
        text: texto,
        html: `<pre style="font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;font-size:14px;line-height:1.5">${
          texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        }</pre>`,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { status: "erro", provedor: "resend", provider_id: null, erro: `HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}` };
    return { status: "enviado", provedor: "resend", provider_id: (body as any)?.id ?? null, erro: null };
  } catch (e) {
    return { status: "erro", provedor: "resend", provider_id: null, erro: String(e).slice(0, 300) };
  }
}

async function rodarDigest() {
  const { hora, dia } = agoraLocal();
  const { data: cfgs } = await supa.from("digest_config").select("*").eq("ativo", true);
  const resultados: any[] = [];
  for (const cfg of (cfgs ?? [])) {
    const slots: number[] = Array.isArray(cfg.slots) ? cfg.slots.map(Number) : [];
    if (!slots.includes(hora)) continue;

    // dedup por empresa/slot/dia.
    const { data: ja } = await supa.from("digest_entregas").select("id,status")
      .eq("company_id", cfg.company_id).eq("tipo", "digest").eq("slot", hora).eq("dia", dia).maybeSingle();
    if (ja && ["enviado", "simulado", "sem_destinatario", "sem_provedor"].includes(ja.status)) {
      resultados.push({ company_id: cfg.company_id, slot: hora, pulado: `ja registrado (${ja.status})` });
      continue;
    }

    const { data: corpo } = await supa.rpc("montar_corpo_digest", { p_company_id: cfg.company_id });
    const texto = String(corpo ?? "");
    const assunto = `${cfg.assunto_prefixo ?? "[Gestor IA]"} Relatorio diario`;
    const destino: string[] = Array.isArray(cfg.emails) ? cfg.emails : [];
    const env = await enviarEmail(destino, assunto, texto);

    await supa.from("digest_entregas").insert({
      company_id: cfg.company_id, tipo: "digest", dia, slot: hora, destino,
      assunto, corpo_preview: texto.slice(0, 500), status: env.status,
      provedor: env.provedor, provider_id: env.provider_id, erro: env.erro,
      enviado_em: env.status === "enviado" ? new Date().toISOString() : null,
    });
    resultados.push({ company_id: cfg.company_id, slot: hora, status: env.status, destinatarios: destino.length });
  }
  return { modo: "digest", hora_local: hora, dia, empresas: resultados };
}

async function drenarAlertas() {
  const { data: pend } = await supa.from("digest_entregas").select("*")
    .eq("tipo", "alerta_critico").eq("status", "pendente").order("criado_em", { ascending: true }).limit(50);
  const resultados: any[] = [];
  for (const e of (pend ?? [])) {
    const { data: al } = await supa.from("alerts").select("title,description,severity,resolved").eq("id", e.alert_id).maybeSingle();
    if (!al) { await marcar(e.id, "erro", null, null, "alerta nao encontrado"); resultados.push({ id: e.id, status: "erro" }); continue; }
    if (al.resolved === true) { await marcar(e.id, "cancelado", null, null, "alerta ja resolvido antes do envio"); resultados.push({ id: e.id, status: "cancelado" }); continue; }

    const texto = `🔴 ALERTA CRITICO\n\n${al.title}\n\n${al.description ?? ""}\n\n— Gestor de Trafego IA`;
    const destino: string[] = Array.isArray(e.destino) ? e.destino : [];
    const env = await enviarEmail(destino, e.assunto ?? `[Gestor IA] ALERTA CRITICO: ${al.title}`, texto);
    await marcar(e.id, env.status, env.provedor, env.provider_id, env.erro);
    resultados.push({ id: e.id, status: env.status, destinatarios: destino.length });
  }
  return { modo: "drenar_alertas", processados: resultados.length, resultados };
}

async function marcar(id: string, status: string, provedor: string | null, provider_id: string | null, erro: string | null) {
  await supa.from("digest_entregas").update({
    status, provedor, provider_id, erro,
    enviado_em: status === "enviado" ? new Date().toISOString() : null,
  }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const modo = String(body?.modo ?? "digest");

  if (modo === "teste") {
    const to: string[] = Array.isArray(body?.emails) ? body.emails : [];
    const env = await enviarEmail(to, "[Gestor IA][TESTE] Digest", "Teste de entrega do digest (ESP-41). Se voce recebeu isto, o provedor de e-mail esta configurado.");
    return json({ ok: true, modo, provedor_configurado: !!RESEND_API_KEY, envio: env });
  }
  if (modo === "drenar_alertas") return json({ ok: true, ...(await drenarAlertas()), provedor_configurado: !!RESEND_API_KEY });
  return json({ ok: true, ...(await rodarDigest()), provedor_configurado: !!RESEND_API_KEY });
});
