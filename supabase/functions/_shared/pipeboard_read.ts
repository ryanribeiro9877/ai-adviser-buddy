// Leitura ao vivo do Pipeboard: so tools de leitura, escopadas a contas da empresa.
// Escrita continua em meta-actions. Sync diario (structure/metrics) continua oficial para historico.

import { pipeboardCall, pipeboardListTools } from "./pipeboard.ts";

const READ_PREFIXES = [
  "get_",
  "list_",
  "search_",
  "estimate_",
  "resolve_",
  "check_",
  "compute_",
  "bulk_get_",
  // Entrou em 03/09/2026 pela enumeracao do catalogo remoto: bulk_search_interests e leitura
  // (readOnlyHint=true, aceita account_id, so consulta a taxonomia de interesses) e estava
  // recusada por acidente de grafia — bulk_get_ existia, bulk_search_ nao. Perda de
  // capacidade, nao de seguranca: era a unica forma de resolver varios interesses numa
  // chamada, e sem ela o agente gastava uma execucao de ferramenta por palavra-chave.
  "bulk_search_",
] as const;

// `fetch` e o par do `search` do conector: devolve so registros que um `search` anterior
// cacheou NA MESMA SESSAO, e nao faz chamada direta a API. Como `search` continua recusado
// (ver NAO_ESCOPAVEIS), `fetch` esta permitido e inerte — nunca ha cache para ele devolver.
const READ_EXACT = new Set(["fetch"]);

/**
 * Leituras que o catalogo remoto declara readOnlyHint=true e que continuam RECUSADAS de
 * proposito, por isolamento de empresa e nao por efeito.
 *
 * `search` varre "ad accounts, campaigns, ads, pages, and businesses" e recebe so (query,
 * access_token): nao tem account_id no schema, entao scopeArgsToCompany NAO consegue prende-lo
 * as contas da empresa da conversa. Uma leitura que atravessa contas e um vazamento entre
 * clientes do mesmo conector — dano diferente do de escrita, e igualmente inaceitavel.
 * Mantido aqui como registro explicito: a recusa e uma decisao, nao um esquecimento de grafia
 * como foi a do bulk_search_.
 */
export const NAO_ESCOPAVEIS_POR_EMPRESA = new Set(["search"]);

const WRITE_PREFIXES = [
  "create_",
  "update_",
  "delete_",
  "upload_",
  "duplicate_",
  "publish_",
  "manage_",
  "submit_",
  "buy_",
  "bulk_create",
  "bulk_update",
  "bulk_upload",
  "add_",
  "remove_",
] as const;

export const PIPEBOARD_READ_PAYLOAD_CAP = 35000;

/**
 * Anotacoes que o servidor MCP declara por ferramenta. Todas OPCIONAIS no protocolo, e a
 * ausencia nao afirma nada: quem nao declara nada nao esta dizendo "sou leitura".
 */
export type PipeboardAnotacoes = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type PipeboardToolDef = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: PipeboardAnotacoes;
};

export function isReadOnlyTool(name: string): boolean {
  const n = String(name ?? "").trim();
  if (!n) return false;
  if (WRITE_PREFIXES.some((p) => n.startsWith(p))) return false;
  if (NAO_ESCOPAVEIS_POR_EMPRESA.has(n)) return false;
  if (READ_EXACT.has(n)) return true;
  return READ_PREFIXES.some((p) => n.startsWith(p));
}

export type MotivoRecusa =
  | "ok"
  | "nome_fora_da_lista_de_leitura"
  | "servidor_declara_nao_leitura"
  | "servidor_declara_destrutiva";

export type VereditoFerramentaPipeboard = {
  name: string;
  /** Decisao final: so true quando o NOME passa E o servidor nao desmente. */
  leitura: boolean;
  motivo: MotivoRecusa;
  /** Veredito so pelo nome — o que a guarda fazia sozinha antes de 03/09/2026. */
  nome_passa: boolean;
  anotacoes: PipeboardAnotacoes;
};

/**
 * Veredito de leitura de UMA ferramenta remota, por nome E pelo que o servidor declara.
 *
 * POR QUE DUAS CAMADAS E NAO UMA. O nome e a camada que NAO depende da rede: ela vale mesmo
 * quando tools/list falha, e por isso continua sendo a guarda primaria — trocar allowlist de
 * nome por confianca na anotacao remota transformaria uma indisponibilidade do conector em
 * permissao de escrita. As anotacoes entram so para ESTREITAR: uma ferramenta cujo nome comeca
 * com get_ mas que o proprio servidor marca readOnlyHint=false e, na melhor hipotese, um nome
 * mentiroso, e a duvida aqui nao resolve em "deixa passar".
 *
 * A ASSIMETRIA E DELIBERADA e e o oposto da de agent_ferramentas.efeito. La, falha aberta:
 * duvida vira 'leitura' porque o custo do erro e uma verificacao que nao acontece. Aqui, falha
 * fechada: duvida vira recusa porque o custo do erro e uma escrita na conta do cliente por um
 * caminho que ninguem classificou. Mesmo sistema, dois campos, dois custos de erro opostos.
 *
 * ANOTACAO AUSENTE NAO RECUSA. O protocolo MCP nao obriga annotations e o default de
 * readOnlyHint e false quando o campo nem existe — tratar ausencia como "declara escrita"
 * recusaria o catalogo inteiro de um servidor que simplesmente nao anota. So o valor
 * EXPLICITO conta.
 */
export function classificarFerramentaPipeboard(
  name: string,
  anotacoes?: PipeboardAnotacoes | null,
): VereditoFerramentaPipeboard {
  const n = String(name ?? "").trim();
  const a = (anotacoes && typeof anotacoes === "object" ? anotacoes : {}) as PipeboardAnotacoes;
  const nomePassa = isReadOnlyTool(n);
  if (!nomePassa) {
    return { name: n, leitura: false, motivo: "nome_fora_da_lista_de_leitura", nome_passa: false, anotacoes: a };
  }
  // destructiveHint=true e o sinal mais forte que o protocolo tem. Note que o inverso NAO
  // vale, e por isso destructiveHint=false nunca absolve nada aqui: o campo distingue
  // "apaga/substitui dado" de "acrescenta dado", nao escrita de leitura — um create_ ou
  // update_ pode se declarar nao-destrutivo com razao e continuar escrevendo na conta.
  if (a.destructiveHint === true) {
    return { name: n, leitura: false, motivo: "servidor_declara_destrutiva", nome_passa: true, anotacoes: a };
  }
  if (a.readOnlyHint === false) {
    return { name: n, leitura: false, motivo: "servidor_declara_nao_leitura", nome_passa: true, anotacoes: a };
  }
  return { name: n, leitura: true, motivo: "ok", nome_passa: true, anotacoes: a };
}

/**
 * Catalogo remoto INTEIRO com o veredito de cada item — leitura e escrita. Existe para que a
 * classificacao do proxy seja auditavel: `ler_pipeboard` e `listar_ferramentas_pipeboard` sao
 * proxies genericos, e um proxy que ninguem consegue enumerar e um proxy cujo alcance ninguem
 * conhece. listReadTools() devolve so o lado da leitura, que e o certo para o modelo e o
 * errado para a auditoria.
 */
export function classificarCatalogoPipeboard(tools: PipeboardToolDef[]): {
  total: number;
  leitura: VereditoFerramentaPipeboard[];
  recusadas: VereditoFerramentaPipeboard[];
  /** Nome de leitura que o servidor desmente: o caso que o allowlist de nome nao pegava. */
  divergentes: VereditoFerramentaPipeboard[];
} {
  const vereditos = (tools ?? [])
    .map((t) => classificarFerramentaPipeboard(String(t?.name ?? ""), t?.annotations))
    .filter((v) => v.name)
    .sort((x, y) => x.name.localeCompare(y.name));
  return {
    total: vereditos.length,
    leitura: vereditos.filter((v) => v.leitura),
    recusadas: vereditos.filter((v) => !v.leitura),
    divergentes: vereditos.filter((v) => v.nome_passa && !v.leitura),
  };
}

export function normalizeAccountId(value: unknown): string {
  return String(value ?? "").trim().replace(/^act_/i, "");
}

export function withActPrefix(accountId: string): string {
  const bare = normalizeAccountId(accountId);
  return bare ? `act_${bare}` : "";
}

/** Remove access_token e qualquer chave sensivel residual. */
export function sanitizeReadArgs(args: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === "access_token" || k === "token" || k === "PIPEBOARD_API_TOKEN") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function truncatePipeboardPayload(value: unknown, cap = PIPEBOARD_READ_PAYLOAD_CAP): {
  data: unknown;
  truncado: boolean;
  bytes: number;
} {
  const raw = JSON.stringify(value ?? null);
  const bytes = raw?.length ?? 0;
  if (bytes <= cap) return { data: value, truncado: false, bytes };
  // Preferir cortar arrays grandes em vez de cortar JSON no meio.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        const lista = obj[key] as unknown[];
        let keep = lista.length;
        while (keep > 0) {
          const candidate = { ...obj, [key]: lista.slice(0, keep) };
          const size = JSON.stringify(candidate).length;
          if (size <= cap - 400) {
            return {
              data: {
                ...candidate,
                aviso_corte:
                  `Payload truncado: ${keep} de ${lista.length} itens em '${key}'. O restante EXISTE no Pipeboard — peca filtro mais estreito.`,
                exibidos: keep,
                omitidos: lista.length - keep,
              },
              truncado: true,
              bytes: size,
            };
          }
          keep = Math.floor(keep / 2);
        }
      }
    }
  }
  return {
    data: {
      aviso_corte: `Resposta do Pipeboard excedeu ${cap} bytes e foi cortada. Peca um recorte mais estreito (ids, datas, limit).`,
      trecho: raw.slice(0, Math.max(0, cap - 200)),
    },
    truncado: true,
    bytes,
  };
}

/**
 * Catalogo remoto com cache curto por instancia.
 *
 * O CACHE NAO E OTIMIZACAO GRATUITA, ele e o que permite a guarda de anotacao existir sem
 * custar latencia. O caminho vivo (t_ler_pipeboard no traffic-chat) ja chama listReadTools
 * imediatamente antes de callReadTool para descobrir o schema; com o catalogo em cache, a
 * conferencia de anotacao dentro de callReadTool nao acrescenta round-trip nenhum. Sem cache
 * ela acrescentaria um tools/list por chamada de ferramenta, em duas edges que estao sob
 * medicao de latencia e que nao podem ser editadas para receber o catalogo por parametro.
 *
 * TTL curto porque o catalogo do conector muda sem aviso (ele ganhou ferramentas entre 08 e
 * 09/2026) e porque instancia de edge e efemera: o que se quer e nao repetir a chamada DENTRO
 * de um turno, nao guardar estado entre turnos.
 */
const CATALOGO_TTL_MS = 60_000;
let _catalogoCache: { em: number; tools: PipeboardToolDef[] } | null = null;

export async function catalogoPipeboard(token: string): Promise<{
  ok: boolean;
  tools: PipeboardToolDef[];
  erro?: string;
}> {
  const agora = Date.now();
  if (_catalogoCache && agora - _catalogoCache.em < CATALOGO_TTL_MS) {
    return { ok: true, tools: _catalogoCache.tools };
  }
  const listed = await pipeboardListTools(token);
  if (!listed.ok) {
    return { ok: false, tools: [], erro: listed.erro ?? `tools/list_${listed.status}` };
  }
  const tools = (listed.tools ?? []) as PipeboardToolDef[];
  _catalogoCache = { em: agora, tools };
  return { ok: true, tools };
}

/** Zera o cache. Usado pelas provas, para nao herdarem catalogo de outro caso. */
export function limparCacheCatalogoPipeboard(): void {
  _catalogoCache = null;
}

export async function listReadTools(token: string): Promise<{
  ok: boolean;
  tools: Array<{ name: string; description: string; properties: string[]; required: string[] }>;
  total_pipeboard: number;
  total_leitura: number;
  erro?: string;
}> {
  const cat = await catalogoPipeboard(token);
  if (!cat.ok) {
    return {
      ok: false,
      tools: [],
      total_pipeboard: 0,
      total_leitura: 0,
      erro: cat.erro,
    };
  }
  const all = cat.tools;
  const read = all.filter((t) => classificarFerramentaPipeboard(String(t?.name ?? ""), t?.annotations).leitura);
  return {
    ok: true,
    total_pipeboard: all.length,
    total_leitura: read.length,
    tools: read.map((t) => ({
      name: String(t.name),
      description: String(t.description ?? "").slice(0, 180),
      properties: Object.keys(t.inputSchema?.properties ?? {}),
      required: Array.isArray(t.inputSchema?.required) ? t.inputSchema!.required! : [],
    })),
  };
}

export async function companyMetaAccounts(
  // deno-lint-ignore no-explicit-any
  supa: any,
  companyId: string,
): Promise<string[]> {
  if (!companyId) return [];
  const { data, error } = await supa
    .from("integrations")
    .select("external_id,status")
    .eq("provider", "meta_ads")
    .eq("company_id", companyId)
    .not("external_id", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row: { status?: string }) => row.status !== "disabled")
    .map((row: { external_id: string }) => normalizeAccountId(row.external_id))
    .filter(Boolean);
}

export function assertAccountInCompany(accountId: string, allowed: string[]): {
  ok: boolean;
  account_id?: string;
  erro?: string;
} {
  const bare = normalizeAccountId(accountId);
  if (!bare) return { ok: false, erro: "account_id_ausente" };
  if (!allowed.includes(bare)) {
    return {
      ok: false,
      erro: "account_fora_da_empresa",
      account_id: bare,
    };
  }
  return { ok: true, account_id: bare };
}

/** Injeta/valida account_id quando a tool exige conta. */
export function scopeArgsToCompany(
  toolName: string,
  args: Record<string, unknown>,
  allowedAccounts: string[],
  schemaProperties: Record<string, unknown> = {},
): { ok: true; args: Record<string, unknown> } | { ok: false; erro: string; contas_da_empresa?: string[] } {
  if (!allowedAccounts.length) {
    return { ok: false, erro: "empresa_sem_conta_meta_vinculada" };
  }
  const safe = sanitizeReadArgs(args);
  const props = schemaProperties ?? {};
  const needsAccount =
    Object.hasOwn(props, "account_id") ||
    Object.hasOwn(props, "ad_account_id") ||
    ["get_insights", "bulk_get_insights", "get_campaigns", "get_adsets", "get_ads", "get_ad_accounts"].includes(
      toolName,
    );

  const rawAccount =
    safe.account_id ?? safe.ad_account_id ?? safe.act_id ?? null;
  if (rawAccount != null && String(rawAccount).trim()) {
    const check = assertAccountInCompany(String(rawAccount), allowedAccounts);
    if (!check.ok) {
      return {
        ok: false,
        erro: check.erro ?? "account_fora_da_empresa",
        contas_da_empresa: allowedAccounts,
      };
    }
    safe.account_id = withActPrefix(check.account_id!);
    delete safe.ad_account_id;
    delete safe.act_id;
    return { ok: true, args: safe };
  }

  if (needsAccount) {
    if (allowedAccounts.length === 1) {
      safe.account_id = withActPrefix(allowedAccounts[0]);
      return { ok: true, args: safe };
    }
    return {
      ok: false,
      erro: "informe_account_id_das_contas_da_empresa",
      contas_da_empresa: allowedAccounts,
    };
  }

  return { ok: true, args: safe };
}

export async function callReadTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
): Promise<{
  ok: boolean;
  tool: string;
  status?: number;
  body?: unknown;
  erro?: string;
}> {
  const name = String(toolName ?? "").trim();
  if (!isReadOnlyTool(name)) {
    return {
      ok: false,
      tool: name,
      erro: "ferramenta_nao_e_leitura",
    };
  }
  // SEGUNDO PORTAO: o nome passou, agora o catalogo remoto tem de concordar. Sao duas
  // perguntas diferentes e o allowlist de nome so responde a primeira:
  //   1) o nome esta na forma de leitura?            -> isReadOnlyTool, acima
  //   2) a ferramenta EXISTE e o servidor a declara leitura? -> aqui
  // Sem (2), qualquer string comecando com get_ era repassada ao conector sem que ninguem
  // soubesse se aquilo existia ou o que fazia; e uma ferramenta futura chamada get_or_create_*
  // atravessaria o portao inteiro so pelo prefixo. A ausencia de catalogo NAO abre o portao
  // nem o fecha: cai de volta na decisao por nome, que e o comportamento anterior — uma queda
  // de rede do conector nao pode virar bloqueio de leitura nem permissao de escrita.
  const cat = await catalogoPipeboard(token);
  if (cat.ok) {
    const def = cat.tools.find((t) => String(t?.name ?? "").trim() === name);
    if (!def) {
      return {
        ok: false,
        tool: name,
        erro: "ferramenta_inexistente_no_catalogo_pipeboard",
      };
    }
    const veredito = classificarFerramentaPipeboard(name, def.annotations);
    if (!veredito.leitura) {
      return {
        ok: false,
        tool: name,
        erro: `ferramenta_de_escrita_recusada:${veredito.motivo}`,
      };
    }
  }
  const response = await pipeboardCall(name, sanitizeReadArgs(args), token);
  const readOk =
    response.status >= 200 &&
    response.status < 300 &&
    !response.erro &&
    !(response.body as { error?: unknown } | null)?.error;
  if (!readOk) {
    return {
      ok: false,
      tool: name,
      status: response.status,
      erro: response.erro ?? `pipeboard_${name}_${response.status}`,
      body: response.body,
    };
  }
  return { ok: true, tool: name, status: response.status, body: response.body };
}
