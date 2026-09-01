// WhatsApp da Página para Click-to-WA (CTWA).
//
// promoted_object.whatsapp_phone_number e DIGITO, nunca o display do Gerenciador:
// os conjuntos JUR/LF que entregam gravam 12 digitos 55+DDD+8 (sem o 9 extra do
// celular BR) e, quando existe, whats_app_business_phone_number_id. Mandar
// "+55 71 9189-4229" no payload e invalido — o display so vale para texto humano.
//
// 1487246 e do DRIVER, nao do numero. Comparacao controlada de 01/09/2026 com o
// mesmo promoted_object {page_id:105656372312257, whatsapp_phone_number:"557191894229"},
// mesmo destination_type=WHATSAPP e mesmo optimization_goal=CONVERSATIONS:
//   11:49 driver graph     -> HTTP 400 / 1487246 (tentou tambem +557191894229 e 13 digitos)
//   12:46 driver pipeboard -> conjunto 120249829825270182 criado e reconciliado
// Os numeros VISTTA nao estao em WABA alguma e o Pipeboard cria assim mesmo, entao
// casou_na_api=false NAO e motivo de recusa: e so informacao de inventario. Conjunto
// CTWA sai por driver_por_acao.criar_conjunto_a_partir_de=pipeboard.
// Pipeboard create_adset e escrita: agentes usam criar_conjunto_a_partir_de.

import { criarGraphClient, type GraphClient } from "./instagram_anuncios.ts";
import {
  businessIdPorCompanyId,
  tokenAdsPorCompanyId,
  tokenWabaPorCompanyId,
} from "./meta_company_tokens.ts";

export const SUBCODE_WA_NAO_LIGADO = 1487246;
export const SUBCODE_PAGINA_SEM_WA = 2446886;

/** Destino MANUAL WhatsApp-only (conjuntos JUR/LF que entregam). Meta nao escolhe o canal. */
export const DESTINO_MANUAL_WHATSAPP = "WHATSAPP";
/** Destino MANUAL Messenger + WhatsApp (dropdown do Gerenciador com as duas caixas). */
export const DESTINO_MANUAL_MESSENGER_WHATSAPP = "MESSAGING_MESSENGER_WHATSAPP";
/** Destino AUTOMATICO (Meta escolhe entre IG/Messenger/WhatsApp). Nao usamos. */
export const DESTINO_AUTOMATICO_MENSAGENS = "MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP";

export type WhatsAppPaginaNumero = {
  display: string | null;
  digitos: string;
  phone_number_id: string | null;
  fontes: string[];
};

export type PromotedObjectCtwa = {
  page_id: string;
  whatsapp_phone_number: string;
  whats_app_business_phone_number_id?: string;
  /** Presente nos conjuntos CTWA que entregam (leitura Graph). */
  smart_pse_enabled?: boolean;
};

export type CandidatoPromotedCtwa = {
  label: string;
  promoted: PromotedObjectCtwa;
  destination_type: string;
};

export function soDigitosWa(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/wa\.me/i.test(s)) {
    const m = s.match(/wa\.me\/(\d+)/i);
    if (m?.[1]) return m[1];
  }
  const digits = s.replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
}

function comDdi55(digits: string): string {
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/** Variantes do MESMO numero (55, 9 extra do celular BR, nacional). Nunca cruza outro numero. */
export function variantesDigitosWhatsAppBr(raw: unknown): string[] {
  const base = comDdi55(soDigitosWa(raw));
  if (base.length < 10) return [];
  const set = new Set<string>();
  const add = (d: string) => {
    if (d.length >= 10) set.add(d);
  };
  add(base);
  if (base.startsWith("55") && base.length >= 12) {
    const ddd = base.slice(2, 4);
    const rest = base.slice(4);
    if (rest.length === 9 && rest.startsWith("9")) add(`55${ddd}${rest.slice(1)}`);
    if (rest.length === 8) add(`55${ddd}9${rest}`);
    add(base.slice(2));
  }
  return [...set];
}

/**
 * Formato que os conjuntos CTWA ativos da conta gravam na Graph:
 * 55 + DDD + 8 (sem o 9 extra). Display do Gerenciador costuma mostrar o 9.
 */
export function preferidoWhatsAppParaAds(raw: unknown): string {
  const vars = variantesDigitosWhatsAppBr(raw);
  const doze = vars.find((v) => v.startsWith("55") && v.length === 12);
  if (doze) return doze;
  const treze = vars.find((v) => v.startsWith("55") && v.length === 13);
  if (treze) return treze;
  return vars[0] ?? soDigitosWa(raw);
}

export function mesmaLinhaWhatsApp(a: unknown, b: unknown): boolean {
  const va = new Set(variantesDigitosWhatsAppBr(a));
  if (!va.size) return false;
  return variantesDigitosWhatsAppBr(b).some((x) => va.has(x));
}

export function casarNumeroWhatsApp(
  pedido: unknown,
  lista: WhatsAppPaginaNumero[],
): WhatsAppPaginaNumero | null {
  if (!soDigitosWa(pedido) && !String(pedido ?? "").trim()) return null;
  return lista.find((n) => mesmaLinhaWhatsApp(pedido, n.digitos) || mesmaLinhaWhatsApp(pedido, n.display)) ??
    null;
}

export function ehRecusaWhatsappNaoLigado(body: unknown): boolean {
  const err = body && typeof body === "object" ? (body as any).error ?? body : null;
  const sub = Number(err?.error_subcode ?? 0);
  if (sub === SUBCODE_WA_NAO_LIGADO || sub === SUBCODE_PAGINA_SEM_WA) return true;
  const msg = `${err?.error_user_msg ?? ""} ${err?.error_user_title ?? ""} ${err?.message ?? ""}`;
  return /not linked to your account|not linked to a WhatsApp|Page with WhatsApp Business account required/i
    .test(msg);
}

function phoneIdValido(id: unknown): string | null {
  const s = String(id ?? "").trim();
  if (!s || s.startsWith("ads-wa:")) return null;
  if (!/^\d{5,}$/.test(s)) return null;
  return s;
}

function chaveNumero(n: { digitos?: string; display?: string | null }): string {
  return preferidoWhatsAppParaAds(n.digitos || n.display || "") || soDigitosWa(n.digitos || n.display);
}

function mergeNumero(
  mapa: Map<string, WhatsAppPaginaNumero>,
  item: { display?: string | null; digitos?: string; phone_number_id?: string | null; fonte: string },
) {
  const digitos = preferidoWhatsAppParaAds(item.digitos || item.display || "");
  if (!digitos) return;
  const key = chaveNumero({ digitos, display: item.display ?? null });
  const prev = mapa.get(key);
  const id = phoneIdValido(item.phone_number_id) ?? prev?.phone_number_id ?? null;
  const display = item.display || prev?.display || null;
  const fontes = [...new Set([...(prev?.fontes ?? []), item.fonte])];
  mapa.set(key, {
    display,
    digitos,
    phone_number_id: id,
    fontes,
  });
}

function phonesDeNode(node: any): Array<{ id?: string; display_phone_number?: string }> {
  if (!node) return [];
  if (Array.isArray(node)) {
    return node.flatMap((x) => phonesDeNode(x));
  }
  const nested = node.phone_numbers;
  if (nested && typeof nested === "object") {
    const data = Array.isArray(nested) ? nested : Array.isArray(nested.data) ? nested.data : [];
    return data;
  }
  if (node.display_phone_number || node.id) return [node];
  const data = Array.isArray(node.data) ? node.data : [];
  return data.flatMap((x: any) => phonesDeNode(x));
}

async function getSafe(g: GraphClient, path: string): Promise<{ status: number; body: any; erro?: string }> {
  try {
    const r = await g.get(path);
    const err = r.body?.error?.message ? String(r.body.error.message) : undefined;
    return { status: r.status, body: r.body, erro: r.status >= 400 ? err : undefined };
  } catch (e) {
    return { status: 0, body: null, erro: String((e as Error)?.message ?? e) };
  }
}

export async function listarWhatsAppDaPagina(opts: {
  gAds: GraphClient;
  gWaba?: GraphClient | null;
  pageId: string;
  companyId: string;
  businessId?: string | null;
  // deno-lint-ignore no-explicit-any
  supa: any;
}): Promise<{
  ok: boolean;
  page_id: string;
  page_nome: string | null;
  numeros: WhatsAppPaginaNumero[];
  erros: string[];
}> {
  const pageId = String(opts.pageId ?? "").trim();
  const erros: string[] = [];
  const mapa = new Map<string, WhatsAppPaginaNumero>();
  let pageNome: string | null = null;

  const ingestPhones = (phones: any[], fonte: string) => {
    for (const p of phones) {
      mergeNumero(mapa, {
        display: p?.display_phone_number != null ? String(p.display_phone_number) : null,
        digitos: soDigitosWa(p?.display_phone_number ?? p?.whatsapp_phone_number),
        phone_number_id: p?.id != null ? String(p.id) : null,
        fonte,
      });
    }
  };

  if (pageId) {
    const page = await getSafe(opts.gAds, `/${pageId}?fields=id,name`);
    if (page.erro) erros.push(`page:${page.erro}`);
    else pageNome = page.body?.name != null ? String(page.body.name) : null;

    const pageWa = await getSafe(opts.gAds, `/${pageId}?fields=whatsapp_number,has_whatsapp_number`);
    if (pageWa.erro) erros.push(`page_wa:${pageWa.erro}`);
    else if (pageWa.body?.whatsapp_number) {
      mergeNumero(mapa, {
        display: String(pageWa.body.whatsapp_number),
        digitos: soDigitosWa(pageWa.body.whatsapp_number),
        fonte: "page.whatsapp_number",
      });
    }

    const wabasPage = await getSafe(
      opts.gAds,
      `/${pageId}/whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name,status,platform_type}&limit=25`,
    );
    if (wabasPage.erro) erros.push(`page_wabas:${wabasPage.erro}`);
    else {
      for (const w of wabasPage.body?.data ?? []) {
        ingestPhones(phonesDeNode(w), "page.whatsapp_business_accounts");
      }
    }

    // WABA conectada direto na Pagina: e por aqui que o Destino manual do
    // Gerenciador costuma achar numero que as edges do Business nao devolvem.
    const conectada = await getSafe(
      opts.gAds,
      `/${pageId}?fields=connected_whatsapp_business_account{id,name,phone_numbers{id,display_phone_number,verified_name,status,platform_type}}`,
    );
    if (conectada.erro) erros.push(`page_waba_conectada:${conectada.erro}`);
    else {
      const w = conectada.body?.connected_whatsapp_business_account;
      if (w) ingestPhones(phonesDeNode(w), "page.connected_whatsapp_business_account");
    }
  }

  const biz = String(opts.businessId ?? "").trim();
  const gW = opts.gWaba ?? opts.gAds;
  const edges = biz
    ? [
      `${biz}/owned_whatsapp_business_accounts`,
      `${biz}/client_whatsapp_business_accounts`,
    ]
    : [];
  edges.push("me/assigned_whatsapp_business_accounts");
  for (const edge of edges) {
    const r = await getSafe(
      gW,
      `/${edge}?fields=id,name,phone_numbers{id,display_phone_number,verified_name,status}&limit=50`,
    );
    if (r.erro) {
      erros.push(`${edge}:${r.erro}`);
      continue;
    }
    for (const w of r.body?.data ?? []) {
      ingestPhones(phonesDeNode(w), edge);
    }
  }

  if (opts.companyId && opts.supa) {
    const { data: sets } = await opts.supa
      .from("ad_sets")
      .select("name,promoted_object,destination_type,status")
      .eq("company_id", opts.companyId)
      .not("promoted_object", "is", null);
    for (const s of sets ?? []) {
      const po = (s as any).promoted_object ?? {};
      const wa = po?.whatsapp_phone_number;
      if (!wa) continue;
      mergeNumero(mapa, {
        display: String(wa),
        digitos: soDigitosWa(wa),
        phone_number_id: po?.whats_app_business_phone_number_id ?? null,
        fonte: `adset:${String((s as any).name ?? "").slice(0, 40)}`,
      });
    }
    const { data: phones } = await opts.supa
      .from("waba_phone_numbers")
      .select("display_phone_number,external_id,platform_type,status,verified_name")
      .eq("company_id", opts.companyId);
    for (const p of phones ?? []) {
      mergeNumero(mapa, {
        display: p.display_phone_number != null ? String(p.display_phone_number) : null,
        digitos: soDigitosWa(p.display_phone_number),
        phone_number_id: p.external_id,
        fonte: `waba_db:${String(p.platform_type ?? "na")}`,
      });
    }
  }

  return {
    ok: true,
    page_id: pageId,
    page_nome: pageNome,
    numeros: [...mapa.values()].sort((a, b) => a.digitos.localeCompare(b.digitos)),
    erros,
  };
}

function promoted(
  pageId: string,
  number: string,
  phoneId?: string | null,
  opts?: { smartPse?: boolean },
): PromotedObjectCtwa {
  const out: PromotedObjectCtwa = { page_id: pageId, whatsapp_phone_number: number };
  const id = phoneIdValido(phoneId);
  if (id) out.whats_app_business_phone_number_id = id;
  if (opts?.smartPse === true) out.smart_pse_enabled = false;
  return out;
}

export function formatDisplayWhatsAppGerenciador(digits: string): string | null {
  const d = digits.startsWith("55") ? digits.slice(2) : digits;
  if (d.length === 10) return `+55 ${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `+55 ${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  return null;
}

function chavePromoted(p: PromotedObjectCtwa, dest: string): string {
  return `${dest}|${p.whatsapp_phone_number}|${p.whats_app_business_phone_number_id ?? ""}|${p.smart_pse_enabled === false ? "pse0" : ""}`;
}

/**
 * Destino MANUAL so WhatsApp (JUR/LF). Messenger fica OFF —
 * nao emite MESSAGING_MESSENGER_WHATSAPP nem destino automatico.
 */
export function candidatosPromotedObjectCtwa(opts: {
  pageId: string;
  pedido: unknown;
  phoneIdPedido?: unknown;
  match: WhatsAppPaginaNumero | null;
}): CandidatoPromotedCtwa[] {
  const pageId = String(opts.pageId ?? "").trim();
  const preferido = preferidoWhatsAppParaAds(opts.pedido);
  const original = soDigitosWa(opts.pedido) || preferido;
  const idPedido = phoneIdValido(opts.phoneIdPedido);
  const idMatch = opts.match?.phone_number_id ?? null;
  const digitsMatch = opts.match ? preferidoWhatsAppParaAds(opts.match.digitos || opts.match.display) : "";
  const ids = [...new Set([idMatch, idPedido].filter(Boolean) as string[])];
  const digitList = [
    digitsMatch,
    preferido,
    original,
    ...variantesDigitosWhatsAppBr(opts.pedido).filter((v) => v.startsWith("55")),
  ].filter((d, i, arr) => d && arr.indexOf(d) === i);

  const out: CandidatoPromotedCtwa[] = [];
  const seen = new Set<string>();
  const push = (
    label: string,
    number: string,
    id: string | null | undefined,
    dest: string,
    smartPse?: boolean,
  ) => {
    if (!pageId || !number) return;
    const p = promoted(pageId, number, id, { smartPse });
    const k = chavePromoted(p, dest);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ label, promoted: p, destination_type: dest });
  };

  // So digitos. O display do Gerenciador nunca entra no promoted_object.
  const dest = DESTINO_MANUAL_WHATSAPP;
  push("wa_12", preferido, ids[0] ?? null, dest);
  push("wa_12_sem_id", preferido, null, dest);
  if (/^\d+$/.test(preferido)) push("wa_plus", `+${preferido}`, null, dest);
  if (original && original !== preferido) push("wa_orig", original, ids[0] ?? null, dest);
  for (const d of digitList) {
    push(`wa:${d}`, d, ids[0] ?? null, dest);
    if (ids[0]) push(`wa_sem_id:${d}`, d, null, dest);
  }
  return out.slice(0, 12);
}

export async function resolverWhatsAppCtwa(opts: {
  gAds: GraphClient;
  gWaba?: GraphClient | null;
  pageId: string;
  companyId: string;
  businessId?: string | null;
  pedido: unknown;
  phoneIdPedido?: unknown;
  // deno-lint-ignore no-explicit-any
  supa: any;
}): Promise<{
  promoted: PromotedObjectCtwa;
  candidatos: CandidatoPromotedCtwa[];
  match: WhatsAppPaginaNumero | null;
  inventario: WhatsAppPaginaNumero[];
  erros: string[];
  aviso: string | null;
}> {
  const pageId = String(opts.pageId ?? "").trim();
  const listed = await listarWhatsAppDaPagina({
    gAds: opts.gAds,
    gWaba: opts.gWaba,
    pageId,
    companyId: opts.companyId,
    businessId: opts.businessId,
    supa: opts.supa,
  });
  const match = casarNumeroWhatsApp(opts.pedido, listed.numeros);
  const candidatos = candidatosPromotedObjectCtwa({
    pageId,
    pedido: opts.pedido,
    phoneIdPedido: opts.phoneIdPedido,
    match,
  });
  const first = candidatos[0]?.promoted ?? promoted(pageId, preferidoWhatsAppParaAds(opts.pedido));
  let aviso: string | null = null;
  if (!match) {
    aviso =
      "Numero fora de qualquer WABA da conta — informativo, nao impedimento. O create sai pelo driver " +
      "pipeboard, que aceita numero ligado so a Pagina (01/09/2026: graph 1487246, pipeboard criou). " +
      "Se o driver desta acao for graph, espere 1487246. Nao substitua por numero Juridico/La Felicita.";
  } else if (!match.phone_number_id) {
    aviso =
      "Numero casou com um ja visto na conta, mas sem whats_app_business_phone_number_id. " +
      "O create envia so whatsapp_phone_number no formato Ads.";
  }
  return {
    promoted: first,
    candidatos,
    match,
    inventario: listed.numeros,
    erros: listed.erros,
    aviso,
  };
}

export async function toolGetWhatsAppDaPagina(opts: {
  companyId: string;
  numero?: unknown;
  // deno-lint-ignore no-explicit-any
  supa: any;
}): Promise<Record<string, unknown>> {
  const companyId = String(opts.companyId ?? "").trim();
  if (!companyId) return { erro: "company_id_obrigatorio" };
  const { data: cfg } = await opts.supa
    .from("meta_execution_config")
    .select("page_id")
    .eq("company_id", companyId)
    .maybeSingle();
  const pageId = String((cfg as any)?.page_id ?? "").trim();
  if (!pageId) {
    return {
      erro: "page_id_ausente",
      detalhe: "meta_execution_config.page_id vazio — sem Pagina nao listo o dropdown de WhatsApp.",
    };
  }
  const ads = tokenAdsPorCompanyId(companyId);
  if (!ads) return { erro: "token_ads_ausente_para_empresa" };
  const waba = tokenWabaPorCompanyId(companyId);
  const gAds = criarGraphClient(ads.token);
  const gWaba = waba ? criarGraphClient(waba.token) : null;
  const listed = await listarWhatsAppDaPagina({
    gAds,
    gWaba,
    pageId,
    companyId,
    businessId: businessIdPorCompanyId(companyId),
    supa: opts.supa,
  });
  const pedido = opts.numero != null && String(opts.numero).trim() ? opts.numero : null;
  const match = pedido ? casarNumeroWhatsApp(pedido, listed.numeros) : null;
  const canonico = pedido ? preferidoWhatsAppParaAds(pedido) : null;
  const display = canonico ? (formatDisplayWhatsAppGerenciador(canonico) || canonico) : null;
  const parecer = pedido ? parecerPedidoWhatsAppConjunto(pedido, match) : null;
  return {
    ok: true,
    page_id: listed.page_id,
    page_nome: listed.page_nome,
    numeros_na_pagina_ou_conta: listed.numeros.map((n) => ({
      display: n.display,
      digitos_para_ads: n.digitos,
      whats_app_business_phone_number_id: n.phone_number_id,
      fontes: n.fontes,
    })),
    total: listed.numeros.length,
    erros_graph: listed.erros,
    inventario_graph_nao_e_o_seletor_do_gerenciador: true,
    pedido: pedido
      ? {
        bruto: String(pedido),
        variantes: variantesDigitosWhatsAppBr(pedido),
        canonico_para_conjunto: canonico,
        display_gerenciador: display,
        destination_type: DESTINO_MANUAL_WHATSAPP,
        casou_na_api: !!match,
        pode_usar_no_conjunto: parecer?.pode_usar_no_conjunto ?? false,
        match: match
          ? {
            display: match.display,
            digitos_para_ads: match.digitos,
            whats_app_business_phone_number_id: match.phone_number_id,
            fontes: match.fontes,
          }
          : null,
      }
      : null,
    parecer,
    como_associar_no_conjunto:
      "Destino MANUAL = WHATSAPP (Messenger OFF) e whatsapp_phone_number em DIGITOS (55+DDD+8). " +
      "O display (+55 71 9189-4229) e so para o texto do card — no promoted_object ele e invalido. " +
      "EMITA com casou_na_api true OU false: quem cria e o driver pipeboard, que aceita numero ligado " +
      "so a Pagina (01/09/2026 — graph recusou 1487246 e pipeboard criou o 120249829825270182 com o " +
      "mesmo payload). casou_na_api=false e inventario, nao impedimento. Nao misture Juridico em VISTTA.",
    pipeboard:
      "get_account_pages e leitura (ler_pipeboard). create_adset e escrita bloqueada em ler_pipeboard — o card de conjunto e o caminho.",
    distinto_de_get_waba_status:
      "get_waba_status e inventario Cloud/ON_PREMISE. Esta tool cobre Pagina + WABAs do Business; " +
      "numero que so aparece no seletor da Pagina continua criavel pelo driver pipeboard.",
  };
}

/**
 * Parecer honesto sobre o numero antes de emitir o card.
 *
 * Numero valido basta para emitir: o create do conjunto CTWA depende do DRIVER, e o
 * Pipeboard cria mesmo com numero fora das WABAs (medido 01/09/2026 — graph recusou
 * 1487246 e pipeboard criou o 120249829825270182 com o mesmo payload). Por isso
 * `e_ativo_whatsapp_da_conta` e informativo e nao trava `pode_usar_no_conjunto`.
 * `whatsapp_phone_number` sai em digitos; `display_gerenciador` e so para texto.
 */
export function parecerPedidoWhatsAppConjunto(
  pedido: unknown,
  match?: WhatsAppPaginaNumero | null,
): {
  pode_usar_no_conjunto: boolean;
  e_ativo_whatsapp_da_conta: boolean;
  display_gerenciador: string | null;
  destination_type: string;
  whatsapp_phone_number: string | null;
  whats_app_business_phone_number_id: string | null;
  decisao: string;
} {
  const preferido = preferidoWhatsAppParaAds(pedido);
  const display = preferido ? (formatDisplayWhatsAppGerenciador(preferido) || preferido) : null;
  const ativo = !!match;
  return {
    pode_usar_no_conjunto: !!preferido,
    e_ativo_whatsapp_da_conta: ativo,
    display_gerenciador: display,
    destination_type: DESTINO_MANUAL_WHATSAPP,
    whatsapp_phone_number: preferido || null,
    whats_app_business_phone_number_id: match?.phone_number_id ?? null,
    decisao: !preferido
      ? "Numero invalido: informe DDI+DDD+numero."
      : ativo
      ? "EMITIR criar_conjunto_a_partir_de: destination_type=WHATSAPP (Messenger OFF) e whatsapp_phone_number em digitos."
      : "EMITIR mesmo assim. O numero nao aparece nas WABAs da conta, e isso e so inventario: " +
        "o create sai por driver pipeboard, que cria numero ligado so a Pagina (medido 01/09/2026 — " +
        "graph recusou 1487246 e pipeboard criou o conjunto 120249829825270182 com o mesmo payload). " +
        "NAO peca vinculo de WABA nem mande o gestor para o Gerenciador. " +
        "Nao substitua por numero Juridico/La Felicita.",
  };
}

/**
 * Texto de falha do card quando a Meta devolve 1487246/2446886 no create do conjunto.
 *
 * A primeira pergunta e o DRIVER, nao o numero: em 01/09/2026 o mesmo promoted_object
 * que o graph recusou (1487246, tres formatos de digitos) o Pipeboard criou. Mandar o
 * gestor mexer em WABA quando o que falta e trocar o driver custa dias de campanha.
 */
export function diagnosticoRecusaWhatsApp(opts: {
  numero: unknown;
  temIdWaba: boolean;
  formatosTentados: string[];
  driver?: string | null;
}): string {
  const display = formatDisplayWhatsAppGerenciador(preferidoWhatsAppParaAds(opts.numero)) ??
    String(opts.numero ?? "");
  const driver = String(opts.driver ?? "").toLowerCase();
  if (driver && driver !== "pipeboard") {
    return `A Meta recusou ${display} no driver ${driver} (1487246). Isso e esperado: em 01/09/2026 o ` +
      `MESMO payload recusado pelo graph foi aceito pelo Pipeboard, que criou o conjunto ` +
      `120249829825270182. Aponte driver_por_acao.criar_conjunto_a_partir_de para pipeboard ` +
      `nesta empresa e mande o card de novo — nao ha nada a corrigir no numero.`;
  }
  if (opts.temIdWaba) {
    return `O Pipeboard recusou ${display} mesmo com whats_app_business_phone_number_id. ` +
      `Formatos tentados: ${opts.formatosTentados.join(", ")}. ` +
      `Confira no WhatsApp Manager se a WABA continua vinculada a conta de anuncios.`;
  }
  return `O Pipeboard recusou ${display} (1487246) nos formatos ${opts.formatosTentados.join(", ")}. ` +
    `Como o Pipeboard costuma aceitar numero ligado so a Pagina, o mais provavel e que o numero tenha ` +
    `saido do seletor da Pagina Cohapm ou que a conexao Pipeboard da conta tenha caido. ` +
    `Confira os dois antes de mexer em WABA.`;
}
