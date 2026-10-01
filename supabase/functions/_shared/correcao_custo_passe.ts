// Passe do vigia de regua. Contexto so por parametro: nada de JOB_* de modulo.
// A funcao SQL detecta. Este arquivo grava, avisa e verifica. Nao executa na Meta.

import { bodyOpenRouter, resolverChamadaLlm } from "./llm_roteador.ts";
import { recusarCruzamentoLinhaProduto } from "./memoria_conjunto.ts";
import {
  escolherEscada,
  validarPlanoDeCorrecao,
  VAZAO_POR_EMPRESA,
  type ResultadoValidacao,
} from "./correcao_custo.ts";

export type Db = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>;
  from: (tabela: string) => any;
};

const TAREFA = "vigia-de-regua";

function txt(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function ontem(): string {
  return somarDias(hoje(), -1);
}

function extrairJson(texto: string): Record<string, unknown> | null {
  const i = texto.indexOf("{");
  const j = texto.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try {
    const v = JSON.parse(texto.slice(i, j + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function garantirExecucao(supa: Db, companyId: string | null): Promise<string | null> {
  const q = await supa.from("execucoes_agendadas")
    .select("id,desfecho,iniciado_em")
    .eq("tarefa", TAREFA)
    .order("iniciado_em", { ascending: false })
    .limit(1);
  const row = Array.isArray(q.data) ? q.data[0] : null;
  if (row?.id) {
    const iniciado = Date.parse(txt(row.iniciado_em));
    const recente = Number.isFinite(iniciado) && Date.now() - iniciado < 15 * 60_000;
    if (txt(row.desfecho) === "em_curso" || recente) return txt(row.id);
  }
  const aberto = await supa.rpc("abrir_execucao", {
    p_tarefa: TAREFA,
    p_origem: "edge",
    p_company_id: companyId,
    p_forcar: true,
  });
  if (aberto.error || aberto.data == null) return null;
  return txt(aberto.data);
}

async function fecharExecucao(
  supa: Db,
  id: string | null,
  desfecho: string,
  itens: number,
  achados: number,
  erro: string | null,
  detalhe: Record<string, unknown>,
) {
  if (!id) return;
  await supa.rpc("fechar_execucao", {
    p_execucao: id,
    p_desfecho: desfecho,
    p_itens: itens,
    p_achados: achados,
    p_erro: erro,
    p_detalhe: detalhe,
  });
}

async function medirCusto(supa: Db, plano: Record<string, unknown>): Promise<number | null> {
  const companyId = txt(plano.company_id);
  const nivel = txt(plano.nivel);
  const alvo = txt(plano.alvo_external_id);
  const janela = Number(plano.janela_dias) || 7;
  const fim = ontem();
  const ini = somarDias(fim, -(janela - 1));
  let ids: string[] = [];
  if (nivel === "anuncio") ids = [alvo];
  else if (nivel === "conjunto") {
    const ads = await supa.from("ads").select("external_id").eq("company_id", companyId).eq("adset_external_id", alvo);
    ids = (ads.data ?? []).map((a: { external_id?: string }) => txt(a.external_id)).filter(Boolean);
  } else {
    const camp = await supa.from("campaigns").select("id").eq("company_id", companyId).eq("external_id", alvo).maybeSingle();
    const campId = txt(camp.data?.id);
    if (!campId) return null;
    const ads = await supa.from("ads").select("external_id").eq("company_id", companyId).eq("campaign_id", campId);
    ids = (ads.data ?? []).map((a: { external_id?: string }) => txt(a.external_id)).filter(Boolean);
  }
  if (!ids.length) return null;
  const snaps = await supa.from("ad_metric_snapshots")
    .select("spend,messaging_started,form_leads,link_clicks")
    .eq("company_id", companyId)
    .in("ad_external_id", ids)
    .gte("snapshot_date", ini)
    .lte("snapshot_date", fim);
  let gasto = 0, forms = 0, msgs = 0, links = 0;
  for (const s of snaps.data ?? []) {
    gasto += Number(s.spend) || 0;
    forms += Number(s.form_leads) || 0;
    msgs += Number(s.messaging_started) || 0;
    links += Number(s.link_clicks) || 0;
  }
  const custo = await supa.rpc("custo_por_resultado", {
    p_gasto: gasto,
    p_form_leads: forms,
    p_messaging: msgs,
    p_base: "conversas",
    p_link_clicks: links,
  });
  if (custo.error) return null;
  return num(custo.data);
}

async function verificarPlanosVencidos(supa: Db, companyId: string | null): Promise<Record<string, number>> {
  let q = supa.from("planos_de_ajuste_de_custo")
    .select("*")
    .in("status", ["aberto", "proposto"])
    .not("data_de_leitura", "is", null)
    .lte("data_de_leitura", hoje());
  if (companyId) q = q.eq("company_id", companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const cont = { expirados: 0, ok: 0, sem_efeito: 0 };
  for (const plano of data ?? []) {
    const ids = Array.isArray(plano.approval_ids) ? plano.approval_ids : [];
    const nuncaEmitido = txt(plano.status) === "aberto" || ids.length === 0;
    if (nuncaEmitido) {
      await supa.from("planos_de_ajuste_de_custo").update({
        status: "expirado",
        verificado_em: new Date().toISOString(),
        veredito_nota: "Prazo de leitura venceu sem emissao. A alavanca nao foi culpada.",
        atualizado_em: new Date().toISOString(),
      }).eq("id", plano.id);
      cont.expirados += 1;
      continue;
    }
    const custo = await medirCusto(supa, plano);
    const regua = num(plano.regua_valor);
    const dentro = custo != null && regua != null && custo <= regua;
    const status = dentro ? "verificado_ok" : "verificado_sem_efeito";
    const tentativas = Number(plano.tentativas_na_familia) || 0;
    await supa.from("planos_de_ajuste_de_custo").update({
      status,
      verificado_em: new Date().toISOString(),
      custo_na_verificacao: custo,
      tentativas_na_familia: dentro || custo == null ? tentativas : tentativas + 1,
      veredito_nota: custo == null
        ? "Custo indefinido na verificacao: ausencia nao e zero e nao culpa a alavanca."
        : dentro
          ? "O custo voltou para dentro da regua."
          : "O custo segue acima da regua. A familia desta alavanca nao se repete as cegas.",
      atualizado_em: new Date().toISOString(),
    }).eq("id", plano.id);
    if (dentro) cont.ok += 1;
    else cont.sem_efeito += 1;
  }
  return cont;
}

async function familiaEsgotada(supa: Db, companyId: string, alvo: string): Promise<string[]> {
  const { data } = await supa.from("planos_de_ajuste_de_custo")
    .select("alavanca,status,verificado_em")
    .eq("company_id", companyId)
    .eq("alvo_external_id", alvo)
    .in("status", ["verificado_ok", "verificado_sem_efeito"])
    .order("verificado_em", { ascending: false })
    .limit(12);
  const por = new Map<string, string[]>();
  for (const row of data ?? []) {
    const al = txt(row.alavanca);
    if (!al) continue;
    const lista = por.get(al) ?? [];
    if (lista.length < 2) lista.push(txt(row.status));
    por.set(al, lista);
  }
  const esgotadas: string[] = [];
  for (const [al, lista] of por) {
    if (lista.length >= 2 && lista.every((s) => s === "verificado_sem_efeito")) esgotadas.push(al);
  }
  return esgotadas;
}

async function colher(supa: Db, est: Record<string, unknown>) {
  const companyId = txt(est.company_id);
  const ini = txt(est.janela_inicio);
  const fim = txt(est.janela_fim);
  const conjunto = txt(est.conjunto_external_id);
  const adsConj = conjunto
    ? await supa.from("ads").select("external_id,name,status").eq("company_id", companyId).eq("adset_external_id", conjunto)
    : { data: [] };
  const ids = (adsConj.data ?? []).map((a: { external_id?: string }) => txt(a.external_id)).filter(Boolean);
  const alvoId = txt(est.alvo_external_id);
  const idsSerie = est.nivel === "anuncio" ? [alvoId] : ids;
  const serie = idsSerie.length
    ? await supa.from("ad_metric_snapshots")
      .select("ad_external_id,snapshot_date,spend,messaging_started")
      .eq("company_id", companyId)
      .in("ad_external_id", idsSerie.slice(0, 40))
      .gte("snapshot_date", ini)
      .lte("snapshot_date", fim)
    : { data: [] };
  const ranking: Array<Record<string, unknown>> = [];
  const porAd = new Map<string, { gasto: number; msgs: number; nome: string }>();
  for (const ad of adsConj.data ?? []) porAd.set(txt(ad.external_id), { gasto: 0, msgs: 0, nome: txt(ad.name) });
  for (const s of serie.data ?? []) {
    const id = txt(s.ad_external_id);
    const slot = porAd.get(id) ?? { gasto: 0, msgs: 0, nome: id };
    slot.gasto += Number(s.spend) || 0;
    slot.msgs += Number(s.messaging_started) || 0;
    porAd.set(id, slot);
  }
  for (const [id, slot] of porAd) {
    if (slot.gasto <= 0) continue;
    ranking.push({
      external_id: id,
      nome: slot.nome,
      gasto: Math.round(slot.gasto * 100) / 100,
      conversas: slot.msgs,
      custo: slot.msgs > 0 ? Math.round((slot.gasto / slot.msgs) * 100) / 100 : null,
    });
  }
  ranking.sort((a, b) => Number(b.gasto) - Number(a.gasto));
  const breakdowns = ids.length
    ? await supa.from("metric_breakdown_daily")
      .select("tipo_recorte,valor_recorte,spend,messaging_started")
      .eq("company_id", companyId)
      .in("ad_external_id", (est.nivel === "anuncio" ? [alvoId] : ids).slice(0, 20))
      .gte("snapshot_date", ini)
      .lte("snapshot_date", fim)
      .limit(400)
    : { data: [] };
  const segmentos = new Map<string, { gasto: number; msgs: number }>();
  for (const b of breakdowns.data ?? []) {
    const k = `${txt(b.tipo_recorte)}:${txt(b.valor_recorte)}`;
    const slot = segmentos.get(k) ?? { gasto: 0, msgs: 0 };
    slot.gasto += Number(b.spend) || 0;
    slot.msgs += Number(b.messaging_started) || 0;
    segmentos.set(k, slot);
  }
  const recortes = [...segmentos.entries()]
    .map(([k, v]) => ({ segmento: k, gasto: Math.round(v.gasto * 100) / 100, conversas: v.msgs }))
    .filter((r) => r.gasto > 0 && r.conversas > 0);
  const posicionamentoComVolume = recortes.some((r) => r.segmento.startsWith("posicionamento:"));
  const pecas = await supa.from("drive_analises")
    .select("drive_file_id,nome,produto_detectado,aproveitavel,aprovado_pelo_gestor")
    .eq("company_id", companyId)
    .eq("aproveitavel", "sim")
    .eq("aprovado_pelo_gestor", true)
    .limit(30);
  const estrutura = [txt(est.campanha_nome), txt(est.conjunto_nome), txt(est.marca)];
  const acervo = (pecas.data ?? []).filter((p: Record<string, unknown>) => {
    const cruz = recusarCruzamentoLinhaProduto({
      estruturaNomes: estrutura,
      pecaSinais: [txt(p.nome), txt(p.produto_detectado)],
    });
    return cruz.ok;
  }).slice(0, 5);
  const fadiga = est.nivel === "anuncio"
    ? await supa.rpc("avaliar_fadiga", { p_company_id: companyId, p_ad_external_id: alvoId })
    : { data: null, error: null };
  const pausa = est.nivel === "anuncio"
    ? await supa.rpc("pode_pausar_por_custo", { p_company_id: companyId, p_ad_external_id: alvoId })
    : { data: null, error: null };
  const decisao = conjunto
    ? await supa.rpc("decidir_sobre_conjunto", { p_company_id: companyId, p_adset_external_id: conjunto })
    : { data: null, error: null };
  const pacing = await supa.rpc("avaliar_pacing", {
    p_company_id: companyId,
    p_meta_leads_dia: Math.max(1, Math.round((num(est.resultados_da_base) ?? 0) / 7)),
  });
  const esgotadas = await familiaEsgotada(supa, companyId, alvoId);
  return {
    ranking: ranking.slice(0, 8),
    recortes: recortes.slice(0, 12),
    posicionamentoComVolume,
    acervo,
    fadiga: fadiga.data ?? null,
    podePausar: pausa.data ?? null,
    decisaoConjunto: decisao.data ?? null,
    pacing: pacing.error ? { erro: pacing.error.message } : pacing.data,
    esgotadas,
  };
}

function planoDeterministico(
  est: Record<string, unknown>,
  escada: { alavanca: string | null; atos: string[]; motivo: string | null },
  colheita: Awaited<ReturnType<typeof colher>>,
  motivoExtra: string | null,
): Record<string, unknown> {
  const prazo = somarDias(hoje(), 7);
  if (!escada.alavanca) {
    return {
      alvo: { nivel: est.nivel, external_id: est.alvo_external_id, nome: est.alvo_nome },
      veredito: "nao_agir",
      alavanca: null,
      evidencia: `Custo ${est.custo_observado} contra regua ${est.regua_valor} em ${est.janela_dias} dias.`,
      mecanismo: motivoExtra ?? escada.motivo ?? "sem alavanca segura",
      criterio_de_sucesso: "reavaliar quando a carencia ou o dado faltante passar",
      prazo_de_leitura: prazo,
      reversa: "nenhuma acao foi proposta",
      risco: "nenhum",
      atos_propostos: [],
      lacunas: [escada.motivo ?? "sem_alavanca"],
      redator: "deterministico",
    };
  }
  const peca = colheita.acervo[0] as Record<string, unknown> | undefined;
  const conjuntoId = txt(est.conjunto_external_id);
  const conjuntoNome = txt(est.conjunto_nome);
  const atos = escada.atos.map((action) => {
    const noConjunto = action === "criar_anuncio_a_partir_de" || action === "ajustar_posicionamentos_do_conjunto";
    return {
      action,
      target_external_id: noConjunto ? (conjuntoId || txt(est.alvo_external_id)) : txt(est.alvo_external_id),
      target_name: noConjunto ? (conjuntoNome || txt(est.alvo_nome)) : txt(est.alvo_nome),
      payload: action === "criar_anuncio_a_partir_de"
        ? { drive_file_id: peca ? txt(peca.drive_file_id) : null, nome: peca ? txt(peca.nome) : null }
        : action === "ajustar_posicionamentos_do_conjunto"
          ? { formato_midia: txt(est.formato_midia) || null, posicionamento: txt(est.posicionamento) || null }
          : {},
    };
  });
  const discorda = est.direcoes_discordam === true;
  return {
    alvo: { nivel: est.nivel, external_id: est.alvo_external_id, nome: est.alvo_nome },
    veredito: "agir",
    alavanca: escada.alavanca,
    evidencia: `Em ${est.janela_dias} dias o custo por conversa foi ${est.custo_observado} e a regua e ${est.regua_valor}. `
      + `Gasto da base ${est.gasto_da_base}, ${est.resultados_da_base} conversas, ${est.dias_com_entrega} dias com entrega.`
      + (discorda ? ` A janela de 3 dias (${est.custo_3d}) nao aponta o mesmo lado; quem decidiu foi a de 7 dias.` : ""),
    mecanismo: "A peca ou o conjunto acima da regua concentra custo. A escada so mexe em criativo ou posicionamento, nunca em verba, publico, geo ou idade.",
    criterio_de_sucesso: `Custo por conversa de volta para dentro de ${est.regua_valor} na mesma base, lido em 7 dias.`,
    prazo_de_leitura: prazo,
    reversa: escada.alavanca === "pausar_criativo"
      ? "Reativar o anuncio pausado se o conjunto perder entrega ou o custo nao cair."
      : escada.alavanca === "criar_anuncio_a_partir_de"
        ? "Pausar o anuncio novo se ele nao entregar ou puxar o custo para cima."
        : "Devolver os posicionamentos anteriores do conjunto.",
    risco: "Menos peca no conjunto por alguns dias, ou um criativo novo ainda em aprendizado.",
    atos_propostos: atos,
    lacunas: motivoExtra ? [motivoExtra] : [],
    redator: motivoExtra ? "deterministico_apos_llm" : "deterministico",
  };
}

async function redigir(
  chave: string,
  est: Record<string, unknown>,
  colheita: Awaited<ReturnType<typeof colher>>,
  escada: { alavanca: string | null; atos: string[]; motivo: string | null },
): Promise<Record<string, unknown> | null> {
  if (!chave || !escada.alavanca) return null;
  const rota = resolverChamadaLlm({
    tipo: "subagente",
    sessionId: null,
    tier: "standard",
    especialista: "vigia-de-regua",
  });
  const sys = [
    "Voce redige UM plano de correcao de custo por conversa.",
    "Devolva so JSON, sem markdown.",
    `A alavanca ja foi escolhida e e obrigatoria: ${escada.alavanca}.`,
    `Os atos permitidos, nesta ordem, sao: ${escada.atos.join(", ")}.`,
    "Proibido: orcamento, publico, geo, idade, escala, pausar campanha ou conjunto, renomear.",
    "reversa e obrigatoria. Sem reversa o plano e recusado.",
    "Nao invente peca: use so o acervo recebido.",
  ].join(" ");
  const user = JSON.stringify({
    estouro: {
      alvo: est.alvo_nome,
      nivel: est.nivel,
      external_id: est.alvo_external_id,
      custo_7d: est.custo_7d,
      custo_3d: est.custo_3d,
      regua: est.regua_valor,
      direcoes_discordam: est.direcoes_discordam,
      janela_que_decidiu: "7d",
    },
    ranking: colheita.ranking,
    recortes: colheita.recortes,
    acervo: colheita.acervo,
    contrato: {
      alvo: { nivel: est.nivel, external_id: est.alvo_external_id, nome: est.alvo_nome },
      veredito: "agir",
      alavanca: escada.alavanca,
      atos_propostos: escada.atos,
    },
  }).slice(0, 12000);
  const body = bodyOpenRouter(rota, {
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    max_tokens: 2500,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 40_000);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return null;
    const j = JSON.parse(text);
    return extrairJson(txt(j?.choices?.[0]?.message?.content));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function podeExecutar(supa: Db, companyId: string, action: string): Promise<boolean> {
  const r = await supa.rpc("pode_executar_acao", { p_company_id: companyId, p_action: action });
  if (r.error) return false;
  const v = r.data as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return false;
  if (v.permitido === false || v.ok === false || v.pode === false) return false;
  if (v.permitido === true || v.ok === true || v.pode === true) return true;
  return !txt(v.motivo) && !txt(v.erro);
}

async function gravarPlano(
  supa: Db,
  est: Record<string, unknown>,
  validacao: ResultadoValidacao,
  corpo: Record<string, unknown>,
): Promise<"insert" | "update"> {
  const companyId = txt(est.company_id);
  const chave = txt(est.chave_dedupe);
  const existente = await supa.from("planos_de_ajuste_de_custo")
    .select("id,status")
    .eq("company_id", companyId)
    .eq("chave_dedupe", chave)
    .in("status", ["aberto", "proposto"])
    .maybeSingle();
  const evidencia = {
    gasto_da_base: num(est.gasto_da_base) ?? 0,
    resultados_da_base: Number(est.resultados_da_base) || 0,
    custo_observado: num(est.custo_observado) ?? 0,
    custo_7d: num(est.custo_7d),
    custo_3d: num(est.custo_3d),
    dias_com_entrega: Number(est.dias_com_entrega) || 0,
    cobertura: est.cobertura ?? {},
    atualizado_em: new Date().toISOString(),
  };
  if (existente.data && txt(existente.data.status) === "proposto") {
    await supa.from("planos_de_ajuste_de_custo").update(evidencia).eq("id", existente.data.id);
    return "update";
  }
  const linha = {
    company_id: companyId,
    nivel: txt(est.nivel),
    alvo_external_id: txt(est.alvo_external_id),
    alvo_nome: txt(est.alvo_nome) || txt(est.alvo_external_id),
    campanha_external_id: txt(est.campanha_external_id) || null,
    conjunto_external_id: txt(est.conjunto_external_id) || null,
    marca: txt(est.marca) || null,
    metrica: "custo_por_conversa",
    base_declarada: "conversas",
    regua_valor: num(est.regua_valor) ?? 0,
    regua_fonte: txt(est.regua_fonte) || "meta_de_negocio",
    janela_dias: Number(est.janela_dias) || 7,
    janela_inicio: txt(est.janela_inicio),
    janela_fim: txt(est.janela_fim),
    ...evidencia,
    status: "aberto",
    severidade: ["baixa", "media", "alta"].includes(txt(est.severidade)) ? txt(est.severidade) : "media",
    alavanca: validacao.ok && validacao.veredito === "agir" ? validacao.alavanca : null,
    plano: { ...corpo, validacao_motivo: validacao.motivo, veredito: validacao.veredito },
    data_de_leitura: txt(corpo.prazo_de_leitura) || somarDias(hoje(), 7),
    chave_dedupe: chave,
  };
  if (existente.data?.id) {
    await supa.from("planos_de_ajuste_de_custo").update(linha).eq("id", existente.data.id);
    return "update";
  }
  const ins = await supa.from("planos_de_ajuste_de_custo").insert(linha);
  if (ins.error) throw new Error(ins.error.message);
  return "insert";
}

function severidadeAlerta(s: string): "low" | "medium" | "high" {
  if (s === "alta") return "high";
  if (s === "media") return "medium";
  return "low";
}

async function avisar(supa: Db, est: Record<string, unknown>, alavanca: string | null) {
  const companyId = txt(est.company_id);
  if (!companyId) return;
  await supa.rpc("emitir_alerta", {
    p_company_id: companyId,
    p_severidade: severidadeAlerta(txt(est.severidade)),
    p_titulo: "Custo por conversa acima da regua",
    p_o_que: `${txt(est.alvo_nome)} esta em ${est.custo_observado} por conversa, acima da regua ${est.regua_valor}.`,
    p_onde: txt(est.alvo_nome),
    p_quanto: `R$ ${est.custo_observado} contra regua R$ ${est.regua_valor}`,
    p_acao: alavanca
      ? `Ha um plano (${alavanca}) aguardando o gestor emitir. Nada foi executado.`
      : "O passe registrou o estouro e nao propos acao.",
    p_janela: `${est.janela_inicio} a ${est.janela_fim}`,
    p_tarefa: TAREFA,
    p_linha_produto: txt(est.marca) || null,
    p_chave_dedupe: `vigia:${txt(est.chave_dedupe)}`,
    p_valor: num(est.custo_observado),
  });
}

export async function rodarPasseCorrecaoCusto(opts: {
  supa: Db;
  openRouterKey: string;
  companyId: string | null;
}): Promise<Record<string, unknown>> {
  const execId = await garantirExecucao(opts.supa, opts.companyId);
  let desfecho = "sucesso";
  let erro: string | null = null;
  let itens = 0;
  let achados = 0;
  const detalhe: Record<string, unknown> = { lacunas: [] as unknown[] };
  try {
    const verificacao = await verificarPlanosVencidos(opts.supa, opts.companyId);
    detalhe.verificacao = verificacao;
    const det = await opts.supa.rpc("detectar_estouros_de_regua", {
      p_company_id: opts.companyId,
      p_janela_dias: 7,
    });
    if (det.error) throw new Error(det.error.message);
    const linhas = (Array.isArray(det.data) ? det.data : []) as Record<string, unknown>[];
    const abort = linhas.find((l) => l.abortar === true);
    if (abort) {
      desfecho = "falha";
      erro = txt(abort.motivo) || "espelho_abortado";
      detalhe.abortar = abort;
      return { ok: false, modo: "correcao_custo", abortar: true, motivo: erro, itens: 0, achados: 0 };
    }
    const lacunas = linhas.filter((l) => txt(l.tipo) === "lacuna");
    detalhe.lacunas = lacunas.map((l) => ({
      alvo: l.alvo_nome,
      marca: l.marca,
      motivo: "sem_regua_de_negocio",
    }));
    const acionaveis = linhas.filter((l) => l.acionavel === true && txt(l.tipo) === "estouro");
    const porEmpresa = new Map<string, Record<string, unknown>[]>();
    for (const l of acionaveis) {
      const id = txt(l.company_id);
      const lista = porEmpresa.get(id) ?? [];
      lista.push(l);
      porEmpresa.set(id, lista);
    }
    const escolhidos: Record<string, unknown>[] = [];
    for (const lista of porEmpresa.values()) {
      lista.sort((a, b) => (num(b.peso) ?? 0) - (num(a.peso) ?? 0));
      escolhidos.push(...lista.slice(0, VAZAO_POR_EMPRESA));
    }
    for (const est of escolhidos) {
      const colheita = await colher(opts.supa, est);
      const entregando = num(est.anuncios_entregando_no_conjunto) ?? colheita.ranking.length;
      const podeCusto = est.nivel !== "anuncio"
        || (colheita.podePausar as Record<string, unknown> | null)?.permitido !== false;
      let escada = escolherEscada({
        anuncios_entregando: entregando,
        pode_pausar_por_custo: podeCusto,
        peca_ok: colheita.acervo.length > 0,
        cruzamento: false,
        posicionamento_com_volume: colheita.posicionamentoComVolume,
        carencia: false,
        alavancas_esgotadas: colheita.esgotadas,
      });
      if (escada.alavanca === "ajustar_posicionamentos_do_conjunto" && !txt(est.formato_midia)) {
        escada = { alavanca: null, atos: [], motivo: "formato_de_midia_nao_medido" };
      }
      let corpo = await redigir(opts.openRouterKey, est, colheita, escada);
      if (corpo && escada.alavanca && txt(corpo.alavanca) !== escada.alavanca) corpo = null;
      let montado = corpo ?? planoDeterministico(est, escada, colheita, corpo ? null : "llm_sem_json");
      const contextoBase = {
        hoje: hoje(),
        anuncios_entregando_no_conjunto: entregando,
        pode_executar: escada.alavanca
          ? await podeExecutar(opts.supa, txt(est.company_id), escada.alavanca)
          : true,
        peca_acervo_ok: colheita.acervo.length > 0,
        cruzamento_linha: false,
        carencia_ate: est.carencia_ate,
      };
      let validacao = validarPlanoDeCorrecao({ ...montado, ...contextoBase });
      if (!validacao.ok) {
        montado = planoDeterministico(est, { alavanca: null, atos: [], motivo: validacao.motivo }, colheita, validacao.motivo);
        validacao = validarPlanoDeCorrecao({ ...montado, veredito: "nao_agir", atos_propostos: [], ...contextoBase });
      }
      await gravarPlano(opts.supa, est, validacao, montado);
      if (validacao.veredito === "agir") await avisar(opts.supa, est, validacao.alavanca);
      itens += 1;
      if (validacao.veredito === "agir") achados += 1;
    }
    const resposta = {
      ok: true,
      modo: "correcao_custo",
      itens,
      achados,
      planos: itens,
      alertas: achados,
      empresas: porEmpresa.size,
    };
    detalhe.resposta = resposta;
    return resposta;
  } catch (e) {
    desfecho = "falha";
    erro = txt((e as Error)?.message ?? e).slice(0, 800);
    return { ok: false, modo: "correcao_custo", erro, itens, achados };
  } finally {
    await fecharExecucao(opts.supa, execId, desfecho, itens, achados, erro, detalhe);
  }
}

async function idDoAlvo(supa: Db, companyId: string, action: string, externalId: string): Promise<{ id: string; name: string } | null> {
  const tabela = action === "pausar_criativo" || action === "ativar_criativo"
    ? "ads"
    : action === "ajustar_posicionamentos_do_conjunto" || action === "criar_anuncio_a_partir_de"
      ? "ad_sets"
      : "campaigns";
  const q = await supa.from(tabela).select("id,name,external_id").eq("company_id", companyId).eq("external_id", externalId).maybeSingle();
  if (!q.data?.id) return null;
  return { id: txt(q.data.id), name: txt(q.data.name) };
}

export async function emitirPlanoDeCusto(opts: {
  supa: Db;
  companyId: string;
  planoId: string;
  userId: string;
}): Promise<Record<string, unknown>> {
  const plano = await opts.supa.from("planos_de_ajuste_de_custo").select("*").eq("id", opts.planoId).maybeSingle();
  if (plano.error) return { ok: false, erro: plano.error.message };
  if (!plano.data) return { ok: false, erro: "plano_nao_encontrado" };
  if (txt(plano.data.company_id) !== opts.companyId) return { ok: false, erro: "plano_de_outra_empresa" };
  if (txt(plano.data.status) !== "aberto") return { ok: false, erro: "plano_nao_esta_aberto" };
  const corpo = (plano.data.plano ?? {}) as Record<string, unknown>;
  const atos = Array.isArray(corpo.atos_propostos) ? corpo.atos_propostos as Record<string, unknown>[] : [];
  if (!atos.length) return { ok: false, erro: "plano_sem_atos" };
  const entregando = num((plano.data.cobertura as Record<string, unknown> | null)?.anuncios_entregando)
    ?? num(corpo.anuncios_entregando_no_conjunto);
  const validacao = validarPlanoDeCorrecao({
    ...corpo,
    hoje: hoje(),
    anuncios_entregando_no_conjunto: entregando ?? 2,
    pode_executar: true,
  });
  if (!validacao.ok || validacao.veredito !== "agir") {
    return { ok: false, erro: validacao.motivo ?? "plano_recusado", nada_executado: true };
  }
  const approvalIds: string[] = [];
  for (const ato of atos) {
    const action = txt(ato.action);
    const permitido = await podeExecutar(opts.supa, opts.companyId, action);
    if (!permitido) return { ok: false, erro: `acao_nao_executavel:${action}`, nada_executado: true };
    if (action === "pausar_criativo") {
      const alvo = txt(ato.target_external_id);
      const pausa = await opts.supa.rpc("pode_pausar_por_custo", { p_company_id: opts.companyId, p_ad_external_id: alvo });
      const p = pausa.data as Record<string, unknown> | null;
      if (p && p.permitido === false) return { ok: false, erro: "pode_pausar_por_custo_recusou", detalhe: p, nada_executado: true };
    }
    const externalId = txt(ato.target_external_id);
    const alvo = await idDoAlvo(opts.supa, opts.companyId, action, externalId);
    if (!alvo) return { ok: false, erro: `alvo_nao_encontrado:${externalId}`, nada_executado: true };
    const entity = action === "pausar_criativo" || action === "ativar_criativo" ? "ad" : "adset";
    const ins = await opts.supa.from("approval_requests").insert({
      company_id: opts.companyId,
      requested_by: opts.userId,
      conversation_id: null,
      entity_type: entity,
      entity_id: alvo.id,
      action,
      summary: `${action} em ${alvo.name}. Plano do vigia de regua. Nada executado.`,
      payload: {
        ...(ato.payload && typeof ato.payload === "object" ? ato.payload as Record<string, unknown> : {}),
        target_name: alvo.name,
        target_external_id: externalId,
        justificativa: txt(corpo.evidencia),
        reversa: txt(corpo.reversa),
        metrica_sucesso: txt(corpo.criterio_de_sucesso),
        janela_leitura: txt(corpo.prazo_de_leitura),
        risco: txt(corpo.risco),
        mecanismo: txt(corpo.mecanismo),
        plano_id: opts.planoId,
        proposto_por: "vigia-de-regua",
      },
      status: "pending",
    }).select("id").single();
    if (ins.error) return { ok: false, erro: ins.error.message, nada_executado: true };
    approvalIds.push(txt(ins.data.id));
  }
  await opts.supa.from("planos_de_ajuste_de_custo").update({
    status: "proposto",
    proposto_em: new Date().toISOString(),
    approval_ids: approvalIds,
    atualizado_em: new Date().toISOString(),
  }).eq("id", opts.planoId);
  return {
    ok: true,
    modo: "emitir_plano_custo",
    plano_id: opts.planoId,
    approval_ids: approvalIds,
    status: "proposto",
    nada_executado: true,
  };
}
