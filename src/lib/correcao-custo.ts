// Travas do vigia de regua. Puras: sem banco, sem LLM, sem estado de modulo.
// O prompt nao e trava. Quem grava o plano chama isto antes.

export const ALAVANCAS_PERMITIDAS = [
  "pausar_criativo",
  "ativar_criativo",
  "criar_anuncio_a_partir_de",
  "ajustar_posicionamentos_do_conjunto",
] as const;

export const ALAVANCAS_PROIBIDAS = [
  "alterar_orcamento",
  "alterar_publico_do_conjunto",
  "alterar_geo_do_conjunto",
  "alterar_idade_do_conjunto",
  "escalar_duplicar",
  "escalar_criativo",
  "pausar_campanha",
  "ativar_campanha",
  "pausar_conjunto",
  "renomear_campanha",
  "renomear_conjunto",
  "renomear_criativo",
  "alterar_categoria_especial_campanha",
] as const;

export const CARENCIA_DIAS = 3;
export const VAZAO_POR_EMPRESA = 3;

const PERMITIDAS: ReadonlySet<string> = new Set(ALAVANCAS_PERMITIDAS);

export type VereditoPlano = "agir" | "nao_agir" | "sem_dado";

export type ResultadoValidacao = {
  ok: boolean;
  veredito: VereditoPlano;
  alavanca: string | null;
  motivo: string | null;
  atos: string[];
};

export type Escada = {
  alavanca: string | null;
  atos: string[];
  motivo: string | null;
};

function tipoDe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function diaIso(v: unknown): string | null {
  const s = texto(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function diasEntre(inicio: string, fim: string): number | null {
  const a = Date.parse(`${inicio.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${fim.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function recusa(motivo: string, alavanca: string | null = null): ResultadoValidacao {
  return { ok: false, veredito: "nao_agir", alavanca, motivo, atos: [] };
}

function atosDe(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
}

/**
 * Recusa plano fora da lista branca, sem reversa, que pausa o ultimo anuncio
 * que entrega, ou dentro da carencia de 3 dias. Veredito nao_agir/sem_dado
 * so passa com atos vazios.
 */
export function validarPlanoDeCorrecao(entrada: unknown): ResultadoValidacao {
  if (entrada == null || typeof entrada !== "object" || Array.isArray(entrada)) {
    return recusa(`entrada_invalida:${tipoDe(entrada)}`);
  }
  const e = entrada as Record<string, unknown>;
  const vereditoBruto = texto(e.veredito);
  const veredito: VereditoPlano = vereditoBruto === "sem_dado"
    ? "sem_dado"
    : vereditoBruto === "nao_agir"
      ? "nao_agir"
      : "agir";
  const alavanca = texto(e.alavanca) || null;
  const atos = atosDe(e.atos_propostos);
  const acoes = atos.map((a) => texto(a.action)).filter(Boolean);

  if (veredito !== "agir") {
    if (acoes.length > 0) return recusa("veredito_sem_acao_com_atos", alavanca);
    return { ok: true, veredito, alavanca: null, motivo: texto(e.motivo) || null, atos: [] };
  }

  if (!alavanca || !PERMITIDAS.has(alavanca)) {
    return recusa(`alavanca_proibida:${alavanca ?? "ausente"}`, alavanca);
  }
  if (acoes.some((a) => !PERMITIDAS.has(a))) {
    const ruim = acoes.find((a) => !PERMITIDAS.has(a)) ?? "ausente";
    return recusa(`alavanca_proibida:${ruim}`, alavanca);
  }
  if (alavanca === "ajustar_posicionamentos_do_conjunto" && acoes.length > 1) {
    return recusa("posicionamento_nao_combina_com_outra_alavanca", alavanca);
  }
  if (acoes.includes("ajustar_posicionamentos_do_conjunto") && acoes.length > 1) {
    return recusa("posicionamento_nao_combina_com_outra_alavanca", alavanca);
  }

  const entregando = Number(e.anuncios_entregando_no_conjunto);
  const pausaUltimo = e.pausaria_ultimo_anuncio === true
    || (alavanca === "pausar_criativo" && Number.isFinite(entregando) && entregando <= 1)
    || (acoes.includes("pausar_criativo") && Number.isFinite(entregando) && entregando <= 1);
  if (pausaUltimo && (alavanca === "pausar_criativo" || acoes.includes("pausar_criativo"))) {
    return recusa("ultimo_anuncio_que_entrega", alavanca);
  }

  const hoje = diaIso(e.hoje) ?? new Date().toISOString().slice(0, 10);
  const ultima = diaIso(e.ultima_intervencao_em);
  if (ultima) {
    const decorridos = diasEntre(ultima, hoje);
    if (decorridos != null && decorridos < CARENCIA_DIAS) {
      return recusa("carencia_3_dias", alavanca);
    }
  }
  const carenciaAte = diaIso(e.carencia_ate);
  if (carenciaAte && carenciaAte > hoje) return recusa("carencia_3_dias", alavanca);

  if (!texto(e.reversa)) return recusa("sem_reversa", alavanca);

  if (e.cruzamento_linha === true) return recusa("cruzamento_linha_produto", alavanca);
  if (e.pode_executar === false) {
    return recusa(`acao_nao_executavel:${texto(e.motivo_pode_executar) || alavanca}`, alavanca);
  }
  if (
    (alavanca === "criar_anuncio_a_partir_de" || acoes.includes("criar_anuncio_a_partir_de"))
    && e.peca_acervo_ok === false
  ) {
    return recusa("peca_fora_do_acervo", alavanca);
  }

  const faltando = ["evidencia", "mecanismo", "criterio_de_sucesso", "prazo_de_leitura", "risco"]
    .filter((k) => !texto(e[k]));
  if (faltando.length) return recusa(`campo_faltando:${faltando.join(",")}`, alavanca);
  if (!diaIso(e.prazo_de_leitura)) return recusa("prazo_de_leitura_invalido", alavanca);
  if (acoes.length === 0) return recusa("agir_sem_atos", alavanca);

  return { ok: true, veredito: "agir", alavanca, motivo: null, atos: acoes };
}

/**
 * Escada: (1) pausar a peca cara se sobram pecas entregando;
 * (2) criar do acervo junto com a pausa, ou sozinha se pausar deixaria pouca peca;
 * (3) posicionamento sozinho, so com volume proprio no breakdown.
 * Nunca pausa o ultimo anuncio que entrega.
 */
export function escolherEscada(entrada: unknown): Escada {
  if (entrada == null || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { alavanca: null, atos: [], motivo: `contexto_invalido:${tipoDe(entrada)}` };
  }
  const e = entrada as Record<string, unknown>;
  const esgotadas = new Set(
    (Array.isArray(e.alavancas_esgotadas) ? e.alavancas_esgotadas : []).map((x) => texto(x)),
  );
  if (e.carencia === true) return { alavanca: null, atos: [], motivo: "carencia_3_dias" };
  const entregando = Number(e.anuncios_entregando);
  const n = Number.isFinite(entregando) ? entregando : 0;
  const podeCusto = e.pode_pausar_por_custo !== false;
  const peca = e.peca_ok === true && e.cruzamento !== true;
  const posicionamento = e.posicionamento_com_volume === true;
  const livre = (nome: string) => !esgotadas.has(nome);

  const ultimo = n <= 1;
  const pouca = n < 3;
  if (!ultimo && !pouca && podeCusto && livre("pausar_criativo")) {
    if (peca && livre("criar_anuncio_a_partir_de")) {
      return {
        alavanca: "pausar_criativo",
        atos: ["pausar_criativo", "criar_anuncio_a_partir_de"],
        motivo: null,
      };
    }
    return { alavanca: "pausar_criativo", atos: ["pausar_criativo"], motivo: null };
  }
  if (peca && livre("criar_anuncio_a_partir_de") && (pouca || ultimo || !podeCusto)) {
    return { alavanca: "criar_anuncio_a_partir_de", atos: ["criar_anuncio_a_partir_de"], motivo: null };
  }
  if (posicionamento && livre("ajustar_posicionamentos_do_conjunto")) {
    return {
      alavanca: "ajustar_posicionamentos_do_conjunto",
      atos: ["ajustar_posicionamentos_do_conjunto"],
      motivo: null,
    };
  }
  if (esgotadas.size > 0) return { alavanca: null, atos: [], motivo: "familia_esgotada" };
  return { alavanca: null, atos: [], motivo: "sem_alavanca_segura" };
}
