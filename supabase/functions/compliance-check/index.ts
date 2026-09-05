// supabase/functions/compliance-check/index.ts (v4)
// v4 (21/08/2026): isolamento multi-empresa. company_id governa o LLM:
//   - Legal/credito: Guardião consignado + FIN/CET + promessas_proibidas.
//   - COHAPM/nao-credito: Guardião cooperativa/juridico WA — SEM CET/CLT/consignado;
//     filtra regras FIN-* / LGL-01/02; nao roda mapa de promessas de credito.
//   Veredito continua DETERMINISTICO por severidade. sugestao_reescrita NAO inventa
//   "Legal e Viver" / correspondente bancario fora da empresa de credito.
// v3 (05/08/2026 CODE 1.4): substituto seguro + checar_segmentacao.
// Auth: x-mcp-key OU Bearer JWT. Body: { legenda?, image_base64?, mime?, company_id?, targeting? }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { bodyOpenRouter, resolverChamadaLlm, tetoDeSaida } from "../_shared/llm_roteador.ts";
import {
  empresaEhCredito,
  filtrarRegrasPorEmpresa,
} from "../_shared/empresa_credito.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const xKey = (req.headers.get("x-mcp-key") ?? "").trim();
  const bearer = bearerDe(req);
  let authed = false;
  let mcpChamador: string | null = null;
  let mcpLegado: boolean | null = null;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
    mcpChamador = v.chamador;
    mcpLegado = v.legado;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) authed = true;
    else {
      const v = await mcpKeyValida(supa, bearer);
      if (v.ok) {
        authed = true;
        mcpChamador = v.chamador;
        mcpLegado = v.legado;
      }
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const legenda = String(body?.legenda ?? "").trim();
  const imgB64 = String(body?.image_base64 ?? "").trim();
  const mime = String(body?.mime ?? "image/png");
  const companyId = body?.company_id ? String(body.company_id) : null;
  const targeting = body?.targeting ?? null;
  if (!legenda && !imgB64 && !targeting) {
    return json({ error: "envie legenda, image_base64 e/ou targeting" }, 400);
  }

  const ehCredito = empresaEhCredito(companyId);
  let marcaNome = ehCredito ? "Legal e Viver" : "COHAPM";
  try {
    if (companyId) {
      const { data: bi } = await supa.rpc("ler_brand_identity", { p_company_id: companyId });
      const brand = (bi as any)?.brand;
      if (brand?.marca_nome) marcaNome = String(brand.marca_nome);
    }
  } catch { /* brand opcional */ }

  // CODE 1.4: mapa de promessas e de CREDITO — so Legal. COHAPM nao herda substitutos CLT.
  let promessas: unknown = null;
  if (legenda && ehCredito) {
    const { data, error } = await supa.rpc("checar_promessas_proibidas", { p_texto: legenda });
    promessas = error ? { erro: error.message } : data;
  } else if (legenda && !ehCredito) {
    promessas = {
      avaliado: false,
      motivo: "promessas_proibidas e mapa de credito — nao aplica a empresa nao-credito",
    };
  }
  let segmentacao: unknown = null;
  if (targeting != null && companyId) {
    const { data, error } = await supa.rpc("checar_segmentacao", {
      p_company_id: companyId,
      p_targeting: targeting,
    });
    segmentacao = error ? { erro: error.message } : data;
  } else if (targeting != null && !companyId) {
    segmentacao = {
      avaliado: false,
      motivo: "targeting veio sem company_id — checar_segmentacao exige os dois",
    };
  }

  // Sem legenda/imagem: so a checagem estrutural. Nao chama o modelo a toa.
  if (!legenda && !imgB64) {
    return json({
      ok: true,
      escopo: "segmentacao",
      veredito: null,
      violacoes: [],
      sugestao_reescrita: null,
      promessas_proibidas: promessas,
      segmentacao,
      mcp_chamador: mcpChamador,
      mcp_chave_legada: mcpLegado,
      nota: "so targeting foi avaliado; sem legenda/imagem o verificador LLM nao rodou",
    });
  }

  const { data: rules } = await supa
    .from("compliance_rules")
    .select("code,categoria,severidade,regra,exemplos_violacao")
    .eq("active", true)
    .order("code");
  if (!rules?.length) return json({ error: "base de regras vazia" }, 500);
  const escopo = legenda && imgB64 ? "ambos" : legenda ? "legenda" : "criativo";
  const porEscopo = rules.filter(
    (r) => r.categoria === "ambos" || r.categoria === escopo || escopo === "ambos",
  );
  const aplicaveis = filtrarRegrasPorEmpresa(porEscopo, companyId);
  const sevMap = new Map(aplicaveis.map((r) => [r.code, r.severidade]));

  const regrasTxt = aplicaveis
    .map(
      (r) => `${r.code} [${r.severidade}] (${r.categoria}): ${r.regra} Ex.: ${r.exemplos_violacao}`,
    )
    .join("\n");
  const instruCredito =
    `Você é o Guardião de Compliance de anúncios de crédito consignado (${marcaNome}). Identifique VIOLAÇÕES do material contra as regras abaixo. Seja rigoroso mas justo: só aponte violação com base concreta no material; não invente. Responda SOMENTE com JSON válido, sem markdown:\n{"violacoes":[{"code":"...","trecho_ou_elemento":"...","explicacao":"máx 20 palavras"}],"sugestao_reescrita":"legenda corrigida ou null"}\nSe não houver violações: {"violacoes":[],"sugestao_reescrita":null}.\nREGRAS DE INTERPRETAÇÃO OBRIGATÓRIAS (valem sobre ambiguidade nos exemplos):\n- FIN-04: a menção "consulte o CET na sua simulação" (ou "consulte o CET da oferta") SATISFAZ a exigência de CET. NÃO exija percentual numérico de CET. NÃO trate X%/Y%/Z% de exemplos como pendência do anunciante.\n- LGL-04: se a identificação do anunciante estiver na LP/URL de destino, isso é ATENÇÃO no máximo — não invente bloqueio exigindo CNPJ na legenda quando o gestor declarou que fica na LP.\nREGRAS:\n${regrasTxt}`;
  const instruNaoCredito =
    `Você é o Guardião de Compliance de anúncios da cooperativa habitacional / núcleo jurídico (${marcaNome}). NÃO é empresa de crédito consignado. Identifique VIOLAÇÕES só contra as regras listadas. Seja rigoroso mas justo: só aponte violação com base concreta; não invente. Responda SOMENTE com JSON válido, sem markdown:\n{"violacoes":[{"code":"...","trecho_ou_elemento":"...","explicacao":"máx 20 palavras"}],"sugestao_reescrita":"legenda corrigida ou null"}\nSe não houver violações: {"violacoes":[],"sugestao_reescrita":null}.\nPROIBIDO na sugestao_reescrita: inventar CET, consignado CLT, simulação de margem, "Correspondente Bancário", "Legal é Viver", crédito sujeito a análise bancária, ou qualquer oferta financeira de terceiros.\nSe reescrever: preserve temas jurídicos (conta de luz, cobrança indevida, empréstimo abusivo, contratos) e, quando LGL-04 aplicar, sugira razão social/CNPJ/WhatsApp oficial da cooperativa — NÃO de correspondente bancário.\nLGL-04: ausência de CNPJ na legenda é ATENÇÃO no máximo se a identificação estiver no destino/WhatsApp oficial — não invente bloqueio.\nREGRAS APLICÁVEIS A ESTA EMPRESA:\n${regrasTxt}`;
  const instru = ehCredito ? instruCredito : instruNaoCredito;

  const content: any[] = [
    {
      type: "text",
      text:
        instru +
        (legenda ? `\n\nLEGENDA A AVALIAR:\n"""${legenda}"""` : "") +
        (imgB64
          ? "\n\nO CRIATIVO (imagem) segue anexo — avalie elementos visuais e texto na arte."
          : ""),
    },
  ];
  if (imgB64)
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${imgB64}` } });

  const rota = resolverChamadaLlm({ tipo: "compliance", temImagem: !!imgB64 });
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify(bodyOpenRouter(rota, {
      // 05/09/2026: 2.000 ficava ABAIXO do p50 de saida do padrao da casa (2.609 medido em
      // chat_messages para esforco `high`). O veredito de conformidade e curto, mas o teto
      // conta raciocinio + texto: o modelo pensava, estourava e devolvia `content` vazio, o
      // que aqui cai em `veredito_nao_estruturado` — 502 alto, mas 502 sempre.
      max_tokens: tetoDeSaida(),
      messages: [{ role: "user", content }],
    })),
  });
  const raw = await resp.text();
  if (!resp.ok)
    return json({ error: `openrouter_http_${resp.status}`, detail: raw.slice(0, 300) }, 502);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "openrouter_non_json" }, 502);
  }
  const out = String(parsed?.choices?.[0]?.message?.content ?? "");
  const a = out.indexOf("{"),
    b = out.lastIndexOf("}");
  if (a < 0 || b <= a)
    return json({ error: "veredito_nao_estruturado", bruto: out.slice(0, 400) }, 502);
  let veredicto: any;
  try {
    veredicto = JSON.parse(out.slice(a, b + 1));
  } catch {
    return json({ error: "veredito_nao_estruturado", bruto: out.slice(0, 400) }, 502);
  }

  // v2: severidade vem da BASE (não do modelo) e o veredito é determinístico
  const violacoes = (Array.isArray(veredicto?.violacoes) ? veredicto.violacoes : [])
    .filter((v: any) => sevMap.has(String(v?.code)))
    .map((v: any) => ({ ...v, severidade: sevMap.get(String(v.code)) }));
  const temBloqueio = violacoes.some((v: any) => v.severidade === "bloqueia");
  const veredito = violacoes.length === 0 ? "aprovado" : temBloqueio ? "reprovado" : "atencao";

  return json({
    ok: true,
    escopo,
    company_id: companyId,
    empresa_credito: ehCredito,
    marca: marcaNome,
    regras_aplicadas: aplicaveis.length,
    veredito,
    violacoes,
    sugestao_reescrita: veredicto?.sugestao_reescrita ?? null,
    // CODE 1.4: substituto seguro + gate de segmentacao. O gate de promessas e auxiliar —
    // o veredito acima continua sendo o do verificador LLM contra compliance_rules.
    promessas_proibidas: promessas,
    segmentacao,
    mcp_chamador: mcpChamador,
    mcp_chave_legada: mcpLegado,
    tokens_in: parsed?.usage?.prompt_tokens ?? null,
    tokens_out: parsed?.usage?.completion_tokens ?? null,
  });
});
