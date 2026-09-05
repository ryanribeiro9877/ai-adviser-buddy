// supabase/functions/compliance-check/index.ts (v4)
// v5 (05/09/2026): a regua de frases alcanca o veredito. O mapa `promessas_proibidas` deixou
//   de ser consultado por "a empresa e de credito?" e passou a ser escopado por RAMO
//   (`checar_promessas_proibidas_da_empresa`), e um `bloqueia` dele agora produz `reprovado`.
//   Antes disto a LGL-JUR-01 — promovida a bloqueante pelo gestor em 04/09 — era inerte por
//   duas barreiras independentes: nao era consultada para empresa nao-credito, e nao tinha
//   por onde entrar no veredito. Avisos NAO escalam, de proposito (ver comentarios no corpo).
// v4 (21/08/2026): isolamento multi-empresa. company_id governa o LLM:
//   - Legal/credito: Guardião consignado + FIN/CET.
//   - COHAPM/nao-credito: Guardião cooperativa/juridico WA — SEM CET/CLT/consignado;
//     filtra regras FIN-* / LGL-01/02 de `compliance_rules`.
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

  // 05/09/2026 — O MAPA DE FRASES PASSA A SER ESCOPADO POR RAMO, NAO POR "E DE CREDITO?".
  //
  // Este bloco decidia por `ehCredito` e, para toda empresa nao-credito, devolvia
  // { avaliado:false, motivo:"promessas_proibidas e mapa de credito — nao aplica a empresa
  // nao-credito" }. A frase era verdadeira quando foi escrita e ficou FALSA em 04/09, quando
  // as cinco regras LGL-JUR de publicidade advocaticia entraram em promessas_proibidas com
  // ramo 'juridico'. A COHAPM deriva ramo `juridico` e responde por 83 dos 97 anuncios
  // ativos: era exatamente a empresa para quem a regua nova foi escrita que o portao se
  // recusava a consultar — e explicava a recusa com um motivo que havia envelhecido. Ausencia
  // acompanhada de justificativa confiante e errada e a forma perigosa do padrao, porque quem
  // le para de procurar.
  //
  // A pergunta certa nao e "esta empresa e de credito?", e "existe regra aplicavel ao ramo
  // desta empresa?". Quem responde isso JA EXISTE e nao e invencao desta mudanca:
  // `checar_promessas_proibidas_da_empresa` deriva o ramo por `ramos_da_empresa`, filtra por
  // ramo + 'qualquer' e falha FECHADO nos tres casos que importam — company_id nulo ou
  // inexistente levanta excecao, e escopo sem nenhuma regra ativa levanta excecao em vez de
  // deixar todo texto passar. Medido em 05/09: COHAPM -> ['juridico'], 6 regras no escopo,
  // 1 bloqueante; Legal e Viver -> ['credito'], 10 regras, 8 bloqueantes.
  let promessas: unknown = null;
  if (legenda && companyId) {
    const { data, error } = await supa.rpc("checar_promessas_proibidas_da_empresa", {
      p_company_id: companyId,
      p_texto: legenda,
    });
    // `avaliado:false` no erro e deliberado: se a RPC estourou (empresa inexistente, escopo
    // vazio), o texto NAO foi medido, e o campo tem de dizer isso em vez de parecer limpo.
    promessas = error ? { erro: error.message, avaliado: false } : data;
  } else if (legenda && !companyId) {
    promessas = {
      avaliado: false,
      motivo:
        "requisicao sem company_id — o mapa de frases e escopado por ramo do negocio e nao roda sem empresa",
      nota:
        "Isto e LACUNA, nao aprovacao: as regras de frase nao foram medidas contra este texto. Declarar o vazio em vez de explicar por que ele nao importa foi justamente o conserto de 05/09.",
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
  const finish = String(parsed?.choices?.[0]?.finish_reason ?? "");
  const raciocinio = Number(parsed?.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
  // 05/09/2026 — TETO ESTOURADO NAO PODE APROVAR. `finish_reason:length` significa que o
  // modelo foi cortado no meio: o que voltou nao e um veredito, e um pedaco de veredito. E o
  // pedaco podia MUITO BEM ser parseavel — bastava o JSON ter fechado antes das violacoes
  // (`{"violacoes":[]}`) e o resto do codigo devolveria "aprovado" com `regras_aplicadas:N` ao
  // lado, ou seja: avaliacao que nao aconteceu saindo como permissao, com aparencia de rigor.
  // Esta e a forma perigosa do padrao — a ausencia nao so passa, ela vem explicada errado.
  if (finish === "length") {
    return json({
      error: "veredito_truncado_no_teto",
      finish_reason: finish,
      reasoning_tokens: raciocinio,
      fail_closed: true,
      detalhe:
        "O modelo estourou max_tokens antes de fechar o veredito. Avaliacao incompleta NAO aprova.",
      bruto: out.slice(0, 400),
    }, 502);
  }
  const a = out.indexOf("{"),
    b = out.lastIndexOf("}");
  if (a < 0 || b <= a)
    return json({
      error: "veredito_nao_estruturado",
      finish_reason: finish,
      reasoning_tokens: raciocinio,
      fail_closed: true,
      bruto: out.slice(0, 400),
    }, 502);
  let veredicto: any;
  try {
    veredicto = JSON.parse(out.slice(a, b + 1));
  } catch {
    return json({ error: "veredito_nao_estruturado", bruto: out.slice(0, 400) }, 502);
  }

  // v2: severidade vem da BASE (não do modelo) e o veredito é determinístico
  const relatadas = Array.isArray(veredicto?.violacoes) ? veredicto.violacoes : [];
  const violacoes = relatadas
    .filter((v: any) => sevMap.has(String(v?.code)))
    .map((v: any) => ({ ...v, severidade: sevMap.get(String(v.code)) }));
  // 05/09/2026 — A MESMA PORTA, PELO OUTRO LADO. O filtro acima existe por um bom motivo (a
  // severidade e da base, nunca do modelo), mas ele silenciava o caso em que o modelo APONTOU
  // problema e nomeou com codigo que a base nao reconhece: as violacoes eram descartadas em
  // silencio, `violacoes.length` caia a zero e o veredito virava "aprovado". Achado de
  // conformidade sumindo por erro de nomenclatura nao e material aprovado — e material nao
  // avaliado, e material nao avaliado nao passa.
  const descartadas = relatadas.filter((v: any) => !sevMap.has(String(v?.code)));
  if (relatadas.length > 0 && violacoes.length === 0) {
    return json({
      error: "violacoes_com_codigo_fora_da_base",
      fail_closed: true,
      detalhe:
        `O modelo relatou ${relatadas.length} violacao(oes) e NENHUMA casou com um code de compliance_rules aplicavel a esta empresa. Sem casar codigo nao ha severidade, e sem severidade nao ha veredito — isto nao e aprovacao.`,
      codigos_recusados: descartadas.map((v: any) => String(v?.code ?? "(sem code)")).slice(0, 20),
      regras_aplicadas: aplicaveis.length,
      finish_reason: finish,
    }, 502);
  }
  // 05/09/2026 — O MAPA DE FRASES PASSA A ALCANCAR O VEREDITO.
  //
  // O veredito saia SO das violacoes casadas contra `compliance_rules`, e as regras LGL-JUR
  // nao moram lá: moram em `promessas_proibidas`. Consequencia medida: a LGL-JUR-01,
  // promovida a `bloqueia` por decisao do gestor em 04/09, nao tinha por onde virar
  // `reprovado`. A decisao existia e era inerte — o portao podia detectar o bloqueio, grava-lo
  // no corpo da resposta e ainda assim devolver `veredito:"aprovado"` ao lado.
  //
  // SO `bloqueios` ESCALA; `atencoes` continuam FORA do veredito, e isto e escolha, nao
  // esquecimento. Das cinco LGL-JUR so a 01 e bloqueante; a 03 (gratuidade como chamariz)
  // casa 42 de 42 pecas do Juridico pela medicao da propria migration e ainda vai a advogado
  // antes de qualquer promocao. Se aviso escalasse, ligar este caminho pararia de aprovar
  // peca juridica nenhuma — efeito colateral que ninguem decidiu e que teria sido lido como
  // "o portao novo quebrou a operacao".
  //
  // Consistencia com a emissao: `checar_par_texto_e_peca`, que roda na emissao do anuncio, JA
  // devolve veredito 'reprova' sobre estes mesmos `bloqueios`. Esta mudanca nao cria exposicao
  // nova — faz a edge concordar com o portao que ja decide na hora de publicar.
  const bloqueiaPorFrase = (promessas as any)?.bloqueia === true;
  const regrasDeFrase = (arr: unknown) =>
    (Array.isArray(arr) ? arr : [])
      .map((x: any) => String(x?.regra ?? "(sem regra)"))
      .slice(0, 20);
  const bloqueiosDeFrase = regrasDeFrase((promessas as any)?.bloqueios);
  const atencoesDeFrase = regrasDeFrase((promessas as any)?.atencoes);

  const temBloqueio = violacoes.some((v: any) => v.severidade === "bloqueia") || bloqueiaPorFrase;
  const veredito = temBloqueio ? "reprovado" : violacoes.length === 0 ? "aprovado" : "atencao";

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
    // CODE 1.4: substituto seguro + gate de segmentacao.
    // 05/09/2026: este gate DEIXOU de ser auxiliar. O comentario anterior dizia que "o
    // veredito continua sendo o do verificador LLM contra compliance_rules", e era essa
    // afirmacao que mantinha a regua juridica inerte.
    promessas_proibidas: promessas,
    segmentacao,
    // De onde veio o veredito. Sem isto, `reprovado` por frase e `reprovado` por LLM ficam
    // indistinguiveis, e a revisao humana nao sabe se discute com o modelo ou com o padrao.
    veredito_origem: [
      ...(violacoes.length ? ["compliance_rules"] : []),
      ...(bloqueiaPorFrase ? ["promessas_proibidas"] : []),
    ],
    bloqueio_por_frase: bloqueiosDeFrase.length ? bloqueiosDeFrase : null,
    // Aviso de frase NAO escala para o veredito (ver comentario acima), mas tambem nao pode
    // ficar invisivel: quem le "aprovado" com este campo preenchido precisa saber que houve
    // achado que a casa decidiu nao tratar como bloqueio.
    atencoes_de_frase_sem_escalar: atencoesDeFrase.length ? atencoesDeFrase : null,
    ramos_aplicados: (promessas as any)?.ramos_aplicados ?? null,
    escopo_de_ramo_resolvido: (promessas as any)?.escopo_resolvido ?? null,
    mcp_chamador: mcpChamador,
    mcp_chave_legada: mcpLegado,
    // Descarte PARCIAL nao derruba o veredito (as violacoes que casaram ja o produziram), mas
    // tambem nao pode ficar invisivel: se o modelo aponta cinco coisas e duas somem no filtro,
    // quem le "atencao" merece saber que havia mais na mesa.
    codigos_recusados: descartadas.length
      ? descartadas.map((v: any) => String(v?.code ?? "(sem code)")).slice(0, 20)
      : null,
    finish_reason: finish,
    reasoning_tokens: raciocinio,
    tokens_in: parsed?.usage?.prompt_tokens ?? null,
    tokens_out: parsed?.usage?.completion_tokens ?? null,
  });
});
