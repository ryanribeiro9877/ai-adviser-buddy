// traffic-reco-job — canal amplo de Recomendacoes da IA (hibrido).
// Consome recommendation_candidates com needs_llm=true, redige titulo/descricao
// SEM inventar metricas, valida evidencia e grava via public.gravar_recomendacao.
// Auth: x-mcp-key (cron:traffic-reco-job). Body: { modo?: "diario" }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { bodyOpenRouter, resolverChamadaLlm, tetoDeSaida } from "../_shared/llm_roteador.ts";

/**
 * Teto de parede POR CHAMADA do redator.
 *
 * A tarefa `recomendacoes-da-ia` tem timeout_ms=120.000 em public.tarefas_agendadas — esse e o
 * orcamento inteiro do lote, nao de uma ida. Como o padrao da casa raciocina antes de escrever
 * (40-55s por ida medidos em 03/09 no esforco `high`), sem teto por chamada uma unica reco
 * lenta consome a parede toda e o cron morre no meio do lote sem dizer onde parou.
 */
const REDATOR_TIMEOUT_MS = 45_000;

/** Parede do lote. Abaixo dos 120s da tarefa para sobrar margem de escrita no banco. */
const LOTE_PAREDE_MS = 100_000;

/**
 * Teto do SELECT. 40 em serie nao cabem: 45s de teto por ida × 40 = 30 min contra
 * parede de 100s. O fetch pede so o que a parede comporta; o que ficar pendente
 * segue `pending` para a proxima corrida, declarado em nao_alcancados_na_parede
 * se mesmo assim o relogio morder.
 */
const LOTE_MAX = Math.max(1, Math.floor(LOTE_PAREDE_MS / REDATOR_TIMEOUT_MS));

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

type Redacao = {
  title: string;
  description: string;
  used_llm: boolean;
  /**
   * Por que o redator nao escreveu. `null` so quando ele escreveu de fato.
   *
   * 05/09/2026 — ESTE CAMPO E O CONSERTO. Antes, todo caminho de falha caia no mesmo
   * `catch {}` e devolvia o rascunho do SQL como se fosse escolha: `used_llm:false`, card
   * gravado, `ok:true` na resposta e `desfecho='sucesso'` em execucoes_agendadas. O banco
   * mostra o preco disso — de 25/08 a 05/09 foram 26 cards por este caminho e 25 sairam com o
   * rascunho cru, sem uma linha de erro em lugar nenhum; a execucao de 05/09 09:35 gravou
   * `sucesso` com duracao de 1.330 ms, tempo em que o padrao da casa nao termina UMA ida.
   *
   * O rascunho continua sendo publicado — ele e honesto e vale mais que card nenhum. O que
   * muda e que a falha deixa de ser indistinguivel do sucesso.
   */
  falha: string | null;
};

async function redigirComLlm(c: Candidate): Promise<Redacao> {
  if (!OPENROUTER_KEY) {
    return {
      title: c.title_draft,
      description: c.description_draft,
      used_llm: false,
      falha: "sem_chave_openrouter",
    };
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

  const rascunho = (falha: string, sufixo = ""): Redacao => ({
    title: c.title_draft,
    description: c.description_draft + sufixo,
    used_llm: false,
    falha,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REDATOR_TIMEOUT_MS);
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
        // O card e curto, mas o teto conta raciocinio + texto e o padrao da casa raciocina
        // sempre. Sem teto declarado a OpenRouter usa o default do modelo; declarar o piso
        // deixa o orcamento visivel aqui em vez de implicito no provedor.
        max_tokens: tetoDeSaida(),
      })),
      signal: ac.signal,
    });
    // O `res.ok` FALTAVA: a versao anterior ia direto ao res.json(), e em qualquer 4xx/5xx o
    // corpo de erro nao tem `choices`, o JSON.parse("") estourava e a falha virava rascunho.
    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      console.error(`[reco] openrouter_http_${res.status} cand=${c.id} ${detalhe.slice(0, 200)}`);
      return rascunho(`openrouter_http_${res.status}`);
    }
    const body = await res.json();
    const raw = String(body?.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) {
      // Assinatura de teto curto, nao de modelo confuso: `finish_reason:length` com raciocinio
      // grande significa que o modelo pensou e nao sobrou canal para escrever. Sem os dois
      // numeros no log, teto curto e modelo mudo parecem o mesmo defeito.
      const finish = String(body?.choices?.[0]?.finish_reason ?? "?");
      const raciocinio = Number(body?.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
      console.error(`[reco] conteudo vazio cand=${c.id} finish=${finish} raciocinio=${raciocinio}`);
      return rascunho(`openrouter_sem_conteudo (finish=${finish}, raciocinio=${raciocinio})`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[reco] json invalido cand=${c.id} bruto=${raw.slice(0, 200)}`);
      return rascunho("openrouter_json_invalido");
    }
    const title = String(parsed?.title ?? "").trim() || c.title_draft;
    const description = String(parsed?.description ?? "").trim() || c.description_draft;
    const check = textContainsEvidence(description, c.evidence_json);
    if (!check.ok) {
      // Unica falha que NAO e defeito de orcamento: o modelo escreveu e citou numero fora da
      // evidencia. Continua rejeitada, e agora com nome proprio para nao se misturar as outras.
      return rascunho(
        `evidencia_rejeitada (fora=${check.missing.join(",")})`,
        " (redacao LLM rejeitada: numeros fora da evidencia)",
      );
    }
    return { title: title.slice(0, 200), description, used_llm: true, falha: null };
  } catch (e) {
    const abortado = (e as any)?.name === "AbortError";
    const falha = abortado
      ? `openrouter_timeout_${REDATOR_TIMEOUT_MS}`
      : `openrouter_excecao: ${String((e as any)?.message ?? e).slice(0, 160)}`;
    console.error(`[reco] ${falha} cand=${c.id}`);
    return rascunho(falha);
  } finally {
    clearTimeout(timer);
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
    return { id: c.id, ok: false, motivo: error.message, redator_falha: redigido.falha };
  }
  return {
    id: c.id,
    ok: true,
    result: data,
    used_llm: redigido.used_llm,
    // Card gravado com o rascunho do SQL continua sendo um card gravado — mas agora carrega
    // POR QUE o redator nao entrou, em vez de sair como se ninguem tivesse tentado.
    redator_falha: redigido.falha,
  };
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
    .limit(LOTE_MAX);

  if (error) return json({ error: error.message }, 500);

  const t0 = Date.now();
  const fila = (cands ?? []) as Candidate[];
  const results = [];
  let naoAlcancados = 0;
  for (const c of fila) {
    // Parede do lote. Sem isso o cron era morto no meio da fila e ninguem sabia quantos
    // candidatos ficaram para tras — a fila apenas parecia menor no dia seguinte.
    if (Date.now() - t0 > LOTE_PAREDE_MS) {
      naoAlcancados = fila.length - results.length;
      break;
    }
    results.push(await processCandidate(c));
  }

  // Contabilidade do redator, separada da contabilidade da escrita. Eram a mesma coisa antes,
  // e por isso um lote 100% sem redacao aparecia como lote 100% bem-sucedido.
  const falhas = results.filter((r) => r.redator_falha).map((r) => ({
    id: r.id,
    falha: r.redator_falha,
  }));
  const comLlm = results.filter((r) => r.used_llm).length;
  const tentativas = results.length;
  // Apagao do redator: houve trabalho, ninguem escreveu e a causa nao foi ausencia de chave.
  // Este e o estado que o banco mostra desde 25/08 e que a telemetria chamava de sucesso.
  const apagao = tentativas > 0 && comLlm === 0 &&
    falhas.some((f) => f.falha !== "sem_chave_openrouter");

  const corpo = {
    ok: !apagao && naoAlcancados === 0,
    modo: body?.modo ?? "diario",
    processados: tentativas,
    escritos: results.filter((r) => r.ok).length,
    rejeitados: results.filter((r) => !r.ok).length,
    redigidos_por_llm: comLlm,
    redator_apagao: apagao,
    redator_falhas: falhas,
    nao_alcancados_na_parede: naoAlcancados,
    lote_max: LOTE_MAX,
    duracao_ms: Date.now() - t0,
    detalhes: results,
  };
  // 502 e o unico canal que `conferir_execucoes_http` le: com 200 o desfecho vira `sucesso`
  // independente do conteudo. Os cards ja foram gravados — o status aqui nao desfaz trabalho,
  // ele impede que apagao do redator e lote saudavel fiquem com o mesmo carimbo.
  if (apagao || naoAlcancados > 0) return json(corpo, 502);
  return json(corpo);
});
