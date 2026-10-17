// supabase/functions/_shared/aprendizados.ts
//
// Camada de banco da memoria aprendida dos agentes: consultar (antes do prompt), registrar e
// corrigir (ferramentas do modelo) e a rede de seguranca do chat (extracao barata depois da
// resposta, que grava pelo mesmo registrar). As regras puras (volatil, isolamento, linha,
// evidencia, bloco) moram em aprendizados_regras.ts; aqui so ha I/O e a ORDEM em que as regras rodam.
// Tabela, trigger e RPCs: supabase/migrations/20261017150000_memoria_aprendida_dos_agentes.sql.
// Spec: docs/superpowers/specs/2026-10-17-memoria-aprendida-dos-agentes-design.md (7.2, 7.3, 7.4, 7.5, 7.10).
//
// Tres garantias que o resto do sistema assume:
//  1. consultarMemoria, registrarAprendizado, corrigirAprendizado e extrairAprendizadosDoTurno
//     NUNCA lancam. Memoria e acessorio: o turno do chat ou do job segue mesmo com o banco fora.
//  2. A empresa e SEMPRE a do turno. O que o modelo escreve no argumento nunca escolhe empresa.
//  3. Sair de `vigente` grava `motivo_status` no MESMO UPDATE: o CHECK da tabela recusa um sem o outro.

import {
  AVISO_FALHA_APRENDIZADOS,
  chaveNormalizada,
  conferirEvidencia,
  conferirIsolamento,
  ehDadoVolatil,
  formatarBlocoAprendizados,
  idCurto,
  LIMITE_CHAT,
  LIMITE_OUTROS,
  linhasDaEmpresa,
  linhasDaTarefa,
  MAX_PREFERENCIAS,
  resolverLinha,
  TETO_CHARS_CHAT,
  TETO_CHARS_OUTROS,
  TETO_REGISTROS_DIA,
  TETO_REGISTROS_TURNO,
  validarPedidoRegistro,
} from "./aprendizados_regras.ts";
import type {
  AprendizadoLinha,
  Evidencia,
  PedidoRegistro,
  TurnoAprendizado,
} from "./aprendizados_regras.ts";
import { bodyOpenRouter, resolverChamadaLlm, tetoDeSaida } from "./llm_roteador.ts";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** O minimo do cliente Supabase que esta camada usa (a prova entrega um falso). */
export type Db = {
  from: (t: string) => any;
  rpc: (f: string, a: Record<string, unknown>) => any;
};

export type PapelConsulta =
  | "chat"
  | "subagente"
  | "sintese"
  | "relatorio"
  | "ritmo"
  | "correcao_custo"
  | "reco"
  | "legendas"
  | "waba_redator";

export type TelemetriaConsulta = {
  injetados: number;
  ids: string[];
  chars: number;
  falhou: boolean;
  desligada: boolean;
  /** A consulta passou do teto de tempo (falhou tambem fica true: o prompt leva o aviso). */
  timeout: boolean;
};

export type ResultadoRegistro = {
  resultado: "gravado" | "ja_registrado" | "recusado";
  id?: string;
  id_curto?: string;
  motivo?: string;
};

type RespostaDb = {
  data?: any;
  error?: { message?: string; code?: string } | null;
  count?: number | null;
};

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Abaixo disto o banco nao acha o fato parecido; acima, reforca em vez de criar (ponto de partida, calibrado na Tarefa 1). */
const LIMIAR_PARECIDO = 0.8;
/** O pedido do gestor pode ser um texto colado enorme; a busca textual so precisa do comeco. */
const MAX_CHARS_TEXTO_CONSULTA = 2000;
/** O id curto que o gestor cita tem 6 hex (idCurto); menos que isso nao identifica nada. */
const MIN_HEX_ID = 6;
/**
 * Teto de tempo da consulta INTEIRA (chave + RPC), padrao de consultarMemoria. Memoria e acessorio
 * (anti-objetivo 4 da spec): banco lento vira o aviso de "indisponivel", nunca um turno parado.
 * No chat a consulta corre junto com o Roteador, entao 4s raramente aparece na parede.
 */
const TIMEOUT_CONSULTA_MS = 4000;

const MOTIVO_GRAVACAO_DESLIGADA =
  "gravacao de aprendizados desligada neste momento; nao registre nem corrija agora";
const MOTIVO_DADO_VOLATIL =
  "isso e dado, nao memoria: numero de desempenho de um periodo nao se grava; registre so o que continua valendo depois do periodo";

// Os codigos do trigger e das regras puras, com a frase que o modelo entende. O codigo fica na frente.
const EXPLICACAO_ISOLAMENTO: Record<string, string> = {
  cita_outra_empresa: "o texto cita marca de outra empresa; cada empresa tem a propria memoria",
  cita_conta_alheia: "o texto cita uma conta Meta (act_) que nao e desta empresa",
  cita_outra_linha: "o texto cita outra linha de negocio; registre um aprendizado por linha",
};

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

function msgErro(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = String((e as { message?: unknown }).message ?? "").trim();
    if (m) return m;
  }
  return String(e ?? "erro desconhecido");
}

function recusar(motivo: string): ResultadoRegistro {
  return { resultado: "recusado", motivo };
}

function explicar(motivo: string): string {
  const frase = EXPLICACAO_ISOLAMENTO[motivo];
  return frase ? `${motivo}: ${frase}` : motivo;
}

/**
 * Meia-noite de hoje em America/Sao_Paulo, como instante ISO (UTC). O teto "por dia" conta de
 * la: 01:30 UTC de 02/11 ainda e dia 01 para o gestor. Calcula pelo relogio de Sao Paulo (Intl),
 * sem fixar o offset: subtrai do instante o que ja passou desde a meia-noite local.
 */
export function inicioDoDiaSaoPaulo(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(agora);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const msDesdeMeiaNoite = ((n("hour") * 60 + n("minute")) * 60 + n("second")) * 1000 +
    agora.getUTCMilliseconds();
  return new Date(agora.getTime() - msDesdeMeiaNoite).toISOString();
}

// ---------------------------------------------------------------------------
// Chave global (spec 7.10)
// ---------------------------------------------------------------------------

/**
 * memoria_config tem uma linha so. A chave e um freio operacional, nao uma trava de seguranca:
 * se nao for possivel le-la (tabela fora, sem linha), conta como LIGADA, para uma falha de
 * leitura nao apagar a memoria sozinha. As travas de seguranca (isolamento, evidencia) nao
 * dependem dela.
 */
async function lerConfig(supa: Db): Promise<{ consultaAtiva: boolean; gravacaoAtiva: boolean }> {
  try {
    const r: RespostaDb = await supa.from("memoria_config").select("consulta_ativa, gravacao_ativa").limit(1);
    const linha = !r?.error && Array.isArray(r?.data) ? r.data[0] : null;
    return {
      consultaAtiva: linha?.consulta_ativa !== false,
      gravacaoAtiva: linha?.gravacao_ativa !== false,
    };
  } catch {
    return { consultaAtiva: true, gravacaoAtiva: true };
  }
}

// ---------------------------------------------------------------------------
// Consultar (spec 7.5)
// ---------------------------------------------------------------------------

/**
 * Marca o uso sem segurar o turno. Promise.resolve porque o builder do supabase-js so tem then(),
 * nao catch(); EdgeRuntime.waitUntil (quando existe) segura o isolate ate o update acabar, para
 * o worker nao morrer com a resposta e perder a estatistica. Uso e so estatistica: nada aqui lanca.
 */
function marcarUsoEmSegundoPlano(supa: Db, ids: string[]): void {
  try {
    const p = Promise.resolve(supa.rpc("marcar_uso_aprendizados", { p_ids: ids })).catch(() => {});
    const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    edge?.waitUntil?.(p);
  } catch {
    // ignora
  }
}

type ParamsConsulta = {
  supa: Db;
  companyId: string;
  tarefa: string;
  papel: PapelConsulta;
  linhaFixa?: string | null;
  somenteConfirmadas?: boolean;
  /** Teto de tempo da consulta inteira (chave + RPC). Padrao TIMEOUT_CONSULTA_MS. */
  timeoutMs?: number;
};
type ResultadoConsulta = { texto: string; ids: string[]; telemetria: TelemetriaConsulta };

function telemetriaVazia(): TelemetriaConsulta {
  return { injetados: 0, ids: [], chars: 0, falhou: false, desligada: false, timeout: false };
}

/**
 * Bloco da memoria aprendida para o prompt, ja com cabecalho de precedencia e teto de caracteres.
 * - chave desligada: `texto` vazio (a edge se comporta como antes da funcionalidade);
 * - sem aprendizado vigente: `texto` vazio;
 * - falha de qualquer tipo: `texto` = AVISO_FALHA_APRENDIZADOS, para o modelo nao concluir que
 *   "nao ha aprendizado" quando na verdade nao conseguiu olhar;
 * - passou de `timeoutMs` (padrao 4s, a consulta inteira): o mesmo aviso, com `timeout: true`.
 * `ids` sao so os itens que couberam no teto (os que entraram no prompt); sao eles que ganham uso.
 *
 * O teto e uma corrida contra um timer, limpo no caminho normal para nao deixar timer pendurado
 * no isolate. A consulta que perdeu a corrida continua ate o banco responder (o supabase-js nao
 * e cancelado daqui), mas sem efeito: o turno ja levou o aviso, entao nada ganha uso.
 */
export async function consultarMemoria(a: ParamsConsulta): Promise<ResultadoConsulta> {
  const prazo = Number.isFinite(a.timeoutMs) && Number(a.timeoutMs) > 0 ? Number(a.timeoutMs) : TIMEOUT_CONSULTA_MS;
  let estourou = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const porTempo = new Promise<ResultadoConsulta>((resolver) => {
    timer = setTimeout(() => {
      estourou = true;
      console.error(`[aprendizados] consulta passou de ${prazo} ms: segue sem o bloco`);
      resolver({
        texto: AVISO_FALHA_APRENDIZADOS,
        ids: [],
        telemetria: { ...telemetriaVazia(), chars: AVISO_FALHA_APRENDIZADOS.length, falhou: true, timeout: true },
      });
    }, prazo);
  });
  try {
    return await Promise.race([consultarSemTeto(a, () => !estourou), porTempo]);
  } finally {
    clearTimeout(timer);
  }
}

/** O corpo da consulta. `aindaVale` cai para false quando o teto de tempo ja respondeu ao turno. */
async function consultarSemTeto(a: ParamsConsulta, aindaVale: () => boolean): Promise<ResultadoConsulta> {
  const telemetria = telemetriaVazia();
  try {
    const cfg = await lerConfig(a.supa);
    if (!cfg.consultaAtiva) {
      return { texto: "", ids: [], telemetria: { ...telemetria, desligada: true } };
    }

    const emChat = a.papel === "chat";
    const resp: RespostaDb = await a.supa.rpc("consultar_aprendizados", {
      p_company_id: a.companyId,
      p_linhas: linhasDaTarefa(a.companyId, a.tarefa, a.linhaFixa),
      p_texto: String(a.tarefa ?? "").slice(0, MAX_CHARS_TEXTO_CONSULTA),
      p_limite: emChat ? LIMITE_CHAT : LIMITE_OUTROS,
      p_max_preferencias: MAX_PREFERENCIAS,
      p_somente_confirmadas: a.somenteConfirmadas === true,
    });
    if (resp?.error) throw new Error(msgErro(resp.error));
    if (!Array.isArray(resp?.data)) throw new Error("resposta invalida de consultar_aprendizados");
    const rows = resp.data as AprendizadoLinha[];

    const texto = formatarBlocoAprendizados(rows, {
      tetoChars: emChat ? TETO_CHARS_CHAT : TETO_CHARS_OUTROS,
      comLinha: linhasDaEmpresa(a.companyId).length > 0,
    });
    // formatarBlocoAprendizados corta item inteiro e poe um item por linha (cabecalho + N itens).
    const injetados = texto ? texto.split("\n").length - 1 : 0;
    const ids = rows.slice(0, injetados).map((r) => String(r.id));
    // Resposta que chegou depois do teto nao entrou em prompt nenhum: nao ganha uso.
    if (ids.length && aindaVale()) marcarUsoEmSegundoPlano(a.supa, ids);

    return { texto, ids, telemetria: { ...telemetria, injetados, ids, chars: texto.length } };
  } catch (e) {
    console.error("[aprendizados] consulta falhou:", msgErro(e));
    return {
      texto: AVISO_FALHA_APRENDIZADOS,
      ids: [],
      telemetria: { ...telemetria, chars: AVISO_FALHA_APRENDIZADOS.length, falhou: true },
    };
  }
}

// ---------------------------------------------------------------------------
// Conferencias compartilhadas por registrar e substituir
// ---------------------------------------------------------------------------

type Preparado = { ok: true; linha: string | null; chave: string } | { ok: false; motivo: string };

/** So o que o texto cita como act_ precisa de conta cadastrada; sem act_ no texto nao ha o que conferir. */
async function contasDaEmpresa(
  supa: Db,
  companyId: string,
  texto: string,
): Promise<{ ok: true; contas: string[] } | { ok: false; motivo: string }> {
  if (!/act_\d/i.test(texto)) return { ok: true, contas: [] };
  const r: RespostaDb = await supa.from("meta_ad_accounts").select("account_id").eq("company_id", companyId);
  if (r?.error) {
    return { ok: false, motivo: `nao foi possivel conferir as contas desta empresa: ${msgErro(r.error)}` };
  }
  const lista = Array.isArray(r?.data) ? r.data : [];
  return { ok: true, contas: lista.map((x: { account_id?: unknown }) => String(x?.account_id ?? "")) };
}

/**
 * Passos 1 (evidencia contra o texto real), 2 (dado volatil), 3 (isolamento) e 4 (linha) da spec 7.2.
 * Usado pelo registro e pela substituicao: o fato novo passa pelo mesmo funil. O que e FORMA do
 * pedido (tamanhos, categoria) ja foi conferido por validarPedidoRegistro antes.
 */
async function conferirPedido(supa: Db, p: PedidoRegistro, turno: TurnoAprendizado): Promise<Preparado> {
  const ev = conferirEvidencia(p.evidencia, p.confianca, turno);
  if (!ev.ok) return { ok: false, motivo: ev.motivo };

  if (ehDadoVolatil(p.fato)) return { ok: false, motivo: MOTIVO_DADO_VOLATIL };

  // Mesmo texto que o trigger olha: fato + " " + contexto.
  const texto = `${p.fato} ${p.contexto}`;
  const contas = await contasDaEmpresa(supa, turno.companyId, texto);
  if (!contas.ok) return contas;
  const iso = conferirIsolamento(texto, turno.companyId, contas.contas);
  if (!iso.ok) return { ok: false, motivo: explicar(iso.motivo) };

  const lin = resolverLinha(turno.companyId, texto, p.linha);
  if (!lin.ok) return { ok: false, motivo: explicar(lin.motivo) };

  return { ok: true, linha: lin.linha, chave: chaveNormalizada(p.fato) };
}

/** "confirmada" so com fala do gestor; o resto e "observada" (spec 7.2, passo 1). */
function confiancaDaEvidencia(ev: unknown): "confirmada" | "observada" {
  return (ev as { tipo?: unknown } | null)?.tipo === "fala_do_gestor" ? "confirmada" : "observada";
}

/** Item de `evidencias` como a coluna documenta: {tipo, ferramenta?, trecho, job_id?, em}. */
function montarEvidencia(ev: Evidencia, turno: TurnoAprendizado): Record<string, unknown> {
  return {
    tipo: ev.tipo,
    ...(ev.ferramenta ? { ferramenta: ev.ferramenta } : {}),
    trecho: ev.trecho,
    ...(turno.jobId ? { job_id: turno.jobId } : {}),
    em: new Date().toISOString(),
  };
}

/** Mensagem do banco para o modelo. O unique do dedupe exato ganha uma frase que diz o que fazer. */
function motivoDoBanco(e: { message?: string; code?: string }): string {
  const m = msgErro(e);
  if (e?.code === "23505" || m.includes("agent_aprendizados_vigente_chave_uq")) {
    return `ja existe um aprendizado vigente com este mesmo fato nesta empresa (${m})`;
  }
  return m;
}

/** INSERT da linha nova. A empresa, o agente, a superficie, a conversa e o job vem SEMPRE do turno. */
async function inserirAprendizado(
  supa: Db,
  turno: TurnoAprendizado,
  p: PedidoRegistro,
  linha: string | null,
  chave: string,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const r: RespostaDb = await supa.from("agent_aprendizados").insert({
    company_id: turno.companyId,
    linha,
    categoria: p.categoria,
    fato: p.fato,
    contexto: p.contexto || null,
    evidencias: [montarEvidencia(p.evidencia, turno)],
    agente_codigo: turno.agente,
    superficie: turno.superficie,
    conversation_id: turno.conversationId,
    confianca: p.confianca,
    valido_ate: p.valido_ate ?? null,
    chave_normalizada: chave,
    ...extra,
  }).select("id").single();
  if (r?.error) return { ok: false, motivo: motivoDoBanco(r.error) };
  const id = String(r?.data?.id ?? "");
  if (!id) return { ok: false, motivo: "o banco nao devolveu o id do registro" };
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Registrar (spec 7.2)
// ---------------------------------------------------------------------------

/**
 * Ferramenta registrar_aprendizado. Ordem: chave de gravacao; forma do pedido; evidencia conferida,
 * volatil, isolamento e linha (conferirPedido); ja sabia?; teto; grava. Qualquer recusa ou erro do
 * banco volta como { resultado: "recusado", motivo } e nada fica gravado. So o INSERT conta no
 * teto do turno (`turno.registrosNoTurno`): reforcar um fato que ja existe nao cria registro.
 */
export async function registrarAprendizado(
  supa: Db,
  args: unknown,
  turno: TurnoAprendizado,
): Promise<ResultadoRegistro> {
  try {
    const cfg = await lerConfig(supa);
    if (!cfg.gravacaoAtiva) return recusar(MOTIVO_GRAVACAO_DESLIGADA);

    const v = validarPedidoRegistro(args);
    if (!v.ok) return recusar(v.motivo);
    const pedido = v.pedido;

    const prep = await conferirPedido(supa, pedido, turno);
    if (!prep.ok) return recusar(prep.motivo);

    // Passo 5: o mesmo fato (ou quase) ja vigente na empresa e na linha reforca em vez de duplicar.
    const par: RespostaDb = await supa.rpc("aprendizados_parecidos", {
      p_company_id: turno.companyId,
      p_linha: prep.linha,
      p_chave: prep.chave,
      p_limiar: LIMIAR_PARECIDO,
    });
    if (par?.error) return recusar(`nao foi possivel conferir se o fato ja existe: ${msgErro(par.error)}`);
    const parecido = Array.isArray(par?.data) ? par.data[0] : null;
    if (parecido?.id) {
      const ref: RespostaDb = await supa.rpc("reforcar_aprendizado", {
        p_id: parecido.id,
        p_evidencia: montarEvidencia(pedido.evidencia, turno),
      });
      if (ref?.error) return recusar(`nao foi possivel reforcar o aprendizado existente: ${msgErro(ref.error)}`);
      const id = String(parecido.id);
      return { resultado: "ja_registrado", id, id_curto: idCurto(id) };
    }

    // Passo 6: teto do turno e do dia (o dia conta desde a meia-noite de Sao Paulo).
    if ((turno.registrosNoTurno ?? 0) >= TETO_REGISTROS_TURNO) {
      return recusar(`teto de ${TETO_REGISTROS_TURNO} registros por turno atingido; deixe o resto para outra conversa`);
    }
    const dia: RespostaDb = await supa.from("agent_aprendizados")
      .select("id", { count: "exact", head: true })
      .eq("company_id", turno.companyId)
      .gte("criado_em", inicioDoDiaSaoPaulo());
    if (dia?.error) return recusar(`nao foi possivel conferir o teto do dia: ${msgErro(dia.error)}`);
    if (Number(dia?.count ?? 0) >= TETO_REGISTROS_DIA) {
      return recusar(`teto de ${TETO_REGISTROS_DIA} registros por empresa por dia atingido; tente amanha`);
    }

    // Passo 7: grava como vigente. O trigger de isolamento e a rede final: o erro dele volta como motivo.
    const ins = await inserirAprendizado(supa, turno, pedido, prep.linha, prep.chave);
    if (!ins.ok) return recusar(ins.motivo);
    turno.registrosNoTurno = (turno.registrosNoTurno ?? 0) + 1;
    return { resultado: "gravado", id: ins.id, id_curto: idCurto(ins.id) };
  } catch (e) {
    console.error("[aprendizados] registrar falhou:", msgErro(e));
    return recusar(msgErro(e));
  }
}

// ---------------------------------------------------------------------------
// Corrigir (spec 7.3)
// ---------------------------------------------------------------------------

type Alvo = { id: string; categoria: string; linha: string | null };

/**
 * O gestor cita o id curto (6 hex). Em vez de `id::text like 'abc123%'` (que o PostgREST nao aceita
 * em coluna uuid), vira uma faixa: o uuid compara byte a byte, entao todo id que comeca com o
 * prefixo cai entre prefixo000... e prefixofff.... Aceita "#ab12cd", com ou sem hifens, de 6 a 32 hex.
 */
function faixaDoPrefixo(raw: unknown): { de: string; ate: string } | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().replace(/^#/, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length < MIN_HEX_ID || hex.length > 32) return null;
  const montar = (preenche: string) => {
    const h = hex.padEnd(32, preenche);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  return { de: montar("0"), ate: montar("f") };
}

/** Acha o registro VIGENTE da empresa do turno pelo prefixo; exige exatamente um. */
async function localizarVigente(
  supa: Db,
  companyId: string,
  faixa: { de: string; ate: string },
): Promise<{ ok: true; alvo: Alvo } | { ok: false; motivo: string }> {
  const r: RespostaDb = await supa.from("agent_aprendizados")
    .select("id, categoria, linha, status")
    .eq("company_id", companyId)
    .gte("id", faixa.de)
    .lte("id", faixa.ate)
    .limit(10);
  if (r?.error) return { ok: false, motivo: `nao foi possivel buscar o aprendizado: ${motivoDoBanco(r.error)}` };

  const achados: { id: string; categoria: string; linha: string | null; status: string }[] =
    Array.isArray(r?.data) ? r.data : [];
  // Registro de outra empresa nunca aparece aqui, e a recusa nao diz que ele existe.
  if (!achados.length) return { ok: false, motivo: "aprendizado nao encontrado nesta empresa" };

  const vigentes = achados.filter((x) => x.status === "vigente");
  if (vigentes.length > 1) {
    return { ok: false, motivo: `id ambiguo: ${vigentes.length} aprendizados vigentes comecam assim; informe mais caracteres do id` };
  }
  if (!vigentes.length) {
    return { ok: false, motivo: `o aprendizado #${idCurto(achados[0].id)} nao esta vigente (status: ${achados[0].status})` };
  }
  const v = vigentes[0];
  return { ok: true, alvo: { id: String(v.id), categoria: v.categoria, linha: v.linha ?? null } };
}

/** Marca o registro como fora de vigencia. Status e motivo_status no MESMO comando (CHECK da tabela). */
async function sairDeVigente(
  supa: Db,
  companyId: string,
  id: string,
  campos: { status: "substituida" | "aposentada"; motivo_status: string; substituida_por?: string },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const r: RespostaDb = await supa.from("agent_aprendizados")
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("status", "vigente") // se outro turno ja mexeu nele, nao sobrescreve
    .select("id");
  if (r?.error) return { ok: false, motivo: motivoDoBanco(r.error) };
  if (!Array.isArray(r?.data) || !r.data.length) {
    return { ok: false, motivo: "o aprendizado deixou de estar vigente enquanto era corrigido" };
  }
  return { ok: true };
}

/**
 * Ferramenta corrigir_aprendizado: "esquece o #ab12cd" (aposentar) ou "agora e assim" (substituir).
 * Substituir cria a linha nova com substitui_id e marca a antiga como substituida; aposentar so
 * marca. O id so vale se for vigente e da empresa do turno. Nao consome o teto de registros do
 * turno: corrigir troca ou retira um registro, nao aumenta a memoria.
 *
 * Substituir insere ANTES de marcar a antiga: as recusas comuns (volatil, isolamento, trigger,
 * unique do fato igual) saem do INSERT sem ter mexido em nada. Se o UPDATE da antiga falhar depois
 * do insert, a linha nova e aposentada de volta (compensacao) para nao sobrarem duas vigentes.
 */
export async function corrigirAprendizado(
  supa: Db,
  args: unknown,
  turno: TurnoAprendizado,
): Promise<ResultadoRegistro> {
  try {
    const cfg = await lerConfig(supa);
    if (!cfg.gravacaoAtiva) return recusar(MOTIVO_GRAVACAO_DESLIGADA);

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return recusar("pedido invalido: esperado um objeto");
    }
    const o = args as Record<string, unknown>;
    if (o.acao !== "substituir" && o.acao !== "aposentar") {
      return recusar("acao invalida; use substituir ou aposentar");
    }
    const motivo = typeof o.motivo === "string" ? o.motivo.trim() : "";
    if (!motivo) return recusar("informe o motivo da correcao");
    const faixa = faixaDoPrefixo(o.id);
    if (!faixa) {
      return recusar(`id invalido: informe o id curto do aprendizado (pelo menos ${MIN_HEX_ID} caracteres hexadecimais, ex.: ab12cd)`);
    }

    const achado = await localizarVigente(supa, turno.companyId, faixa);
    if (!achado.ok) return recusar(achado.motivo);
    const alvo = achado.alvo;
    const confianca = confiancaDaEvidencia(o.evidencia);

    if (o.acao === "aposentar") {
      const ev = o.evidencia;
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) return recusar("evidencia obrigatoria: {tipo, trecho}");
      const conf = conferirEvidencia(ev as Evidencia, confianca, turno);
      if (!conf.ok) return recusar(conf.motivo);

      const fim = await sairDeVigente(supa, turno.companyId, alvo.id, { status: "aposentada", motivo_status: motivo });
      if (!fim.ok) return recusar(fim.motivo);
      return { resultado: "gravado", id: alvo.id, id_curto: idCurto(alvo.id) };
    }

    // Substituir: o fato novo passa pelo mesmo funil do registro. Categoria e linha vem do registro
    // antigo (a troca nao muda o tipo do aprendizado; linha so diverge se o texto novo citar outra).
    const v = validarPedidoRegistro({
      fato: o.novo_fato,
      contexto: o.novo_contexto,
      categoria: alvo.categoria,
      confianca,
      evidencia: o.evidencia,
      linha: alvo.linha,
    });
    if (!v.ok) return recusar(v.motivo);
    const prep = await conferirPedido(supa, v.pedido, turno);
    if (!prep.ok) return recusar(prep.motivo);

    const ins = await inserirAprendizado(supa, turno, v.pedido, prep.linha, prep.chave, { substitui_id: alvo.id });
    if (!ins.ok) return recusar(ins.motivo);

    const fim = await sairDeVigente(supa, turno.companyId, alvo.id, {
      status: "substituida",
      substituida_por: ins.id,
      motivo_status: motivo,
    });
    if (!fim.ok) {
      // Desfaz a linha nova: sem isto ficariam as duas vigentes. Se ate isto falhar, o erro ja esta no log.
      const desfez = await sairDeVigente(supa, turno.companyId, ins.id, {
        status: "aposentada",
        motivo_status: `substituicao de #${idCurto(alvo.id)} nao concluida: ${fim.motivo}`.slice(0, 500),
      }).catch((e) => ({ ok: false as const, motivo: msgErro(e) }));
      if (!desfez.ok) console.error("[aprendizados] nao desfez a linha nova da substituicao:", ins.id, desfez.motivo);
      return recusar(fim.motivo);
    }
    return { resultado: "gravado", id: ins.id, id_curto: idCurto(ins.id) };
  } catch (e) {
    console.error("[aprendizados] corrigir falhou:", msgErro(e));
    return recusar(msgErro(e));
  }
}

// ---------------------------------------------------------------------------
// Rede de seguranca do chat (spec 7.4)
// ---------------------------------------------------------------------------

/** No maximo 2 aprendizados por extracao: a rede pega a correcao que escapou, nao varre o turno. */
const MAX_ITENS_REDE = 2;
/**
 * A rede roda depois da resposta (EdgeRuntime.waitUntil), entao nao disputa o teto do turno, mas
 * o worker morre no limite de parede da plataforma (~400s) e o turno ja pode ter gasto ~145s.
 * Com raciocinio no piso a extracao leva segundos; 45s e folga, nao orcamento.
 */
const TIMEOUT_EXTRACAO_MS = 45_000;
/** A fala e a resposta podem ser enormes (pedido colado, relatorio); a extracao so precisa do miolo. */
const MAX_CHARS_FALA_REDE = 4000;
const MAX_CHARS_RESPOSTA_REDE = 3000;

const SYS_EXTRACAO = `Voce extrai MEMORIA DURAVEL de um turno de chat entre o gestor de trafego e o agente.
Leia a FALA DO GESTOR e a RESPOSTA DO AGENTE. Extraia no maximo ${MAX_ITENS_REDE} aprendizados que continuam valendo depois desta conversa: correcao que o gestor fez, preferencia ou regra que ele declarou.
NAO extraia: numero de desempenho de um periodo, palpite, pedido pontual desta conversa, nem o que o agente disse por conta propria.
Cada item:
- fato: uma frase autossuficiente de 20 a 600 caracteres, na terceira pessoa (ex.: "O gestor quer ...").
- contexto: uma frase curta sobre a situacao em que isso foi dito.
- categoria: preferencia_do_gestor | correcao | fato_da_conta | armadilha | processo.
- evidencia: {"tipo":"fala_do_gestor","trecho":"<copia LITERAL de um pedaco da FALA DO GESTOR, com pelo menos 12 caracteres e palavras inteiras>"}. Parafrase e recusada.
- confianca: "confirmada".
Se nada valer como memoria duravel, devolva a lista vazia.
Responda APENAS JSON valido, sem markdown: {"aprendizados":[{"fato":"...","contexto":"...","categoria":"...","evidencia":{"tipo":"fala_do_gestor","trecho":"..."},"confianca":"confirmada"}]}`;

/** Lista `aprendizados` do texto do modelo, tolerante a cerca de markdown e a texto em volta. */
function lerItensDoModelo(texto: string): unknown[] {
  const limpo = String(texto ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const candidatos = [limpo];
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini >= 0 && fim > ini) candidatos.push(limpo.slice(ini, fim + 1));
  for (const c of candidatos) {
    try {
      const j = JSON.parse(c);
      if (Array.isArray(j?.aprendizados)) return j.aprendizados;
    } catch {
      // tenta o proximo
    }
  }
  return [];
}

/**
 * A rede so le a fala do gestor e a resposta do agente, entao a unica evidencia que ela pode
 * citar e a fala do gestor. Forcar o tipo faz o handler conferir o trecho contra as falas do
 * turno: um trecho tirado da RESPOSTA do agente cai ali com "cite a fala exata", em vez de
 * entrar como retorno de ferramenta. Item que nem e objeto segue como veio e o handler recusa.
 */
function comoFalaDoGestor(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const o = item as Record<string, unknown>;
  const ev = o.evidencia && typeof o.evidencia === "object" && !Array.isArray(o.evidencia)
    ? o.evidencia as Record<string, unknown>
    : {};
  return { ...o, evidencia: { tipo: "fala_do_gestor", trecho: ev.trecho } };
}

/**
 * Rede de seguranca do chat: o gestor corrigiu ou declarou preferencia e o turno terminou sem
 * registrar_aprendizado. Uma extracao curta le a fala e a resposta e cada item passa pelo MESMO
 * handler do registro (registrarAprendizado): mesmas checagens, mesmo teto do turno (o `turno`
 * e o objeto do chat, com registrosNoTurno ja contado). Nunca lanca: falha de rede, HTTP de erro
 * ou resposta sem JSON devolvem [].
 *
 * MODELO: tipo "planner" e tier "lite", o mais barato que o roteador oferece. O padrao da casa e
 * o mesmo em todo tipo; o que muda e o esforco, e "planner" cai na faixa de triagem (raciocinio
 * no piso, `low`), que e o caso daqui: devolver um JSON curto para codigo, nao prosa ao gestor.
 * O tier nao pesa na triagem (modoRaciocinio), mas fica declarado para nao subir por acidente.
 */
export async function extrairAprendizadosDoTurno(a: {
  supa: Db;
  openRouterKey: string;
  msgGestor: string;
  resposta: string;
  turno: TurnoAprendizado;
}): Promise<ResultadoRegistro[]> {
  try {
    const chave = String(a.openRouterKey ?? "").trim();
    const fala = String(a.msgGestor ?? "").trim();
    if (!chave || !fala) return [];

    const rota = resolverChamadaLlm({ tipo: "planner", tier: "lite" });
    const user = `FALA DO GESTOR:\n${fala.slice(0, MAX_CHARS_FALA_REDE)}\n\n` +
      `RESPOSTA DO AGENTE:\n${String(a.resposta ?? "").slice(0, MAX_CHARS_RESPOSTA_REDE)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_EXTRACAO_MS);
    let conteudo = "";
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
        body: JSON.stringify(bodyOpenRouter(rota, {
          // max_tokens conta raciocinio + texto e o raciocinio do padrao da casa e obrigatorio:
          // o piso do roteador evita o JSON vazio por teto curto.
          max_tokens: tetoDeSaida(),
          messages: [{ role: "system", content: SYS_EXTRACAO }, { role: "user", content: user }],
        })),
        signal: ac.signal,
      });
      if (!resp.ok) {
        console.error("[aprendizados] rede: modelo devolveu http", resp.status);
        return [];
      }
      const j = await resp.json();
      conteudo = String(j?.choices?.[0]?.message?.content ?? "");
    } finally {
      clearTimeout(timer);
    }

    const itens = lerItensDoModelo(conteudo).slice(0, MAX_ITENS_REDE);
    const out: ResultadoRegistro[] = [];
    // Em serie, nao em paralelo: o teto do turno e o dedupe dependem do que o item anterior gravou.
    for (const item of itens) {
      out.push(await registrarAprendizado(a.supa, comoFalaDoGestor(item), a.turno));
    }
    return out;
  } catch (e) {
    console.error("[aprendizados] rede falhou:", msgErro(e));
    return [];
  }
}
