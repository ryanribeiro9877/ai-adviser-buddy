// ESP-40 — nome Meta composto a partir de campos estruturados (opcao 2).
// Ordem canonica observada nos objetos bons da LEV:
//   [MARCA][CANAL][OBJETIVO][PRODUTO?][ROTULO?][PERIODO]
// Ex.: [LEV][LP][LEADS][CLT][NOVA-01][AGO26]
// Nome livre NAO e aceito em criacao/renomeacao sancionada: o sistema MONTA o nome.

export type NomePartes = {
  marca: string;
  canal: string;
  objetivo_tag: string;
  produto?: string | null;
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

/** Normaliza um pedaco do nome: maiusculas, espacos viram -, sem colchetes. */
export function sanitizarToken(raw: unknown, campo: string): { ok: true; token: string } | { ok: false; erro: string } {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (!s) return { ok: false, erro: `${campo}_vazio` };
  if (s.includes("[") || s.includes("]")) {
    return { ok: false, erro: `${campo}_nao_pode_conter_colchetes` };
  }
  if (!TOKEN_OK.test(s)) {
    return {
      ok: false,
      erro: `${campo}_invalido`,
    };
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

/**
 * Monta o nome Meta a partir dos campos. produto e rotulo sao opcionais.
 * marca, canal, objetivo_tag e periodo sao obrigatorios.
 */
export function montarNomeMeta(
  input: Partial<NomePartes> & Record<string, unknown>,
): NomeMontado {
  const faltando: string[] = [];
  for (const k of ["marca", "canal", "objetivo_tag", "periodo"] as const) {
    if (!String(input?.[k] ?? "").trim()) faltando.push(k);
  }
  if (faltando.length) {
    return {
      ok: false,
      erro: "campos_de_nomenclatura_obrigatorios",
      detalhe:
        "Informe marca, canal, objetivo_tag e periodo. Opcional: produto, rotulo. O sistema MONTA o nome no padrao [MARCA][CANAL][OBJETIVO][PRODUTO?][ROTULO?][PERIODO] — nao invente nome livre.",
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
  let rotulo: string | null = null;
  if (String(input.rotulo ?? "").trim()) {
    const r = sanitizarToken(input.rotulo, "rotulo");
    if (!r.ok) return { ok: false, erro: r.erro, detalhe: `rotulo invalido: ${String(input.rotulo)}` };
    rotulo = r.token;
  }

  const tokens = [marca.token, canal.token, objetivo.token];
  if (produto) tokens.push(produto);
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
  opts?: { defaultMarca?: string | null; objetivoOdax?: string | null },
): NomeMontado {
  const p = params ?? {};
  const objetivoTag =
    String(p.objetivo_tag ?? "").trim() ||
    (opts?.objetivoOdax ? objetivoTagDeOdax(opts.objetivoOdax) : null) ||
    (p.objetivo ? objetivoTagDeOdax(String(p.objetivo)) : null) ||
    "";
  return montarNomeMeta({
    marca: String(p.marca ?? opts?.defaultMarca ?? "").trim(),
    canal: String(p.canal ?? "").trim(),
    objetivo_tag: objetivoTag,
    produto: p.produto == null ? null : String(p.produto),
    rotulo: p.rotulo == null ? null : String(p.rotulo),
    periodo: String(p.periodo ?? "").trim(),
  });
}

/** Na execucao: se o payload traz nome_partes, o nome_novo TEM de bater com o composto. */
export function conferirNomeComPartes(
  nomeNovo: string,
  partes: Record<string, unknown> | null | undefined,
):
  | { ok: true; nome: string; partes: NomeMontado extends { ok: true } ? NomeMontado["partes"] : never }
  | { ok: false; erro: string; detalhe: string } {
  const montado = montarNomeMeta((partes ?? {}) as NomePartes);
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
