// Nomenclatura Meta — NOME LIVRE e o contrato vigente.
// O gestor/agente pode passar qualquer string em nome / nome_novo / novo_nome / target_name.
// O padrao estruturado [MARCA][CANAL][OBJETIVO][PRODUTO?][PAPEL?][ROTULO?][PERIODO] e apenas
// SUGESTAO OPCIONAL (helper montarNomeMeta / resolverNomePartesDoParams) quando pedirem
// ou quando so houver partes sem string livre.
// Ex. sugestao: [LEV][LP][LEADS][CLT][TESTE][HOOK-A][AGO26]

export type PapelCampanha = "teste" | "escala" | "desconhecido";

export type NomePartes = {
  marca: string;
  canal: string;
  objetivo_tag: string;
  produto?: string | null;
  /** TESTE | ESCALA — opcional; so entra no composto se informado. */
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

export type NomeResolvido =
  | {
      ok: true;
      nome: string;
      origem: "livre" | "composto";
      partes: Extract<NomeMontado, { ok: true }>["partes"] | null;
    }
  | {
      ok: false;
      erro: string;
      detalhe: string;
      faltando?: string[];
    };

const TOKEN_OK = /^[A-Z0-9][A-Z0-9._+-]*$/;
const PAPEIS = new Set(["TESTE", "ESCALA"]);

/** Normaliza um pedaco do nome composto: maiusculas, espacos viram -, sem colchetes. */
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
 * Helper OPCIONAL: monta sugestao estruturada a partir dos campos.
 * Nao e obrigatorio para criar/renomear — use resolverNomeFinal quando houver nome livre.
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
      erro: "campos_de_nomenclatura_incompletos_para_sugestao",
      detalhe: exigirPapel
        ? "Para sugerir o padrao estruturado informe marca, canal, objetivo_tag, papel (TESTE|ESCALA) e periodo. Opcional: produto, rotulo. Ou passe nome livre."
        : "Para sugerir o padrao estruturado informe marca, canal, objetivo_tag e periodo. Opcional: produto, papel, rotulo. Ou passe nome livre.",
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
        detalhe: `papel deve ser TESTE ou ESCALA (recebi "${pap.token}").`,
      };
    }
    papel = pap.token;
  } else if (exigirPapel) {
    return {
      ok: false,
      erro: "papel_obrigatorio_na_sugestao",
      detalhe: "Sugestao de campanha pediu papel=TESTE ou ESCALA. Ou passe nome livre.",
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
 * Resolve partes a partir do params do card (helper de sugestao).
 * Se objetivo_tag faltar, tenta derivar do objective ODAX.
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

/**
 * Contrato vigente: NOME LIVRE tem prioridade.
 * 1) Se houver string livre (nome/nome_novo/novo_nome/target_name util) → usa.
 * 2) Senao, se der para montar pelas partes → usa o composto (sugestao).
 * 3) Senao → erro pedindo um nome.
 */
export function resolverNomeFinal(opts: {
  nomeLivre?: string | null;
  params?: Record<string, unknown> | null;
  defaultMarca?: string | null;
  objetivoOdax?: string | null;
  /** So para fallback composto; nao bloqueia nome livre. */
  preferirPapelNoComposto?: boolean;
}): NomeResolvido {
  const livre = String(opts.nomeLivre ?? "").trim();
  if (livre) {
    let partes: Extract<NomeMontado, { ok: true }>["partes"] | null = null;
    const montado = resolverNomePartesDoParams(opts.params, {
      defaultMarca: opts.defaultMarca,
      objetivoOdax: opts.objetivoOdax,
      exigirPapel: false,
    });
    if (montado.ok) partes = montado.partes;
    return { ok: true, nome: livre, origem: "livre", partes };
  }

  const montado = resolverNomePartesDoParams(opts.params, {
    defaultMarca: opts.defaultMarca,
    objetivoOdax: opts.objetivoOdax,
    exigirPapel: opts.preferirPapelNoComposto === true,
  });
  if (montado.ok) {
    return { ok: true, nome: montado.nome, origem: "composto", partes: montado.partes };
  }
  return {
    ok: false,
    erro: "nome_obrigatorio",
    detalhe:
      "Informe um nome livre (nome / nome_novo / novo_nome / target_name). O padrao [MARCA][CANAL][…] e opcional — so use se quiser sugestao estruturada.",
    faltando: montado.faltando,
  };
}

/**
 * Soft-check: se ha nome_partes E quiser validar alinhamento com o composto.
 * Com nome livre vigente, divergencia NAO e erro duro — preferir resolverNomeFinal.
 * Mantido para compatibilidade / auditoria opcional.
 */
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
      detalhe: `nome_novo="${nomeNovo}" e as partes montam "${montado.nome}". Com nome livre vigente, use o nome_novo como fonte da verdade (ignore o alinhamento) ou alinhe as partes.`,
    };
  }
  return { ok: true, nome: montado.nome, partes: montado.partes };
}
