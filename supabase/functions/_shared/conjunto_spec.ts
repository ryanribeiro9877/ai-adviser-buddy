// Conjunto que nasce de spec, sem molde. Nasce PAUSADO. Targeting e substituicao total:
// sem targeting_automation a Meta apaga advantage_audience em silencio.

export type RecusaConjunto = { ok: false; erro: string; detalhe: string };

export type ConjuntoMontado = {
  ok: true;
  corpo: Record<string, string>;
  targeting: Record<string, unknown>;
  reais: number;
  resumo: string;
};

const CLASSES = ["interests", "behaviors", "work_positions", "industries", "work_employers"] as const;

function objeto(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function reaisDoPedido(p: Record<string, unknown>): { reais: number } | RecusaConjunto {
  const emReais = p.orcamento_diario_reais ?? p.daily_budget_reais;
  const centavos = p.daily_budget;
  if (emReais != null && emReais !== "" && centavos != null && centavos !== "") {
    const r = Number(emReais);
    const c = Number(centavos);
    if (Number.isFinite(r) && Number.isFinite(c) && Math.round(r * 100) !== Math.round(c)) {
      return {
        ok: false,
        erro: "orcamento_ambiguo",
        detalhe: "orcamento_diario_reais e daily_budget discordam. Passe so orcamento_diario_reais (reais por dia).",
      };
    }
  }
  if (emReais != null && emReais !== "") {
    const r = Number(emReais);
    if (!Number.isFinite(r) || r <= 0) {
      return { ok: false, erro: "orcamento_invalido", detalhe: "orcamento_diario_reais tem de ser maior que zero, em reais." };
    }
    return { reais: r };
  }
  if (centavos != null && centavos !== "") {
    const c = Number(centavos);
    if (!Number.isFinite(c) || c < 100 || !Number.isInteger(c)) {
      return {
        ok: false,
        erro: "orcamento_invalido",
        detalhe: "daily_budget, quando usado, e inteiro em centavos (2000 = R$ 20). Prefira orcamento_diario_reais.",
      };
    }
    return { reais: c / 100 };
  }
  return { ok: false, erro: "orcamento_obrigatorio", detalhe: "Informe orcamento_diario_reais em reais por dia." };
}

function nomes(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista.map((item) => {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      return String(o.name ?? o.nome ?? o.key ?? o.id ?? "").trim();
    }
    return String(item ?? "").trim();
  }).filter(Boolean);
}

export function resumoLegivelDoConjunto(opts: {
  nome: string;
  reais: number;
  targeting: Record<string, unknown>;
}): string {
  const t = opts.targeting;
  const geo = objeto(t.geo_locations) ?? {};
  const exc = objeto(t.excluded_geo_locations) ?? {};
  const idadeMin = t.age_min != null ? String(t.age_min) : "?";
  const idadeMax = t.age_max != null ? String(t.age_max) : "65";
  const cidades = nomes(geo.cities);
  const bairros = Array.isArray(geo.neighborhoods) ? geo.neighborhoods.length : 0;
  const pinos = Array.isArray(geo.custom_locations) ? geo.custom_locations.length : 0;
  const bairrosExc = Array.isArray(exc.neighborhoods) ? exc.neighborhoods.length : 0;
  const pinosExc = Array.isArray(exc.custom_locations) ? exc.custom_locations.length : 0;
  const cidadesExc = nomes(exc.cities);
  const termos: string[] = [];
  const blocos = Array.isArray(t.flexible_spec) ? t.flexible_spec : [];
  for (const bloco of blocos) {
    const b = objeto(bloco);
    if (!b) continue;
    for (const classe of CLASSES) {
      const arr = b[classe];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const o = objeto(item);
        const nome = o ? String(o.name ?? o.nome ?? o.id ?? "").trim() : String(item ?? "").trim();
        if (nome) termos.push(`${nome} (${classe})`);
      }
    }
  }
  const auto = objeto(t.targeting_automation);
  const adv = auto ? Number(auto.advantage_audience) : NaN;
  const linhas = [
    `Conjunto "${opts.nome}"`,
    `Verba R$ ${opts.reais.toFixed(2)}/dia`,
    "Nasce pausado",
    `Idade ${idadeMin}–${idadeMax}`,
    cidades.length ? `Cidades: ${cidades.join(", ")}` : "",
    bairros ? `${bairros} bairro(s)` : "",
    pinos ? `${pinos} pino(s)` : "",
    (bairrosExc || pinosExc || cidadesExc.length)
      ? `Exclui ${[cidadesExc.length ? cidadesExc.join(", ") : "", bairrosExc ? `${bairrosExc} bairro(s)` : "", pinosExc ? `${pinosExc} pino(s)` : ""].filter(Boolean).join(", ")}`
      : "",
    termos.length ? `Segmentacao (${termos.length}): ${termos.join("; ")}` : "Segmentacao: nenhuma",
    `Advantage+ ${adv === 1 ? "ligado" : "desligado"}`,
  ];
  return linhas.filter(Boolean).join(". ");
}

export function validarSpecConjunto(p: Record<string, unknown> | null | undefined): ConjuntoMontado | RecusaConjunto {
  const pedido = p ?? {};
  const nome = String(pedido.nome ?? pedido.nome_novo ?? pedido.name ?? "").trim();
  if (!nome) return { ok: false, erro: "nome_obrigatorio", detalhe: "Informe nome do conjunto." };
  const campaignId = String(pedido.campaign_id ?? pedido.campanha_destino_external_id ?? "").trim();
  if (!/^\d{5,}$/.test(campaignId)) {
    return { ok: false, erro: "campaign_id_obrigatorio", detalhe: "campaign_id numerico da campanha pai." };
  }
  const dinheiro = reaisDoPedido(pedido);
  if ("ok" in dinheiro && dinheiro.ok === false) return dinheiro;
  const reais = (dinheiro as { reais: number }).reais;

  const optimization = String(pedido.optimization_goal ?? "").trim();
  const billing = String(pedido.billing_event ?? "").trim();
  const bid = String(pedido.bid_strategy ?? "").trim();
  const destination = String(pedido.destination_type ?? "").trim();
  if (!optimization || !billing || !bid || !destination) {
    return {
      ok: false,
      erro: "spec_incompleto",
      detalhe: "optimization_goal, billing_event, bid_strategy e destination_type sao obrigatorios. bid_strategy faltando a Meta recusa na primeira tentativa.",
    };
  }
  const promoted = objeto(pedido.promoted_object);
  if (!promoted || !Object.keys(promoted).length) {
    return { ok: false, erro: "promoted_object_obrigatorio", detalhe: "promoted_object completo (page_id e, em WhatsApp, o numero)." };
  }

  let targeting = pedido.targeting;
  if (typeof targeting === "string") {
    try {
      targeting = JSON.parse(targeting);
    } catch {
      return { ok: false, erro: "targeting_invalido", detalhe: "targeting nao e JSON." };
    }
  }
  const t = objeto(targeting);
  if (!t) return { ok: false, erro: "targeting_obrigatorio", detalhe: "Passe o targeting inteiro. Spec parcial nao entra." };
  const auto = objeto(t.targeting_automation);
  const adv = auto ? auto.advantage_audience : undefined;
  if (adv !== 0 && adv !== 1 && adv !== "0" && adv !== "1") {
    return {
      ok: false,
      erro: "targeting_parcial",
      detalhe:
        "targeting sem targeting_automation.advantage_audience (0 ou 1) e spec parcial. Reenviar sem esse campo apaga advantage_audience 0 em silencio.",
    };
  }
  if (t.age_min == null || t.age_min === "") {
    return { ok: false, erro: "targeting_parcial", detalhe: "targeting sem age_min." };
  }
  const geo = objeto(t.geo_locations);
  if (!geo || !Object.keys(geo).some((k) => k !== "location_types")) {
    return { ok: false, erro: "targeting_parcial", detalhe: "targeting sem geo_locations. Conjunto sem geo vira pais inteiro." };
  }
  const advNum = Number(adv) === 1 ? 1 : 0;
  t.targeting_automation = { ...(auto ?? {}), advantage_audience: advNum };

  const corpo: Record<string, string> = {
    name: nome,
    campaign_id: campaignId,
    daily_budget: String(Math.round(reais * 100)),
    optimization_goal: optimization,
    billing_event: billing,
    bid_strategy: bid,
    destination_type: destination,
    promoted_object: JSON.stringify(promoted),
    targeting: JSON.stringify(t),
    status: "PAUSED",
  };
  const start = String(pedido.start_time ?? "").trim();
  if (start) corpo.start_time = start;

  return {
    ok: true,
    corpo,
    targeting: t,
    reais,
    resumo: resumoLegivelDoConjunto({ nome, reais, targeting: t }),
  };
}
