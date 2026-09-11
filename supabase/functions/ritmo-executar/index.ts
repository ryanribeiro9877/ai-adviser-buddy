// Tiques da forca-tarefa Ritmo. Toda escrita na Meta passa por meta-actions
// { origem: "ritmo", ritmo_ato_id }. Sem Graph. Sem approval_requests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import {
  atosDoPrimeiroPasse,
  parsePlanoRitmo,
  motivoParada,
  sonhoAtingido,
  gastoNaJanela,
  nDiasPrazo,
  type AtoPlanoEntrada,
} from "../_shared/ritmo.ts";
import { hojeYmdBrasilia } from "../_shared/relatorios.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIMITE_DESPACHO = 20;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Missao = {
  id: string;
  company_id: string;
  campaign_id: string;
  status: string;
  periodo_inicio: string;
  periodo_fim: string;
  metrica: string;
  sonho: number | null;
  teto_gasto_janela: number | null;
  plano_json: unknown;
  autonomia_concedida_em: string | null;
  atualizado_em: string | null;
};

type SnapLinha = {
  snapshot_date: string;
  spend?: number | string | null;
  impressions?: number | string | null;
  reach?: number | string | null;
  clicks?: number | string | null;
  link_clicks?: number | string | null;
  form_leads?: number | string | null;
  messaging_started?: number | string | null;
};

const MODOS = [
  "primeiro_passe",
  "leve",
  "fundo",
  "dispatcher_leve",
  "dispatcher_fundo",
] as const;
type Modo = (typeof MODOS)[number];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function emBackground(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else void p;
}

function ymdDe(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function txt(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function uuidDe(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : "";
}

function chaveAto(acao: unknown, alvo: unknown): string {
  return `${String(acao ?? "")}::${String(alvo ?? "").trim()}`;
}

function ehModo(v: string): v is Modo {
  return (MODOS as readonly string[]).includes(v);
}

function payloadDoAto(ato: AtoPlanoEntrada, alvo: string): Record<string, unknown> {
  const bruto = { ...(ato as AtoPlanoEntrada & Record<string, unknown>) };
  delete bruto.executavel;
  return { ...bruto, target_external_id: alvo };
}

function atoReexecutavel(resposta: unknown): boolean {
  if (!resposta || typeof resposta !== "object") return true;
  const r = resposta as Record<string, unknown>;
  if (r.re_executavel === false) return false;
  if (r.adcreative_orfao) return false;
  const ultima = r.ultima_falha;
  if (ultima && typeof ultima === "object" && (ultima as { re_executavel?: unknown }).re_executavel === false) {
    return false;
  }
  return true;
}

function valorMetricaSnap(metrica: string, s: SnapLinha): number {
  if (metrica === "conversas") return num(s.messaging_started);
  if (metrica === "cliques_no_link") return num(s.link_clicks);
  if (metrica === "formularios") return num(s.form_leads);
  if (metrica === "alcance") return num(s.reach);
  if (metrica === "impressoes") return num(s.impressions);
  return 0;
}

async function carregarMissao(id: string): Promise<Missao | null> {
  const { data, error } = await supa.from("ritmo_missoes").select(
    "id,company_id,campaign_id,status,periodo_inicio,periodo_fim,metrica,sonho,teto_gasto_janela,plano_json,autonomia_concedida_em,atualizado_em",
  ).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Missao;
}

async function snapshotsDaMissao(missao: Missao): Promise<SnapLinha[]> {
  const { data: camp } = await supa
    .from("campaigns")
    .select("id")
    .eq("company_id", missao.company_id)
    .eq("external_id", missao.campaign_id)
    .maybeSingle();
  const campId = (camp as { id?: string } | null)?.id;
  if (!campId) return [];
  const { data } = await supa
    .from("metric_snapshots")
    .select("snapshot_date,spend,impressions,reach,clicks,link_clicks,form_leads,messaging_started")
    .eq("company_id", missao.company_id)
    .eq("campaign_id", campId)
    .gte("snapshot_date", ymdDe(missao.periodo_inicio))
    .lte("snapshot_date", ymdDe(missao.periodo_fim))
    .order("snapshot_date");
  return (data ?? []) as SnapLinha[];
}

async function chavesAtosExistentes(missaoId: string): Promise<Set<string>> {
  const { data } = await supa
    .from("ritmo_atos")
    .select("acao,alvo_external_id")
    .eq("missao_id", missaoId);
  const out = new Set<string>();
  for (const row of data ?? []) {
    out.add(chaveAto(row.acao, row.alvo_external_id));
  }
  return out;
}

/** HTTP 200 de meta-actions traz ok:true mesmo com resultado falhou/bloqueado — ler resultado. */
async function postMetaAto(
  atoId: string,
  mcpKey: string,
): Promise<{ http: number; resultado?: string; erro?: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/meta-actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcp-key": mcpKey,
      },
      body: JSON.stringify({ origem: "ritmo", ritmo_ato_id: atoId }),
    });
    const raw = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* */
    }
    const resultado = typeof body.resultado === "string" ? body.resultado : undefined;
    if (res.status === 403) {
      return { http: 403, resultado: resultado ?? "bloqueado" };
    }
    if (!res.ok) {
      await supa.from("ritmo_atos").update({
        resultado: "falhou",
        resposta_meta: { re_executavel: true, http: res.status, body },
      }).eq("id", atoId);
      return { http: res.status, resultado: "falhou", erro: raw.slice(0, 400) };
    }
    return { http: res.status, resultado };
  } catch (e) {
    const erro = String((e as Error)?.message ?? e).slice(0, 400);
    await supa.from("ritmo_atos").update({
      resultado: "falhou",
      resposta_meta: { re_executavel: true, erro },
    }).eq("id", atoId);
    return { http: 0, resultado: "falhou", erro };
  }
}

async function inserirEExecutarAtos(opts: {
  missao: Missao;
  atos: AtoPlanoEntrada[];
  tique: "primeiro_passe" | "fundo";
  mcpKey: string;
  replano: boolean;
}): Promise<{ inseridos: number; pulados: number; execucoes: Record<string, unknown>[] }> {
  const existentes = await chavesAtosExistentes(opts.missao.id);
  const execucoes: Record<string, unknown>[] = [];
  let inseridos = 0;
  let pulados = 0;
  for (const ato of opts.atos) {
    const alvo = String(ato.alvo_external_id ?? "").trim();
    const chave = chaveAto(ato.acao, alvo);
    if (existentes.has(chave)) {
      pulados += 1;
      continue;
    }
    const extra = ato as AtoPlanoEntrada & Record<string, unknown>;
    const { data: row, error } = await supa.from("ritmo_atos").insert({
      missao_id: opts.missao.id,
      company_id: opts.missao.company_id,
      tique: opts.tique,
      acao: ato.acao,
      alvo_external_id: alvo || null,
      payload: payloadDoAto(ato, alvo),
      evidencia: txt(extra.evidencia),
      mecanismo: txt(extra.mecanismo),
      metrica_sucesso: txt(extra.metrica_sucesso),
      janela_leitura: txt(extra.janela_leitura),
      reversa: txt(extra.reversa),
      resultado: "pendente",
      replano: opts.replano,
    }).select("id").maybeSingle();
    if (error || !row?.id) {
      execucoes.push({ acao: ato.acao, alvo, erro: error?.message ?? "insert_falhou" });
      continue;
    }
    existentes.add(chave);
    inseridos += 1;
    const saida = await postMetaAto(String(row.id), opts.mcpKey);
    execucoes.push({ ritmo_ato_id: row.id, acao: ato.acao, alvo, ...saida });
  }
  return { inseridos, pulados, execucoes };
}

function imediatosDoPlano(planoJson: unknown, existentes: Set<string>): AtoPlanoEntrada[] {
  const plano = parsePlanoRitmo(planoJson);
  if (!plano) return [];
  const executaveis = plano.atos.filter((a) => a.executavel);
  const novos = executaveis.filter(
    (a) => !existentes.has(chaveAto(a.acao, a.alvo_external_id)),
  );
  return atosDoPrimeiroPasse(novos);
}

async function rodarPrimeiroPasse(missaoId: string, mcpKey: string) {
  const missao = await carregarMissao(missaoId);
  if (!missao) return json({ error: "missao_nao_encontrada" }, 404);
  if (missao.status !== "em_execucao") {
    return json({ ok: true, modo: "primeiro_passe", pulado: "status", status: missao.status });
  }
  const hoje = hojeYmdBrasilia(new Date());
  if (ymdDe(missao.periodo_inicio) > hoje) {
    return json({ ok: true, modo: "primeiro_passe", pulado: "antes_do_inicio", hoje });
  }
  const existentes = await chavesAtosExistentes(missao.id);
  const atos = imediatosDoPlano(missao.plano_json, existentes);
  const r = await inserirEExecutarAtos({
    missao,
    atos,
    tique: "primeiro_passe",
    mcpKey,
    replano: false,
  });
  return json({
    ok: true,
    modo: "primeiro_passe",
    missao_id: missaoId,
    n_dias: nDiasPrazo(missao.periodo_inicio, missao.periodo_fim),
    ...r,
  });
}

async function rodarLeve(missaoId: string, mcpKey: string) {
  const missao = await carregarMissao(missaoId);
  if (!missao) return json({ error: "missao_nao_encontrada" }, 404);
  if (missao.status !== "em_execucao") {
    return json({ ok: true, modo: "leve", pulado: "status", status: missao.status });
  }

  const hoje = hojeYmdBrasilia(new Date());
  const inicio = ymdDe(missao.periodo_inicio);
  const fim = ymdDe(missao.periodo_fim);
  const snaps = await snapshotsDaMissao(missao);
  const series = snaps.map((s) => ({ date: ymdDe(s.snapshot_date), spend: num(s.spend) }));
  const gasto = gastoNaJanela(series, inicio, fim);
  const dias = snaps.map((s) => ({
    date: ymdDe(s.snapshot_date),
    valor: valorMetricaSnap(missao.metrica, s),
    impressoes: num(s.impressions),
    cliques: num(s.clicks),
    cliques_link: num(s.link_clicks),
  }));
  const concessaoYmd = missao.autonomia_concedida_em
    ? hojeYmdBrasilia(new Date(missao.autonomia_concedida_em))
    : inicio;
  const sonhoBateu = missao.sonho != null &&
    sonhoAtingido(missao.metrica, missao.sonho, dias, inicio, concessaoYmd);

  const { data: conf } = await supa
    .from("meta_execution_config")
    .select("master_enabled")
    .eq("company_id", missao.company_id)
    .maybeSingle();

  const motivo = motivoParada({
    hojeYmd: hoje,
    periodoFim: fim,
    gastoJanela: gasto,
    teto: missao.teto_gasto_janela,
    sonhoBateu,
    encerrarHumano: false,
    masterLigado: (conf as { master_enabled?: boolean } | null)?.master_enabled === true,
  });

  if (motivo) {
    const { data: enc } = await supa.rpc("encerrar_ritmo_missao", {
      p_id: missaoId,
      p_motivo: motivo,
    });
    const okEnc = !!(enc as { ok?: boolean } | null)?.ok;
    if (okEnc) {
      await supa.from("ritmo_atos").insert({
        missao_id: missaoId,
        company_id: missao.company_id,
        tique: "leve",
        acao: "verificar_parada",
        payload: { motivo, gasto, teto: missao.teto_gasto_janela, sonho_bateu: sonhoBateu },
        resultado: "ok",
        resposta_meta: { motivo },
      });
    }
    return json({
      ok: true,
      modo: "leve",
      missao_id: missaoId,
      parada: motivo,
      encerrada: okEnc,
    });
  }

  const { data: falhos } = await supa
    .from("ritmo_atos")
    .select("id,resultado,resposta_meta")
    .eq("missao_id", missaoId)
    .eq("resultado", "falhou");

  const retries: Record<string, unknown>[] = [];
  for (const ato of falhos ?? []) {
    if (!atoReexecutavel(ato.resposta_meta)) {
      retries.push({ ritmo_ato_id: ato.id, pulado: "nao_reexecutavel" });
      continue;
    }
    await supa.from("ritmo_atos").update({ resultado: "pendente" }).eq("id", ato.id);
    const saida = await postMetaAto(String(ato.id), mcpKey);
    retries.push({ ritmo_ato_id: ato.id, ...saida });
  }

  return json({
    ok: true,
    modo: "leve",
    missao_id: missaoId,
    parada: null,
    retries: retries.length,
    execucoes: retries,
  });
}

async function chamarReplano(
  missaoId: string,
  mcpKey: string,
): Promise<{ ok: boolean; http: number; detalhe: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/traffic-agent-job`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mcp-key": mcpKey,
      },
      body: JSON.stringify({ modo: "ritmo_replano", missao_id: missaoId }),
    });
    const raw = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* */
    }
    if (!res.ok || body.error || body.ok === false) {
      const detalhe = `http=${res.status} ${raw.slice(0, 500)}`;
      console.warn(`[ritmo-executar] ritmo_replano falhou missao=${missaoId} ${detalhe}`);
      return { ok: false, http: res.status, detalhe };
    }
    return { ok: true, http: res.status, detalhe: `http=${res.status}` };
  } catch (e) {
    const detalhe = String((e as Error)?.message ?? e).slice(0, 400);
    console.warn(`[ritmo-executar] ritmo_replano erro missao=${missaoId} ${detalhe}`);
    return { ok: false, http: 0, detalhe };
  }
}

async function esperarPlanoNovo(missaoId: string, atualizadoAntes: string | null, tetoMs = 45_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < tetoMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const { data } = await supa
      .from("ritmo_missoes")
      .select("atualizado_em,plano_json")
      .eq("id", missaoId)
      .maybeSingle();
    if (data && String(data.atualizado_em ?? "") !== String(atualizadoAntes ?? "")) return;
  }
}

async function rodarFundo(missaoId: string, mcpKey: string) {
  const missao = await carregarMissao(missaoId);
  if (!missao) return json({ error: "missao_nao_encontrada" }, 404);
  if (missao.status !== "em_execucao") {
    return json({ ok: true, modo: "fundo", pulado: "status", status: missao.status });
  }

  const replano = await chamarReplano(missaoId, mcpKey);
  if (!replano.ok) {
    return json({
      ok: true,
      modo: "fundo",
      missao_id: missaoId,
      replano: "falhou",
      detalhe: replano.detalhe,
      inseridos: 0,
    });
  }
  if (replano.http === 202) {
    await esperarPlanoNovo(missaoId, missao.atualizado_em);
  }

  const atual = await carregarMissao(missaoId);
  if (!atual || atual.status !== "em_execucao") {
    return json({
      ok: true,
      modo: "fundo",
      missao_id: missaoId,
      replano: "ok",
      pulado: atual ? "status" : "missao_ausente",
    });
  }
  const existentes = await chavesAtosExistentes(atual.id);
  const atos = imediatosDoPlano(atual.plano_json, existentes);
  const r = await inserirEExecutarAtos({
    missao: atual,
    atos,
    tique: "fundo",
    mcpKey,
    replano: true,
  });
  return json({
    ok: true,
    modo: "fundo",
    missao_id: missaoId,
    replano: "ok",
    ...r,
  });
}

async function despachar(tique: "leve" | "fundo", mcpKey: string, limite: number) {
  const { data, error } = await supa.rpc("listar_ritmo_tiques_devidos", {
    p_tique: tique,
    p_limite: limite,
  });
  if (error) return json({ error: "listar_falhou", detalhe: error.message }, 500);
  const rows = (data ?? []) as { id: string; company_id: string; campaign_id: string }[];
  for (const row of rows) {
    const id = String(row.id);
    emBackground(
      (tique === "leve" ? rodarLeve(id, mcpKey) : rodarFundo(id, mcpKey)).catch((e) => {
        console.warn(`[ritmo-executar] ${tique} missao=${id} ${String(e)}`);
      }),
    );
  }
  return json({
    ok: true,
    modo: tique === "leve" ? "dispatcher_leve" : "dispatcher_fundo",
    despachados: rows.length,
  }, 202);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const mcpKey = chaveMcpDe(req, "header-only");
  const auth = await mcpKeyValida(supa, mcpKey);
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }

  const modo = String(body?.modo ?? "");
  if (!ehModo(modo)) {
    return json({
      error: "modo_invalido",
      modos: MODOS,
    }, 400);
  }

  if (modo === "dispatcher_leve") {
    const limite = Number(body?.limite ?? LIMITE_DESPACHO);
    return await despachar("leve", mcpKey, Number.isFinite(limite) ? limite : LIMITE_DESPACHO);
  }
  if (modo === "dispatcher_fundo") {
    const limite = Number(body?.limite ?? LIMITE_DESPACHO);
    return await despachar("fundo", mcpKey, Number.isFinite(limite) ? limite : LIMITE_DESPACHO);
  }

  const missaoId = uuidDe(body?.missao_id);
  if (!missaoId) return json({ error: "missao_id obrigatorio" }, 400);

  if (modo === "primeiro_passe") return await rodarPrimeiroPasse(missaoId, mcpKey);
  if (modo === "leve") return await rodarLeve(missaoId, mcpKey);
  return await rodarFundo(missaoId, mcpKey);
});
