// ESP-40 + ESP-39 — nome Meta composto a partir de campos estruturados.
// Ordem canonica:
//   [MARCA][CANAL][OBJETIVO][PRODUTO?][PAPEL?][ROTULO?][PERIODO]
// Ex. campanha TESTE:  [LEV][LP][LEADS][CLT][TESTE][HOOK-A][AGO26]
// Ex. campanha ESCALA: [LEV][LP][LEADS][CLT][ESCALA][V1][AGO26]
// Nome livre NAO e aceito em criacao/renomeacao sancionada: o sistema MONTA o nome.
// ESP-39: papel TESTE|ESCALA e obrigatorio em campanha (criar/renomear); vencedores e
// testes vivem em campanhas SEPARADAS.

export type PapelCampanha = "teste" | "escala" | "desconhecido";

export type NomePartes = {
  marca: string;
  canal: string;
  objetivo_tag: string;
  produto?: string | null;
  /** TESTE | ESCALA — obrigatorio em campanha (ESP-39). */
  papel?: string | null;
  rotulo?: string | null;
  periodo: string;
};

export type NomeMontado =
  | {
      ok: true;
      nome: string;
      partes: {
        marca: string;
        canal: string;
        objetivo_tag: string;
        produto: string | null;
        papel: string | null;
        rotulo: string | null;
        periodo: string;
      };
    }
  | {
      ok: false;
      erro: string;
      detalhe: string;
      faltando?: string[];
    };

const TOKEN_OK = /^[A-Z0-9][A-Z0-9._+-]*$/;
const PAPEIS = new Set(["TESTE", "ESCALA"]);

/** Normaliza um pedaco do nome: maiusculas, espacos viram -, sem colchetes. */
export function sanitizarToken(raw: unknown, campo: string): { ok: true; token: string } | { ok: false; erro: string } {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (!s) return { ok: false, erro: `${campo}_vazio` };
  if (s.includes("[") || s.includes("]")) {
    return { ok: false, erro: `${campo}_nao_pode_conter_colchetes` };
  }
  if (!TOKEN_OK.test(s)) {
    return { ok: false, erro: `${campo}_invalido` };
  }
  if (s.length > 40) return { ok: false, erro: `${campo}_longo_demais` };
  return { ok: true, token: s };
}

/** Mapeia objective ODAX → tag curta do nome (quando o agente nao informar objetivo_tag). */
export function objetivoTagDeOdax(objetivo: string): string | null {
  const o = String(objetivo ?? "").trim().toUpperCase();
  const map: Record<string, string> = {
    OUTCOME_LEADS: "LEADS",
    OUTCOME_SALES: "SALES",
    OUTCOME_TRAFFIC: "TRAFFIC",
    OUTCOME_ENGAGEMENT: "ENGAGEMENT",
    OUTCOME_AWARENESS: "AWARENESS",
    OUTCOME_APP_PROMOTION: "APP",
  };
  return map[o] ?? null;
}

/** Classifica campanha pelo nome (tokens entre colchetes). Legacy TESTE-* conta como teste. */
export function classificarPapelCampanha(nome: string): PapelCampanha {
  const tokens = [...String(nome ?? "").matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].toUpperCase());
  if (tokens.includes("TESTE") || tokens.some((t) => t.startsWith("TESTE"))) return "teste";
  if (tokens.includes("ESCALA") || tokens.includes("VENCEDOR")) return "escala";
  return "desconhecido";
}

/**
 * Monta o nome Meta a partir dos campos.
 * marca, canal, objetivo_tag e periodo sao sempre obrigatorios.
 * papel (TESTE|ESCALA) e obrigatorio quando opts.exigirPapel (campanha).
 */
export function montarNomeMeta(
  input: Partial<NomePartes> & Record<string, unknown>,
  opts?: { exigirPapel?: boolean },
): NomeMontado {
  const exigirPapel = opts?.exigirPapel === true;
  const faltando: string[] = [];
  for (const k of ["marca", "canal", "objetivo_tag", "periodo"] as const) {
    if (!String(input?.[k] ?? "").trim()) faltando.push(k);
  }
  if (exigirPapel && !String(input?.papel ?? "").trim()) faltando.push("papel");
  if (faltando.length) {
    return {
      ok: false,
      erro: "campos_de_nomenclatura_obrigatorios",
      detalhe: exigirPapel
        ? "Informe marca, canal, objetivo_tag, papel (TESTE|ESCALA) e periodo. Opcional: produto, rotulo. Padrao [MARCA][CANAL][OBJ][PROD?][PAPEL][ROT?][PER]."
        : "Informe marca, canal, objetivo_tag e periodo. Opcional: produto, papel, rotulo.",
      faltando,
    };
  }

  const marca = sanitizarToken(input.marca, "marca");
  if (!marca.ok) return { ok: false, erro: marca.erro, detalhe: `marca invalida: ${String(input.marca)}` };
  const canal = sanitizarToken(input.canal, "canal");
  if (!canal.ok) return { ok: false, erro: canal.erro, detalhe: `canal invalido: ${String(input.canal)}` };
  const objetivo = sanitizarToken(input.objetivo_tag, "objetivo_tag");
  if (!objetivo.ok) {
    return { ok: false, erro: objetivo.erro, detalhe: `objetivo_tag invalido: ${String(input.objetivo_tag)}` };
  }
  const periodo = sanitizarToken(input.periodo, "periodo");
  if (!periodo.ok) {
    return { ok: false, erro: periodo.erro, detalhe: `periodo invalido: ${String(input.periodo)}` };
  }

  let produto: string | null = null;
  if (String(input.produto ?? "").trim()) {
    const p = sanitizarToken(input.produto, "produto");
    if (!p.ok) return { ok: false, erro: p.erro, detalhe: `produto invalido: ${String(input.produto)}` };
    produto = p.token;
  }

  let papel: string | null = null;
  if (String(input.papel ?? "").trim()) {
    const pap = sanitizarToken(input.papel, "papel");
    if (!pap.ok) return { ok: false, erro: pap.erro, detalhe: `papel invalido: ${String(input.papel)}` };
    if (!PAPEIS.has(pap.token)) {
      return {
        ok: false,
        erro: "papel_invalido",
        detalhe: `papel deve ser TESTE ou ESCALA (recebi "${pap.token}"). ESP-39: vencedores e testes em campanhas separadas.`,
      };
    }
    papel = pap.token;
  } else if (exigirPapel) {
    return {
      ok: false,
      erro: "papel_obrigatorio",
      detalhe: "Campanha exige papel=TESTE ou ESCALA.",
      faltando: ["papel"],
    };
  }

  let rotulo: string | null = null;
  if (String(input.rotulo ?? "").trim()) {
    const r = sanitizarToken(input.rotulo, "rotulo");
    if (!r.ok) return { ok: false, erro: r.erro, detalhe: `rotulo invalido: ${String(input.rotulo)}` };
    rotulo = r.token;
  }

  const tokens = [marca.token, canal.token, objetivo.token];
  if (produto) tokens.push(produto);
  if (papel) tokens.push(papel);
  if (rotulo) tokens.push(rotulo);
  tokens.push(periodo.token);

  const nome = tokens.map((t) => `[${t}]`).join("");
  return {
    ok: true,
    nome,
    partes: {
      marca: marca.token,
      canal: canal.token,
      objetivo_tag: objetivo.token,
      produto,
      papel,
      rotulo,
      periodo: periodo.token,
    },
  };
}

/**
 * Resolve partes a partir do params do card. Se objetivo_tag faltar, tenta derivar do
 * objective ODAX (params.objetivo). marca pode vir de defaultMarca (config da empresa).
 */
export function resolverNomePartesDoParams(
  params: Record<string, unknown> | null | undefined,
  opts?: { defaultMarca?: string | null; objetivoOdax?: string | null; exigirPapel?: boolean },
): NomeMontado {
  const p = params ?? {};
  const objetivoTag =
    String(p.objetivo_tag ?? "").trim() ||
    (opts?.objetivoOdax ? objetivoTagDeOdax(opts.objetivoOdax) : null) ||
    (p.objetivo ? objetivoTagDeOdax(String(p.objetivo)) : null) ||
    "";
  return montarNomeMeta(
    {
      marca: String(p.marca ?? opts?.defaultMarca ?? "").trim(),
      canal: String(p.canal ?? "").trim(),
      objetivo_tag: objetivoTag,
      produto: p.produto == null ? null : String(p.produto),
      papel: p.papel == null ? null : String(p.papel),
      rotulo: p.rotulo == null ? null : String(p.rotulo),
      periodo: String(p.periodo ?? "").trim(),
    },
    { exigirPapel: opts?.exigirPapel === true },
  );
}

/** Na execucao: se o payload traz nome_partes, o nome_novo TEM de bater com o composto. */
export function conferirNomeComPartes(
  nomeNovo: string,
  partes: Record<string, unknown> | null | undefined,
  opts?: { exigirPapel?: boolean },
):
  | { ok: true; nome: string; partes: Extract<NomeMontado, { ok: true }>["partes"] }
  | { ok: false; erro: string; detalhe: string } {
  const montado = montarNomeMeta((partes ?? {}) as NomePartes, opts);
  if (!montado.ok) {
    return { ok: false, erro: montado.erro, detalhe: montado.detalhe };
  }
  if (String(nomeNovo ?? "").trim() !== montado.nome) {
    return {
      ok: false,
      erro: "nome_divergiu_das_partes",
      detalhe: `nome_novo="${nomeNovo}" mas as partes montam "${montado.nome}". O nome e derivado dos campos — nao edite nome_novo a mao.`,
    };
  }
  return { ok: true, nome: montado.nome, partes: montado.partes };
}
