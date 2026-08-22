// traffic-reco-job — canal amplo de Recomendacoes da IA (hibrido).
// Consome recommendation_candidates com needs_llm=true, redige titulo/descricao
// SEM inventar metricas, valida evidencia e grava via public.gravar_recomendacao.
// Auth: x-mcp-key (cron:traffic-reco-job). Body: { modo?: "diario" }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { bodyOpenRouter, resolverChamadaLlm } from "../_shared/llm_roteador.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

type Candidate = {
  id: string;
  company_id: string;
  signal_key: string;
  family: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  impact: string;
  category: string | null;
  maturity_days: number;
  title_draft: string;
  description_draft: string;
  suggested_prompt: string;
  evidence_json: Record<string, unknown>;
  dedupe_key: string;
};

function evidenceNumbers(ev: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(String(v));
    else if (typeof v === "string" && /^-?\d+([.,]\d+)?%?$/.test(v.trim())) out.push(v.trim().replace(",", "."));
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "fonte" || k === "legenda" || k === "base_clique") continue;
        walk(val);
      }
    }
  };
  walk(ev);
  return [...new Set(out)];
}

function textContainsEvidence(text: string, ev: Record<string, unknown>): { ok: boolean; missing: string[] } {
  const nums = evidenceNumbers(ev).filter((n) => {
    const abs = Math.abs(Number(String(n).replace("%", "")));
    return abs >= 0.01; // ignora zeros triviais
  });
  const norm = text.replace(",", ".");
  const missing: string[] = [];
  // Exige pelo menos metade dos numeros materiais (ou todos se <=3)
  const must = nums.length <= 3 ? nums : nums.slice(0, Math.ceil(nums.length * 0.5));
  for (const n of must) {
    const core = String(n).replace("%", "");
    if (!norm.includes(core)) missing.push(core);
  }
  if (!(ev.fonte) || !String(text.toLowerCase()).includes("fonte") && !String(JSON.stringify(ev.fonte))) {
    // fonte pode estar so no evidence_json; texto deve mencionar origem se video/paralelo
  }
  return { ok: missing.length === 0, missing };
}

async function redigirComLlm(c: Candidate): Promise<{ title: string; description: string; used_llm: boolean }> {
  if (!OPENROUTER_KEY) {
    return { title: c.title_draft, description: c.description_draft, used_llm: false };
  }
  const sys = `Voce redige cards de recomendacao de trafego pago em portugues brasileiro.
REGRAS INEGOCIAVEIS:
1) Use SOMENTE os numeros presentes em evidence_json. Nunca invente metrica, percentual ou valor.
2) Se evidence_json tem base_clique=link, diga "CTR de link" / "CPC de link" — nunca misture com cliques totais.
3) visualizacoes_lp, thruplay, avg_watch sao resultados validos — cite quando presentes.
4) Nao proponha execucao na Meta; proponha discussao/diagnostico.
5) Responda JSON puro: {"title":"...","description":"..."} com title <= 120 chars.`;

  const user = JSON.stringify({
    signal_key: c.signal_key,
    family: c.family,
    entity: { type: c.entity_type, id: c.entity_id, name: c.entity_name },
    title_draft: c.title_draft,
    description_draft: c.description_draft,
    evidence_json: c.evidence_json,
  });

  try {
    const rota = resolverChamadaLlm({ tipo: "reco" });
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENROUTER_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://ai-adviser-buddy.local",
        "x-title": "traffic-reco-job",
      },
      body: JSON.stringify(bodyOpenRouter(rota, {
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      })),
    });
    const body = await res.json();
    const raw = String(body?.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(raw);
    const title = String(parsed?.title ?? "").trim() || c.title_draft;
    const description = String(parsed?.description ?? "").trim() || c.description_draft;
    const check = textContainsEvidence(description, c.evidence_json);
    if (!check.ok) {
      return {
        title: c.title_draft,
        description: c.description_draft + " (redacao LLM rejeitada: numeros fora da evidencia)",
        used_llm: false,
      };
    }
    return { title: title.slice(0, 200), description, used_llm: true };
  } catch {
    return { title: c.title_draft, description: c.description_draft, used_llm: false };
  }
}

async function processCandidate(c: Candidate) {
  const draftCheck = textContainsEvidence(c.description_draft, c.evidence_json);
  if (!draftCheck.ok && evidenceNumbers(c.evidence_json).length > 0) {
    // Draft SQL ja deve carregar os numeros; se nao, rejeita
    await supa.from("recommendation_candidates").update({
      status: "rejected",
      processed_at: new Date().toISOString(),
      reject_reason: `draft_sem_evidencia: missing=${draftCheck.missing.join(",")}`,
    }).eq("id", c.id);
    return { id: c.id, ok: false, motivo: "draft_sem_evidencia" };
  }

  const redigido = await redigirComLlm(c);
  const { data, error } = await supa.rpc("gravar_recomendacao", {
    p_company_id: c.company_id,
    p_title: redigido.title,
    p_description: redigido.description,
    p_impact: c.impact,
    p_category: c.category,
    p_family: c.family,
    p_signal_key: c.signal_key,
    p_entity_type: c.entity_type,
    p_entity_id: c.entity_id,
    p_entity_name: c.entity_name,
    p_evidence: c.evidence_json,
    p_suggested_prompt: c.suggested_prompt,
    p_maturity_days: c.maturity_days,
    p_source: redigido.used_llm ? "hybrid:reco-job" : "hybrid:sql-direct",
    p_dedupe_key: c.dedupe_key,
    p_candidate_id: c.id,
  });

  if (error) {
    await supa.from("recommendation_candidates").update({
      status: "rejected",
      processed_at: new Date().toISOString(),
      reject_reason: error.message,
    }).eq("id", c.id);
    return { id: c.id, ok: false, motivo: error.message };
  }
  return { id: c.id, ok: true, result: data, used_llm: redigido.used_llm };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const key = chaveMcpDe(req);
  const auth = await mcpKeyValida(supa, key);
  if (!auth.ok) {
    return json({ error: "nao autorizado", detalhe: auth.motivo }, 401);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: cands, error } = await supa
    .from("recommendation_candidates")
    .select("*")
    .eq("status", "pending")
    .eq("needs_llm", true)
    .order("created_at", { ascending: true })
    .limit(40);

  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const c of (cands ?? []) as Candidate[]) {
    results.push(await processCandidate(c));
  }

  return json({
    ok: true,
    modo: body?.modo ?? "diario",
    processados: results.length,
    escritos: results.filter((r) => r.ok).length,
    rejeitados: results.filter((r) => !r.ok).length,
    detalhes: results,
  });
});
