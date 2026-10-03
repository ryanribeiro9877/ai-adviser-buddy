// Lista os arquivos da biblioteca que a faxina poderia tirar.
// Não apaga nada. A exclusão é irreversível e fica fora até a listagem
// ser conferida: 01. Setembro como duplicata, La Felicità fora, e nenhum
// candidato com gasto na janela.
//
// Tirar o arquivo da biblioteca não apaga entrega, política nem reputação.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cfgEmpresa, redactAllMetaTokens, tokenAdsPorCompanyId } from "../_shared/meta_company_tokens.ts";
import {
  anuncioDaGraph,
  aprendizadoDaConta,
  fundirVideoDoEspelho,
  hashValido,
  limparErroMeta,
  listarAteOFim,
  nomeComUpload,
  type AnuncioMapeado,
  type ItemDaLista,
} from "../_shared/biblioteca_meta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";
const PRAZO_MS = 50_000;
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

function contaNua(v: unknown): string {
  return String(v ?? "").trim().replace(/^act_/i, "");
}

async function buscarGraph(url: string) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const texto = await resposta.text();
  let corpo: unknown = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = { error: { message: "resposta que não é json" } };
  }
  return { ok: resposta.ok, status: resposta.status, json: corpo };
}

type Upload = { nome: string | null; criado_em: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Use POST." }, 405);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ ok: false, erro: "Sessão ausente." }, 401);
  const { data: auth, error: authErro } = await supa.auth.getUser(jwt);
  if (authErro || !auth.user) return json({ ok: false, erro: "Sessão inválida." }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const companyId = String(body.company_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
    return json({ ok: false, erro: "Empresa inválida." }, 400);
  }
  const { data: membro, error: membroErro } = await supa.rpc("is_company_member", {
    _company_id: companyId,
    _user_id: auth.user.id,
  });
  if (membroErro) return json({ ok: false, erro: "Não foi possível confirmar a empresa." }, 500);
  if (!membro) return json({ ok: false, erro: "Esta empresa não está na sua conta." }, 403);

  const cfg = cfgEmpresa(companyId);
  const tok = tokenAdsPorCompanyId(companyId);
  if (!cfg || !tok) return json({ ok: false, erro: "Esta empresa não tem token da Meta." }, 409);
  const contas = cfg.ad_accounts.map(contaNua).filter(Boolean);
  const pedida = contaNua(body.account_id);
  const conta = pedida || (contas.length === 1 ? contas[0] : "");
  if (!conta || !contas.includes(conta)) {
    return json({ ok: false, erro: "Conta de anúncio fora desta empresa." }, 400);
  }
  const dias = body.dias_sem_uso == null || body.dias_sem_uso === "" ? 90 : Number(body.dias_sem_uso);
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
    return json({ ok: false, erro: "dias_sem_uso inválido." }, 400);
  }

  const prazo = Date.now() + PRAZO_MS;
  const token = encodeURIComponent(tok.token);
  const camposVideo = "id,title,created_time";
  const camposImagem = "hash,name,created_time";
  const camposAnuncio = "id,name,effective_status,creative{video_id,image_hash,object_story_spec,asset_feed_spec}";

  const [videos, imagens, anunciosGraph, campanhas] = await Promise.all([
    listarAteOFim(`${GRAPH}/act_${conta}/advideos?fields=${camposVideo}&limit=100&access_token=${token}`, buscarGraph, prazo),
    listarAteOFim(`${GRAPH}/act_${conta}/adimages?fields=${camposImagem}&limit=100&access_token=${token}`, buscarGraph, prazo),
    listarAteOFim(`${GRAPH}/act_${conta}/ads?fields=${camposAnuncio}&limit=50&access_token=${token}`, buscarGraph, prazo),
    listarAteOFim(`${GRAPH}/act_${conta}/campaigns?fields=id,name,created_time&limit=100&access_token=${token}`, buscarGraph, prazo),
  ]);

  let espelho: { external_id: string; name: string | null; effective_status: string | null; meta_video_id: string | null }[] = [];
  let espelhoOk = true;
  try {
    espelho = await lerEspelho(supa, companyId, conta);
  } catch (e) {
    espelhoOk = false;
    console.error(redactAllMetaTokens(limparErroMeta(String((e as Error)?.message ?? e))));
  }

  let uploads: Map<string, Upload>;
  try {
    uploads = await lerUploads(supa, companyId);
  } catch (e) {
    return json({
      ok: false,
      erro: "listagem_incompleta: a biblioteca ou os anúncios não vieram inteiros. Lista vazia com escopo zero não é faxina.",
      detalhe: limparErroMeta(String((e as Error)?.message ?? e)),
    });
  }
  const anuncios = espelhoOk
    ? fundirVideoDoEspelho(
      anunciosGraph.itens.map(anuncioDaGraph).filter((a): a is AnuncioMapeado => !!a),
      espelho,
    )
    : [];

  const { data, error } = await supa.rpc("listar_ativos_orfaos", {
    p_company_id: companyId,
    p_account_id: conta,
    p_dias_sem_uso: dias,
    p_videos: videos.itens.map((row) => ativoVideo(row, uploads)),
    p_imagens: imagens.itens.map((row) => ativoImagem(row, uploads)),
    p_anuncios: anuncios,
    p_videos_ok: videos.completo,
    p_imagens_ok: imagens.completo,
    p_anuncios_ok: anunciosGraph.completo && espelhoOk,
    // Gasto e card aberto a função lê no banco. Não passar array vazio:
    // array substitui o banco e esconderia histórico.
  });

  if (error) {
    const detalhe = videos.erro ?? imagens.erro ?? anunciosGraph.erro ?? (espelhoOk ? null : "espelho_indisponivel");
    return json({
      ok: false,
      erro: limparErroMeta(redactAllMetaTokens(error.message ?? "A classificação não rodou.")),
      detalhe: detalhe ? limparErroMeta(detalhe) : null,
    });
  }

  const miniaturas = await contarMiniaturas(supa, companyId, conta);
  const aprendizado = aprendizadoDaConta(campanhas);

  return json({
    ok: true,
    company_id: companyId,
    account_id: conta,
    dias_sem_uso: dias,
    gerado_em: new Date().toISOString(),
    videos: videos.itens.length,
    imagens: imagens.itens.length,
    anuncios: anuncios.length,
    miniaturas_nossas: miniaturas.nossas,
    miniaturas_faltando: miniaturas.faltando,
    faxina_adiada_ate: aprendizado.ate,
    aprendizado_desconhecido: aprendizado.desconhecido,
    ativos: data ?? [],
  });
});

function ativoVideo(row: ItemDaLista, uploads: Map<string, Upload>) {
  const id = String(row.id ?? "").trim();
  const upload = uploads.get(`video:${id}`);
  return {
    id,
    nome: nomeComUpload(String(row.title ?? row.name ?? ""), id, upload),
    criado_em: textoData(row.created_time) ?? upload?.criado_em ?? null,
  };
}

function ativoImagem(row: ItemDaLista, uploads: Map<string, Upload>) {
  const id = hashValido(row.hash ?? row.id) ?? "";
  const upload = uploads.get(`imagem:${id}`);
  return {
    id,
    nome: nomeComUpload(String(row.name ?? ""), id, upload),
    criado_em: textoData(row.created_time) ?? upload?.criado_em ?? null,
  };
}

function textoData(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

async function lerEspelho(supa: ReturnType<typeof createClient>, companyId: string, conta: string) {
  const linhas: { external_id: string; name: string | null; effective_status: string | null; meta_video_id: string | null }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supa
      .from("ads")
      .select("external_id,name,effective_status,meta_video_id")
      .eq("company_id", companyId)
      .eq("account_id", conta)
      .is("ausente_na_graph_em", null)
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    linhas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return linhas;
}

async function lerUploads(supa: ReturnType<typeof createClient>, companyId: string) {
  const mapa = new Map<string, Upload>();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supa
      .from("media_uploads")
      .select("meta_video_id,meta_image_hash,nome,created_at")
      .eq("company_id", companyId)
      .eq("status", "enviado")
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    for (const linha of pagina) {
      const upload = { nome: linha.nome ?? null, criado_em: linha.created_at ?? null };
      if (linha.meta_video_id) mapa.set(`video:${linha.meta_video_id}`, upload);
      if (linha.meta_image_hash) mapa.set(`imagem:${String(linha.meta_image_hash).toLowerCase()}`, upload);
    }
    if (pagina.length < 1000) break;
  }
  return mapa;
}

async function contarMiniaturas(supa: ReturnType<typeof createClient>, companyId: string, conta: string) {
  const total = await supa
    .from("ads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("account_id", conta)
    .is("ausente_na_graph_em", null);
  const nossas = await supa
    .from("ads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("account_id", conta)
    .is("ausente_na_graph_em", null)
    .like("thumbnail_url", `${companyId}/%`);
  if (total.error || nossas.error) return { nossas: null, faltando: null };
  const n = total.count ?? 0;
  const com = nossas.count ?? 0;
  return { nossas: com, faltando: Math.max(0, n - com) };
}
