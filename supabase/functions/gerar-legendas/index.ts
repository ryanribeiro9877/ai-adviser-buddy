// supabase/functions/gerar-legendas/index.ts (v4)
// v4 (25/08/2026): (1) NAO envia reasoning.enabled=false — Gemini 3.7 recusa com HTTP 400
//   "Reasoning is mandatory and cannot be disabled" e o chat dizia "ferramenta indisponivel";
//   (2) p_meio / produto imovel seleciona brand La Felicità, nunca Juridico.
// v3 (21/08/2026): isolamento multi-empresa. company_id OBRIGATORIO (sem fallback LEV).
//   produto obrigatorio OU linhas_produto da brand — NUNCA inventa CLT para COHAPM.
//   Bloco CET/FIN-04 so para empresa de credito. Framework Hook→Beneficio→CTA para todos.
// ESP-37 (12/08/2026): motor de legenda Meta Ads — N=3 fixo. Redator OpenRouter +
//   guardião compliance-check por variante. NÃO emite card e NÃO escreve na Meta.
// v2 - ESP-36: consome ler_brand_identity(company_id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { bodyOpenRouter, resolverChamadaLlm, tetoDeSaida } from "../_shared/llm_roteador.ts";
import { empresaEhCredito } from "../_shared/empresa_credito.ts";
import { inferirMeioDeProduto, inferirMeioDrive, parseMeioDriveArg, type MeioDrive } from "../_shared/pedido_drive_criativos.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OR_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const VERSAO = "gerar-legendas-v4";
const N = 3;

const FALLBACK_LA_FELICITA = {
  marca_nome: "La Felicità (residencial COHAPM)",
  tom: "acolhedor, sensorial e cotidiano; fala de morar bem, rotina e pertencimento",
  persona: "quem ja vive no residencial e convida a conhecer o La Felicità",
  dos: [
    "Abrir pela sensacao da cena (chegada, familia, lazer, rotina, noite)",
    "Beneficio concreto do residencial sem inventar metragem, preco ou condicao",
    "CTA: conhecer o La Felicità / ver o empreendimento no site",
  ],
  donts: [
    "Voz do nucleo Juridico (conta de luz, cobranca, emprestimo abusivo)",
    "CET, consignado CLT, margem, correspondente bancario, Legal e Viver",
    "Promessa juridica ou urgencia falsa",
  ],
};

const FALLBACK_SISTEMA_OCULAR = {
  marca_nome: "Sistema Ocular / VISTTA (COHAPM)",
  tom: "claro, confiavel e humano; fala de cuidar da visao sem alarmismo nem jargao medico inventado",
  persona: "quem busca atendimento ocular de qualidade e quer conhecer o empreendimento Sistema Ocular",
  dos: [
    "Abrir pelo cuidado com a visao, acolhimento e clareza do servico",
    "Beneficio concreto sem inventar procedimento, preco, resultado clinico ou especialidade",
    "CTA: conhecer o Sistema Ocular / VISTTA — sem misturar Juridico nem La Felicità",
  ],
  donts: [
    "Voz do nucleo Juridico (conta de luz, cobranca, emprestimo) ou copy residencial La Felicità",
    "Promessa medica, cura, resultado clinico garantido ou urgencia falsa de saude",
    "CET, consignado CLT, Legal e Viver",
  ],
};

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
  //
  // A CHAVE FANTASMA, removida em 04/09/2026. As duas linhas seguintes liam `compl.aprovado`,
  // chave que `compliance-check` NUNCA devolve - ela so produz `veredito: "aprovado"`. A
  // primeira leitura era `!== false`, a forma perigosa: chave ausente da `undefined !== false`,
  // que e VERDADEIRO, entao a ausencia de sinal virava aprovacao. A segunda era `=== true`,
  // inofensiva mas morta. Aqui o dano estava contido porque so se chegava nelas com veredito
  // ja positivo; o motivo de tirar e que o idioma e o mesmo que em 03/09/2026 leu
  // `->>'aprovado'` do portao de promessas e quase enterrou um achado de compliance.
  // Quem decide agora e o veredito, que existe. Ver _prova_portao_fail_closed.ts.
  if (verd === "aprovado" || verd === "atencao" || verd.includes("aprov") || verd.includes("atenc")) {
    return true;
  }
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
        : "Informe objetivo (ou eixo): o que a legenda deve comunicar (ex.: 'conhecer o La Felicità' ou 'orientar no WhatsApp juridico').",
    }, 400);
  }

  const meio: MeioDrive | null =
    parseMeioDriveArg(body?.meio)
    || inferirMeioDeProduto(produto)
    || inferirMeioDrive(`${produto} ${objetivo}`);

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

  // ESP-36: identidade de marca da empresa (voz/tom). Meio La Felicita NAO herda Juridico.
  let brandBloco = "";
  let marcaNome = ehCredito ? "Legal e Viver (credito consignado)" : "COHAPM";
  let linhasProduto: string[] = [];
  try {
    const rpcArgs: Record<string, unknown> = { p_company_id: companyId };
    if (meio) rpcArgs.p_meio = meio;
    const { data: bi } = await supa.rpc("ler_brand_identity", rpcArgs);
    const brand = (bi as any)?.brand;
    if (brand && (!meio || String(brand?.meio ?? "") === meio || !brand?.meio)) {
      marcaNome = String(brand?.marca_nome ?? marcaNome);
      const voz = brand?.voz_tom ?? {};
      const dos: string[] = Array.isArray(brand?.dos) ? brand.dos : [];
      const donts: string[] = Array.isArray(brand?.donts) ? brand.donts : [];
      const discl: string[] = Array.isArray(brand?.disclaimers_obrigatorios) ? brand.disclaimers_obrigatorios : [];
      linhasProduto = Array.isArray(brand?.linhas_produto) ? brand.linhas_produto.map(String) : [];
      brandBloco = [
        `\n=== IDENTIDADE DE MARCA (ESP-36 — ${marcaNome}${meio ? `, meio=${meio}` : ""}) ===`,
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

  if (meio === "la_felicita" && (!brandBloco || /juridico/i.test(marcaNome))) {
    marcaNome = FALLBACK_LA_FELICITA.marca_nome;
    linhasProduto = ["imovel", "residencial", "la_felicita"];
    brandBloco = [
      `\n=== IDENTIDADE DE MARCA (La Felicità — editorial; nao usar Juridico) ===`,
      `Tom: ${FALLBACK_LA_FELICITA.tom}`,
      `Persona: ${FALLBACK_LA_FELICITA.persona}`,
      `FACA:\n${FALLBACK_LA_FELICITA.dos.map((d) => `- ${d}`).join("\n")}`,
      `NAO FACA:\n${FALLBACK_LA_FELICITA.donts.map((d) => `- ${d}`).join("\n")}`,
      `Linhas de produto: ${linhasProduto.join(", ")}`,
    ].join("\n");
  }

  if (meio === "sistema_ocular" && (!brandBloco || /juridico|felicita/i.test(marcaNome))) {
    marcaNome = FALLBACK_SISTEMA_OCULAR.marca_nome;
    linhasProduto = ["saude_ocular", "oftalmologia", "sistema_ocular", "vistta"];
    brandBloco = [
      `\n=== IDENTIDADE DE MARCA (Sistema Ocular / VISTTA — editorial; nao usar Juridico nem La Felicità) ===`,
      `Tom: ${FALLBACK_SISTEMA_OCULAR.tom}`,
      `Persona: ${FALLBACK_SISTEMA_OCULAR.persona}`,
      `FACA:\n${FALLBACK_SISTEMA_OCULAR.dos.map((d) => `- ${d}`).join("\n")}`,
      `NAO FACA:\n${FALLBACK_SISTEMA_OCULAR.donts.map((d) => `- ${d}`).join("\n")}`,
      `Linhas de produto: ${linhasProduto.join(", ")}`,
    ].join("\n");
  }

  if (!produto) {
    if (meio === "la_felicita") produto = "imovel";
    else if (meio === "sistema_ocular") produto = "saude_ocular";
    else produto = linhasProduto[0] ? String(linhasProduto[0]) : "";
  }
  if (!produto) {
    return json({
      erro: "produto_obrigatorio",
      detalhe: ehCredito
        ? "Informe produto (ex.: CLT / consignado_clt) ou semeie brand_identity.linhas_produto."
        : "Informe produto (ex.: imovel / la_felicita ou juridico_whatsapp) ou semeie brand_identity.linhas_produto. Nao ha fallback CLT.",
      linhas_produto_brand: linhasProduto,
      meio,
    }, 400);
  }

  const blocoCet = ehCredito
    ? `4) CET — o CET (ou referencia ao CET da oferta) MORA NA LEGENDA DA PUBLICACAO (FIN-04 v4). Preferencia da casa quando NAO ha taxa oficial: "consulte o CET na sua simulacao". Isso E suficiente. NUNCA invente percentual.`
    : meio === "la_felicita"
    ? `4) FECHO — CTA conhecer o La Felicità / ver o empreendimento. NUNCA invente CET, consignado, conta de luz, cobranca, emprestimo ou copy do nucleo Juridico.`
    : meio === "sistema_ocular"
    ? `4) FECHO — CTA conhecer o Sistema Ocular / VISTTA. NUNCA invente resultado clinico, preco, CET, copy Juridico ou La Felicità.`
    : `4) FECHO — CTA + canal oficial (WhatsApp/juridico). NUNCA invente CET, consignado CLT, margem disponivel, correspondente bancario ou "Legal e Viver".`;

  const regrasDuras = ehCredito
    ? `- Proibido: garantia de aprovacao, "sem consulta", "100% aprovado", dinheiro "gratis", omitir risco de credito.`
    : meio === "la_felicita"
    ? `- Proibido: voz Juridico (conta de luz, cobranca, emprestimo); inventar preco/metragem/financiamento; CET/CLT.`
    : meio === "sistema_ocular"
    ? `- Proibido: voz Juridico ou La Felicità; promessa medica/cura; inventar procedimento, preco ou resultado clinico; CET/CLT.`
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

  const rota = resolverChamadaLlm({ tipo: "legendas" });
  // v4: NAO passar reasoning.enabled=false — Gemini 3.7 / alguns endpoints devolvem HTTP 400
  // "Reasoning is mandatory for this endpoint and cannot be disabled".
  const extraBody: Record<string, unknown> = {
    // 05/09/2026: 4.000 cobria o raciocinio no p90 (4.217) e nada mais — e aqui o teto tem de
    // pagar raciocinio MAIS N legendas em prosa. Diferente do compliance, estourar aqui nao da
    // 502 limpo: da `redator_nao_devolveu_n_variantes`, que parece redator ruim e nao teto
    // curto. O piso do roteador resolve os dois.
    max_tokens: tetoDeSaida(),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userMsg },
    ],
  };
  let rl = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OR_KEY}` },
    body: JSON.stringify(bodyOpenRouter(rota, extraBody)),
  });
  if (!rl.ok) {
    const t = await rl.text().catch(() => "");
    if (rl.status === 400 && /reasoning/i.test(t) && rota.fallbacks.length) {
      const retryRota = { ...rota, model: rota.fallbacks[0], fallbacks: rota.fallbacks.slice(1) };
      rl = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OR_KEY}` },
        body: JSON.stringify(bodyOpenRouter(retryRota, extraBody)),
      });
    }
    if (!rl.ok) {
      const t2 = t || (await rl.text().catch(() => ""));
      return json({
        erro: "redator_openrouter_falhou",
        detalhe: `OpenRouter HTTP ${rl.status}`,
        bruto: t2.slice(0, 400),
        fail_closed: true,
        instrucao_agente:
          "NAO diga que a ferramenta esta indisponivel e NAO ofereca esperar vs o gestor escrever. ESCREVA VOCE as 3 variantes Hook→Beneficio→CTA no tom do produto desta conversa (La Felicita ≠ Juridico) e registre com registrar_legenda_da_conversa.",
      }, 502);
    }
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
      // FAIL-CLOSED, e o motivo esta em producao. A versao anterior tratava erro da RPC, mas
      // nao tratava RESPOSTA VAZIA sem erro: `parData` nulo fazia `verdPar` virar "", ""
      // nao contem "reprov", e a variante passava como apta. Ou seja, verificador que nao
      // respondeu liberava a publicacao. E o mesmo defeito que em 03/09/2026 fez uma
      // comparacao de risco ler a chave inexistente `aprovado` e tratar NULL como aprovacao.
      // Agora so passa quem foi avaliado e cujo veredito esta na lista de liberados; qualquer
      // outra coisa - nulo, vazio, vocabulario novo - e recusa. Ausencia de veredito nao e
      // veredito de ausencia de risco.
      const LIBERADOS = ["sem_violacao_detectada", "atencao", "nada_a_avaliar"];
      if (parErr) {
        par = { fail_closed: true, erro: parErr.message };
        parOk = false;
      } else if (!parData || typeof parData !== "object") {
        par = { fail_closed: true, erro: "checar_par_texto_e_peca devolveu resposta vazia" };
        parOk = false;
      } else {
        par = parData;
        const verdPar = String((parData as any)?.veredito ?? "").toLowerCase().trim();
        if (!LIBERADOS.includes(verdPar)) {
          parOk = false;
          par = {
            ...(parData as Record<string, unknown>),
            fail_closed: true,
            erro: `veredito do par nao esta na lista de liberados: ${verdPar || "(ausente)"}`,
          };
        }
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
    redator_meta: { model: rota.model, tokens: rj?.usage ?? null, faixa: rota.faixa },
  });
});
