// supabase/functions/meta-identity-probe/index.ts (v1) — SOMENTE LEITURA.
// Pergunta unica: a conta Instagram informada e a conta vinculada a Pagina informada?
//
// POR QUE ESTA FUNCAO EXISTE: os anuncios criados pelo sistema nascem sem identidade
// Instagram e perdem posicionamentos de Instagram/Threads. Antes de o sistema passar a
// preencher instagram_actor_id na criacao, e preciso PROVAR pela propria Graph que o id
// pertence a Pagina. Nenhuma deducao vale aqui.
//
// POR QUE UM GET POR CAMPO, e nao um unico fields=a,b,c,d: num pedido combinado a Graph
// pode omitir silenciosamente um campo sem permissao e o resultado fica ambiguo entre
// "nao retornou" e "retornou vazio". Pedindo um campo por vez, a ausencia da chave no
// corpo e um fato observavel, e o erro daquele campo vem isolado com code/subcode.
//
// NAO ESCREVE NADA: nem na Meta, nem no banco. Apenas GETs na Graph.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const T_ADS = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const T_WABA = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";

const PAGE_PADRAO = "1095196357012756";
const IG_ESPERADO_PADRAO = "17841428674060566";
const AD_ACCOUNT_PADRAO = "act_3302001729967572";

// Os quatro campos do no da Pagina que podem declarar a conta Instagram vinculada.
// Sao quatro porque significam coisas diferentes: instagram_business_account e a conta
// profissional vinculada; connected_instagram_account e a conta usada em anuncios;
// instagram_accounts e o vinculo legado; page_backed_instagram_accounts e a conta
// "sombra" que a Meta cria para a Pagina quando nao ha IG real.
const CAMPOS = [
  "instagram_business_account",
  "connected_instagram_account",
  "instagram_accounts",
  "page_backed_instagram_accounts",
] as const;

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

function redact(s: string): string {
  let o = s;
  for (const t of [T_ADS, T_WABA]) if (t) o = o.split(t).join("[TOKEN-REDACTED]");
  return o.replace(/access_token=[A-Za-z0-9_\-.]+/g, "access_token=[TOKEN-REDACTED]");
}

function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

type Resposta = { status: number; body: any };

async function g(path: string, token: string): Promise<Resposta> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(redact(t)) };
  } catch {
    return { status: r.status, body: redact(t.slice(0, 400)) };
  }
}

/** Varre qualquer forma que a Graph use para embrulhar id(s): escalar, objeto, {data:[...]}. */
function idsDe(valor: unknown): string[] {
  const achados: string[] = [];
  const visitar = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(visitar);
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string" || typeof o.id === "number") achados.push(String(o.id));
      if (Array.isArray(o.data)) o.data.forEach(visitar);
      return;
    }
    if (typeof v === "string" || typeof v === "number") achados.push(String(v));
  };
  visitar(valor);
  return Array.from(new Set(achados));
}

/**
 * Classifica UM campo. A distincao que interessa ao ticket:
 *   erro                -> a Graph recusou este campo (permissao/escopo/campo invalido)
 *   nao_retornado       -> respondeu 200 e simplesmente nao trouxe a chave
 *   retornado_vazio     -> trouxe a chave, mas sem nenhum id dentro
 *   retornado_com_valor -> trouxe a chave com id(s)
 */
function classificar(campo: string, r: Resposta, esperado: string) {
  const corpo = r.body;
  const erro = corpo && typeof corpo === "object" ? corpo.error : null;

  if (erro) {
    return {
      campo,
      situacao: "erro" as const,
      http_status: r.status,
      erro: {
        message: erro.message ?? null,
        type: erro.type ?? null,
        code: erro.code ?? null,
        error_subcode: erro.error_subcode ?? null,
        fbtrace_id: erro.fbtrace_id ?? null,
      },
      ids: [] as string[],
      valor_bruto: null,
      comparacao: "nao_foi_possivel_comparar" as const,
    };
  }

  const temChave = corpo && typeof corpo === "object" && Object.hasOwn(corpo, campo);
  if (!temChave) {
    return {
      campo,
      situacao: "nao_retornado" as const,
      http_status: r.status,
      erro: null,
      ids: [] as string[],
      valor_bruto: null,
      comparacao: "nao_foi_retornado" as const,
    };
  }

  const valor = corpo[campo];
  const ids = idsDe(valor);
  if (ids.length === 0) {
    return {
      campo,
      situacao: "retornado_vazio" as const,
      http_status: r.status,
      erro: null,
      ids,
      valor_bruto: valor,
      comparacao: "retornado_sem_id" as const,
    };
  }

  return {
    campo,
    situacao: "retornado_com_valor" as const,
    http_status: r.status,
    erro: null,
    ids,
    valor_bruto: valor,
    comparacao: ids.includes(esperado) ? ("confere" as const) : ("difere" as const),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-or-bearer"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* corpo opcional */
  }

  const qual = String(body?.token ?? "ads").toLowerCase();
  const TOKEN = qual === "waba" ? T_WABA : T_ADS;
  const TOKEN_FONTE = qual === "waba" ? "WHATSAPP_ACCESS_TOKEN" : "META_ADS_TOKEN";
  if (!TOKEN) return json({ error: `token '${qual}' ausente no ambiente` }, 500);

  const pageId = String(body?.page_id ?? PAGE_PADRAO);
  const igEsperado = String(body?.instagram_id ?? IG_ESPERADO_PADRAO);
  const adAccount = String(body?.ad_account ?? AD_ACCOUNT_PADRAO);

  // Quem assina o token e quais escopos ele carrega. Se um campo vier com erro de
  // permissao, isto e o que diz o que faltou pedir.
  const quem = await g("/me?fields=id,name", TOKEN);
  const debug = await g(`/debug_token?input_token=${encodeURIComponent(TOKEN)}`, TOKEN);
  const dd: any = (debug.body as any)?.data ?? {};
  const escopos = Array.from(
    new Set([
      ...(Array.isArray(dd?.scopes) ? dd.scopes.map(String) : []),
      ...(Array.isArray(dd?.granular_scopes)
        ? dd.granular_scopes.map((s: any) => String(s?.scope ?? "")).filter(Boolean)
        : []),
    ]),
  );

  const pagina = await g(`/${pageId}?fields=id,name,username,category`, TOKEN);

  // Um GET por campo — ver nota do cabecalho sobre por que nao combinar.
  const porCampo: Record<string, unknown> = {};
  const cruJson: Record<string, unknown> = {};
  for (const campo of CAMPOS) {
    const r = await g(`/${pageId}?fields=${campo}`, TOKEN);
    cruJson[campo] = { http_status: r.status, body: r.body };
    porCampo[campo] = classificar(campo, r, igEsperado);
  }

  // Pedido combinado: serve so como contraprova do que o caminho normal do sistema veria.
  const combinado = await g(`/${pageId}?fields=${CAMPOS.join(",")}`, TOKEN);

  // instagram_accounts e page_backed_instagram_accounts tambem existem como EDGE. Um campo
  // pode nao vir no no e a edge responder (ou vice-versa); as duas leituras sao registradas
  // para nao confundir "a Pagina nao tem" com "este caminho nao expoe".
  const edges = {
    instagram_accounts: await g(`/${pageId}/instagram_accounts?fields=id,username&limit=25`, TOKEN),
    page_backed_instagram_accounts: await g(
      `/${pageId}/page_backed_instagram_accounts?fields=id,username&limit=25`,
      TOKEN,
    ),
  };

  // O no do proprio id Instagram: se ele responder e apontar de volta para a Pagina, e uma
  // segunda evidencia independente. Se nao responder, isso tambem e dito.
  const noDoInstagram = await g(`/${igEsperado}?fields=id,username,name`, TOKEN);

  // Caminhos que NAO passam pelo no da Pagina. Existem porque o token pode ter ads_management
  // e business_management sem ter pages_read_engagement: nesse caso a Pagina fica ilegivel mas
  // a conta de anuncios e o Business ainda listam as contas Instagram utilizaveis como
  // identidade. ATENCAO: aparecer aqui prova DISPONIBILIDADE para a conta/Business, NAO prova
  // vinculo com a Pagina. A distincao esta explicita na resposta para nao virar deducao.
  const contaAnuncios = await g(`/${adAccount}?fields=id,name,business`, TOKEN);
  const businessId = (contaAnuncios.body as any)?.business?.id
    ? String((contaAnuncios.body as any).business.id)
    : null;

  const alternativas: Record<string, unknown> = {
    ad_account_instagram_accounts: await g(
      `/${adAccount}/instagram_accounts?fields=id,username&limit=50`,
      TOKEN,
    ),
    business_id: businessId,
    business_owned_instagram_accounts: businessId
      ? await g(`/${businessId}/owned_instagram_accounts?fields=id,username&limit=50`, TOKEN)
      : null,
    business_instagram_accounts: businessId
      ? await g(`/${businessId}/instagram_accounts?fields=id,username&limit=50`, TOKEN)
      : null,
  };
  const idsAlternativos = idsDe(
    Object.entries(alternativas)
      .filter(([k]) => k !== "business_id")
      .map(([, v]) => (v as Resposta | null)?.body ?? null),
  );
  alternativas.contem_o_id_esperado = idsAlternativos.includes(igEsperado);
  alternativas.o_que_isto_prova = alternativas.contem_o_id_esperado
    ? "O id aparece como conta Instagram disponivel para a conta de anuncios/Business. Isto NAO e o mesmo que estar vinculada a Pagina - so um campo do no da Pagina prova isso."
    : "O id nao apareceu por estes caminhos; pode ser falta de permissao ou ausencia real. Ver os corpos brutos.";

  const confirmados = CAMPOS.filter((c) => (porCampo[c] as any)?.comparacao === "confere");
  const divergentes = CAMPOS.filter((c) => (porCampo[c] as any)?.comparacao === "difere");
  const comErro = CAMPOS.filter((c) => (porCampo[c] as any)?.situacao === "erro");

  const veredito = confirmados.length > 0
    ? "confere"
    : divergentes.length > 0
    ? "difere"
    : "nao_deu_para_confirmar";

  return json({
    ok: true,
    versao: "meta-identity-probe-v1",
    somente_leitura: true,
    token_fonte: TOKEN_FONTE,
    mcp_chamador: auth.chamador,
    alvo: { page_id: pageId, instagram_id_esperado: igEsperado },
    veredito,
    campos_que_confirmam: confirmados,
    campos_que_divergem: divergentes,
    campos_com_erro: comErro,
    por_campo: porCampo,
    json_cru_por_campo: cruJson,
    pedido_combinado: { http_status: combinado.status, body: combinado.body },
    edges,
    no_do_instagram_id: noDoInstagram,
    pagina,
    fontes_alternativas: alternativas,
    token: {
      identidade: quem,
      app_id: dd?.app_id ? String(dd.app_id) : null,
      tipo: dd?.type ?? null,
      valido: dd?.is_valid ?? null,
      escopos,
    },
    nota:
      "veredito='confere' exige um campo da Graph devolvendo o id. 'nao_deu_para_confirmar' significa que nenhum campo trouxe id — ver por_campo para separar nao_retornado, retornado_vazio e erro.",
  });
});
