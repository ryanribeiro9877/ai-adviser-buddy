// Recortes diarios de midia (idade, genero, plataforma) pelo Pipeboard.
//
// POR QUE ESTA EDGE EXISTE. metric_breakdown_daily era alimentada pela Windsor e parou em
// 13/08/2026, quando a Windsor foi encerrada. Ninguem percebeu por 23 dias porque o vigia de
// rotina olhava EXECUCAO e nao DADO, e a tarefa que trazia o recorte nem existia no registro.
// O digest continuou afirmando no presente que o sistema "tem" recorte por idade e genero.
//
// O QUE FOI MEDIDO ANTES DE ESCREVER ISTO (05/09/2026, tools/list + quatro chamadas reais pelo
// proxy pipeboard-read, requests 10627/10630/10631/10632/10634):
//   - get_insights aceita `breakdown` (singular) no schema, e devolve os segmentos com a chave
//     do recorte DENTRO de metrics: metrics.age="25-34", metrics.gender="female",
//     metrics.publisher_platform="instagram".
//   - Os valores voltam com a MESMA grafia que a Windsor gravava ("18-24".."65+", "female" /
//     "male"), entao os leitores da tabela nao precisam de tradutor nem de migracao de dado.
//   - get_insights NAO tem `fields` no schema: o conjunto de metricas dele e fixo e nao inclui
//     os tres rankings de qualidade. Quem aceita `fields` e bulk_get_insights. Por isso os
//     rankings sao problema do pipeboard-metrics-sync (dono de ad_metric_snapshots) e nao desta
//     edge, que so escreve em metric_breakdown_daily.
//
// UM DIA POR CHAMADA, DE PROPOSITO. O `limit` do conector corta SEGMENTOS, e segmento aqui e
// (anuncio x dia x valor do recorte). Numa janela de tres dias, uma conta com 358 anuncios e
// sete faixas de idade passa de 7.500 segmentos e o corte chegaria calado — perda de dado com
// cara de coleta completa, que e o formato de defeito que esta entrega existe para acabar. Um
// dia por chamada mantem o numero na casa das centenas e, quando ainda assim bater no teto, o
// relatorio diz `teto_atingido` em vez de omitir.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardCall, pipeboardToken } from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FONTE = "pipeboard:meta";
const LIMITE_SEGMENTOS = 1000;

/**
 * Recortes coletados. `chave` e o nome do argumento do conector E o nome do campo que ele
 * devolve dentro de metrics; `tipo` e o valor gravado em metric_breakdown_daily.tipo_recorte,
 * que tem CHECK em ('idade','genero','plataforma','posicionamento').
 */
const RECORTES = [
  { chave: "age", tipo: "idade" },
  { chave: "gender", tipo: "genero" },
  { chave: "publisher_platform", tipo: "plataforma" },
] as const;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isoDate(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function numero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inteiro(value: unknown): number {
  return Math.round(numero(value));
}

function acao(row: any, tipos: string[]): number {
  const quer = new Set(tipos);
  const lista = Array.isArray(row?.actions) ? row.actions : [];
  let total = 0;
  for (const item of lista) {
    if (quer.has(String(item?.action_type ?? item?.type ?? ""))) total += numero(item?.value);
  }
  return total;
}

/** Desembrulha as camadas que o conector empilha e devolve os `metrics` de cada segmento. */
function segmentos(value: any, profundidade = 0): any[] {
  if (profundidade > 5 || value == null) return [];
  if (typeof value === "string") {
    try {
      return segmentos(JSON.parse(value), profundidade + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => segmentos(item, profundidade + 1));
  if (typeof value !== "object") return [];
  if (Array.isArray(value.segmented_metrics)) {
    return value.segmented_metrics
      .map((s: any) => (s && typeof s === "object" ? (s.metrics ?? s) : null))
      .filter((s: any) => s && typeof s === "object");
  }
  for (const chave of ["resultado", "result", "data", "results"]) {
    if (value[chave] != null) {
      const achado = segmentos(value[chave], profundidade + 1);
      if (achado.length) return achado;
    }
  }
  return [];
}

/**
 * Linha de metric_breakdown_daily a partir de um segmento.
 *
 * `reach` fica NULO quando o conector nao devolve o campo, e nunca zero: a tabela permite nulo
 * exatamente porque "nao veio" e "ninguem foi alcancado" sao fatos diferentes — a mesma
 * distincao que 20260804140430 ja tinha gravado para o recorte da Windsor.
 */
function mapear(seg: any, companyId: string, tipo: string, chave: string, contaPadrao: string) {
  const adId = String(seg?.ad_id ?? "").trim();
  const dia = isoDate(seg?.date_start ?? seg?.date ?? seg?.period);
  const valor = String(seg?.[chave] ?? "").trim();
  if (!adId || !dia || !valor) return null;
  return {
    company_id: companyId,
    ad_external_id: adId,
    campaign_external_id: String(seg?.campaign_id ?? "").trim() || null,
    account_id: String(seg?.account_id ?? contaPadrao).replace(/^act_/, ""),
    snapshot_date: dia,
    tipo_recorte: tipo,
    valor_recorte: valor,
    spend: numero(seg?.spend),
    impressions: inteiro(seg?.impressions),
    reach: seg?.reach == null ? null : inteiro(seg.reach),
    clicks: inteiro(seg?.clicks),
    link_clicks: inteiro(acao(seg, ["link_click"])),
    landing_page_views: inteiro(acao(seg, ["landing_page_view"])),
    form_leads: inteiro(acao(seg, ["lead", "onsite_conversion.lead_grouped"])),
    messaging_started: inteiro(
      acao(seg, [
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_conversion_messaging_conversation_started_7d",
      ]),
    ),
    fonte: FONTE,
  };
}

/**
 * `pipeboardCall` decide `ok` por `success===true` ou por id do objeto criado — criterio de
 * ESCRITA. Leitura nao devolve nem um nem outro, entao o ok dele e sempre falso aqui. O veredito
 * de leitura e o do HTTP mais a ausencia de erro no corpo, igual ao que pipeboard-metrics-sync
 * ja faz com o proprio callTool.
 */
async function ler(args: Record<string, unknown>, token: string) {
  const r = await pipeboardCall("get_insights", args, token);
  const erroCorpo = r.erro ?? (r.body as { error?: unknown } | null)?.error;
  const ok = r.status >= 200 && r.status < 300 && !erroCorpo;
  return { ok, status: r.status, body: r.body, erro: ok ? null : String(erroCorpo ?? `http_${r.status}`) };
}

/** Conta sem permissao devolve o mesmo erro em toda chamada: insistir so gasta o relogio. */
function semPermissao(erro: string | null): boolean {
  return !!erro && /does not have access to account/i.test(erro);
}

function dias(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${de}T00:00:00Z`); d <= new Date(`${ate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length >= 31) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Corpo vazio usa a janela padrao.
  }

  const { data: segredo } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  const token = await pipeboardToken(async () => String(segredo?.value ?? ""));
  if (!token) return json({ ok: false, error: "missing_pipeboard_api_token" }, 400);

  const hoje = new Date().toISOString().slice(0, 10);
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dataDe = isoDate(body?.date_from) ?? ontem;
  const dataAte = isoDate(body?.date_to) ?? hoje;
  if (dataDe > dataAte) return json({ error: "date_from posterior a date_to" }, 400);

  const { data: integracoes, error: erroIntegracoes } = await supa
    .from("integrations")
    .select("company_id, external_id, status")
    .eq("provider", "meta_ads")
    .not("external_id", "is", null);
  if (erroIntegracoes) {
    return json({ error: "integrations_read_failed", detail: erroIntegracoes.message }, 500);
  }

  const pedidas = Array.isArray(body?.account_ids)
    ? new Set(body.account_ids.map((v: unknown) => String(v).replace(/^act_/, "")))
    : null;
  const ativas = (integracoes ?? []).filter((i: any) =>
    i.external_id && i.status !== "disabled" &&
    (!pedidas || pedidas.has(String(i.external_id).replace(/^act_/, "")))
  );

  const janela = dias(dataDe, dataAte);
  const relatorio: any[] = [];
  let gravadas = 0;
  let tetoAtingido = 0;

  for (const integracao of ativas) {
    const conta = String(integracao.external_id).replace(/^act_/, "");
    const companyId = String(integracao.company_id);
    const porTipo: Record<string, number> = {};
    const linhas = new Map<string, any>();
    let erroConta: string | null = null;
    let chamadas = 0;

    for (const dia of janela) {
      if (erroConta) break;
      const respostas = await Promise.all(
        RECORTES.map((r) =>
          ler({
            object_id: `act_${conta}`,
            level: "ad",
            breakdown: r.chave,
            time_range: { since: dia, until: dia },
            time_breakdown: "day",
            limit: LIMITE_SEGMENTOS,
          }, token).then((resposta) => ({ recorte: r, resposta }))
        ),
      );
      chamadas += respostas.length;

      for (const { recorte, resposta } of respostas) {
        if (!resposta.ok) {
          // A primeira negativa de permissao encerra a conta: as outras 3N chamadas trariam
          // a mesma frase e so consumiriam o prazo das contas que funcionam.
          if (semPermissao(resposta.erro)) {
            erroConta = resposta.erro;
            break;
          }
          erroConta = erroConta ?? resposta.erro;
          continue;
        }
        const segs = segmentos(resposta.body);
        if (segs.length >= LIMITE_SEGMENTOS) tetoAtingido += 1;
        for (const seg of segs) {
          const linha = mapear(seg, companyId, recorte.tipo, recorte.chave, conta);
          if (!linha) continue;
          linhas.set(
            `${linha.ad_external_id}:${linha.snapshot_date}:${linha.tipo_recorte}:${linha.valor_recorte}`,
            linha,
          );
          porTipo[recorte.tipo] = (porTipo[recorte.tipo] ?? 0) + 1;
        }
      }
    }

    const lote = [...linhas.values()];
    let gravadasConta = 0;
    for (let i = 0; i < lote.length; i += 500) {
      const parte = lote.slice(i, i + 500);
      const { error } = await supa
        .from("metric_breakdown_daily")
        .upsert(parte, { onConflict: "ad_external_id,snapshot_date,tipo_recorte,valor_recorte" });
      if (error) {
        erroConta = `upsert_falhou: ${error.message}`;
        break;
      }
      gravadasConta += parte.length;
    }
    gravadas += gravadasConta;

    relatorio.push({
      account_id: conta,
      company_id: companyId,
      chamadas,
      segmentos_por_recorte: porTipo,
      linhas_unicas: lote.length,
      gravadas: gravadasConta,
      error: erroConta,
    });
  }

  // A rodada so e `ok` quando TODA conta com permissao fechou sem erro. Conta negada continua
  // sendo erro visivel: ela e o motivo de 13 das 19 contas nao terem metrica hoje, e um ok:true
  // aqui repetiria o silencio que esta entrega desfaz.
  const comErro = relatorio.filter((r) => r.error);
  return json({
    ok: comErro.length === 0,
    fonte: FONTE,
    destino: "metric_breakdown_daily",
    recortes: RECORTES.map((r) => `${r.chave} -> ${r.tipo}`),
    window: { date_from: dataDe, date_to: dataAte, dias: janela.length },
    contas: ativas.length,
    contas_com_erro: comErro.length,
    total_gravadas: gravadas,
    teto_de_segmentos_atingido: tetoAtingido,
    aviso_teto: tetoAtingido > 0
      ? `Em ${tetoAtingido} chamada(s) o conector devolveu o maximo de ${LIMITE_SEGMENTOS} segmentos: pode haver recorte faltando nesse dia.`
      : null,
    report: relatorio,
  });
});
