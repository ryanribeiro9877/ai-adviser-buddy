/** Só a tela. Não grava no banco: traduz o card cru para o gestor ler. */

export type RecoBruta = {
  title: string;
  description: string;
  impact?: string | null;
  category?: string | null;
  family?: string | null;
  signal_key?: string | null;
  entity_type?: string | null;
  entity_name?: string | null;
  evidence_json?: Record<string, unknown> | null;
  maturity_days?: number | null;
};

export type NumeroReco = { rotulo: string; valor: string };

export type OpiniaoTom = "fazer" | "nao_fazer" | "avaliar" | "informativo";

export type RecoNaTela = {
  titulo: string;
  onde: string | null;
  assunto: string;
  proposta: string;
  rotuloProposta: string;
  opiniao: string;
  opiniaoRotulo: string;
  opiniaoTom: OpiniaoTom;
  urgencia: string;
  familia: string;
  numeros: NumeroReco[];
  desde: string | null;
};

const FAMILIA: Record<string, string> = {
  meta_dica: "Dica da Meta",
  criativo_fadiga: "Fadiga de criativo",
  custo_teto: "Custo acima da régua",
  copy_legenda: "Legenda",
  video: "Vídeo",
  comparativo: "Comparativo",
  vencedor: "Criativo vencedor",
  criativo: "Criativo",
  custo: "Custo",
  escala: "Escala",
  geral: "Geral",
};

const ENTIDADE: Record<string, string> = {
  ad: "Anúncio",
  campaign: "Campanha",
  adset: "Conjunto",
  account: "Conta de anúncios",
};

const SKIP_EV = new Set([
  "fonte",
  "legenda",
  "base_clique",
  "janela",
  "veredito",
  "importance",
  "blame_field",
  "meta_recommendation_id",
  "first_seen_on",
  "campaign_name",
  "opportunity_score",
]);

export function rotuloFamiliaRecomendacao(familia: string | null | undefined): string {
  const k = String(familia ?? "").trim();
  if (!k) return "Geral";
  if (FAMILIA[k]) return FAMILIA[k];
  return k.replace(/[_./]+/g, " ").trim() || "Geral";
}

function rotuloUrgencia(impact: string | null | undefined): string {
  const k = String(impact ?? "").trim().toLowerCase();
  if (k === "high") return "Prioridade alta";
  if (k === "low") return "Prioridade baixa";
  return "Prioridade média";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace("%", "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtPt(n: number, casas = 2): string {
  const inteiro = Number.isInteger(n);
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: inteiro ? 0 : Math.min(casas, 2),
    maximumFractionDigits: casas,
  });
}

function pct(n: number): string {
  if (n === 0) return "0%";
  return `${fmtPt(n)}%`;
}

function dataBr(iso: unknown): string | null {
  const s = String(iso ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return null;
}

function ev(r: RecoBruta): Record<string, unknown> {
  return r.evidence_json && typeof r.evidence_json === "object" ? r.evidence_json : {};
}

function limparJargaoRecomendacao(texto: string): string {
  let out = String(texto ?? "");
  out = out.replace(/\[auto:[^\]]+\]/gi, "");
  out = out.replace(/Veredito interno:\s*[A-Z_]+\s*--\s*/gi, "");
  out = out.replace(/Veredito interno:\s*/gi, "");
  out = out.replace(/Fonte:\s*Graph[\s\S]*/gi, "");
  out = out.replace(/Base\s*=\s*cliques_no_link\/impressoes\.?/gi, "");
  out = out.replace(/Maturidade:\s*\d+\s*dias de entrega\.?/gi, "");
  out = out.replace(/objeto\s+(account|campaign|adset|ad)\s+"[^"]*"/gi, "");
  out = out.replace(/Dica da Meta coletada em \d{2}\/\d{2}\/\d{4}\s*\|?\s*/gi, "");
  out = out.replace(/A Graph devolveu\s+/gi, "");
  out = out.replace(/opportunity_score=\d+/gi, "");
  out = out.replace(/GET \/act_\*\/recommendations/gi, "lista de dicas");
  out = out.replace(/\bact_\d+\b/gi, "");
  out = out.replace(/\bSEM_REGUA\b/gi, "");
  out = out.replace(/Nenhuma doutrina\/RPC cobre este tipo de dica ainda\.?/gi, "");
  out = out.replace(/A dica foi guardada;\s*nao vira concordancia por omissao\.?/gi, "");
  out = out.replace(/doutrina\/RPC/gi, "regra nossa");
  out = out.replace(/\bpipeboard\b/gi, "");
  out = out.replace(/meta-campaign-status/gi, "");
  out = out.replace(/Badge do Ads Manager pode existir mesmo assim\.?/gi, "");
  out = out.replace(/\bAds Manager\b/gi, "Gerenciador de Anúncios");
  out = out.replace(/\bCTR de link\b/gi, "cliques no link");
  out = out.replace(/\bCBO\b/g, "orçamento único na campanha");
  out = out.replace(/\s*[|]\s*/g, ". ");
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.replace(/^[.\s]+|[.\s]+$/g, "").trim();
}

function limparTitulo(title: string): string {
  let t = String(title ?? "").trim();
  const os = t.match(/Opportunity Score da conta:\s*(\d+)/i);
  if (os) return `A Meta deu nota ${os[1]} para a conta`;
  t = t.replace(/^Meta:\s*/i, "");
  if (/campaign budget|CBO/i.test(t)) return "A Meta quer juntar o orçamento na campanha";
  if (/advantage\+/i.test(t)) return "A Meta quer ligar o Advantage+";
  if (/reprovad|disapproved|rejected/i.test(t)) return "A Meta reprovou um anúncio";
  t = t.replace(/\bact_\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return t || "Recomendação";
}

function montarOnde(r: RecoBruta): string | null {
  const tipo = ENTIDADE[String(r.entity_type ?? "")] ?? null;
  const nomeBruto = String(r.entity_name ?? "").trim();
  const nomeFeio = /^act_\d+$/i.test(nomeBruto);
  const partes: string[] = [];
  if (tipo) partes.push(tipo);
  if (nomeBruto && !nomeFeio) partes.push(nomeBruto);
  const camp = String(ev(r).campaign_name ?? "").trim();
  if (camp && r.entity_type !== "campaign" && r.entity_type !== "account") {
    partes.push(`campanha ${camp}`);
  }
  const dias = r.maturity_days;
  if (typeof dias === "number" && dias > 0) {
    partes.push(`${dias} ${dias === 1 ? "dia" : "dias"} no ar`);
  }
  return partes.length ? partes.join(" · ") : null;
}

function numerosDaEvidencia(e: Record<string, unknown>): NumeroReco[] {
  const out: NumeroReco[] = [];
  const ctrBase = num(e.ctr_link_base_3d);
  const ctrUlt = num(e.ctr_link_ultimo);
  if (ctrBase != null && ctrUlt != null) {
    out.push({ rotulo: "Cliques no link", valor: `de ${pct(ctrBase)} para ${pct(ctrUlt)}` });
  }
  const freqBase = num(e.frequencia_base_3d ?? e.frequencia_base);
  const freqUlt = num(e.frequencia_ultimo);
  if (freqBase != null && freqUlt != null) {
    out.push({
      rotulo: "Vezes que cada pessoa viu",
      valor: `de ${fmtPt(freqBase)} para ${fmtPt(freqUlt)}`,
    });
  }
  const pares = new Set([
    "ctr_link_base_3d",
    "ctr_link_ultimo",
    "frequencia_base_3d",
    "frequencia_base",
    "frequencia_ultimo",
  ]);
  const rotulo: Record<string, string> = {
    dias_entrega: "Dias no ar",
    ctr_link: "Cliques no link",
    mediana_peers_ctr_link: "Cliques no link das outras peças",
    custo_periodo: "Custo no período",
    teto: "Teto da casa",
    spend7: "Investido em 7 dias",
    resultados7: "Resultados em 7 dias",
    quality_ranking: "Qualidade na Meta",
    engagement_rate_ranking: "Engajamento na Meta",
    thruplay_rate: "Quanto assistem até o fim",
    avg_watch_s: "Tempo médio assistido",
    ctr_link_semana_atual: "Cliques nesta semana",
    ctr_link_semana_mes_passado: "Cliques na mesma semana do mês passado",
    custo7: "Custo em 7 dias",
  };
  const dinheiro = new Set(["custo_periodo", "teto", "spend7", "custo7"]);
  const percentual = new Set([
    "ctr_link",
    "mediana_peers_ctr_link",
    "ctr_link_semana_atual",
    "ctr_link_semana_mes_passado",
  ]);
  for (const [k, v] of Object.entries(e)) {
    if (SKIP_EV.has(k) || pares.has(k) || v == null || typeof v === "object") continue;
    const label = rotulo[k];
    if (!label) continue;
    const n = num(v);
    let valor: string;
    if (n == null) valor = String(v);
    else if (dinheiro.has(k)) {
      valor = n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    } else if (percentual.has(k)) valor = pct(n);
    else if (k === "avg_watch_s") valor = `${fmtPt(n, 1)} s`;
    else valor = fmtPt(n);
    out.push({ rotulo: label, valor });
  }
  return out.slice(0, 5);
}

function extrairMensagemMeta(description: string): string {
  const blocos = String(description ?? "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .filter(
      (b) =>
        !/^Dica da Meta coletada/i.test(b) &&
        !/^Veredito interno/i.test(b) &&
        !/^Fonte:/i.test(b),
    );
  const bruto = blocos[0] ?? "";
  return limparJargaoRecomendacao(bruto);
}

function notaDaConta(r: RecoBruta, e: Record<string, unknown>): Partial<RecoNaTela> {
  const score =
    num(e.opportunity_score) ??
    num((r.title.match(/:\s*(\d+)\s*$/) ?? [])[1]) ??
    null;
  const nota = score != null ? String(Math.round(score)) : null;
  const alta = score != null && score >= 80;
  return {
    titulo: nota ? `A Meta deu nota ${nota} para a conta` : "A Meta deu uma nota para a conta",
    assunto:
      "Essa é a nota que a Meta dá para a conta de anúncios, de 0 a 100. Serve como termômetro — não como ordem.",
    proposta: "A Meta não enviou nenhuma dica concreta para aplicar agora.",
    rotuloProposta: "O que a Meta pediu",
    opiniao: alta
      ? `O SuperGestor não recomenda mudar nada só por causa dessa nota. ${nota} é alto e a lista de dicas veio vazia.`
      : `O SuperGestor não trata essa pontuação como ordem. Olhe as outras recomendações desta aba — não altere a conta só para subir a nota.`,
    opiniaoRotulo: "Não precisa agir",
    opiniaoTom: "informativo",
  };
}

function opiniaoDaDicaMeta(veredito: string, motivoBruto: string): Pick<
  RecoNaTela,
  "opiniao" | "opiniaoRotulo" | "opiniaoTom"
> {
  const motivo = limparJargaoRecomendacao(motivoBruto);
  if (veredito === "discorda") {
    return {
      opiniaoRotulo: "Não siga agora",
      opiniaoTom: "nao_fazer",
      opiniao:
        "O SuperGestor discorda desta dica da Meta. " +
        (motivo ||
          "Seguir agora misturaria o desenho da conta e atrapalharia o teste que já está no ar."),
    };
  }
  if (veredito === "concorda") {
    return {
      opiniaoRotulo: "O SuperGestor concorda",
      opiniaoTom: "fazer",
      opiniao:
        "O SuperGestor concorda: " +
        (motivo || "isso trava a entrega e precisa ser corrigido, não é uma escolha de estratégia."),
    };
  }
  if (veredito === "nao_aplicavel") {
    return {
      opiniaoRotulo: "Não se aplica",
      opiniaoTom: "informativo",
      opiniao: "O SuperGestor entende que este aviso da Meta não se aplica a esta conta.",
    };
  }
  return {
    opiniaoRotulo: "Não siga só pela Meta",
    opiniaoTom: "informativo",
    opiniao:
      "O SuperGestor ainda não tem uma regra nossa para esse tipo de aviso. Guardamos o recado, mas não recomendamos seguir só porque a Meta sugeriu.",
  };
}

function dicaMeta(r: RecoBruta, e: Record<string, unknown>): Partial<RecoNaTela> {
  const veredito = String(e.veredito ?? "").toLowerCase();
  const motivoMatch = String(r.description ?? "").match(
    /Veredito interno:\s*[A-Z_]+\s*--\s*([^\n]+)/i,
  );
  const proposta =
    extrairMensagemMeta(r.description) ||
    "A Meta deixou um aviso no Gerenciador, sem um pedido claro.";
  return {
    titulo: limparTitulo(r.title),
    assunto: "Aviso que a Meta colocou no Gerenciador de Anúncios.",
    proposta,
    rotuloProposta: "O que a Meta pediu",
    ...opiniaoDaDicaMeta(veredito, motivoMatch?.[1] ?? ""),
  };
}

function fadiga(r: RecoBruta, e: Record<string, unknown>): Partial<RecoNaTela> {
  const dias = r.maturity_days ?? num(e.dias_entrega);
  return {
    titulo: "Este anúncio está cansando o público",
    assunto:
      "O criativo está sendo visto mais vezes e gerando menos cliques no link — sinal de que o público já conhece a peça.",
    proposta: "Vale trocar a peça ou o ângulo, em vez de só deixar o anúncio rodando.",
    rotuloProposta: "O que fazer",
    opiniaoRotulo: "Vale olhar",
    opiniaoTom: "avaliar",
    opiniao:
      "O SuperGestor recomenda tratar isso com prioridade: " +
      (dias ? `o anúncio já tem ${dias} dias no ar, ` : "") +
      "os cliques caíram e as pessoas estão vendo a peça com mais frequência.",
  };
}

function porSinal(sinal: string, r: RecoBruta, e: Record<string, unknown>): Partial<RecoNaTela> | null {
  if (sinal === "fadiga.ctr_freq") return fadiga(r, e);
  if (sinal === "ranking.meta_below") {
    return {
      titulo: "A Meta classificou este anúncio abaixo da média",
      assunto: "A plataforma está entregando menos porque acha a peça pior que a média do mercado.",
      proposta: "Revisar criativo (imagem, vídeo e texto) antes de aumentar verba.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor recomenda não escalar esta peça agora. Ranking baixo da Meta costuma puxar o custo para cima.",
    };
  }
  if (sinal === "custo.acima_teto") {
    return {
      titulo: "O custo passou da régua desta conta",
      assunto: "Cada resultado está saindo mais caro do que o teto combinado para esta operação.",
      proposta: "Decidir se madura mais alguns dias, ajusta público/peça ou reduz a verba.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor não manda pausar no automático — mas o custo já estourou a régua, então precisa de uma decisão consciente.",
    };
  }
  if (sinal === "custo.gasto_sem_resultado") {
    return {
      titulo: "Gastou e não veio resultado",
      assunto: "A campanha já rodou alguns dias, gastou verba e ainda não gerou o resultado que ela existe para gerar.",
      proposta: "Investigar criativo, público e oferta antes de continuar queimando verba.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor recomenda parar para diagnosticar. Continuar no piloto automático aqui só aumenta o prejuízo.",
    };
  }
  if (sinal === "copy.ctr_abaixo_peers") {
    return {
      titulo: "A legenda está rendendo menos que as outras",
      assunto: "Na mesma categoria, esta peça pega menos cliques no link do que a mediana das outras.",
      proposta: "Reescrever o gancho, a clareza e o chamado para ação da legenda.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor vê espaço real na copy. Vale testar 2 legendas novas nesta peça, sem inventar número.",
    };
  }
  if (sinal === "video.retencao_baixa") {
    return {
      titulo: "As pessoas não estão assistindo o vídeo até o fim",
      assunto: "O vídeo perde atenção cedo — o gancho dos primeiros segundos não está segurando.",
      proposta: "Trocar os primeiros segundos (gancho) antes de mexer em público ou verba.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor recomenda revisar o começo do vídeo. Sem retenção, o restante da campanha não tem o que otimizar.",
    };
  }
  if (sinal === "comparativo.mom_ctr") {
    return {
      titulo: "Os cliques caíram na comparação com o mês passado",
      assunto: "Nesta semana o anúncio está pegando bem menos cliques no link do que no mesmo período do mês anterior.",
      proposta: "Ver o que mudou (peça, público, oferta) e decidir se refresca o criativo.",
      opiniaoRotulo: "Vale olhar",
      opiniaoTom: "avaliar",
      opiniao:
        "O SuperGestor marca isso como tendência, não como acidente de um dia. Vale olhar o comparativo antes de escalar.",
    };
  }
  if (sinal === "vencedor.escala") {
    return {
      titulo: r.title.replace(/^Escalar criativo vencedor:\s*/i, "Escale o criativo vencedor: "),
      assunto: "Esta peça está gerando resultado abaixo do teto da casa, com volume suficiente para confiar no número.",
      proposta: "Aumentar o orçamento com calma ou duplicar este anúncio.",
      opiniaoRotulo: "Vale fazer",
      opiniaoTom: "fazer",
      opiniao:
        "O SuperGestor recomenda escalar. O custo está confortável frente à régua — o próximo passo é crescer sem resetar o aprendizado de uma vez.",
    };
  }
  if (sinal === "vencedor.padrao") {
    return {
      titulo: r.title.replace(/^Produza mais como:\s*/i, "Produza mais peças neste padrão: "),
      assunto: "Este criativo virou referência: o custo está bom e o formato/CTA merecem ser copiados.",
      proposta: "Produzir variações no mesmo padrão (formato, chamado e ângulo), não peças aleatórias.",
      opiniaoRotulo: "Vale fazer",
      opiniaoTom: "fazer",
      opiniao:
        "O SuperGestor recomenda replicar o que já funciona, em vez de começar do zero. Use esta peça como molde.",
    };
  }
  return null;
}

function fallback(r: RecoBruta): Partial<RecoNaTela> {
  const limpo = limparJargaoRecomendacao(r.description);
  return {
    titulo: limparTitulo(r.title),
    assunto: limpo || "Há um ponto de atenção nesta conta.",
    proposta: "Abra o chat para o SuperGestor detalhar o próximo passo com os números desta conta.",
    rotuloProposta: "O que fazer",
    opiniaoRotulo: "Vale olhar",
    opiniaoTom: "avaliar",
    opiniao:
      "O SuperGestor registrou este ponto para vocês decidirem com calma — não é uma ordem automática.",
  };
}

function ehNotaDaConta(r: RecoBruta): boolean {
  const sinal = String(r.signal_key ?? "");
  return /opportunity_score/i.test(sinal) || /opportunity score/i.test(r.title);
}

export function apresentarRecomendacao(r: RecoBruta): RecoNaTela {
  const e = ev(r);
  const sinal = String(r.signal_key ?? "");
  const familiaRaw = r.family ?? r.category ?? "geral";
  const base: RecoNaTela = {
    titulo: limparTitulo(r.title),
    onde: montarOnde(r),
    assunto: "",
    proposta: "",
    rotuloProposta: "O que fazer",
    opiniao: "",
    opiniaoRotulo: "Vale olhar",
    opiniaoTom: "avaliar",
    urgencia: rotuloUrgencia(r.impact),
    familia: rotuloFamiliaRecomendacao(familiaRaw),
    numeros: numerosDaEvidencia(e),
    desde: dataBr(e.first_seen_on),
  };

  const extra = ehNotaDaConta(r)
    ? notaDaConta(r, e)
    : familiaRaw === "meta_dica"
      ? dicaMeta(r, e)
      : porSinal(sinal, r, e) ?? fallback(r);

  return { ...base, ...extra };
}
