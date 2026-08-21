// supabase/functions/gerar-legendas/index.ts (v3)
// v3 (21/08/2026): isolamento multi-empresa. company_id OBRIGATORIO (sem fallback LEV).
//   produto obrigatorio OU linhas_produto da brand — NUNCA inventa CLT para COHAPM.
//   Bloco CET/FIN-04 so para empresa de credito. Framework Hook→Beneficio→CTA para todos.
// ESP-37 (12/08/2026): motor de legenda Meta Ads — N=3 fixo. Redator OpenRouter +
//   guardião compliance-check por variante. NÃO emite card e NÃO escreve na Meta.
// v2 - ESP-36: consome ler_brand_identity(company_id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { extrasAutoRouter, modeloOpenRouterPadrao } from "../_shared/openrouter_auto.ts";
import { empresaEhCredito } from "../_shared/empresa_credito.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OR_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const OR_MODEL = modeloOpenRouterPadrao();
const VERSAO = "gerar-legendas-v3";
const N = 3;

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

function complianceAptoParaCard(compl: any, httpOk: boolean): boolean {
  if (!httpOk || !compl || compl?.erro) return false;
  const verd = String(compl?.veredito ?? compl?.verdict ?? "").toLowerCase();
  if (verd === "reprovado" || verd.includes("reprov")) return false;
  const viol = Array.isArray(compl?.violacoes) ? compl.violacoes : [];
  if (viol.some((v: any) => String(v?.severidade ?? "").toLowerCase() === "bloqueia")) return false;
  // aprovado e atencao (ex. LGL-04 sem CNPJ no body) sao aptos para emitir card.
  if (verd === "aprovado" || verd === "atencao" || verd.includes("aprov") || verd.includes("atenc")) {
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

  const companyId = String(body?.company_id ?? body?.company ?? "").trim();
  if (!companyId) {
    return json({
      erro: "company_id_obrigatorio",
      detalhe: "Informe company_id da conversa. O motor nao usa Legal/LEV como fallback.",
    }, 400);
  }
  const ehCredito = empresaEhCredito(companyId);
  let produto = String(body?.produto ?? "").trim();
  const objetivo = String(body?.objetivo ?? body?.eixo ?? "").trim();
  if (!objetivo) {
    return json({
      erro: "objetivo_obrigatorio",
      detalhe: ehCredito
        ? "Informe objetivo (ou eixo): o que a legenda deve comunicar (ex.: 'abrir simulacao CLT')."
        : "Informe objetivo (ou eixo): o que a legenda deve comunicar (ex.: 'orientar sobre cobranca indevida no WhatsApp juridico').",
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

  // Amostra de promessas proibidas — so credito (mapa e de consignado).
  let listaPromessas = "";
  if (ehCredito) {
    const { data: promessas } = await supa
      .from("promessas_proibidas")
      .select("proibido,seguro")
      .limit(40);
    listaPromessas = (promessas ?? [])
      .map((p: any) => `- "${p.proibido}" → use "${p.seguro}"`)
      .slice(0, 25)
      .join("\n");
  }

  // ESP-36: identidade de marca da empresa (voz/tom, dos/donts, disclaimers, produtos).
  let brandBloco = "";
  let marcaNome = ehCredito ? "Legal e Viver (credito consignado)" : "COHAPM (cooperativa / juridico)";
  let linhasProduto: string[] = [];
  try {
    const { data: bi } = await supa.rpc("ler_brand_identity", { p_company_id: companyId });
    const brand = (bi as any)?.brand;
    if (brand) {
      marcaNome = String(brand?.marca_nome ?? marcaNome);
      const voz = brand?.voz_tom ?? {};
      const dos: string[] = Array.isArray(brand?.dos) ? brand.dos : [];
      const donts: string[] = Array.isArray(brand?.donts) ? brand.donts : [];
      const discl: string[] = Array.isArray(brand?.disclaimers_obrigatorios) ? brand.disclaimers_obrigatorios : [];
      linhasProduto = Array.isArray(brand?.linhas_produto) ? brand.linhas_produto.map(String) : [];
      brandBloco = [
        `\n=== IDENTIDADE DE MARCA (ESP-36 — ${marcaNome}) ===`,
        voz?.tom ? `Tom: ${voz.tom}` : "",
        voz?.persona ? `Persona: ${voz.persona}` : "",
        voz?.pessoa ? `Voz: ${voz.pessoa}` : "",
        dos.length ? `FACA:\n${dos.map((d) => `- ${d}`).join("\n")}` : "",
        donts.length ? `NAO FACA:\n${donts.map((d) => `- ${d}`).join("\n")}` : "",
        discl.length ? `Disclaimers obrigatorios:\n${discl.map((d) => `- ${d}`).join("\n")}` : "",
        linhasProduto.length ? `Linhas de produto: ${linhasProduto.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    }
  } catch {
    /* brand nao bloqueia */
  }

  if (!produto) {
    produto = linhasProduto[0] ? String(linhasProduto[0]) : "";
  }
  if (!produto) {
    return json({
      erro: "produto_obrigatorio",
      detalhe: ehCredito
        ? "Informe produto (ex.: CLT / consignado_clt) ou semeie brand_identity.linhas_produto."
        : "Informe produto (ex.: juridico_whatsapp) ou semeie brand_identity.linhas_produto. Nao ha fallback CLT.",
      linhas_produto_brand: linhasProduto,
    }, 400);
  }

  const blocoCet = ehCredito
    ? `4) CET — o CET (ou referencia ao CET da oferta) MORA NA LEGENDA DA PUBLICACAO (FIN-04 v4). Preferencia da casa quando NAO ha taxa oficial: "consulte o CET na sua simulacao". Isso E suficiente. NUNCA invente percentual.`
    : `4) FECHO — CTA + canal oficial (WhatsApp/juridico). NUNCA invente CET, consignado CLT, margem disponivel, correspondente bancario ou "Legal e Viver".`;

  const regrasDuras = ehCredito
    ? `- Proibido: garantia de aprovacao, "sem consulta", "100% aprovado", dinheiro "gratis", omitir risco de credito.`
    : `- Proibido: inventar credito/CLT/CET; prometer resultado juridico garantido; direcionar a numero de terceiro nao identificado.`;

  const sys = `Voce e redator de legendas de Meta Ads para ${marcaNome}.
Framework OBRIGATORIO (ESP-37), nesta ordem em CADA legenda:
1) HOOK — primeira linha que para o scroll (use tatica de hook distinta em cada variante).
2) BENEFICIO/PROVA — o que a oferta/orientacao entrega, sem promessa ilegal.
3) CTA — acao clara.
${blocoCet}

Regras duras:
- Portugues do Brasil; tom direto, conversacional, sem exagero de urgencia falsa.
${regrasDuras}
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
      ...extrasAutoRouter({ model: OR_MODEL, costTier: "medium" }),
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

    const okCompl = complianceAptoParaCard(compl, httpOk);
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
    framework: ehCredito ? "hook_beneficio_cta_cet" : "hook_beneficio_cta",
    empresa_credito: ehCredito,
    n: N,
    produto,
    objetivo,
    drive_file_id: driveFileId,
    variantes: variantesOut,
    aptas,
    instrucao:
      "ESP-37: escolha UMA variante com apto_para_card=true e use em propose_action criar_anuncio_a_partir_de com params.legenda, legenda_fonte=agente e legenda_referencias. Variantes reprovadas NAO entram no card. Nada foi publicado na Meta.",
    redator_meta: { model: OR_MODEL, tokens: rj?.usage ?? null },
  });
});
