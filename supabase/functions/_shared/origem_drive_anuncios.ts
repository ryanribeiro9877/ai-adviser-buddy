/**
 * Origem Drive dos anuncios ja no ar.
 *
 * O casamento peca↔anuncio vive em approval_requests (criar_anuncio_a_partir_de
 * + drive_file_id + id_criado). ads NAO guarda pasta. Chutar 2.mp4 a partir de
 * AD_CONJ.1_…_2 e o erro que, em 02/09/2026, deixou 5 de 6 pecas do CONJ.1
 * VISTTA como "sem vinculo" — o arquivo real do _2 era 10.mp4 na mesma pasta.
 */

import {
  numeroConjuntoDaFala,
  numeroConjuntoDoNome,
  statusObjetoOperacional,
} from "./memoria_conjunto.ts";
import { casarCampanhas, escolherCampanhaUnica, type CampanhaRef } from "./leitura_desempenho.ts";

type Supa = { from: (t: string) => any; rpc?: (n: string, p: Record<string, unknown>) => any };

export type OrigemDriveArgs = {
  name_like?: string;
  campaign_id?: string;
  conjunto?: number;
  ad_external_id?: string;
  incluir_apagados?: boolean;
};

export type CardOrigem = {
  id: string;
  drive_file_id: string | null;
  ad_criado: string | null;
};

export type PecaDriveOrigem = {
  nome: string | null;
  caminho: string | null;
};

export type AdParaOrigem = {
  name: string;
  external_id: string;
  status: string;
  adset_name: string;
  campaign_name: string;
  campaign_external_id: string | null;
  criado_pelo_sistema: boolean;
  criado_por_approval_id: string | null;
};

// Espelham as colunas dos dois `select()` de ad_sets e campaigns logo abaixo: ao mexer no
// select, mexer aqui. Campos como `unknown` de proposito — vem crus do banco e cada leitura
// tem de coagir (`String(...)`), que e o que o codigo abaixo ja fazia sem o tipo garantir.
type LinhaConjunto = { external_id?: unknown; name?: unknown; campaign_id?: unknown; status?: unknown };
type LinhaCampanha = { id?: unknown; name?: unknown; external_id?: unknown; status?: unknown };

export function pistasCampanhaDoPedido(pedido: string): string[] {
  const raw = String(pedido ?? "");
  const out: string[] = [];
  const named = raw.match(/\bCOHAPM[A-Z0-9._-]*/gi) ?? [];
  for (const n of named) {
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  const p = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/vistta|sistema[\s_-]*ocular|\bocular\b/.test(p)) out.push("VISTTA");
  if (/felicita|\blaf\b/.test(p)) out.push("LAFELICITA");
  if (/\bjuridico\b/.test(p)) out.push("JURIDICO");
  return out;
}

export function conjuntoDoPedidoOrigem(pedido: string, args?: OrigemDriveArgs): number | null {
  const nArg = Number(args?.conjunto);
  if (Number.isInteger(nArg) && nArg >= 1 && nArg <= 99) return nArg;
  return numeroConjuntoDaFala(pedido);
}

function campanhaCasaPista(nome: string, pistas: string[]): boolean {
  if (!pistas.length) return true;
  const n = String(nome ?? "").toUpperCase();
  return pistas.some((p) => n.includes(String(p).toUpperCase()));
}

export function recortarAdsOrigem(
  ads: AdParaOrigem[],
  recorte: {
    conjunto?: number | null;
    nameLike?: string;
    campaignId?: string;
    adExternalId?: string;
    pistas: string[];
  },
): { ads: AdParaOrigem[]; ambiguo?: { campanhas: string[] }; erro?: string } {
  let lista = ads.slice();
  const adId = String(recorte.adExternalId ?? "").trim();
  if (adId) lista = lista.filter((a) => a.external_id === adId);
  const campId = String(recorte.campaignId ?? "").replace(/\D/g, "");
  if (campId.length >= 8) {
    lista = lista.filter((a) => String(a.campaign_external_id ?? "").replace(/\D/g, "").endsWith(campId)
      || campId.endsWith(String(a.campaign_external_id ?? "").replace(/\D/g, "")));
  }
  const like = String(recorte.nameLike ?? "").trim();
  if (like) {
    const camps = [...new Map(lista.map((a) => [a.campaign_name, {
      name: a.campaign_name,
      external_id: a.campaign_external_id,
    }])).values()] as CampanhaRef[];
    const hits = casarCampanhas(camps, like);
    const escolha = escolherCampanhaUnica(hits, like);
    if (escolha.unica) {
      const alvo = String(escolha.unica.name ?? "");
      lista = lista.filter((a) => a.campaign_name === alvo);
    } else if (escolha.ambiguo?.length) {
      return {
        ads: [],
        ambiguo: { campanhas: escolha.ambiguo.map((c) => String(c.name ?? "")) },
      };
    } else {
      lista = lista.filter((a) =>
        a.campaign_name.toLowerCase().includes(like.toLowerCase())
        || a.adset_name.toLowerCase().includes(like.toLowerCase())
        || a.name.toLowerCase().includes(like.toLowerCase())
      );
    }
  }
  const n = recorte.conjunto ?? null;
  if (n != null) {
    lista = lista.filter((a) =>
      numeroConjuntoDoNome(a.adset_name) === n || numeroConjuntoDoNome(a.name) === n
    );
  }
  const pistas = recorte.pistas ?? [];
  const campsUnicas = [...new Set(lista.map((a) => a.campaign_name))];
  if (campsUnicas.length > 1 && pistas.length) {
    const filtrado = lista.filter((a) => campanhaCasaPista(a.campaign_name, pistas));
    if (filtrado.length) lista = filtrado;
  }
  const campsDepois = [...new Set(lista.map((a) => a.campaign_name))];
  if (campsDepois.length > 1 && n != null && !like && !campId) {
    return { ads: lista, ambiguo: { campanhas: campsDepois } };
  }
  if (!lista.length) {
    return { ads: [], erro: "nenhum anuncio operacional casou com conjunto/campanha deste pedido" };
  }
  return { ads: lista };
}

export function resolverOrigemDoAd(
  ad: AdParaOrigem,
  porApproval: Map<string, CardOrigem>,
  porAdCriado: Map<string, CardOrigem>,
  pecas: Map<string, PecaDriveOrigem>,
): {
  anuncio: string;
  ad_external_id: string;
  status: string;
  conjunto: string;
  campanha: string;
  pasta: string | null;
  peca_nome: string | null;
  drive_file_id: string | null;
  approval_id: string | null;
  vinculo: "confirmado" | "sem_card" | "fora_do_sistema";
} {
  const card = (ad.criado_por_approval_id ? porApproval.get(ad.criado_por_approval_id) : undefined)
    ?? porAdCriado.get(ad.external_id);
  const drive = String(card?.drive_file_id ?? "").trim() || null;
  const peca = drive ? pecas.get(drive) : undefined;
  let vinculo: "confirmado" | "sem_card" | "fora_do_sistema" = "sem_card";
  if (drive) vinculo = "confirmado";
  else if (!ad.criado_pelo_sistema && !card) vinculo = "fora_do_sistema";
  return {
    anuncio: ad.name,
    ad_external_id: ad.external_id,
    status: ad.status,
    conjunto: ad.adset_name,
    campanha: ad.campaign_name,
    pasta: peca?.caminho ?? null,
    peca_nome: peca?.nome ?? null,
    drive_file_id: drive,
    approval_id: card?.id ?? ad.criado_por_approval_id,
    vinculo,
  };
}

export function resumirPastasOrigem(
  itens: Array<{ pasta: string | null; vinculo: string }>,
): { pasta: string; anuncios: number }[] {
  const m = new Map<string, number>();
  for (const it of itens) {
    if (it.vinculo !== "confirmado" || !it.pasta) continue;
    m.set(it.pasta, (m.get(it.pasta) ?? 0) + 1);
  }
  return [...m.entries()].map(([pasta, anuncios]) => ({ pasta, anuncios }))
    .sort((a, b) => b.anuncios - a.anuncios);
}

export async function tCasarCriativoPerformance(
  rpc: (nome: string, params: Record<string, unknown>) => Promise<unknown>,
  args: { companyId: string; driveFileId?: string | null; adExternalId?: string | null; dias?: number },
): Promise<unknown> {
  const drive = String(args.driveFileId ?? "").trim() || null;
  const ad = String(args.adExternalId ?? "").trim() || null;
  const dias = Number(args.dias ?? 7) || 7;
  const first = await rpc("casar_criativo_performance", {
    p_company_id: args.companyId,
    p_drive_file_id: drive,
    p_ad_external_id: ad,
    p_dias: dias,
  });
  if (first && typeof first === "object" && (first as { erro?: unknown }).erro) return first;
  const total = Number((first as { total?: unknown })?.total ?? 0);
  if (total === 0 && drive && ad) {
    const second = await rpc("casar_criativo_performance", {
      p_company_id: args.companyId,
      p_drive_file_id: null,
      p_ad_external_id: ad,
      p_dias: dias,
    });
    if (second && typeof second === "object" && Number((second as { total?: unknown }).total ?? 0) > 0) {
      return {
        ...(second as Record<string, unknown>),
        aviso_filtro_drive_divergente:
          "O drive_file_id informado NAO e o da peca deste anuncio. Devolvi o par REAL pelo ad_external_id. Use este drive_file_id. Par vazio no filtro combinado NAO significa 'sem origem'.",
        drive_file_id_chutado: drive,
      };
    }
  }
  return first;
}

export async function tOrigemDriveDosAnuncios(
  supa: Supa,
  companyId: string,
  args: OrigemDriveArgs,
  pedido = "",
): Promise<Record<string, unknown>> {
  if (!companyId) return { erro: "company_id_obrigatorio" };
  const conjunto = conjuntoDoPedidoOrigem(pedido, args);
  const nameLike = String(args.name_like ?? "").trim();
  const campaignId = String(args.campaign_id ?? "").trim();
  const adExternalId = String(args.ad_external_id ?? "").trim();
  if (!conjunto && !nameLike && !campaignId && !adExternalId) {
    return {
      erro: "informe conjunto (1-99), name_like/campaign_id da campanha, ou ad_external_id",
      instrucao: "Ex.: conjunto=1 + name_like=VISTTA. NAO chute arquivo pelo numero do anuncio.",
    };
  }

  const { data: adsRaw, error: eAds } = await supa.from("ads")
    .select("name,external_id,status,adset_external_id,campaign_id,criado_pelo_sistema,criado_por_approval_id")
    .eq("company_id", companyId);
  if (eAds) return { erro: `falha ao ler anuncios: ${eAds.message}` };

  const { data: setsRaw } = await supa.from("ad_sets")
    .select("external_id,name,campaign_id,status")
    .eq("company_id", companyId);
  const { data: campsRaw } = await supa.from("campaigns")
    .select("id,name,external_id,status")
    .eq("company_id", companyId);

  // A anotacao de tupla no retorno do map e obrigatoria: sem ela o literal vira
  // `(string | Linha…)[]`, o `new Map` nao consegue inferir chave/valor e cai em
  // `Map<unknown, unknown>` — era dai que saiam os TS2339 de `set?.name`/`camp?.external_id`.
  const setMap = new Map(
    ((setsRaw ?? []) as LinhaConjunto[]).map((s): [string, LinhaConjunto] => [String(s.external_id), s]),
  );
  const campMap = new Map(
    ((campsRaw ?? []) as LinhaCampanha[]).map((c): [string, LinhaCampanha] => [String(c.id), c]),
  );
  const incluirApagados = args.incluir_apagados === true;

  const ads: AdParaOrigem[] = ((adsRaw ?? []) as any[])
    .filter((a) => incluirApagados || statusObjetoOperacional(a.status))
    .map((a) => {
      const set = setMap.get(String(a.adset_external_id ?? ""));
      const camp = campMap.get(String(a.campaign_id ?? ""));
      return {
        name: String(a.name ?? ""),
        external_id: String(a.external_id ?? ""),
        status: String(a.status ?? ""),
        adset_name: String(set?.name ?? ""),
        campaign_name: String(camp?.name ?? ""),
        campaign_external_id: camp?.external_id != null ? String(camp.external_id) : null,
        criado_pelo_sistema: a.criado_pelo_sistema === true,
        criado_por_approval_id: a.criado_por_approval_id ? String(a.criado_por_approval_id) : null,
      };
    })
    .filter((a) => Boolean(a.external_id));

  const recorte = recortarAdsOrigem(ads, {
    conjunto,
    nameLike,
    campaignId,
    adExternalId,
    pistas: pistasCampanhaDoPedido(`${pedido} ${nameLike}`),
  });
  if (recorte.erro) {
    return { erro: recorte.erro, filtro: { conjunto, name_like: nameLike || null, campaign_id: campaignId || null } };
  }
  const lista = recorte.ads;

  const { data: cardsRaw } = await supa.from("approval_requests")
    .select("id,payload,execution_result,action,executed_at")
    .eq("company_id", companyId)
    .eq("action", "criar_anuncio_a_partir_de");
  const porApproval = new Map<string, CardOrigem>();
  const porAdCriado = new Map<string, CardOrigem>();
  for (const c of (cardsRaw ?? []) as any[]) {
    const drive = String(c?.payload?.drive_file_id ?? "").trim() || null;
    const criado = String(c?.execution_result?.id_criado ?? "").trim() || null;
    const row: CardOrigem = { id: String(c.id), drive_file_id: drive, ad_criado: criado };
    porApproval.set(row.id, row);
    if (criado) {
      const prev = porAdCriado.get(criado);
      if (!prev || (drive && !prev.drive_file_id)) porAdCriado.set(criado, row);
    }
  }
  const drives = [...new Set(
    lista.map((a) => {
      const card = (a.criado_por_approval_id ? porApproval.get(a.criado_por_approval_id) : undefined)
        ?? porAdCriado.get(a.external_id);
      return card?.drive_file_id;
    }).filter(Boolean),
  )] as string[];

  const pecas = new Map<string, PecaDriveOrigem>();
  if (drives.length) {
    const { data: analises } = await supa.from("drive_midia_analises")
      .select("drive_file_id,nome,caminho,analisado_em")
      .eq("company_id", companyId)
      .in("drive_file_id", drives);
    const ord = [...((analises ?? []) as any[])].sort((a, b) =>
      String(b.analisado_em ?? "").localeCompare(String(a.analisado_em ?? "")),
    );
    for (const a of ord) {
      const id = String(a.drive_file_id ?? "");
      if (!id || pecas.has(id)) continue;
      pecas.set(id, { nome: a.nome != null ? String(a.nome) : null, caminho: a.caminho != null ? String(a.caminho) : null });
    }
    const faltam = drives.filter((d) => !pecas.get(d)?.caminho);
    if (faltam.length) {
      const { data: ups } = await supa.from("media_uploads")
        .select("drive_file_id,nome,caminho_drive")
        .eq("company_id", companyId)
        .in("drive_file_id", faltam);
      for (const u of (ups ?? []) as any[]) {
        const id = String(u.drive_file_id ?? "");
        if (!id) continue;
        const prev = pecas.get(id) ?? { nome: null, caminho: null };
        pecas.set(id, {
          nome: prev.nome || (u.nome != null ? String(u.nome) : null),
          caminho: prev.caminho || (u.caminho_drive != null ? String(u.caminho_drive) : null),
        });
      }
    }
  }

  const anuncios = lista
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => resolverOrigemDoAd(a, porApproval, porAdCriado, pecas));
  const pastas = resumirPastasOrigem(anuncios);
  const confirmados = anuncios.filter((a) => a.vinculo === "confirmado").length;

  return {
    total: anuncios.length,
    com_pasta_confirmada: confirmados,
    sem_vinculo: anuncios.length - confirmados,
    conjunto,
    pastas,
    pasta_unica: pastas.length === 1 ? pastas[0].pasta : null,
    ...(recorte.ambiguo
      ? {
        ambiguo: true,
        opcoes: recorte.ambiguo.campanhas,
        instrucao: "CONJ.N existe em mais de uma campanha. Filtre pela campanha do fio (ex.: VISTTA) ou chame de novo com name_like.",
      }
      : {}),
    anuncios,
    nota:
      "Fonte: card criar_anuncio_a_partir_de (payload.drive_file_id) + pasta em drive_midia_analises. " +
      "AD_…_2 NAO implica 2.mp4. Anuncio feito so no Gerenciador fica vinculo=fora_do_sistema. " +
      "DELETED/ARCHIVED ficam de fora (salvo incluir_apagados). " +
      "PROIBIDO dizer 'sem vinculo' se esta tool devolveu pasta/drive_file_id.",
  };
}

// A definicao desta ferramenta (nome, descricao e schema) mora em public.agent_ferramentas,
// com snapshot local em _shared/ferramentas_base.ts. Mantida aqui, seria a segunda copia da
// mesma verdade — e foi divergindo da versao do traffic-agent-job ate 03/09/2026.


export const FOCO_ORIGEM_DRIVE =
  "ORIGEM DRIVE DOS ANUNCIOS JA NO AR: chame origem_drive_dos_anuncios (conjunto + name_like da campanha). " +
  "Responda pasta (e peca_nome) de CADA anuncio. PROIBIDO 'sem vinculo' se a tool trouxe drive_file_id. " +
  "PROIBIDO inventariar a pasta inteira no lugar desta leitura. PROIBIDO mapear AD_…_N para N.mp4.";
