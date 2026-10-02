import { lerObjetoAoVivo, nivelDoArgumento, type NivelObjeto } from "./ler_objeto.ts";

// Depois que a Meta aceita o POST, o que ficou pode nao ser o que foi pedido.
// validate_only verde nao encerra a conferencia. Esta comparacao e por valor:
// array vira conjunto, objeto compara chave a chave, numero compara como numero.

export type VereditoReleitura = "igual" | "normalizado" | "divergente";

export type CampoReleitura = {
  campo: string;
  valor_enviado: unknown;
  valor_gravado: unknown;
  veredito: VereditoReleitura;
};

const IGNORAR = new Set(["access_token", "execution_options", "id"]);

export function corpoEnviadoComoObjeto(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (IGNORAR.has(k) || v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        try {
          out[k] = JSON.parse(t);
          continue;
        } catch {
          /* texto comum */
        }
      }
    }
    out[k] = v;
  }
  return out;
}

export function camposPedidos(enviado: Record<string, unknown>): string {
  return Object.keys(enviado).filter((k) => enviado[k] !== undefined && !IGNORAR.has(k)).join(",");
}

function significativo(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

function numeroDe(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function assinatura(item: unknown): string {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const o = item as Record<string, unknown>;
    if (o.id != null && String(o.id).trim()) return `id:${String(o.id)}`;
    const chaves = Object.keys(o).sort();
    return JSON.stringify(chaves.map((k) => [k, assinatura(o[k])]));
  }
  if (Array.isArray(item)) return JSON.stringify([...item].map(assinatura).sort());
  const n = numeroDe(item);
  if (n != null && typeof item !== "boolean") return `n:${n}`;
  return `s:${String(item ?? "").trim().toLowerCase()}`;
}

function mesmoValor(a: unknown, b: unknown): boolean {
  const na = numeroDe(a);
  const nb = numeroDe(b);
  if (na != null && nb != null && typeof a !== "boolean" && typeof b !== "boolean") return na === nb;
  if (typeof a === "string" || typeof b === "string") {
    return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  }
  return assinatura(a) === assinatura(b);
}

function vereditoDeLista(enviado: unknown[], gravado: unknown[]): VereditoReleitura {
  const a = new Set(enviado.map(assinatura));
  const b = new Set((Array.isArray(gravado) ? gravado : []).map(assinatura));
  if (a.size === b.size && [...a].every((x) => b.has(x))) return "igual";
  const enviadoCabe = [...a].every((x) => b.has(x));
  const gravadoCabe = [...b].every((x) => a.has(x));
  if (enviadoCabe && !gravadoCabe) return "normalizado";
  return "divergente";
}

function blocoDeSpec(bloco: unknown): string {
  if (!bloco || typeof bloco !== "object" || Array.isArray(bloco)) return assinatura(bloco);
  const o = bloco as Record<string, unknown>;
  const partes = Object.keys(o).sort().map((k) => {
    const v = o[k];
    if (!Array.isArray(v)) return `${k}:${assinatura(v)}`;
    const ids = v.map(assinatura).sort();
    return `${k}:${JSON.stringify(ids)}`;
  });
  return partes.join("|");
}

function vereditoFlexibleSpec(enviado: unknown[], gravado: unknown): VereditoReleitura {
  const g = Array.isArray(gravado) ? gravado : [];
  const a = new Set(enviado.map(blocoDeSpec));
  const b = new Set(g.map(blocoDeSpec));
  if (a.size === b.size && [...a].every((x) => b.has(x))) return "igual";
  if ([...a].every((x) => b.has(x))) return "normalizado";
  return "divergente";
}

function empurrar(
  saida: CampoReleitura[],
  campo: string,
  valor_enviado: unknown,
  valor_gravado: unknown,
  veredito: VereditoReleitura,
) {
  saida.push({ campo, valor_enviado, valor_gravado, veredito });
}

function compararNo(
  enviado: unknown,
  gravado: unknown,
  anterior: unknown,
  caminho: string,
  saida: CampoReleitura[],
  checarOmissao: boolean,
) {
  if (Array.isArray(enviado)) {
    const nome = caminho.split(".").pop() ?? "";
    const veredito = nome === "flexible_spec"
      ? vereditoFlexibleSpec(enviado, gravado)
      : vereditoDeLista(enviado, Array.isArray(gravado) ? gravado : []);
    empurrar(saida, caminho, enviado, gravado ?? null, veredito);
    return;
  }
  if (enviado && typeof enviado === "object") {
    const env = enviado as Record<string, unknown>;
    const gra = gravado && typeof gravado === "object" && !Array.isArray(gravado)
      ? gravado as Record<string, unknown>
      : {};
    const ant = anterior && typeof anterior === "object" && !Array.isArray(anterior)
      ? anterior as Record<string, unknown>
      : null;
    for (const k of Object.keys(env)) {
      if (IGNORAR.has(k)) continue;
      compararNo(env[k], gra[k], ant ? ant[k] : undefined, caminho ? `${caminho}.${k}` : k, saida, true);
    }
    if (checarOmissao && ant) {
      for (const k of Object.keys(ant)) {
        if (k in env || IGNORAR.has(k)) continue;
        if (!significativo(ant[k])) continue;
        if (significativo(gra[k])) continue;
        saida.push({
          campo: caminho ? `${caminho}.${k}` : k,
          valor_enviado: { omitido_no_envio: true, havia: ant[k] },
          valor_gravado: gra[k] ?? null,
          veredito: "divergente",
        });
      }
    }
    return;
  }
  const veredito: VereditoReleitura = mesmoValor(enviado, gravado) ? "igual" : "divergente";
  empurrar(saida, caminho, enviado, gravado ?? null, veredito);
}

/** Compara o corpo enviado com o objeto relido. `anterior` pega chave que o POST omitiu e a Meta apagou. */
export function compararEnviadoComGravado(opts: {
  enviado: Record<string, unknown>;
  gravado: Record<string, unknown> | null;
  anterior?: Record<string, unknown> | null;
}): CampoReleitura[] {
  const saida: CampoReleitura[] = [];
  const enviado = corpoEnviadoComoObjeto(opts.enviado);
  const gravado = opts.gravado ?? {};
  compararNo(enviado, gravado, opts.anterior ?? null, "", saida, false);
  return saida.map((c) => ({ ...c, campo: c.campo.replace(/^\./, "") }));
}

export function carimboDaReleitura(campos: CampoReleitura[], leituraOk: boolean): "conferido" | "gravado_diferente" | "releitura_falhou" {
  if (!leituraOk) return "releitura_falhou";
  if (campos.some((c) => c.veredito === "divergente")) return "gravado_diferente";
  return "conferido";
}

export async function relerDepoisDaEscrita(opts: {
  token: string;
  objetoId: string;
  nivel: NivelObjeto | string;
  enviado: Record<string, unknown>;
  anterior?: Record<string, unknown> | null;
}): Promise<{
  leitura_ok: boolean;
  carimbo: "conferido" | "gravado_diferente" | "releitura_falhou";
  campos: CampoReleitura[];
  motivo?: string;
}> {
  const enviado = corpoEnviadoComoObjeto(opts.enviado);
  const nivel = nivelDoArgumento(opts.nivel);
  const campos = camposPedidos(enviado);
  if (!nivel || !campos) {
    return {
      leitura_ok: false,
      carimbo: "releitura_falhou",
      campos: [],
      motivo: "sem nivel ou sem campos para reler",
    };
  }
  const lido = await lerObjetoAoVivo({
    token: opts.token,
    id: opts.objetoId,
    nivel,
    campos,
  });
  if (lido.consulta_falhou) {
    return {
      leitura_ok: false,
      carimbo: "releitura_falhou",
      campos: [],
      motivo: String(lido.motivo ?? "releitura falhou"),
    };
  }
  const comparados = compararEnviadoComGravado({
    enviado,
    gravado: lido,
    anterior: opts.anterior ?? null,
  });
  return {
    leitura_ok: true,
    carimbo: carimboDaReleitura(comparados, true),
    campos: comparados,
  };
}

export async function gravarDivergenciasMeta(
  supa: { from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }> } },
  opts: { approvalId: string; objetoId: string; campos: CampoReleitura[] },
): Promise<{ ok: true; gravados: number } | { ok: false; motivo: string }> {
  const linhas = opts.campos
    .filter((c) => c.veredito !== "igual")
    .map((c) => ({
      approval_id: opts.approvalId,
      objeto_id: opts.objetoId,
      campo: c.campo,
      valor_enviado: c.valor_enviado ?? null,
      valor_gravado: c.valor_gravado ?? null,
      veredito: c.veredito,
    }));
  if (!linhas.length) return { ok: true, gravados: 0 };
  const { error } = await supa.from("divergencias_meta").insert(linhas);
  if (error) return { ok: false, motivo: error.message };
  return { ok: true, gravados: linhas.length };
}
