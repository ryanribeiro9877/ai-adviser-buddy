// esm.sh, nao npm:, para casar com _shared/mcp_auth.ts e com as outras 22 edges.
// Com o especificador npm: o Deno resolvia pelo node_modules do repo e o
// SupabaseClient resultante era um tipo nominalmente diferente do que
// mcpKeyValida espera - o deno check nao passava nesta edge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { situacaoDoCard } from "../_shared/aprovacoes.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const SERVER_INFO = { name: "gestao-marketing-mcp", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-mcp-key, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function toolText(data: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    isError,
  };
}

async function checkAuth(req: Request): Promise<boolean> {
  const auth = await mcpKeyValida(db, chaveMcpDe(req, "header-or-bearer"));
  return auth.ok;
}

function derive(r: Record<string, unknown>) {
  const n = (v: unknown) => Number(v ?? 0);
  const spend = n(r.spend), leads = n(r.leads), sales = n(r.sales),
    revenue = n(r.revenue), clicks = n(r.clicks), impressions = n(r.impressions);
  return {
    cpl: leads ? +(spend / leads).toFixed(2) : null,
    cpa: sales ? +(spend / sales).toFixed(2) : null,
    roas: spend ? +(revenue / spend).toFixed(2) : null,
    ctr: impressions ? +((clicks / impressions) * 100).toFixed(2) : null,
  };
}

const sinceDate = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

const TOOLS = [
  { name: "list_companies", description: "Lista as empresas (clientes) cadastradas.", inputSchema: { type: "object", properties: {} } },
  { name: "list_campaigns", description: "Lista campanhas com metricas atuais e derivadas (CPL, CPA, ROAS, CTR). Filtros opcionais por empresa e status.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, status: { type: "string" } } } },
  { name: "get_campaign_timeseries", description: "Serie temporal diaria de metricas de UMA campanha (metric_snapshots). Base para tendencia e comparacao de periodo.", inputSchema: { type: "object", properties: { campaign_id: { type: "string" }, days: { type: "number" } }, required: ["campaign_id"] } },
  { name: "get_portfolio_summary", description: "Resumo agregado do periodo (spend, leads, revenue + CPL/ROAS derivados) a partir dos snapshots.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, days: { type: "number" } } } },
  { name: "list_alerts", description: "Lista alertas disparados. Por padrao apenas os nao resolvidos.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, only_unresolved: { type: "boolean" } } } },
  { name: "list_alert_rules", description: "Lista as regras de alerta (thresholds) configuradas.", inputSchema: { type: "object", properties: { company_id: { type: "string" } } } },
  { name: "list_approvals", description: "Lista solicitacoes de alteracao na fila de aprovacao. Por padrao as pendentes.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, status: { type: "string" } } } },
  { name: "list_recommendations", description: "Lista recomendacoes de IA registradas.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, status: { type: "string" } } } },
  { name: "list_integrations", description: "Lista integracoes de contas de anuncio e status de conexao (meta_ads, google_ads, ga4, gsc, gtm).", inputSchema: { type: "object", properties: { company_id: { type: "string" } } } },
  { name: "teto_vigente", description: "FONTE PRIORITARIA para teto vigente. Exige company_id e metric. Declara qual regua governa, valor, denominador, autor/data/citacao da meta de negocio, consistencia historica, aspiracao e divergencias/avisos. Targets isolado NAO e veredito de negocio.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, metric: { type: "string" } }, required: ["company_id", "metric"] } },
  { name: "checar_par_texto_e_peca", description: "Avalia legenda + peca juntas no company_id pela concatenacao do texto disponivel. Devolve PAR, leituras separadas, cobertura e lacunas. E deteccao por padroes, NAO aprovacao; audio sem transcricao fica explicitamente nao lido.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, legenda: { type: "string" }, drive_file_id: { type: "string" } }, required: ["company_id", "legenda", "drive_file_id"] } },
  { name: "saude_das_integracoes", description: "Mede integracoes Meta do company_id por evidencia de ads, snapshots, breakdown e tres relogios. Declara divergencias com status/estado_operacional sem altera-los; nao promete diagnosticar provedores fora do retorno.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, dias_tolerancia: { type: "integer", description: "Opcional; padrao 3." } }, required: ["company_id"] } },
  { name: "custo_llm_periodo", description: "Calcula em USD o custo derivado dos tokens gravados de chat e jobs do company_id no periodo. Nao e fatura. Declara premissa de modelos e lacunas: cache-teto, subagentes sem tokens e visao/compliance-check invisiveis.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, de: { type: "string", description: "YYYY-MM-DD" }, ate: { type: "string", description: "YYYY-MM-DD" } }, required: ["company_id", "de", "ate"] } },
  { name: "panorama_utm_anuncios", description: "Mostra no company_id a coleta de url_tags e destino: nunca lido, lido sem/com rotulo, rotulos, ambiguidades e URLs. Distingue ausencia configurada de nao coleta quando o retorno permite. Nao mede leads por UTM; token alcanca so parte das contas.", inputSchema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
  { name: "nota_visual_da_peca", description: "Retorna nota visual textual de uma peca no company_id: revisao aberta, base, produto, aproveitabilidade, risco, motivo e divergencia. Informa, nao aprova; ausencia de leitura nao e ausencia de risco.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, drive_file_id: { type: "string" } }, required: ["company_id", "drive_file_id"] } },
  { name: "registrar_veredito_peca_em_revisao", description: "PROPOE veredito de compliance emitindo um CARD DE APROVACAO. NAO decide e NAO libera: a peca segue impedida ate um administrador aprovar na tela, e a assinatura gravada e a de quem aprovar (resolvida por auth.users). veredito_por entra so como autor_sugerido, sem valor de decisao. liberado_como_esta libera SE aprovado; ajustar_peca/nao_usar mantem o bloqueio. Proposta pendente ja existente e recusada. Nao faca UPDATE a mao.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, drive_file_id: { type: "string" }, veredito: { type: "string", enum: ["liberado_como_esta", "ajustar_peca", "nao_usar"] }, veredito_por: { type: "string", description: "Opcional: quem pediu. Informativo, nao assinatura." }, nota: { type: "string" } }, required: ["company_id", "drive_file_id", "veredito"] } },
  { name: "get_acervo_para_anuncio", description: "LEITURA TOTAL do acervo Drive no company_id. Devolve taxonomia_drive + inventario_global SEMPRE (19 videos=10 Educacao financeira+9 Caminho Triste/feliz; Capas; 9 Carrosseis; 4 Cards instrucionais). Em lote/mix chame SEM produto primeiro. apta=true so = pronta pra publicar agora; NAO use para afirmar escassez. Slides Carrossel = imagem estatica. Cards = leia a legenda. Capas inventariar. Bloqueadas = legiveis via veredito.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, produto: { type: "string" }, incluir_inaptas: { type: "boolean" } }, required: ["company_id"] } },
  { name: "upload_midia", description: "Sobe UMA peca do Drive (imagem ou video) para a biblioteca Meta via edge upload-midia (adimages/advideos) e grava meta_image_hash ou meta_video_id. USE quando get_acervo_para_anuncio mostrar na_biblioteca_da_meta=false. NAO cria anuncio. Respeita flag upload_midia e teto 5/hora. Idempotente. Video pode devolver id antes de ready - nao emita card ate pronto=true.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, drive_file_id: { type: "string" }, account_id: { type: "string" } }, required: ["company_id", "drive_file_id"] } },
  { name: "diagnosticar_custo", description: "Diagnostica por que o custo por formulario de um anuncio subiu, comparando o ultimo dia com entrega aos 3 anteriores. Exige company_id e ad_external_id. Devolve sinal, causa, acao, confirmacao, medidas e guarda de maturacao; sem base nao conclui, e problema depois do clique e apenas apontado porque esta fora do escopo.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, ad_external_id: { type: "string" } }, required: ["company_id", "ad_external_id"] } },
  { name: "avaliar_fadiga", description: "Avalia se uma peca cansou, teve queda sem saturacao, esta com frequencia alta antes da queda ou nao tem sinal de fadiga. Exige company_id e ad_external_id. Sem entrega/base nao conclui; usa frequencia DIARIA e declara que frequencia deduplicada de 30 dias nao pode ser derivada das linhas diarias.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, ad_external_id: { type: "string" } }, required: ["company_id", "ad_external_id"] } },
  { name: "pode_pausar_por_custo", description: "Verifica se um anuncio pode ser avaliado para pausa por custo: libera quando maduro ou pela excecao dura de zero resultado, CTR baixo e piso de gasto. Exige company_id e ad_external_id. Nao verifica a guarda do unico conjunto/alternativa ativa; permitido aqui NAO significa seguro pausar.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, ad_external_id: { type: "string" } }, required: ["company_id", "ad_external_id"] } },
  { name: "decidir_sobre_conjunto", description: "Decide manter, maturar, trocar criativo ou preparar reversao para um conjunto usando custo, volume e tendencia. Exige company_id e adset_external_id. A guarda do unico conjunto entregando sobrescreve pausa. Declara a lacuna: sem regua de IDEAL separada do teto, esta funcao nao prescreve escala.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, adset_external_id: { type: "string" } }, required: ["company_id", "adset_external_id"] } },
  { name: "avaliar_escala", description: "Avalia se um conjunto esta apto a escala por duplicacao com no maximo +20%, usando a arvore de decisao, custo ate 80% do teto, volume e espera. Exige company_id e adset_external_id. Nao cobre CBO sem orcamento proprio; a espera enxerga apenas escalas registradas pelo sistema, nao alteracoes manuais.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, adset_external_id: { type: "string" } }, required: ["company_id", "adset_external_id"] } },
  { name: "avaliar_pacing", description: "Calcula capacidade diaria da estrutura e, se meta_leads_dia for informada, o PISO de verba diaria ao custo atual. Exige company_id; meta_leads_dia e opcional. Declara que nao existe meta registrada e que a projecao nao e estimativa: escalar tende a elevar o custo, portanto a verba real pode ser maior.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, meta_leads_dia: { type: "number" } }, required: ["company_id"] } },
  { name: "validar_pedido_contra_contrato", description: "Valida pedido jsonb contra contrato_de_execucao. Assinatura real: (acao text, pedido jsonb). contrato_desconhecido se nao houver linhas; recusa se faltar obrigatorio; extras nao invalidam (vao em nao_previstos_no_contrato). Lacunas: contrato de anuncio veio do codigo montarCriacao, nao de card executado; url_tags e opcional e vai no adcreative; NAO substitui pedido_de_anuncio_completo.", inputSchema: { type: "object", properties: { acao: { type: "string" }, pedido: { type: "object" } }, required: ["acao", "pedido"] } },
  { name: "renomear_campanha", description: "Emite card de aprovacao para renomear campanha existente via Pipeboard update_campaign. Nao executa antes da aprovacao humana. Exige driver Pipeboard e flag renomear_campanha; envia somente campaign_id + name e reconcilia pela Graph.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, campanha_atual: { type: "string" }, novo_nome: { type: "string" }, justificativa: { type: "string" } }, required: ["company_id", "campanha_atual", "novo_nome"] } },
  { name: "alterar_categoria_especial", description: "Emite card de aprovacao para alterar ou remover special_ad_categories de campanha existente (Graph/Pipeboard update_campaign). special_ad_categories=[] remove a marca. Nao executa antes da aprovacao humana.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, campanha_atual: { type: "string" }, special_ad_categories: { type: "array", items: { type: "string" }, description: "Array desejado; [] remove" }, justificativa: { type: "string" } }, required: ["company_id", "campanha_atual", "special_ad_categories"] } },
  { name: "create_approval_request", description: "PROPOE uma alteracao (campaign|budget|ad|audience|config). Entra na fila como pending. NADA e executado ate um humano aprovar no painel.", inputSchema: { type: "object", properties: { company_id: { type: "string" }, entity_type: { type: "string", enum: ["campaign", "budget", "ad", "audience", "config"] }, action: { type: "string" }, summary: { type: "string" }, payload: { type: "object" } }, required: ["company_id", "entity_type", "action", "summary"] } },
  { name: "create_alert_rule", description: "Cria uma regra de alerta com threshold (ex.: CPL > 50 na janela de 7 dias).", inputSchema: { type: "object", properties: { company_id: { type: "string" }, name: { type: "string" }, metric: { type: "string" }, comparator: { type: "string", enum: [">", "<", ">=", "<=", "pct_change_up", "pct_change_down"] }, threshold: { type: "number" }, window_days: { type: "number" }, severity: { type: "string", enum: ["low", "medium", "high", "critical"] } }, required: ["company_id", "name", "metric", "comparator", "threshold"] } },
  { name: "resolve_alert", description: "Marca um alerta como resolvido.", inputSchema: { type: "object", properties: { alert_id: { type: "string" } }, required: ["alert_id"] } },
  { name: "execute_change", description: "Executa na plataforma de anuncios (via Windsor) uma alteracao JA aprovada. AINDA NAO HABILITADO — stub proposital ate ter aprovacao humana + chave Windsor.", inputSchema: { type: "object", properties: { approval_id: { type: "string" } }, required: ["approval_id"] } },
];

async function callRpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, params);
  return error ? toolText(`Falha ao chamar ${name}: ${error.message}`, true) : toolText(data);
}

// deno-lint-ignore no-explicit-any
async function callTool(name: string, args: any, mcpKeyEncaminhada: string) {
  args = args ?? {};
  try {
    switch (name) {
      case "list_companies": {
        const { data, error } = await db.from("companies").select("id,name,industry,created_at").order("name");
        return error ? toolText(error.message, true) : toolText(data);
      }
      case "list_campaigns": {
        let q = db.from("campaigns").select("*");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q.order("spend", { ascending: false });
        if (error) return toolText(error.message, true);
        return toolText((data ?? []).map((c: Record<string, unknown>) => ({ ...c, derived: derive(c) })));
      }
      case "get_campaign_timeseries": {
        const days = Number(args.days ?? 30);
        const { data, error } = await db.from("metric_snapshots").select("*")
          .eq("campaign_id", args.campaign_id).gte("snapshot_date", sinceDate(days)).order("snapshot_date");
        if (error) return toolText(error.message, true);
        return toolText({ days, rows: data, note: data && data.length ? undefined : "Sem snapshots ainda — a ingestao (pg_cron -> Windsor) precisa popular metric_snapshots." });
      }
      case "get_portfolio_summary": {
        const days = Number(args.days ?? 7);
        let q = db.from("metric_snapshots").select("spend,leads,sales,revenue,clicks,impressions").gte("snapshot_date", sinceDate(days));
        if (args.company_id) q = q.eq("company_id", args.company_id);
        const { data, error } = await q;
        if (error) return toolText(error.message, true);
        const totals = (data ?? []).reduce((a: Record<string, number>, r: Record<string, unknown>) => {
          for (const k of ["spend", "leads", "sales", "revenue", "clicks", "impressions"]) a[k] = (a[k] ?? 0) + Number(r[k] ?? 0);
          return a;
        }, {});
        return toolText({ window_days: days, totals, derived: derive(totals), note: data && data.length ? undefined : "Sem snapshots no periodo — ingestao pendente." });
      }
      case "list_alerts": {
        let q = db.from("alerts").select("*");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        if (args.only_unresolved !== false) q = q.eq("resolved", false);
        const { data, error } = await q.order("created_at", { ascending: false });
        return error ? toolText(error.message, true) : toolText(data);
      }
      case "list_alert_rules": {
        let q = db.from("alert_rules").select("*");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        const { data, error } = await q.order("created_at", { ascending: false });
        return error ? toolText(error.message, true) : toolText(data);
      }
      case "list_approvals": {
        let q = db.from("approval_requests").select("*").eq("status", args.status ?? "pending");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        const { data, error } = await q.order("created_at", { ascending: false });
        if (error) return toolText(error.message, true);
        // O `select *` devolvia executed_at e execution_result crus e deixava a interpretacao para
        // quem lesse - que e como "executed_at nulo" virou "esta sendo processado" em 07/08/2026.
        // A situacao vem da MESMA funcao que o traffic-chat usa; nenhum leitor deriva a sua.
        const comEstado = (data ?? []).map((r: any) => {
          const s = situacaoDoCard(r);
          return {
            ...r,
            estado: s.estado,
            situacao: s.situacao,
            id_criado_na_meta: s.id_criado_na_meta,
            motivo_da_falha: s.motivo_da_falha,
            falhou_em: s.falhou_em,
            tentativas_de_execucao: s.tentativas,
            erro_da_plataforma: s.detalhe_tecnico_da_falha,
            pode_ser_retentado: s.re_executavel,
          };
        });
        return toolText({
          total: comEstado.length,
          aprovacoes: comEstado,
          nota: "Leia o campo `estado`. A execucao e SINCRONA com a aprovacao (trigger trg_executar_aprovacao): nao existe fila amadurecendo, e aguardando_execucao deve durar segundos. Card aprovado sem id_criado_na_meta ou FALHOU (veja motivo_da_falha) ou nao rodou - nunca 'esta sendo processado'.",
        });
      }
      case "list_recommendations": {
        let q = db.from("ai_recommendations").select("*");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        if (args.status) q = q.eq("status", args.status);
        const { data, error } = await q.order("created_at", { ascending: false });
        return error ? toolText(error.message, true) : toolText(data);
      }
      case "list_integrations": {
        let q = db.from("integrations").select("*");
        if (args.company_id) q = q.eq("company_id", args.company_id);
        const { data, error } = await q.order("provider");
        return error ? toolText(error.message, true) : toolText(data);
      }
      case "teto_vigente":
        return await callRpc("teto_vigente", { p_company_id: args.company_id, p_metric: args.metric });
      case "checar_par_texto_e_peca":
        return await callRpc("checar_par_texto_e_peca", { p_company_id: args.company_id, p_legenda: args.legenda, p_drive_file_id: args.drive_file_id });
      case "saude_das_integracoes":
        return await callRpc("saude_das_integracoes", { p_company_id: args.company_id, p_dias_tolerancia: Number(args.dias_tolerancia ?? 3) });
      case "custo_llm_periodo":
        return await callRpc("custo_llm_periodo", { p_company_id: args.company_id, p_de: args.de, p_ate: args.ate });
      case "panorama_utm_anuncios":
        return await callRpc("panorama_utm_anuncios", { p_company_id: args.company_id });
      case "nota_visual_da_peca":
        return await callRpc("nota_visual_da_peca", { p_company_id: args.company_id, p_drive_file_id: args.drive_file_id });
      case "registrar_veredito_peca_em_revisao": {
        // A RPC exige um solicitante real (FK em auth.users): proposta sem dono nao e proposta.
        // Aqui nao existe sessao de usuario, entao o pedido nasce no nome de um admin. Isso NAO
        // decide nada - quem assina o veredito e quem aprovar o card na tela.
        const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        if (!adm?.user_id) return toolText("Nao ha administrador cadastrado para assinar a proposta de veredito.", true);
        return await callRpc("registrar_veredito_peca_em_revisao", {
          p_company_id: args.company_id,
          p_drive_file_id: args.drive_file_id,
          p_veredito: args.veredito,
          p_veredito_por: (typeof args.veredito_por === "string" && args.veredito_por.trim()) ? args.veredito_por.trim() : null,
          p_nota: (typeof args.nota === "string" && args.nota.trim()) ? args.nota.trim() : null,
          p_solicitado_por: adm.user_id,
        });
      }
      case "get_acervo_para_anuncio":
        return await callRpc("get_acervo_para_anuncio", { p_company_id: args.company_id, p_produto: (typeof args.produto === "string" && args.produto.trim()) ? args.produto.trim() : null, p_incluir_inaptas: args.incluir_inaptas === false ? false : true });
      case "upload_midia": {
        const dfid = String(args.drive_file_id ?? "").trim();
        if (!args.company_id || !dfid) return toolText("company_id e drive_file_id sao obrigatorios.", true);
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/upload-midia`;
        const body: Record<string, unknown> = {
          acao: "executar",
          company: args.company_id,
          drive_file_id: dfid,
        };
        if (typeof args.account_id === "string" && args.account_id.trim()) body.account_id = args.account_id.trim();
        // Encaminha a mesma chave MCP que autenticou este servidor (upload-midia exige x-mcp-key).
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-mcp-key": mcpKeyEncaminhada },
          body: JSON.stringify(body),
        });
        const t = await r.text();
        let j: unknown; try { j = JSON.parse(t); } catch { return toolText(`upload-midia falhou (${r.status}): ${t.slice(0, 200)}`, true); }
        return toolText(j, !r.ok);
      }
      case "diagnosticar_custo":
        return await callRpc("diagnosticar_custo", { p_company_id: args.company_id, p_ad_external_id: args.ad_external_id });
      case "avaliar_fadiga":
        return await callRpc("avaliar_fadiga", { p_company_id: args.company_id, p_ad_external_id: args.ad_external_id });
      case "pode_pausar_por_custo":
        return await callRpc("pode_pausar_por_custo", { p_company_id: args.company_id, p_ad_external_id: args.ad_external_id });
      case "decidir_sobre_conjunto":
        return await callRpc("decidir_sobre_conjunto", { p_company_id: args.company_id, p_adset_external_id: args.adset_external_id });
      case "avaliar_escala":
        return await callRpc("avaliar_escala", { p_company_id: args.company_id, p_adset_external_id: args.adset_external_id });
      case "avaliar_pacing":
        return await callRpc("avaliar_pacing", { p_company_id: args.company_id, p_meta_leads_dia: args.meta_leads_dia ?? null });
      case "validar_pedido_contra_contrato":
        return await callRpc("validar_pedido_contra_contrato", { p_acao: args.acao, p_pedido: args.pedido ?? {} });
      case "renomear_campanha": {
        const atual = String(args.campanha_atual ?? "").trim(), novo = String(args.novo_nome ?? "").trim();
        if (!atual || !novo) return toolText("campanha_atual e novo_nome sao obrigatorios.", true);
        if (atual.toLocaleLowerCase("pt-BR") === novo.toLocaleLowerCase("pt-BR")) return toolText("O novo nome e igual ao atual; nenhum card foi emitido.", true);
        const postura = await db.rpc("pode_executar_acao", { p_company_id: args.company_id, p_action: "renomear_campanha" });
        if (postura.error) return toolText(`Falha ao verificar a postura: ${postura.error.message}`, true);
        if (!postura.data?.permitido) return toolText(postura.data ?? { erro: "renomear_campanha_nao_permitida" }, true);
        if (postura.data?.driver_escrita !== "pipeboard") return toolText("renomear_campanha exige driver Pipeboard; nenhum card foi emitido.", true);
        const { data: campanhas, error: ce } = await db.from("campaigns").select("id,name,external_id").eq("company_id", args.company_id).ilike("name", `%${atual}%`);
        if (ce) return toolText(ce.message, true);
        const candidatas = campanhas ?? [];
        const exatas = candidatas.filter((c: any) => String(c.name).toLocaleLowerCase("pt-BR") === atual.toLocaleLowerCase("pt-BR"));
        const alvo = exatas.length === 1 ? exatas[0] : candidatas.length === 1 ? candidatas[0] : null;
        if (!alvo) return toolText(candidatas.length ? { ambiguo: true, opcoes: candidatas.slice(0, 10).map((c: any) => c.name) } : { erro: "campanha_nao_encontrada", busca: atual }, true);
        const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        if (!adm?.user_id) return toolText("Nao ha administrador cadastrado para ser solicitante do card.", true);
        const payload = { target_name: alvo.name, target_external_id: alvo.external_id, novo_nome: novo,
          justificativa: String(args.justificativa ?? "").trim() || "Solicitacao explicita do gestor para corrigir o nome da campanha.",
          reversa: `Renomear a campanha de volta para "${alvo.name}" pelo Pipeboard.`,
          metrica_sucesso: `Graph API devolver name exatamente igual a "${novo}".`,
          risco: "Links, relatorios ou rotinas que dependam do nome antigo podem deixar de casar; o ID nao muda.",
          proposto_por: "mcp-server:renomear_campanha" };
        const { data: card, error } = await db.from("approval_requests").insert({
          company_id: args.company_id, requested_by: adm.user_id, entity_type: "campaign", entity_id: alvo.id,
          action: "renomear_campanha", summary: `Renomear a campanha "${alvo.name}" para "${novo}" via Pipeboard`,
          payload, status: "pending",
        }).select("id,status,expires_at").single();
        if (error) return toolText(error.message, true);
        await db.from("audit_log").insert({ company_id: args.company_id, user_id: adm.user_id, action: "approval_created",
          target_type: "approval_request", target_id: card.id,
          details: { acao: "renomear_campanha", alvo: alvo.name, novo_nome: novo, origem: "mcp-server" } });
        return toolText({ ok: true, card, aviso: "PENDENTE: nada foi renomeado. Um administrador precisa aprovar o card." });
      }
      case "alterar_categoria_especial": {
        const atual = String(args.campanha_atual ?? "").trim();
        if (!atual) return toolText("campanha_atual e obrigatoria.", true);
        if (!Array.isArray(args.special_ad_categories)) {
          return toolText("special_ad_categories deve ser array (use [] para remover).", true);
        }
        const cats = (args.special_ad_categories as unknown[])
          .map((x) => String(x).trim().toUpperCase())
          .filter((x) => x && x !== "NONE" && x !== "NULL");
        const postura = await db.rpc("pode_executar_acao", {
          p_company_id: args.company_id,
          p_action: "alterar_categoria_especial_campanha",
        });
        if (postura.error) return toolText(`Falha ao verificar a postura: ${postura.error.message}`, true);
        if (!postura.data?.permitido) {
          return toolText(postura.data ?? { erro: "alterar_categoria_especial_nao_permitida" }, true);
        }
        const { data: campanhas, error: ce } = await db
          .from("campaigns")
          .select("id,name,external_id,special_ad_categories")
          .eq("company_id", args.company_id)
          .ilike("name", `%${atual}%`);
        if (ce) return toolText(ce.message, true);
        const candidatas = campanhas ?? [];
        const exatas = candidatas.filter(
          (c: any) => String(c.name).toLocaleLowerCase("pt-BR") === atual.toLocaleLowerCase("pt-BR"),
        );
        const alvo = exatas.length === 1 ? exatas[0] : candidatas.length === 1 ? candidatas[0] : null;
        if (!alvo) {
          return toolText(
            candidatas.length
              ? { ambiguo: true, opcoes: candidatas.slice(0, 10).map((c: any) => c.name) }
              : { erro: "campanha_nao_encontrada", busca: atual },
            true,
          );
        }
        const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin").limit(1).maybeSingle();
        if (!adm?.user_id) return toolText("Nao ha administrador cadastrado para ser solicitante do card.", true);
        const resumoCats = cats.length ? `[${cats.join(", ")}]` : "[] (sem categoria especial)";
        const payload = {
          target_name: alvo.name,
          target_external_id: alvo.external_id,
          special_ad_categories: cats,
          categorias_atuais: Array.isArray(alvo.special_ad_categories) ? alvo.special_ad_categories : null,
          justificativa: String(args.justificativa ?? "").trim() ||
            `Corrigir special_ad_categories da campanha para ${resumoCats}.`,
          reversa: "Restaurar as categorias anteriores com a mesma acao apos releitura.",
          metrica_sucesso: `Graph devolver special_ad_categories igual a ${resumoCats}.`,
          risco: "A Meta pode recusar troca em campanha com entrega; nesse caso o caminho e campanha nova.",
          proposto_por: "mcp-server:alterar_categoria_especial",
        };
        const { data: card, error } = await db.from("approval_requests").insert({
          company_id: args.company_id,
          requested_by: adm.user_id,
          entity_type: "campaign",
          entity_id: alvo.id,
          action: "alterar_categoria_especial_campanha",
          summary: cats.length
            ? `Alterar special_ad_categories de "${alvo.name}" para ${resumoCats}`
            : `Remover special_ad_categories de "${alvo.name}"`,
          payload,
          status: "pending",
        }).select("id,status,expires_at").single();
        if (error) return toolText(error.message, true);
        await db.from("audit_log").insert({
          company_id: args.company_id,
          user_id: adm.user_id,
          action: "approval_created",
          target_type: "approval_request",
          target_id: card.id,
          details: {
            acao: "alterar_categoria_especial_campanha",
            alvo: alvo.name,
            special_ad_categories: cats,
            origem: "mcp-server",
          },
        });
        return toolText({
          ok: true,
          card,
          aviso: "PENDENTE: nada foi alterado na Meta. Um administrador precisa aprovar o card.",
        });
      }
      case "create_approval_request": {
        const { data, error } = await db.from("approval_requests").insert({
          company_id: args.company_id, entity_type: args.entity_type, action: args.action,
          summary: args.summary, payload: args.payload ?? {}, status: "pending",
        }).select().single();
        if (error) return toolText(error.message, true);
        return toolText({ created: data, note: "Proposta registrada como pending. Um humano precisa aprovar no painel antes de qualquer execucao." });
      }
      case "create_alert_rule": {
        const { data, error } = await db.from("alert_rules").insert({
          company_id: args.company_id, name: args.name, metric: args.metric, comparator: args.comparator,
          threshold: args.threshold, window_days: args.window_days ?? 1, severity: args.severity ?? "medium",
        }).select().single();
        return error ? toolText(error.message, true) : toolText({ created: data });
      }
      case "resolve_alert": {
        const { data, error } = await db.from("alerts").update({ resolved: true }).eq("id", args.alert_id).select().single();
        return error ? toolText(error.message, true) : toolText({ resolved: data });
      }
      case "execute_change":
        return toolText("Execucao real via Windsor ainda NAO habilitada. Faltam: (1) approval_request 'approved' por um humano; (2) chave de API do Windsor como secret da edge function. Stub proposital ate o gate estar completo.", true);
      default:
        return toolText(`Tool desconhecida: ${name}`, true);
    }
  } catch (e) {
    return toolText(`Erro interno na tool ${name}: ${String(e)}`, true);
  }
}

// deno-lint-ignore no-explicit-any
async function handleRpc(msg: any, mcpKeyEncaminhada: string): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  switch (method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call":
      return { jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments, mcpKeyEncaminhada) };
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST (MCP JSON-RPC). SSE nao implementado neste servidor." }, 405);

  if (!(await checkAuth(req))) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: chave MCP invalida ou ausente." } }, 401);
  }

  const mcpKeyEncaminhada = chaveMcpDe(req, "header-or-bearer") ?? "";

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }

  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) { const r = await handleRpc(m, mcpKeyEncaminhada); if (r) out.push(r); }
    return json(out);
  }
  const r = await handleRpc(body, mcpKeyEncaminhada);
  if (r === null) return new Response(null, { status: 202, headers: CORS });
  return json(r);
});
