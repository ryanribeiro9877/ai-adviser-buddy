// supabase/functions/gerar-legendas/index.ts (v2)
// ESP-37 (12/08/2026): motor de legenda Meta Ads — framework A (Hook → Benefício/prova →
//   CTA + CET na legenda FIN-04), N=3 fixo. Redator OpenRouter + guardião compliance-check
//   por variante (+ checar_par_texto_e_peca quando drive_file_id). NÃO emite card e NÃO
//   escreve na Meta. Auth: x-mcp-key (mcp_key_valida).
// v2 - ESP-36 (12/08/2026): consome ler_brand_identity(company_id) — voz/tom, dos/donts,
//   disclaimers e linhas de produto entram no prompt do redator (marca deixa de ser hardcoded).
//   Fix: promessas_proibidas usa a coluna 'seguro' (antes 'substituto_seguro', que vinha vazio).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OR_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const OR_MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "x-ai/grok-4.6").trim();
const VERSAO = "gerar-legendas-v1";
const N = 3;

const LEV_COMPANY = "ded20b38-f42e-4c71-800c-31b97ea48bcf";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function extrairJson(bruto: string): unknown {
  const s = String(bruto ?? "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    /* */
  }
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(s.slice(i, j + 1));
    } catch {
      /* */
    }
  }
  return null;
}

function complianceAprovado(compl: any, httpOk: boolean): boolean {
  if (!httpOk || !compl) return false;
  const verd = String(compl?.veredito ?? compl?.verdict ?? "").toLowerCase();
  if (verd === "aprovado" || verd.includes("aprov") || verd.includes("green") || verd.includes("pass")) {
    return compl?.aprovado !== false;
  }
  if (compl?.aprovado === true) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ erro: "POST only" }, 405);
  if (!OR_KEY) return json({ erro: "OPENROUTER_API_KEY ausente — redator indisponivel" }, 500);

  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ erro: "unauthorized", motivo: auth.motivo }, 401);

  // Chave para cascata ao compliance-check (mesmo padrao WABA).
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key) return json({ erro: "cascade_key_unavailable" }, 500);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }

  const companyId = String(body?.company_id ?? body?.company ?? LEV_COMPANY).trim() || LEV_COMPANY;
  const produto = String(body?.produto ?? "CLT").trim().toUpperCase() || "CLT";
  const objetivo = String(body?.objetivo ?? body?.eixo ?? "").trim();
  if (!objetivo) {
    return json({
      erro: "objetivo_obrigatorio",
      detalhe:
        "Informe objetivo (ou eixo): o que a legenda deve comunicar em linguagem de negocio (ex.: 'abrir simulacao CLT para quem quer dinheiro rapido sem burocracia').",
    }, 400);
  }

  const driveFileId = String(body?.drive_file_id ?? "").trim() || null;
  const referencias: string[] = Array.isArray(body?.referencias)
    ? body.referencias.map((r: unknown) => String(r ?? "").trim()).filter(Boolean).slice(0, 5)
    : [];

  // Contexto opcional da peca (nota visual) — nao e veredito.
  let notaPeca: string | null = null;
  if (driveFileId) {
    const { data: nota } = await supa.rpc("nota_visual_da_peca", {
      p_company_id: companyId,
      p_drive_file_id: driveFileId,
    });
    if (nota) {
      notaPeca = typeof nota === "string" ? nota : JSON.stringify(nota).slice(0, 1200);
    }
  }

  // Amostra de promessas proibidas (texto curto) para o redator nao inventar.
  const { data: promessas } = await supa
    .from("promessas_proibidas")
    .select("proibido,seguro")
    .limit(40);
  const listaPromessas = (promessas ?? [])
    .map((p: any) => `- "${p.proibido}" → use "${p.seguro}"`)
    .slice(0, 25)
    .join("\n");

  // ESP-36: identidade de marca da empresa (voz/tom, dos/donts, disclaimers, produtos).
  let brandBloco = "";
  let marcaNome = "a marca (credito consignado Brasil)";
  try {
    const { data: bi } = await supa.rpc("ler_brand_identity", { p_company_id: companyId });
    const brand = (bi as any)?.brand;
    if (brand) {
      marcaNome = String(brand?.marca_nome ?? marcaNome);
      const voz = brand?.voz_tom ?? {};
      const dos: string[] = Array.isArray(brand?.dos) ? brand.dos : [];
      const donts: string[] = Array.isArray(brand?.donts) ? brand.donts : [];
      const discl: string[] = Array.isArray(brand?.disclaimers_obrigatorios) ? brand.disclaimers_obrigatorios : [];
      const linhas: string[] = Array.isArray(brand?.linhas_produto) ? brand.linhas_produto : [];
      brandBloco = [
        `\n=== IDENTIDADE DE MARCA (ESP-36 — ${marcaNome}) ===`,
        voz?.tom ? `Tom: ${voz.tom}` : "",
        voz?.persona ? `Persona: ${voz.persona}` : "",
        voz?.pessoa ? `Voz: ${voz.pessoa}` : "",
        dos.length ? `FACA:\n${dos.map((d) => `- ${d}`).join("\n")}` : "",
        donts.length ? `NAO FACA:\n${donts.map((d) => `- ${d}`).join("\n")}` : "",
        discl.length ? `Disclaimers obrigatorios:\n${discl.map((d) => `- ${d}`).join("\n")}` : "",
        linhas.length ? `Linhas de produto: ${linhas.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    }
  } catch {
    /* brand nao bloqueia: cai no tom padrao + promessas_proibidas */
  }

  const sys = `Voce e redator de legendas de Meta Ads para ${marcaNome}.
Framework OBRIGATORIO (ESP-37, opcao A), nesta ordem em CADA legenda:
1) HOOK — primeira linha que para o scroll (use tatica de hook distinta em cada variante).
2) BENEFICIO/PROVA — o que o produto entrega, sem promessa ilegal.
3) CTA — acao clara (ex.: simular, falar com especialista).
4) CET — o CET (ou referencia ao CET da oferta) MORA NA LEGENDA DA PUBLICACAO (FIN-04 v4). Preferencia da casa quando NAO ha taxa oficial: "consulte o CET na sua simulacao". Isso E suficiente. NUNCA invente percentual. NUNCA peca ao gestor um numero de CET depois que ele autorizou a formulacao de consulta.

Regras duras:
- Portugues do Brasil; tom direto, conversacional, sem exagero de urgencia falsa.
- Proibido: garantia de aprovacao, "sem consulta", "100% aprovado", dinheiro "gratis", omitir risco de credito.
- N = ${N} variantes DISTINTAS (hooks diferentes). Nao repita a mesma abertura.
- Cada texto: 2 a 6 frases curtas; adequado a Feed/Reels (legenda de publicacao).
- Responda APENAS JSON valido, sem markdown:
{"variantes":[{"texto":"...","hook_tactic":"nome curto da tatica","notas":"1 frase"}]}

Produto: ${produto}
${brandBloco}
${listaPromessas ? `Substitutos seguros (promessas_proibidas):\n${listaPromessas}` : ""}
${referencias.length ? `Referencias de estilo (nao copie literal):\n${referencias.map((r, i) => `${i + 1}. ${r.slice(0, 280)}`).join("\n")}` : ""}
${notaPeca ? `Contexto da peca (Drive — informar, nao aprovar):\n${notaPeca.slice(0, 800)}` : ""}`;

  const userMsg = `Objetivo da legenda: ${objetivo}\nGere exatamente ${N} variantes.`;

  const rl = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OR_KEY}` },
    body: JSON.stringify({
      model: OR_MODEL,
      max_tokens: 2200,
      reasoning: { enabled: false },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    }),
  });
  if (!rl.ok) {
    const t = await rl.text().catch(() => "");
    return json({
      erro: "redator_indisponivel",
      detalhe: `OpenRouter HTTP ${rl.status}`,
      bruto: t.slice(0, 300),
      fail_closed: true,
    }, 502);
  }
  const rj = await rl.json().catch(() => null);
  const bruto = String(rj?.choices?.[0]?.message?.content ?? "").trim();
  const parsed = extrairJson(bruto) as { variantes?: any[] } | null;
  const rawVars = Array.isArray(parsed?.variantes) ? parsed!.variantes : [];
  if (rawVars.length < N) {
    return json({
      erro: "redator_nao_devolveu_n_variantes",
      detalhe: `Esperei ${N}, recebi ${rawVars.length}. Nada foi publicado.`,
      bruto: bruto.slice(0, 400),
      fail_closed: true,
    }, 502);
  }

  const variantesOut: any[] = [];
  for (let i = 0; i < N; i++) {
    const v = rawVars[i] ?? {};
    const texto = String(v?.texto ?? "").trim();
    const hook = String(v?.hook_tactic ?? "").trim() || null;
    const notas = String(v?.notas ?? "").trim() || null;
    if (!texto) {
      variantesOut.push({
        indice: i + 1,
        texto: "",
        hook_tactic: hook,
        notas,
        veredito: "reprovado",
        apto_para_card: false,
        compliance: { fail_closed: true, erro: "texto_vazio" },
        par_texto_e_peca: null,
      });
      continue;
    }

    let compl: any = null;
    let httpOk = false;
    try {
      const cc = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mcp-key": cfg.api_key },
        body: JSON.stringify({ legenda: texto, company_id: companyId }),
      });
      compl = await cc.json().catch(() => null);
      httpOk = cc.status === 200;
      if (!httpOk) {
        compl = { fail_closed: true, http: cc.status, resposta: compl };
      }
    } catch (e) {
      compl = { fail_closed: true, erro: String(e).slice(0, 200) };
    }

    const okCompl = complianceAprovado(compl, httpOk);
    let par: any = null;
    let parOk = true;
    if (driveFileId) {
      const { data: parData, error: parErr } = await supa.rpc("checar_par_texto_e_peca", {
        p_company_id: companyId,
        p_legenda: texto,
        p_drive_file_id: driveFileId,
      });
      if (parErr) {
        par = { fail_closed: true, erro: parErr.message };
        parOk = false;
      } else {
        par = parData;
        const verdPar = String((parData as any)?.veredito ?? "").toLowerCase();
        if (verdPar.includes("reprov")) parOk = false;
      }
    }

    const apto = okCompl && parOk;
    variantesOut.push({
      indice: i + 1,
      texto,
      hook_tactic: hook,
      notas,
      veredito: apto ? "aprovado" : (okCompl ? "atencao_ou_par" : String(compl?.veredito ?? "reprovado")),
      apto_para_card: apto,
      compliance: compl,
      par_texto_e_peca: par,
    });
  }

  const aptas = variantesOut.filter((v) => v.apto_para_card).length;
  try {
    await supa.from("audit_log").insert({
      company_id: companyId,
      user_id: null,
      action: "legendas_geradas",
      target_type: "legenda",
      target_id: driveFileId ?? "sem_peca",
      details: {
        versao: VERSAO,
        n: N,
        produto,
        objetivo: objetivo.slice(0, 300),
        aptas,
        hooks: variantesOut.map((v) => v.hook_tactic),
        mcp_chamador: auth.chamador,
      },
    });
  } catch {
    /* audit nao bloqueia */
  }

  return json({
    ok: true,
    versao: VERSAO,
    framework: "hook_beneficio_cta_cet",
    n: N,
    produto,
    objetivo,
    drive_file_id: driveFileId,
    variantes: variantesOut,
    aptas,
    instrucao:
      "ESP-37: escolha UMA variante com apto_para_card=true e use em propose_action criar_anuncio_a_partir_de com params.legenda, legenda_fonte=agente e legenda_referencias (hooks/objetivo). Variantes reprovadas NAO entram no card. Nada foi publicado na Meta.",
    redator_meta: { model: OR_MODEL, tokens: rj?.usage ?? null },
  });
});
