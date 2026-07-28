// supabase/functions/meta-actions/index.ts (v2) — F4.2 + criação
// v2 — ACOES DE CRIACAO. O v1 sabia MODIFICAR objeto existente (POST /{id}); criar e
// diferente em quatro pontos que exigiram caminho proprio:
//   (a) nao existe target_external_id: o alvo e a CONTA, e o v1 falhava sem esse campo;
//   (b) o endpoint e de COLECAO (POST /act_X/campaigns), nao de objeto;
//   (c) existem 20 contas meta_ads em integrations - criar na conta errada nao tem reversa
//       simples, por isso toda criacao valida a conta contra meta_execution_config
//       .contas_permitidas_criacao e RECUSA se nao estiver na lista;
//   (d) configuracao de conjunto (optimization_goal, billing_event, promoted_object,
//       destination_type, targeting, attribution_spec) nao pode ser inventada. Por isso
//       conjunto e anuncio sao REPLICADOS: o executor LE o molde na Graph API e troca apenas
//       nome, destino, orcamento e status.
// TRAVAS (decisoes do Ryan, todas no codigo):
//   status=PAUSED forcado em tudo que nasce; special_ad_categories=['CREDIT'] forcado na
//   campanha; teto de sanidade de orcamento; 3 camadas (master + flag + rate) preservadas;
//   dry_run mostra exatamente o que criaria sem escrever nada.
// UTM: o anuncio novo recebe url_tags gerado pelo traffic-chat. Como creative existente e
//   imutavel, criamos um adcreative NOVO reaproveitando o object_story_spec do molde (sem
//   upload de midia) so para poder aplicar as UTMs. Se o molde nao expuser object_story_spec
//   (tipico de Advantage+ com asset_feed_spec), reusamos o creative_id e DECLARAMOS que as
//   UTMs serao as do molde - degradar com aviso, nunca silenciosamente.
// v1: executor da fila de aprovações (pausar_criativo, pausar_campanha, alterar_orcamento).
//   escalar_criativo segue NAO automatizado (pulado com nota — decisão manual).
// Token: META_ADS_TOKEN (redigido de qualquer saída). Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const EXECUTAVEIS = ["pausar_criativo", "pausar_campanha", "alterar_orcamento"];
const CRIACAO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s.split(TOKEN).join("[TOKEN-REDACTED]").replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), { status, headers: { "content-type": "application/json" } });
}
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const form = new URLSearchParams({ ...(body ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r = method === "GET"
    ? await fetch(`${GRAPH}${path}${sep}${form.toString()}`)
    : await fetch(`${GRAPH}${path}`, { method, body: form });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(redact(t)) }; } catch { return { status: r.status, body: redact(t.slice(0, 300)) }; }
}
async function audit(companyId: string, userId: string, action: string, approvalId: string, details: unknown) {
  await supa.from("audit_log").insert({
    company_id: companyId, user_id: userId, action, target_type: "approval_request", target_id: approvalId,
    details: JSON.parse(redact(JSON.stringify(details))),
  });
}
// v2: normaliza act_123 e 123 para o mesmo formato, porque integrations guarda sem prefixo
// e a lista branca guarda com prefixo.
const actId = (v: string) => { const s = String(v ?? "").trim(); return s.startsWith("act_") ? s : `act_${s}`; };

// v2: monta o corpo de criacao lendo o molde quando necessario. Retorna o path de colecao,
// o body do POST e, opcionalmente, um passo previo (criacao de adcreative).
async function montarCriacao(acao: string, p: any, conta: string, tetoSanidade: number) {
  if (acao === "criar_campanha") {
    const nome = String(p?.nome_novo ?? "").trim();
    if (!nome) return { erro: "payload sem nome_novo" };
    return {
      path: `/${conta}/campaigns`,
      body: {
        name: nome,
        objective: String(p?.objetivo ?? "OUTCOME_LEADS"),
        status: "PAUSED",                                  // TRAVA 1
        special_ad_categories: JSON.stringify(["CREDIT"]),  // TRAVA 2 (forcado, nao vem do payload)
        buying_type: "AUCTION",
      } as Record<string, string>,
    };
  }

  if (acao === "criar_conjunto_a_partir_de") {
    const molde = String(p?.molde_external_id ?? "");
    const campanha = String(p?.campanha_destino_external_id ?? "");
    const nome = String(p?.nome_novo ?? "").trim();
    const reais = Number(p?.orcamento_diario_reais ?? 0);
    if (!molde || !campanha || !nome) return { erro: "payload incompleto (molde_external_id, campanha_destino_external_id, nome_novo)" };
    if (!(reais > 0)) return { erro: "orcamento_diario_reais ausente ou invalido" };
    if (reais > tetoSanidade) return { erro: `orcamento ${reais} acima do teto de sanidade ${tetoSanidade}` };

    const campos = ["optimization_goal", "billing_event", "bid_strategy", "targeting", "promoted_object",
      "destination_type", "attribution_spec", "bid_amount", "dsa_beneficiary", "dsa_payor"].join(",");
    const m = await g(`/${molde}?fields=${campos}`);
    if (m.status !== 200) return { erro: "falha ao ler o conjunto molde na Meta", detalhe: m.body };
    const mb: any = m.body ?? {};

    const body: Record<string, string> = {
      name: nome,
      campaign_id: campanha,
      daily_budget: String(Math.round(reais * 100)),   // centavos
      status: "PAUSED",                                 // TRAVA 1
    };
    // Replica apenas o que o molde realmente tem - nada e inventado.
    if (mb.optimization_goal) body.optimization_goal = String(mb.optimization_goal);
    if (mb.billing_event) body.billing_event = String(mb.billing_event);
    if (mb.bid_strategy) body.bid_strategy = String(mb.bid_strategy);
    if (mb.destination_type) body.destination_type = String(mb.destination_type);
    if (mb.bid_amount) body.bid_amount = String(mb.bid_amount);
    if (mb.targeting) body.targeting = JSON.stringify(mb.targeting);
    if (mb.promoted_object) body.promoted_object = JSON.stringify(mb.promoted_object);
    if (mb.attribution_spec) body.attribution_spec = JSON.stringify(mb.attribution_spec);
    if (mb.dsa_beneficiary) body.dsa_beneficiary = String(mb.dsa_beneficiary);
    if (mb.dsa_payor) body.dsa_payor = String(mb.dsa_payor);

    return { path: `/${conta}/adsets`, body, molde_lido: mb };
  }

  if (acao === "criar_anuncio_a_partir_de") {
    const creativeMolde = String(p?.creative_id ?? "");
    const adset = String(p?.conjunto_destino_external_id ?? "");
    const nome = String(p?.nome_novo ?? "").trim();
    const urlTags = String(p?.url_tags ?? "").trim();
    if (!creativeMolde || !adset || !nome) return { erro: "payload incompleto (creative_id, conjunto_destino_external_id, nome_novo)" };

    // Le o creative do molde para tentar recria-lo com as UTMs novas.
    const c = await g(`/${creativeMolde}?fields=object_story_spec,url_tags,name,degrees_of_freedom_spec`);
    const cb: any = c.body ?? {};
    const temStorySpec = c.status === 200 && cb.object_story_spec;

    return {
      path: `/${conta}/ads`,
      body: { name: nome, adset_id: adset, status: "PAUSED" } as Record<string, string>,
      criativo: temStorySpec
        ? { modo: "novo_adcreative", path: `/${conta}/adcreatives`,
            body: { name: `${nome} - creative`, object_story_spec: JSON.stringify(cb.object_story_spec),
                    ...(urlTags ? { url_tags: urlTags } : {}) } as Record<string, string> }
        : { modo: "reusar_creative_id", creative_id: creativeMolde,
            aviso: "O criativo do molde nao expoe object_story_spec (tipico de Advantage+ com asset_feed_spec), entao o anuncio novo REUSA o criativo original e herda as UTMs dele - a utm_campaign pedida NAO sera aplicada. Ajustar manualmente no Gerenciador se a rastreabilidade for necessaria." },
    };
  }

  return { erro: `acao de criacao desconhecida: ${acao}` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const provided = (req.headers.get("x-mcp-key") ?? "").trim();
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();
  if (!cfg?.api_key || provided !== cfg.api_key) return json({ error: "unauthorized" }, 401);

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const onlyId: string | null = body?.approval_id ?? null;

  const { data: conf } = await supa.from("meta_execution_config").select("*").eq("id", 1).single();
  if (!conf) return json({ error: "meta_execution_config ausente" }, 500);
  const contasOk: string[] = (conf.contas_permitidas_criacao ?? []).map((x: string) => actId(x));
  const tetoSanidade = Number(conf.teto_sanidade_orcamento_diario ?? 5000);

  let q = supa.from("approval_requests").select("*").eq("status", "approved").is("executed_at", null);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: fila } = await q.order("created_at", { ascending: true }).limit(10);
  if (!fila?.length) return json({ ok: true, processados: 0, nota: "fila vazia (nenhum aprovado pendente de execução)", config: { master: conf.master_enabled, dry_run: conf.dry_run } });

  const { count: naHora } = await supa.from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "meta_action_executed")
    .gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  let executadasNaHora = naHora ?? 0;

  const resultados: any[] = [];
  for (const r of fila) {
    const acao = String(r.action);
    const alvoExt = String(r.payload?.target_external_id ?? "");
    const alvoNome = String(r.payload?.target_name ?? r.summary);
    const sistema = r.reviewed_by ?? r.requested_by;
    const flagsOk = conf.master_enabled === true && conf.action_flags?.[acao] === true;
    const rateOk = executadasNaHora < conf.max_actions_per_hour;

    // ==================== CAMINHO DE CRIACAO (v2) ====================
    if (CRIACAO.includes(acao)) {
      // v2: expiracao - cards vencidos ja viram 'rejected' pelo cron, mas checamos de novo
      // porque aprovacao antiga executando contra conta mudada e o risco que motivou o prazo.
      if (r.expires_at && new Date(r.expires_at) < new Date()) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo: "pedido expirado", acao, prazo: r.expires_at });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo: "pedido expirado (24h)" });
        continue;
      }

      const conta = actId(String(r.payload?.conta_destino ?? ""));
      if (!contasOk.length || !contasOk.includes(conta)) {
        const motivo = `conta de destino ${conta || "(vazia)"} nao esta na lista de contas permitidas para criacao`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao, contas_permitidas: contasOk });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo });
        continue;
      }

      const plano = await montarCriacao(acao, r.payload, conta, tetoSanidade);
      if ((plano as any).erro) {
        await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: (plano as any).erro, detalhe: (plano as any).detalhe ?? null, acao });
        resultados.push({ id: r.id, acao, resultado: "falha", motivo: (plano as any).erro });
        continue;
      }
      const pl: any = plano;

      if (conf.dry_run) {
        await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
          SIMULADO: true, acao, conta, criaria_em: pl.path, com_body: pl.body,
          criativo: pl.criativo ?? null, molde_lido: pl.molde_lido ?? null,
          flags_permitiriam: { master: conf.master_enabled, flag_acao: conf.action_flags?.[acao] === true, rate_ok: rateOk },
          nota: "dry_run=true: NADA foi criado na Meta; executed_at NÃO preenchido",
        });
        resultados.push({ id: r.id, acao, resultado: "SIMULADO", conta, criaria_em: pl.path,
          nome_novo: pl.body?.name, status_inicial: pl.body?.status,
          criativo_modo: pl.criativo?.modo ?? null, criativo_aviso: pl.criativo?.aviso ?? null,
          flags_permitiriam: flagsOk && rateOk });
        continue;
      }

      if (!flagsOk || !rateOk) {
        const motivo = !conf.master_enabled ? "master_enabled=false" : (conf.action_flags?.[acao] !== true ? `flag ${acao}=false` : "rate limit atingido");
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo });
        continue;
      }

      // Passo previo: criar adcreative novo (so no caso do anuncio com object_story_spec).
      const bodyFinal: Record<string, string> = { ...pl.body };
      let creativeCriado: any = null;
      if (pl.criativo?.modo === "novo_adcreative") {
        const cc = await g(pl.criativo.path, "POST", pl.criativo.body);
        if (cc.status !== 200 || !(cc.body as any)?.id) {
          await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: "falha ao criar adcreative", resposta_meta: cc, acao });
          resultados.push({ id: r.id, acao, resultado: "falha_meta", etapa: "adcreative", detalhe: cc.body });
          continue;
        }
        creativeCriado = (cc.body as any).id;
        bodyFinal.creative = JSON.stringify({ creative_id: creativeCriado });
      } else if (pl.criativo?.modo === "reusar_creative_id") {
        bodyFinal.creative = JSON.stringify({ creative_id: pl.criativo.creative_id });
      }

      const exec = await g(pl.path, "POST", bodyFinal);
      const novoId = (exec.body as any)?.id ?? null;
      const sucesso = exec.status === 200 && !!novoId;
      // Confere o estado do que nasceu: a trava de PAUSED precisa ser verificada, nao assumida.
      const depois = sucesso ? await g(`/${novoId}?fields=name,status,effective_status`) : { status: 0, body: null };

      await audit(r.company_id, sistema, sucesso ? "meta_action_executed" : "meta_action_failed", r.id, {
        acao, conta, criado_em: pl.path, body_enviado: bodyFinal, adcreative_criado: creativeCriado,
        resposta_meta: exec, objeto_criado: depois.body, criativo_aviso: pl.criativo?.aviso ?? null,
      });

      if (sucesso) {
        executadasNaHora++;
        await supa.from("approval_requests").update({
          executed_at: new Date().toISOString(),
          execution_result: { ok: true, id_criado: novoId, objeto: depois.body,
            adcreative_criado: creativeCriado, aviso: pl.criativo?.aviso ?? null,
            lembrete: "Objeto criado PAUSADO. Precisa ser ativado manualmente no Gerenciador." },
        }).eq("id", r.id);
      }
      resultados.push({ id: r.id, acao, resultado: sucesso ? "CRIADO" : "falha_meta",
        id_criado: novoId, status: (depois.body as any)?.status ?? null,
        aviso: pl.criativo?.aviso ?? null, detalhe: sucesso ? null : exec.body });
      continue;
    }

    // ==================== CAMINHO v1: MODIFICAR EXISTENTE ====================
    if (!EXECUTAVEIS.includes(acao)) {
      resultados.push({ id: r.id, acao, resultado: "pulado", motivo: "ação não automatizada (decisão manual)" });
      continue;
    }
    if (!alvoExt) {
      resultados.push({ id: r.id, acao, resultado: "falha", motivo: "payload sem target_external_id" });
      await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: "sem target_external_id", acao });
      continue;
    }
    if (r.expires_at && new Date(r.expires_at) < new Date()) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo: "pedido expirado", acao, prazo: r.expires_at });
      resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo: "pedido expirado (24h)" });
      continue;
    }

    const antes = await g(`/${alvoExt}?fields=name,status,effective_status,daily_budget`);

    let post: Record<string, string> | null = null;
    if (acao === "pausar_criativo" || acao === "pausar_campanha") post = { status: "PAUSED" };
    if (acao === "alterar_orcamento") {
      const reais = Number(r.payload?.novo_orcamento_diario_reais ?? 0);
      if (!(reais > 0)) {
        resultados.push({ id: r.id, acao, resultado: "falha", motivo: "novo_orcamento_diario_reais ausente/inválido" });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, { motivo: "orcamento invalido", payload: r.payload });
        continue;
      }
      // v2: teto de sanidade tambem na alteracao - a confusao reais/centavos vale aqui igual.
      if (reais > tetoSanidade) {
        const motivo = `orcamento ${reais} acima do teto de sanidade ${tetoSanidade}`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao, payload: r.payload });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo });
        continue;
      }
      post = { daily_budget: String(Math.round(reais * 100)) };
    }

    if (conf.dry_run) {
      await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
        SIMULADO: true, acao, alvo: alvoNome, alvo_external_id: alvoExt,
        chamaria: post, estado_atual_meta: antes.body,
        flags_permitiriam: { master: conf.master_enabled, flag_acao: conf.action_flags?.[acao] === true, rate_ok: rateOk },
        nota: "dry_run=true: NADA foi enviado à Meta; executed_at NÃO preenchido",
      });
      resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: "SIMULADO", chamaria: post, estado_atual: (antes.body as any)?.status, flags_permitiriam: flagsOk && rateOk });
      continue;
    }

    if (!flagsOk || !rateOk) {
      const motivo = !conf.master_enabled ? "master_enabled=false" : (conf.action_flags?.[acao] !== true ? `flag ${acao}=false` : "rate limit atingido");
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao, alvo: alvoNome });
      resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: "bloqueado", motivo });
      continue;
    }
    const exec = await g(`/${alvoExt}`, "POST", post!);
    const depois = await g(`/${alvoExt}?fields=name,status,effective_status,daily_budget`);
    const sucesso = exec.status === 200;
    await audit(r.company_id, sistema, sucesso ? "meta_action_executed" : "meta_action_failed", r.id, {
      acao, alvo: alvoNome, alvo_external_id: alvoExt, chamada: post, resposta_meta: exec, antes: antes.body, depois: depois.body,
    });
    if (sucesso) {
      executadasNaHora++;
      await supa.from("approval_requests").update({
        executed_at: new Date().toISOString(),
        execution_result: { ok: true, antes: antes.body, depois: depois.body },
      }).eq("id", r.id);
    }
    resultados.push({ id: r.id, acao, alvo: alvoNome, resultado: sucesso ? "EXECUTADO" : "falha_meta", antes: (antes.body as any)?.status, depois: (depois.body as any)?.status });
  }

  return json({ ok: true, modo: conf.dry_run ? "DRY-RUN" : "REAL", processados: resultados.length, resultados,
    config: { master: conf.master_enabled, dry_run: conf.dry_run, flags: conf.action_flags,
      max_por_hora: conf.max_actions_per_hour, contas_permitidas_criacao: contasOk,
      teto_sanidade_orcamento: tetoSanidade } });
});