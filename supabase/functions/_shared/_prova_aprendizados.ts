// Prova da camada de banco da memoria aprendida: consultarMemoria, registrarAprendizado e
// corrigirAprendizado, com um Db falso (sem rede, sem Supabase).
//
// O que esta prova defende:
//  - consulta nunca lanca: falha vira o aviso de "indisponivel" e a chave desligada vira "como hoje";
//  - o registro respeita a ordem da spec 7.2 (evidencia, volatil, isolamento, linha, dedupe, teto) e
//    grava sempre com a empresa do TURNO, nunca com a que o modelo escreveu no argumento;
//  - erro do banco (trigger, unique) vira "recusado" com a mensagem, nunca excecao;
//  - sair de vigente grava motivo_status NO MESMO comando (o CHECK da tabela recusa o contrario).
// O DbFalso abaixo e uma tabela em memoria que emula esse CHECK, o unique parcial do dedupe exato e
// o trigger de isolamento, para a prova pegar quem esquecer de filtrar por empresa ou de gravar o motivo.
// Rodar: deno run --no-code-cache --allow-read --allow-env <este arquivo>

import { COMPANY_COHAPM, COMPANY_LEGAL } from "./meta_company_tokens.ts";
import {
  AVISO_FALHA_APRENDIZADOS,
  CABECALHO_APRENDIZADOS,
  chaveNormalizada,
  idCurto,
  TETO_REGISTROS_DIA,
  TETO_REGISTROS_TURNO,
} from "./aprendizados_regras.ts";
import type { AprendizadoLinha, TurnoAprendizado } from "./aprendizados_regras.ts";
import {
  consultarMemoria,
  corrigirAprendizado,
  extrairAprendizadosDoTurno,
  inicioDoDiaSaoPaulo,
  registrarAprendizado,
} from "./aprendizados.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FALHOU: ${msg}`); falhas++; }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Roda sem o ruido de console dos caminhos de falha esperados. */
async function calado<T>(fn: () => Promise<T>): Promise<T> {
  const e = console.error, w = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
}

// ---------------------------------------------------------------------------------------------
// Db falso: tabelas em memoria + RPCs por roteiro. Os resultados sao "thenables" SEM catch(),
// como o builder do supabase-js: quem chamar .catch() direto no builder quebra aqui.
// ---------------------------------------------------------------------------------------------
type Linha = Record<string, any>;
type Filtro = { op: "eq" | "gte" | "lte"; col: string; val: unknown };
type Resp = { data: any; error: { message: string; code?: string } | null; count?: number | null };
type Chamada = { tipo: "rpc" | "select" | "insert" | "update"; alvo: string; args?: any; filtros?: Filtro[]; opts?: any };

type CfgDb = {
  tabelas?: Record<string, Linha[]>;
  rpcs?: Record<string, (a: any) => Resp>;
  /** Simula o trigger de isolamento: devolve a mensagem do erro ou null. */
  gatilho?: (nova: Linha) => string | null;
  erroNaTabela?: Record<string, string>;
  lancaNaTabela?: Record<string, string>;
  rpcLancaSincrono?: string[];
  /** Falha de UPDATE por payload (simula erro do banco no meio de uma troca). */
  falhaUpdateSe?: (payload: Linha) => string | null;
  /** Gancho antes de um UPDATE casar linhas (simula corrida com outro turno). */
  antesDoUpdate?: (db: DbFalso) => void;
};

class DbFalso {
  chamadas: Chamada[] = [];
  rpcsExecutadas: string[] = [];
  tabelas: Record<string, Linha[]>;
  constructor(private cfg: CfgDb = {}) {
    this.tabelas = cfg.tabelas ?? {};
  }

  from(tabela: string) {
    if (this.cfg.lancaNaTabela?.[tabela]) throw new Error(this.cfg.lancaNaTabela[tabela]);
    const q = {
      tabela, op: "select" as Chamada["tipo"], opts: {} as any, filtros: [] as Filtro[],
      payload: undefined as any, limite: Infinity, unico: false, retorna: false,
    };
    const api: any = {
      select: (_cols?: string, opts?: any) => {
        if (q.op === "select") q.opts = opts ?? {};
        else q.retorna = true;
        return api;
      },
      insert: (p: any) => { q.op = "insert"; q.payload = p; return api; },
      update: (p: any) => { q.op = "update"; q.payload = p; return api; },
      eq: (col: string, val: unknown) => { q.filtros.push({ op: "eq", col, val }); return api; },
      gte: (col: string, val: unknown) => { q.filtros.push({ op: "gte", col, val }); return api; },
      lte: (col: string, val: unknown) => { q.filtros.push({ op: "lte", col, val }); return api; },
      limit: (n: number) => { q.limite = n; return api; },
      single: () => { q.unico = true; return api; },
      then: (ok: any, ko: any) => Promise.resolve().then(() => this.executar(q)).then(ok, ko),
    };
    return api;
  }

  rpc(nome: string, args: Record<string, unknown>) {
    this.chamadas.push({ tipo: "rpc", alvo: nome, args });
    if (this.cfg.rpcLancaSincrono?.includes(nome)) throw new Error(`rpc ${nome} lancou`);
    const h = this.cfg.rpcs?.[nome];
    // So "executa" quando alguem aguarda o builder (como o supabase-js, que so manda a requisicao
    // no then). Sem isto um fire-and-forget que nunca chama then() passaria despercebido.
    const exec = (): Resp => {
      this.rpcsExecutadas.push(nome);
      return h ? h(args) : { data: null, error: null };
    };
    return { then: (ok: any, ko: any) => Promise.resolve().then(exec).then(ok, ko) };
  }

  /** Emula CHECKs, unique parcial e trigger de agent_aprendizados. */
  private validar(tabela: string, nova: Linha, antiga: Linha | null): Resp["error"] {
    if (tabela !== "agent_aprendizados") return null;
    if (nova.status !== "vigente" && !String(nova.motivo_status ?? "").trim()) {
      return {
        code: "23514",
        message: 'new row for relation "agent_aprendizados" violates check constraint "agent_aprendizados_motivo_ao_sair_de_vigente"',
      };
    }
    const nf = String(nova.fato ?? "").length;
    if (nf < 20 || nf > 600) return { code: "23514", message: "violates check constraint fato" };
    if (!Array.isArray(nova.evidencias) || nova.evidencias.length < 1) {
      return { code: "23514", message: "violates check constraint evidencias" };
    }
    if (
      nova.status === "vigente" &&
      this.tabelas[tabela].some((l) =>
        l !== antiga && l.status === "vigente" && l.company_id === nova.company_id &&
        l.chave_normalizada === nova.chave_normalizada
      )
    ) {
      return {
        code: "23505",
        message: 'duplicate key value violates unique constraint "agent_aprendizados_vigente_chave_uq"',
      };
    }
    if (!antiga && this.cfg.gatilho) {
      const m = this.cfg.gatilho(nova);
      if (m) return { message: m };
    }
    return null;
  }

  private executar(q: any): Resp {
    this.chamadas.push({ tipo: q.op, alvo: q.tabela, args: q.payload, filtros: [...q.filtros], opts: q.opts });
    const msg = this.cfg.erroNaTabela?.[q.tabela];
    if (msg) return { data: null, error: { message: msg } };

    const linhas = (this.tabelas[q.tabela] ??= []);
    const casa = (l: Linha) =>
      q.filtros.every((f: Filtro) =>
        f.op === "eq" ? l[f.col] === f.val
        : f.op === "gte" ? String(l[f.col]) >= String(f.val)
        : String(l[f.col]) <= String(f.val)
      );

    if (q.op === "select") {
      const achadas = linhas.filter(casa);
      if (q.opts?.head) return { data: null, error: null, count: achadas.length };
      const fatia = achadas.slice(0, q.limite).map((l) => ({ ...l }));
      if (q.unico) {
        return fatia.length === 1
          ? { data: fatia[0], error: null }
          : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } };
      }
      return { data: fatia, error: null };
    }

    if (q.op === "insert") {
      const linha: Linha = {
        id: crypto.randomUUID(), status: "vigente", confirmacoes: 1, usos: 0,
        criado_em: new Date().toISOString(), ...q.payload,
      };
      const erro = this.validar(q.tabela, linha, null);
      if (erro) return { data: null, error: erro };
      linhas.push(linha);
      return { data: q.unico ? { ...linha } : [{ ...linha }], error: null };
    }

    // update
    this.cfg.antesDoUpdate?.(this);
    const falha = this.cfg.falhaUpdateSe?.(q.payload);
    if (falha) return { data: null, error: { message: falha } };
    const alvos = linhas.filter(casa);
    for (const l of alvos) {
      const erro = this.validar(q.tabela, { ...l, ...q.payload }, l);
      if (erro) return { data: null, error: erro };
    }
    for (const l of alvos) Object.assign(l, q.payload);
    return { data: q.retorna ? alvos.map((l) => ({ ...l })) : null, error: null };
  }

  // --- leitura do que foi chamado ---
  chamou(nome: string) { return this.chamadas.some((c) => c.tipo === "rpc" && c.alvo === nome); }
  ultimaRpc(nome: string) {
    return [...this.chamadas].reverse().find((c) => c.tipo === "rpc" && c.alvo === nome)?.args ?? null;
  }
  inserts(tabela = "agent_aprendizados"): Linha[] {
    return this.chamadas.filter((c) => c.tipo === "insert" && c.alvo === tabela).map((c) => c.args);
  }
  updates(tabela = "agent_aprendizados") {
    return this.chamadas.filter((c) => c.tipo === "update" && c.alvo === tabela);
  }
  ultimoInsert(): Linha { return this.inserts().at(-1) ?? {}; }
  linhasDe(tabela = "agent_aprendizados"): Linha[] { return this.tabelas[tabela] ?? []; }
}

// ---------------------------------------------------------------------------------------------
// Dados de exemplo
// ---------------------------------------------------------------------------------------------
const COOPERATIVA = "307849e6-78a7-4217-8112-3fb0a924f988";
const CONVERSA = "c0c0c0c0-0000-4000-8000-000000000001";
const ID = (n: number) => `${n}b12cd34-0000-4000-8000-00000000000${n}`;

const FALA = "A partir de agora mostre sempre o custo por conversa antes do CPL nos relatorios semanais";
const novoTurno = (over: Partial<TurnoAprendizado> = {}): TurnoAprendizado => ({
  companyId: COMPANY_COHAPM, agente: "AG-00", superficie: "chat", conversationId: CONVERSA, jobId: null,
  falasDoGestor: [FALA], retornos: [], registrosNoTurno: 0, ...over,
});
const pedidoOk = {
  fato: "O gestor quer ver o custo por conversa antes do CPL nos relatorios semanais",
  contexto: "Pediu isso ao revisar o relatorio da semana",
  categoria: "preferencia_do_gestor",
  evidencia: { tipo: "fala_do_gestor", trecho: "mostre sempre o custo por conversa antes do CPL" },
  confianca: "confirmada",
};

const linhaRpc = (n: number, over: Partial<AprendizadoLinha> = {}): AprendizadoLinha => ({
  id: ID(n), categoria: "preferencia_do_gestor", fato: `Fato numero ${n} sobre a conta, com texto suficiente`,
  linha: null, agente_codigo: "AG-00", confianca: "confirmada", confirmacoes: 1,
  criado_em: "2026-10-12T15:00:00.000Z", ...over,
});
const dbConsulta = (rows: AprendizadoLinha[], extra: CfgDb = {}) =>
  new DbFalso({ ...extra, rpcs: { consultar_aprendizados: () => ({ data: rows, error: null }), ...extra.rpcs } });

// =============================================================================================
// 1) CONSULTA
// =============================================================================================
{
  // Falha nunca lanca e avisa o modelo para nao concluir que "nao ha aprendizado".
  const dbErro = new DbFalso({ rpcs: { consultar_aprendizados: () => ({ data: null, error: { message: "boom" } }) } });
  const r = await calado(() => consultarMemoria({ supa: dbErro, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" }));
  assert(r.texto.includes(AVISO_FALHA_APRENDIZADOS), "falha da rpc nunca lanca e avisa");
  assert(r.telemetria.falhou === true && r.telemetria.injetados === 0 && r.ids.length === 0, "falha: telemetria.falhou e nada injetado");
  assert(!dbErro.chamou("marcar_uso_aprendizados"), "falha: nao marca uso");

  const dbRejeita = new DbFalso({ rpcs: { consultar_aprendizados: () => { throw new Error("rede caiu"); } } });
  const r2 = await calado(() => consultarMemoria({ supa: dbRejeita, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" }));
  assert(r2.texto === AVISO_FALHA_APRENDIZADOS && r2.telemetria.falhou, "rpc que rejeita tambem vira aviso");

  const dbLancaSinc = new DbFalso({ rpcLancaSincrono: ["consultar_aprendizados"] });
  const r3 = await calado(() => consultarMemoria({ supa: dbLancaSinc, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" }));
  assert(r3.texto === AVISO_FALHA_APRENDIZADOS, "rpc que lanca na chamada tambem vira aviso");

  const dbMalformada = new DbFalso({ rpcs: { consultar_aprendizados: () => ({ data: { nao: "e lista" }, error: null }) } });
  const r4 = await calado(() => consultarMemoria({ supa: dbMalformada, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" }));
  assert(r4.texto === AVISO_FALHA_APRENDIZADOS, "resposta que nao e lista vira aviso, nao 'sem aprendizado'");
}

{
  // Chave desligada = como hoje: sem bloco e sem sequer chamar a consulta.
  const dbOff = dbConsulta([linhaRpc(1)], {
    tabelas: { memoria_config: [{ id: true, consulta_ativa: false, gravacao_ativa: true }] },
  });
  const r = await consultarMemoria({ supa: dbOff, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r.texto === "", "chave desligada = como hoje");
  assert(r.telemetria.desligada === true && r.telemetria.falhou === false, "chave desligada: telemetria.desligada");
  assert(!dbOff.chamou("consultar_aprendizados") && !dbOff.chamou("marcar_uso_aprendizados"), "desligada: nem consulta nem uso");

  // Consulta e gravacao sao chaves separadas.
  const dbSoGravOff = dbConsulta([linhaRpc(1)], {
    tabelas: { memoria_config: [{ id: true, consulta_ativa: true, gravacao_ativa: false }] },
  });
  const r2 = await consultarMemoria({ supa: dbSoGravOff, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r2.texto.startsWith(CABECALHO_APRENDIZADOS), "gravacao desligada nao desliga a consulta");

  // Falha ao LER a chave conta como ligada (a chave e um freio, nao uma trava de seguranca).
  const dbSemConfig = dbConsulta([linhaRpc(1)], { lancaNaTabela: { memoria_config: "tabela fora do ar" } });
  const r3 = await consultarMemoria({ supa: dbSemConfig, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r3.texto.startsWith(CABECALHO_APRENDIZADOS) && !r3.telemetria.falhou, "falha ao ler a chave conta como ligada (excecao)");
  const dbErroConfig = dbConsulta([linhaRpc(1)], { erroNaTabela: { memoria_config: "permissao negada" } });
  const r4 = await consultarMemoria({ supa: dbErroConfig, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r4.texto.startsWith(CABECALHO_APRENDIZADOS), "falha ao ler a chave conta como ligada (erro)");
}

{
  // Tabela vazia = sem bloco (e sem marcar uso de nada).
  const dbVazio = dbConsulta([]);
  const r = await consultarMemoria({ supa: dbVazio, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r.texto === "", "tabela vazia = sem bloco");
  assert(r.telemetria.injetados === 0 && r.telemetria.chars === 0 && !r.telemetria.falhou && !r.telemetria.desligada, "vazio: telemetria zerada");
  assert(!dbVazio.chamou("marcar_uso_aprendizados"), "vazio: nao marca uso");
}

{
  // Tres registros: linhas e limite do papel, uso marcado so do que entrou.
  const rows = [
    linhaRpc(1, { linha: "juridico" }),
    linhaRpc(2, { linha: "la_felicita", confirmacoes: 3 }),
    linhaRpc(3),
  ];
  const dbCom3 = dbConsulta(rows);
  const r = await consultarMemoria({
    supa: dbCom3, companyId: COMPANY_COHAPM, tarefa: "compare La Felicita e Juridico", papel: "subagente",
  });
  const rpc = dbCom3.ultimaRpc("consultar_aprendizados");
  assert(eq(rpc.p_linhas, ["la_felicita", "juridico"]), "p_linhas = linhas inferidas da tarefa");
  assert(rpc.p_limite === 5, "subagente: limite 5");
  assert(rpc.p_max_preferencias === 5, "p_max_preferencias = 5");
  assert(rpc.p_somente_confirmadas === false, "somenteConfirmadas ausente = false");
  assert(rpc.p_company_id === COMPANY_COHAPM && rpc.p_texto === "compare La Felicita e Juridico", "empresa e texto da tarefa");
  assert(dbCom3.chamou("marcar_uso_aprendizados"), "uso marcado");
  await new Promise((ok) => setTimeout(ok, 10));
  assert(dbCom3.rpcsExecutadas.includes("marcar_uso_aprendizados"), "uso marcado de fato disparado (then chamado no builder)");
  assert(eq(dbCom3.ultimaRpc("marcar_uso_aprendizados").p_ids, [ID(1), ID(2), ID(3)]), "uso marcado com os ids injetados");
  assert(eq(r.ids, [ID(1), ID(2), ID(3)]) && eq(r.telemetria.ids, r.ids) && r.telemetria.injetados === 3, "ids e telemetria");
  assert(r.texto.startsWith(CABECALHO_APRENDIZADOS), "bloco abre com o cabecalho de precedencia");
  assert(r.texto.includes(`#${idCurto(ID(2))}`) && r.texto.includes("La Felicità") && r.texto.includes("Jurídico") && r.texto.includes("Geral"), "COHAPM: cada item com o rotulo da linha");
  assert(r.telemetria.chars === r.texto.length, "chars = tamanho do bloco");

  // Limite por papel.
  const dbChat = dbConsulta([linhaRpc(1)]);
  await consultarMemoria({ supa: dbChat, companyId: COMPANY_COHAPM, tarefa: "como esta a conta?", papel: "chat" });
  assert(dbChat.ultimaRpc("consultar_aprendizados").p_limite === 8, "chat: limite 8");
  assert(dbChat.ultimaRpc("consultar_aprendizados").p_linhas === null, "tarefa sem linha: p_linhas nulo (todas, rotuladas)");
  for (const papel of ["sintese", "relatorio", "ritmo", "correcao_custo", "reco", "legendas", "waba_redator"] as const) {
    const d = dbConsulta([linhaRpc(1)]);
    await consultarMemoria({ supa: d, companyId: COMPANY_COHAPM, tarefa: "x", papel });
    assert(d.ultimaRpc("consultar_aprendizados").p_limite === 5, `${papel}: limite 5`);
  }

  // Linha fixa dada pela edge (marca escolhida no gerar-legendas) vence a inferencia.
  const dbLeg = dbConsulta([linhaRpc(1)]);
  await consultarMemoria({
    supa: dbLeg, companyId: COMPANY_COHAPM, tarefa: "legendas para o juridico", papel: "legendas", linhaFixa: "la_felicita",
  });
  assert(eq(dbLeg.ultimaRpc("consultar_aprendizados").p_linhas, ["la_felicita"]), "linhaFixa vence a inferencia");

  // So confirmadas.
  const dbConf = dbConsulta([linhaRpc(1)]);
  await consultarMemoria({ supa: dbConf, companyId: COMPANY_COHAPM, tarefa: "x", papel: "waba_redator", somenteConfirmadas: true });
  assert(dbConf.ultimaRpc("consultar_aprendizados").p_somente_confirmadas === true, "somenteConfirmadas repassado");

  // Empresa sem linhas: p_linhas nulo e item sem rotulo de linha.
  const dbLegal = dbConsulta([linhaRpc(1)]);
  const rl = await consultarMemoria({ supa: dbLegal, companyId: COMPANY_LEGAL, tarefa: "compare La Felicita e Juridico", papel: "chat" });
  assert(dbLegal.ultimaRpc("consultar_aprendizados").p_linhas === null, "empresa sem linhas: p_linhas nulo");
  assert(!rl.texto.includes("Geral"), "empresa sem linhas: item sem rotulo de linha");

  // Tarefa enorme (pedido colado do gestor) nao vai inteira para o banco.
  const dbLonga = dbConsulta([]);
  await consultarMemoria({ supa: dbLonga, companyId: COMPANY_COHAPM, tarefa: "palavra ".repeat(5000), papel: "chat" });
  assert(String(dbLonga.ultimaRpc("consultar_aprendizados").p_texto).length <= 2000, "p_texto limitado");
}

{
  // Teto de caracteres: corta item inteiro, e o uso marcado e so do que coube.
  const grandes = Array.from({ length: 8 }, (_, i) => linhaRpc(i + 1, { fato: `Fato ${i + 1} ` + "x".repeat(590) }));
  const dbChat = dbConsulta(grandes);
  const rc = await consultarMemoria({ supa: dbChat, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(rc.telemetria.chars <= 4000, "teto chat: chars <= 4000");
  assert(rc.telemetria.injetados > 0 && rc.telemetria.injetados < 8, "teto chat: cortou itens");
  assert(eq(rc.ids, grandes.slice(0, rc.telemetria.injetados).map((r) => r.id)), "teto chat: ids sao os dos itens que entraram");
  assert(eq(dbChat.ultimaRpc("marcar_uso_aprendizados").p_ids, rc.ids), "teto chat: uso marcado so dos que entraram");

  const dbSub = dbConsulta(grandes);
  const rs = await consultarMemoria({ supa: dbSub, companyId: COMPANY_COHAPM, tarefa: "x", papel: "subagente" });
  assert(rs.telemetria.chars <= 2500 && rs.telemetria.injetados < rc.telemetria.injetados, "teto dos demais papeis: 2500");

  // Nem o primeiro cabe: sem bloco e sem uso marcado.
  const gigante = dbConsulta([linhaRpc(1, { fato: "y".repeat(5000) })]);
  const rg = await consultarMemoria({ supa: gigante, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(rg.texto === "" && rg.telemetria.injetados === 0 && !gigante.chamou("marcar_uso_aprendizados"), "nem o primeiro cabe: sem bloco, sem uso");
}

{
  // Marcar uso e segundo plano: falha dele nao derruba a consulta, nem como erro, nem como excecao.
  const dbUsoErro = dbConsulta([linhaRpc(1)], { rpcs: { marcar_uso_aprendizados: () => ({ data: null, error: { message: "x" } }) } });
  const r1 = await consultarMemoria({ supa: dbUsoErro, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r1.texto.startsWith(CABECALHO_APRENDIZADOS) && !r1.telemetria.falhou, "erro ao marcar uso nao derruba a consulta");

  const dbUsoRejeita = dbConsulta([linhaRpc(1)], { rpcs: { marcar_uso_aprendizados: () => { throw new Error("rede"); } } });
  const r2 = await consultarMemoria({ supa: dbUsoRejeita, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  await new Promise((ok) => setTimeout(ok, 10)); // deixa a promessa solta rejeitar: nao pode virar erro nao tratado
  assert(r2.texto.startsWith(CABECALHO_APRENDIZADOS) && !r2.telemetria.falhou, "rejeicao ao marcar uso nao derruba a consulta");

  const dbUsoSinc = dbConsulta([linhaRpc(1)], { rpcLancaSincrono: ["marcar_uso_aprendizados"] });
  const r3 = await consultarMemoria({ supa: dbUsoSinc, companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  assert(r3.texto.startsWith(CABECALHO_APRENDIZADOS) && !r3.telemetria.falhou, "excecao sincrona ao marcar uso nao derruba a consulta");

  // No runtime da edge, EdgeRuntime.waitUntil segura o isolate ate o update terminar.
  const g = globalThis as any;
  let segurou = 0;
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { if (p && typeof p.then === "function") segurou++; } };
  try {
    await consultarMemoria({ supa: dbConsulta([linhaRpc(1)]), companyId: COMPANY_COHAPM, tarefa: "x", papel: "chat" });
  } finally {
    delete g.EdgeRuntime;
  }
  assert(segurou === 1, "uso marcado entregue ao EdgeRuntime.waitUntil quando ele existe");
}

// =============================================================================================
// 2) inicioDoDiaSaoPaulo (teto do dia)
// =============================================================================================
assert(inicioDoDiaSaoPaulo(new Date("2026-11-02T01:30:00Z")) === "2026-11-01T03:00:00.000Z", "01:30 UTC de 02/11 ainda e dia 01 em Sao Paulo");
assert(inicioDoDiaSaoPaulo(new Date("2026-11-02T12:00:00Z")) === "2026-11-02T03:00:00.000Z", "meio-dia UTC: meia-noite de Sao Paulo do mesmo dia");
assert(inicioDoDiaSaoPaulo(new Date("2026-11-02T02:59:59.999Z")) === "2026-11-01T03:00:00.000Z", "um ms antes da virada");
assert(inicioDoDiaSaoPaulo(new Date("2026-11-02T03:00:00.000Z")) === "2026-11-02T03:00:00.000Z", "exatamente na virada");

// =============================================================================================
// 3) REGISTRO
// =============================================================================================
const dbReg = (extra: CfgDb = {}) => new DbFalso(extra);

{
  // Grava, com tudo o que a tabela exige, e conta no turno.
  const db = dbReg();
  const turno = novoTurno();
  const r = await registrarAprendizado(db, pedidoOk, turno);
  assert(r.resultado === "gravado", "grava");
  assert(!!r.id && r.id_curto === idCurto(r.id!) && r.id_curto!.length === 6, "devolve id e id curto");
  assert(turno.registrosNoTurno === 1, "incrementa registrosNoTurno ao gravar");
  const ins = db.ultimoInsert();
  assert(db.inserts().length === 1, "um unico insert");
  assert(ins.company_id === turno.companyId, "empresa do turno");
  assert(ins.agente_codigo === "AG-00" && ins.superficie === "chat" && ins.conversation_id === CONVERSA, "agente, superficie e conversa do turno");
  assert(ins.fato === pedidoOk.fato && ins.contexto === pedidoOk.contexto && ins.categoria === "preferencia_do_gestor" && ins.confianca === "confirmada", "campos do pedido");
  assert(ins.chave_normalizada === chaveNormalizada(pedidoOk.fato), "chave_normalizada calculada pela edge");
  assert(ins.linha === null && ins.valido_ate === null, "sem linha no texto e sem prazo: nulos");
  assert(Array.isArray(ins.evidencias) && ins.evidencias.length === 1 && ins.evidencias[0].tipo === "fala_do_gestor" && ins.evidencias[0].trecho === pedidoOk.evidencia.trecho && typeof ins.evidencias[0].em === "string", "evidencia com tipo, trecho e data");
  assert(!("status" in ins) && !("id" in ins), "status e id ficam por conta do banco");
  assert(db.ultimaRpc("aprendizados_parecidos").p_limiar === 0.8 && db.ultimaRpc("aprendizados_parecidos").p_chave === ins.chave_normalizada, "dedupe com o limiar 0.8 sobre a chave");
  assert(db.ultimaRpc("aprendizados_parecidos").p_company_id === turno.companyId && db.ultimaRpc("aprendizados_parecidos").p_linha === null, "dedupe na empresa e na linha do registro");
}

{
  // Empresa SEMPRE a do turno, mesmo que o modelo mande outra no argumento.
  const db = dbReg();
  const turno = novoTurno();
  await registrarAprendizado(db, { ...pedidoOk, company_id: COMPANY_LEGAL, empresa: COMPANY_LEGAL, agente_codigo: "AG-99" }, turno);
  assert(db.ultimoInsert().company_id === turno.companyId, "empresa do turno, nunca do argumento");
  assert(db.ultimoInsert().agente_codigo === "AG-00", "agente do turno, nunca do argumento");
  assert(db.ultimaRpc("aprendizados_parecidos").p_company_id === turno.companyId, "dedupe tambem na empresa do turno");

  // Contexto ausente vira null (validarPedidoRegistro devolve "").
  const db2 = dbReg();
  const { contexto: _c, ...semContexto } = pedidoOk;
  const r = await registrarAprendizado(db2, semContexto, novoTurno());
  assert(r.resultado === "gravado" && db2.ultimoInsert().contexto === null, "contexto ausente grava null");

  // Prazo.
  const db3 = dbReg();
  await registrarAprendizado(db3, { ...pedidoOk, valido_ate: "2026-12-31" }, novoTurno());
  assert(db3.ultimoInsert().valido_ate === "2026-12-31", "valido_ate gravado");

  // Job: sem conversa, com job_id na evidencia.
  const db4 = dbReg();
  const turnoJob = novoTurno({ superficie: "job", conversationId: null, jobId: "j-1", agente: "AG-02" });
  await registrarAprendizado(db4, pedidoOk, turnoJob);
  assert(db4.ultimoInsert().superficie === "job" && db4.ultimoInsert().conversation_id === null && db4.ultimoInsert().evidencias[0].job_id === "j-1", "job: superficie, sem conversa e job_id na evidencia");
}

{
  // Forma e evidencia (passo 1): nada vai ao banco.
  const casos: [string, unknown, Partial<TurnoAprendizado>?, string?][] = [
    ["args nulo", null],
    ["args texto", "oi"],
    ["fato curto", { ...pedidoOk, fato: "curto" }],
    ["categoria invalida", { ...pedidoOk, categoria: "outra" }],
    ["trecho que nao esta na fala (parafrase)", { ...pedidoOk, evidencia: { tipo: "fala_do_gestor", trecho: "o gestor gosta de ver conversa primeiro" } }, undefined, "cite a fala exata"],
    ["trecho curto", { ...pedidoOk, evidencia: { tipo: "fala_do_gestor", trecho: "mostre" } }],
    ["ferramenta que nao rodou", { ...pedidoOk, confianca: "observada", evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "a conta usa conversas iniciadas como resultado" } }, undefined, "nao rodou"],
    ["confirmada com retorno de ferramenta", { ...pedidoOk, evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "a conta usa conversas iniciadas como resultado" } },
      { retornos: [{ tool: "get_funnel", retorno: { nota: "a conta usa conversas iniciadas como resultado" } }] }, "observada"],
  ];
  for (const [nome, args, over, trecho] of casos) {
    const db = dbReg();
    const turno = novoTurno(over);
    const r = await registrarAprendizado(db, args, turno);
    assert(r.resultado === "recusado" && !!r.motivo, `recusa: ${nome}`);
    if (trecho) assert(!!r.motivo?.includes(trecho), `motivo de "${nome}" cita "${trecho}" (veio: ${r.motivo})`);
    assert(db.inserts().length === 0 && turno.registrosNoTurno === (over?.registrosNoTurno ?? 0), `recusa nao grava nem conta: ${nome}`);
  }

  // Retorno de ferramenta rodado neste turno vale, como observada.
  const db = dbReg();
  const r = await registrarAprendizado(db, {
    fato: "A conta usa conversas iniciadas como resultado principal das campanhas", contexto: "", categoria: "fato_da_conta", confianca: "observada",
    evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "a conta usa conversas iniciadas como resultado principal" },
  }, novoTurno({ retornos: [{ tool: "get_funnel", retorno: { nota: "a conta usa conversas iniciadas como resultado principal" } }] }));
  assert(r.resultado === "gravado" && db.ultimoInsert().confianca === "observada" && db.ultimoInsert().evidencias[0].ferramenta === "get_funnel", "retorno de ferramenta conferido grava como observada");
}

{
  // Dado volatil (passo 2).
  const db = dbReg();
  const r = await registrarAprendizado(db, { ...pedidoOk, fato: "CPL de ontem foi R$ 12 na campanha" }, novoTurno());
  assert(r.resultado === "recusado" && !!r.motivo?.includes("dado, nao memoria"), "volatil recusado");
  assert(db.inserts().length === 0 && !db.chamou("aprendizados_parecidos"), "volatil: para antes do banco");
}

{
  // Isolamento (passo 3): marca de outra empresa e conta Meta.
  const db = dbReg();
  const r = await registrarAprendizado(db, { ...pedidoOk, fato: "No Legal e Viver o gestor quer ver o custo por conversa primeiro" }, novoTurno());
  assert(r.resultado === "recusado" && !!r.motivo?.includes("cita_outra_empresa"), "marca de outra empresa recusada");
  assert(db.inserts().length === 0, "marca de outra empresa: nada gravado");

  // meta_ad_accounts vazia: qualquer act_ e recusado (fail-closed, intencional).
  const dbVaziaContas = dbReg({ tabelas: { meta_ad_accounts: [] } });
  const rc = await registrarAprendizado(dbVaziaContas, { ...pedidoOk, fato: "A conta act_111222333 usa conversas iniciadas como resultado" }, novoTurno());
  assert(rc.resultado === "recusado" && !!rc.motivo?.includes("cita_conta_alheia"), "act_ com meta_ad_accounts vazia: recusado");
  const dbSemTabela = dbReg();
  const rc0 = await registrarAprendizado(dbSemTabela, { ...pedidoOk, fato: "A conta act_111222333 usa conversas iniciadas como resultado" }, novoTurno());
  assert(rc0.resultado === "recusado", "act_ sem nenhuma conta cadastrada: recusado");

  // Conta de OUTRA empresa com o mesmo numero nao vale para esta.
  const dbOutra = dbReg({ tabelas: { meta_ad_accounts: [{ company_id: COMPANY_LEGAL, account_id: "act_111222333" }] } });
  const ro = await registrarAprendizado(dbOutra, { ...pedidoOk, fato: "A conta act_111222333 usa conversas iniciadas como resultado" }, novoTurno());
  assert(ro.resultado === "recusado" && !!ro.motivo?.includes("cita_conta_alheia"), "conta de outra empresa recusada");
  assert(dbOutra.chamadas.some((c) => c.tipo === "select" && c.alvo === "meta_ad_accounts" && c.filtros?.some((f) => f.col === "company_id" && f.val === COMPANY_COHAPM)), "contas lidas filtrando pela empresa do turno");

  // Conta da propria empresa passa (com ou sem o prefixo act_ na tabela).
  for (const cadastrada of ["act_111222333", "111222333"]) {
    const dbPropria = dbReg({ tabelas: { meta_ad_accounts: [{ company_id: COMPANY_COHAPM, account_id: cadastrada }] } });
    const rp = await registrarAprendizado(dbPropria, { ...pedidoOk, fato: "A conta act_111222333 usa conversas iniciadas como resultado" }, novoTurno());
    assert(rp.resultado === "gravado", `conta propria (${cadastrada}) passa`);
  }

  // Sem act_ no texto nem consulta as contas.
  const dbSemAct = dbReg();
  await registrarAprendizado(dbSemAct, pedidoOk, novoTurno());
  assert(!dbSemAct.chamadas.some((c) => c.alvo === "meta_ad_accounts"), "sem act_ no texto nao consulta contas");

  // Erro ao ler as contas, com act_ no texto: nao deixa passar.
  const dbErroContas = dbReg({ erroNaTabela: { meta_ad_accounts: "permissao negada" } });
  const re = await registrarAprendizado(dbErroContas, { ...pedidoOk, fato: "A conta act_111222333 usa conversas iniciadas como resultado" }, novoTurno());
  assert(re.resultado === "recusado" && dbErroContas.inserts().length === 0, "erro ao ler contas: recusa (fail-closed)");
}

{
  // Linha (passo 4).
  const db = dbReg();
  const r = await registrarAprendizado(db, { ...pedidoOk, fato: "No juridico o gestor quer ver o custo por conversa antes do CPL" }, novoTurno());
  assert(r.resultado === "gravado" && db.ultimoInsert().linha === "juridico", "fato do Juridico grava linha = juridico");
  assert(db.ultimaRpc("aprendizados_parecidos").p_linha === "juridico", "dedupe na linha do registro");

  const db2 = dbReg();
  const r2 = await registrarAprendizado(db2, { ...pedidoOk, fato: "A La Felicita e o Juridico usam o mesmo criterio de custo por conversa" }, novoTurno());
  assert(r2.resultado === "recusado" && !!r2.motivo?.includes("um aprendizado por linha") && db2.inserts().length === 0, "fato com duas linhas recusado");

  const db3 = dbReg();
  const r3 = await registrarAprendizado(db3, { ...pedidoOk, linha: "juridico" }, novoTurno());
  assert(r3.resultado === "gravado" && db3.ultimoInsert().linha === "juridico", "texto sem linha: vale a linha do modelo");

  const db4 = dbReg();
  const r4 = await registrarAprendizado(db4, { ...pedidoOk, linha: "marte" }, novoTurno());
  assert(r4.resultado === "recusado" && db4.inserts().length === 0, "linha invalida recusada");

  // Empresa sem linhas: linha sempre nula, ignorando o parametro do modelo.
  const db5 = dbReg();
  const r5 = await registrarAprendizado(db5, { ...pedidoOk, linha: "juridico" }, novoTurno({ companyId: COMPANY_LEGAL }));
  assert(r5.resultado === "gravado" && db5.ultimoInsert().linha === null, "empresa sem linhas: linha nula");
}

{
  // Dedupe (passo 5): o mesmo fato reforca, nao cria linha.
  const parecido = { id: ID(7), similaridade: 0.92 };
  const db = dbReg({ rpcs: { aprendizados_parecidos: () => ({ data: [parecido, { id: ID(8), similaridade: 0.81 }], error: null }) } });
  const turno = novoTurno();
  const r = await registrarAprendizado(db, pedidoOk, turno);
  assert(r.resultado === "ja_registrado" && r.id === ID(7) && r.id_curto === idCurto(ID(7)), "dedupe: ja_registrado com o id do mais parecido");
  assert(db.chamou("reforcar_aprendizado"), "dedupe reforca");
  const ev = db.ultimaRpc("reforcar_aprendizado");
  assert(ev.p_id === ID(7) && ev.p_evidencia?.tipo === "fala_do_gestor" && ev.p_evidencia?.trecho === pedidoOk.evidencia.trecho && typeof ev.p_evidencia?.em === "string", "reforco anexa a evidencia nova");
  assert(db.inserts().length === 0, "dedupe: nao cria linha nova");
  assert(turno.registrosNoTurno === 0, "reforco nao conta no teto do turno");

  // O reforco vale mesmo com o turno ja no teto: nao cria registro.
  const db2 = dbReg({ rpcs: { aprendizados_parecidos: () => ({ data: [parecido], error: null }) } });
  const r2 = await registrarAprendizado(db2, pedidoOk, novoTurno({ registrosNoTurno: TETO_REGISTROS_TURNO }));
  assert(r2.resultado === "ja_registrado", "reforco passa mesmo com o turno no teto");

  // Falhas do dedupe nao viram duplicata silenciosa nem excecao.
  const dbErroPar = dbReg({ rpcs: { aprendizados_parecidos: () => ({ data: null, error: { message: "falhou a busca" } }) } });
  const rp = await registrarAprendizado(dbErroPar, pedidoOk, novoTurno());
  assert(rp.resultado === "recusado" && !!rp.motivo?.includes("falhou a busca") && dbErroPar.inserts().length === 0, "erro no dedupe: recusa");
  const dbErroRef = dbReg({
    rpcs: {
      aprendizados_parecidos: () => ({ data: [parecido], error: null }),
      reforcar_aprendizado: () => ({ data: null, error: { message: "falhou o reforco" } }),
    },
  });
  const rr = await registrarAprendizado(dbErroRef, pedidoOk, novoTurno());
  assert(rr.resultado === "recusado" && !!rr.motivo?.includes("falhou o reforco"), "erro no reforco: recusa, nao finge que reforcou");
}

{
  // Teto (passo 6).
  const db = dbReg();
  const r = await registrarAprendizado(db, pedidoOk, novoTurno({ registrosNoTurno: TETO_REGISTROS_TURNO }));
  assert(r.resultado === "recusado" && !!r.motivo?.includes("turno") && db.inserts().length === 0, "teto do turno");

  const turno = novoTurno({ registrosNoTurno: TETO_REGISTROS_TURNO - 1 });
  const db2 = dbReg();
  const r2 = await registrarAprendizado(db2, pedidoOk, turno);
  assert(r2.resultado === "gravado" && turno.registrosNoTurno === TETO_REGISTROS_TURNO, "o ultimo registro do turno cabe");

  // Teto do dia: conta so a empresa do turno e so desde a meia-noite de Sao Paulo.
  const hoje = new Date().toISOString();
  const ontem = new Date(Date.now() - 36 * 3600_000).toISOString();
  const rowsHoje = (n: number, company: string, quando: string) =>
    Array.from({ length: n }, (_, i) => ({ id: crypto.randomUUID(), company_id: company, status: "vigente", criado_em: quando, chave_normalizada: `${company}-${quando}-${i}` }));

  const dbDia = dbReg({ tabelas: { agent_aprendizados: [...rowsHoje(TETO_REGISTROS_DIA, COMPANY_COHAPM, hoje), ...rowsHoje(5, COMPANY_COHAPM, ontem)] } });
  const rd = await registrarAprendizado(dbDia, pedidoOk, novoTurno());
  assert(rd.resultado === "recusado" && !!rd.motivo?.includes("dia") && dbDia.inserts().length === 0, "teto do dia");
  const contagem = dbDia.chamadas.find((c) => c.tipo === "select" && c.alvo === "agent_aprendizados" && c.opts?.head);
  assert(!!contagem && contagem.opts.count === "exact", "teto do dia conta no banco (count exact, head)");
  assert(!!contagem?.filtros?.some((f) => f.op === "eq" && f.col === "company_id" && f.val === COMPANY_COHAPM), "teto do dia: so a empresa do turno");
  assert(!!contagem?.filtros?.some((f) => f.op === "gte" && f.col === "criado_em" && f.val === inicioDoDiaSaoPaulo()), "teto do dia: desde a meia-noite de Sao Paulo");

  const dbDia29 = dbReg({ tabelas: { agent_aprendizados: rowsHoje(TETO_REGISTROS_DIA - 1, COMPANY_COHAPM, hoje) } });
  assert((await registrarAprendizado(dbDia29, pedidoOk, novoTurno())).resultado === "gravado", "29 hoje: ainda cabe o trigesimo");

  const dbDiaOutros = dbReg({ tabelas: { agent_aprendizados: [...rowsHoje(TETO_REGISTROS_DIA, COMPANY_LEGAL, hoje), ...rowsHoje(TETO_REGISTROS_DIA, COMPANY_COHAPM, ontem)] } });
  assert((await registrarAprendizado(dbDiaOutros, pedidoOk, novoTurno())).resultado === "gravado", "registros de outra empresa ou de ontem nao entram na conta do dia");

  const dbDiaErro = dbReg({ erroNaTabela: { agent_aprendizados: "falha na contagem" } });
  const rde = await registrarAprendizado(dbDiaErro, pedidoOk, novoTurno());
  assert(rde.resultado === "recusado" && dbDiaErro.inserts().length === 0, "erro ao contar o dia: recusa");
}

{
  // Gravacao desligada (7.10): como hoje, nada e escrito.
  const db = dbReg({ tabelas: { memoria_config: [{ id: true, consulta_ativa: true, gravacao_ativa: false }] } });
  const r = await registrarAprendizado(db, pedidoOk, novoTurno());
  assert(r.resultado === "recusado" && !!r.motivo?.includes("desligad"), "gravacao desligada");
  assert(db.inserts().length === 0 && !db.chamou("aprendizados_parecidos") && !db.chamou("reforcar_aprendizado"), "gravacao desligada: nada no banco");

  // Falha ao ler a chave conta como ligada.
  const dbOk = dbReg({ lancaNaTabela: { memoria_config: "fora do ar" } });
  assert((await registrarAprendizado(dbOk, pedidoOk, novoTurno())).resultado === "gravado", "falha ao ler a chave: grava como hoje");
}

{
  // Erro do banco (trigger, unique, qualquer um) vira recusado com a mensagem, nunca excecao.
  const turno = novoTurno();
  const dbTrig = dbReg({ gatilho: () => "aprendizado_cita_outra_empresa" });
  const r = await registrarAprendizado(dbTrig, pedidoOk, turno);
  assert(r.resultado === "recusado" && r.motivo === "aprendizado_cita_outra_empresa", "erro do trigger vira recusado com a mensagem do banco");
  assert(turno.registrosNoTurno === 0, "insert recusado nao conta no turno");

  const dbDup = dbReg({ tabelas: { agent_aprendizados: [{ id: ID(5), company_id: COMPANY_COHAPM, status: "vigente", criado_em: "2026-10-01T00:00:00Z", chave_normalizada: chaveNormalizada(pedidoOk.fato) }] } });
  const rd = await registrarAprendizado(dbDup, pedidoOk, novoTurno());
  assert(rd.resultado === "recusado" && !!rd.motivo?.includes("mesmo fato") && dbDup.linhasDe().length === 1, "unique do dedupe exato (linha diferente) vira recusado legivel");

  const dbLanca = dbReg({ lancaNaTabela: { agent_aprendizados: "conexao perdida" } });
  const rl = await calado(() => registrarAprendizado(dbLanca, pedidoOk, novoTurno()));
  assert(rl.resultado === "recusado" && !!rl.motivo?.includes("conexao perdida"), "excecao no banco vira recusado");
}

// =============================================================================================
// 4) CORRECAO
// =============================================================================================
const ALVO = "abc12345-1111-4000-8000-000000000001";
const alvoRow = (over: Linha = {}): Linha => ({
  id: ALVO, company_id: COMPANY_COHAPM, linha: null, categoria: "preferencia_do_gestor",
  fato: "O gestor quer ver o CPL antes do custo por conversa", contexto: null,
  evidencias: [{ tipo: "fala_do_gestor", trecho: "x", em: "2026-10-01T00:00:00Z" }],
  status: "vigente", motivo_status: null, confirmacoes: 1,
  chave_normalizada: chaveNormalizada("O gestor quer ver o CPL antes do custo por conversa"),
  criado_em: "2026-10-01T00:00:00Z", ...over,
});
const FALA_CORR = "esquece o abc123 porque agora o gestor quer ver o custo por conversa primeiro";
const turnoCorr = (over: Partial<TurnoAprendizado> = {}) => novoTurno({ falasDoGestor: [FALA_CORR], ...over });
const evidenciaCorr = { tipo: "fala_do_gestor", trecho: "agora o gestor quer ver o custo por conversa primeiro" };
const dbCorr = (rows: Linha[], extra: CfgDb = {}) => new DbFalso({ ...extra, tabelas: { agent_aprendizados: rows, ...extra.tabelas } });

{
  // Isolamento: id de outra empresa nunca e achado nem tocado.
  const dbOutra = dbCorr([alvoRow({ company_id: COMPANY_LEGAL })]);
  const r = await corrigirAprendizado(dbOutra, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(r.resultado === "recusado", "id de outra empresa");
  assert(dbOutra.updates().length === 0 && dbOutra.inserts().length === 0 && dbOutra.linhasDe()[0].status === "vigente", "id de outra empresa: nada alterado");
  assert(!r.motivo?.includes(COMPANY_LEGAL), "a recusa nao revela a outra empresa");

  // Prefixo ambiguo entre vigentes da mesma empresa.
  const dbDois = dbCorr([alvoRow(), alvoRow({ id: "abc12399-2222-4000-8000-000000000002", chave_normalizada: "outra chave" })]);
  const r2 = await corrigirAprendizado(dbDois, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(r2.resultado === "recusado" && !!r2.motivo?.includes("ambiguo"), "prefixo ambiguo");
  assert(dbDois.updates().length === 0, "ambiguo: nada alterado");

  // Mas o prefixo mais longo desfaz a ambiguidade.
  const r2b = await corrigirAprendizado(dbDois, { id: "abc123-45", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(r2b.resultado === "gravado" && r2b.id === ALVO, "prefixo mais longo desfaz a ambiguidade");

  // Nao achado, nao vigente, id mal formado.
  const dbNada = dbCorr([alvoRow()]);
  const r3 = await corrigirAprendizado(dbNada, { id: "ffffff", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(r3.resultado === "recusado" && !!r3.motivo?.includes("nao encontrado"), "id nao encontrado");
  const dbApos = dbCorr([alvoRow({ status: "aposentada", motivo_status: "sem uso" })]);
  const r4 = await corrigirAprendizado(dbApos, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(r4.resultado === "recusado" && !!r4.motivo?.includes("aposentada") && dbApos.updates().length === 0, "exige um vigente: aposentada recusada");
  for (const ruim of ["zz", "abc12", "", null, 123456, "#"]) {
    const d = dbCorr([alvoRow()]);
    const rr = await corrigirAprendizado(d, { id: ruim, acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
    assert(rr.resultado === "recusado" && d.updates().length === 0, `id mal formado recusado: ${JSON.stringify(ruim)}`);
  }
  // O "#" do id curto, como o gestor escreve no chat, e aceito.
  const dbHash = dbCorr([alvoRow()]);
  assert((await corrigirAprendizado(dbHash, { id: "#abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr())).resultado === "gravado", "id com # aceito");
}

{
  // Aposentar: status E motivo_status no mesmo comando (o CHECK recusa um sem o outro).
  const db = dbCorr([alvoRow()]);
  const turno = turnoCorr();
  const r = await corrigirAprendizado(db, { id: "abc123", acao: "aposentar", motivo: "o gestor mudou de ideia", evidencia: evidenciaCorr }, turno);
  assert(r.resultado === "gravado" && r.id === ALVO && r.id_curto === idCurto(ALVO), "aposentar devolve o id do registro");
  assert(db.updates().length === 1, "aposentar: um unico UPDATE");
  const up = db.updates()[0];
  assert(up.args.status === "aposentada" && up.args.motivo_status === "o gestor mudou de ideia", "aposentar grava status e motivo_status no MESMO comando");
  assert(!!(up.filtros?.some((f) => f.col === "id" && f.val === ALVO) && up.filtros?.some((f) => f.col === "company_id" && f.val === COMPANY_COHAPM) && up.filtros?.some((f) => f.col === "status" && f.val === "vigente")), "UPDATE filtrado por id, empresa do turno e vigente");
  assert(db.linhasDe()[0].status === "aposentada" && db.inserts().length === 0, "registro aposentado, nada novo criado");
  assert(turno.registrosNoTurno === 0, "corrigir nao consome o teto de registros do turno");

  // Entradas ruins: nada e alterado.
  const casos: [string, unknown, Partial<TurnoAprendizado>?][] = [
    ["acao invalida", { id: "abc123", acao: "apagar", motivo: "m", evidencia: evidenciaCorr }],
    ["sem motivo", { id: "abc123", acao: "aposentar", motivo: "  ", evidencia: evidenciaCorr }],
    ["sem evidencia", { id: "abc123", acao: "aposentar", motivo: "m" }],
    ["evidencia que nao esta na fala", { id: "abc123", acao: "aposentar", motivo: "m", evidencia: { tipo: "fala_do_gestor", trecho: "o gestor disse outra coisa bem diferente" } }],
    ["trecho curto", { id: "abc123", acao: "aposentar", motivo: "m", evidencia: { tipo: "fala_do_gestor", trecho: "esquece" } }],
    ["args nulo", null],
  ];
  for (const [nome, args, over] of casos) {
    const d = dbCorr([alvoRow()]);
    const rr = await corrigirAprendizado(d, args, turnoCorr(over));
    assert(rr.resultado === "recusado" && !!rr.motivo, `corrigir recusa: ${nome}`);
    assert(d.updates().length === 0 && d.inserts().length === 0 && d.linhasDe()[0].status === "vigente", `corrigir recusa sem alterar: ${nome}`);
  }

  // Evidencia por retorno de ferramenta tambem vale na correcao.
  const dbRet = dbCorr([alvoRow()]);
  const rRet = await corrigirAprendizado(dbRet, {
    id: "abc123", acao: "aposentar", motivo: "o dado novo contradiz",
    evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "a conta usa conversas iniciadas como resultado" },
  }, turnoCorr({ retornos: [{ tool: "get_funnel", retorno: { nota: "a conta usa conversas iniciadas como resultado" } }] }));
  assert(rRet.resultado === "gravado", "correcao com retorno de ferramenta conferido");
}

{
  // Substituir guarda historico: linha nova com substitui_id, antiga marcada substituida.
  const db = dbCorr([alvoRow({ linha: "juridico" })]);
  const turno = turnoCorr();
  const sub = await corrigirAprendizado(db, {
    id: "abc123", acao: "substituir", motivo: "mudou", evidencia: evidenciaCorr,
    novo_fato: "O gestor quer ver o custo por conversa antes do CPL", novo_contexto: "c",
  }, turno);
  assert(sub.resultado === "gravado" && !!sub.id && sub.id !== ALVO && sub.id_curto === idCurto(sub.id!), "substituir devolve o id da linha nova");
  const ins = db.ultimoInsert();
  assert(ins.substitui_id === ALVO, "substituir guarda historico: insert com substitui_id");
  assert(ins.company_id === COMPANY_COHAPM && ins.categoria === "preferencia_do_gestor" && ins.linha === "juridico", "linha nova herda categoria e linha do registro antigo");
  assert(ins.fato === "O gestor quer ver o custo por conversa antes do CPL" && ins.contexto === "c", "linha nova com o fato novo");
  assert(ins.confianca === "confirmada" && ins.evidencias?.[0]?.tipo === "fala_do_gestor" && ins.superficie === "chat" && ins.agente_codigo === "AG-00", "linha nova: confianca da evidencia, evidencia e turno");
  assert(ins.chave_normalizada === chaveNormalizada(ins.fato), "linha nova com chave_normalizada");
  assert(db.updates().length === 1, "substituir: um unico UPDATE na antiga");
  const up = db.updates()[0];
  assert(up.args.status === "substituida" && up.args.substituida_por === sub.id && up.args.motivo_status === "mudou", "substituir guarda historico: update status=substituida, substituida_por e motivo_status no MESMO comando");
  assert(!!(up.filtros?.some((f) => f.col === "id" && f.val === ALVO) && up.filtros?.some((f) => f.col === "company_id" && f.val === COMPANY_COHAPM)), "UPDATE da antiga filtrado por id e empresa");
  const antiga = db.linhasDe().find((l) => l.id === ALVO)!;
  const nova = db.linhasDe().find((l) => l.id === sub.id)!;
  assert(antiga.status === "substituida" && antiga.substituida_por === sub.id, "antiga ficou substituida");
  assert(nova.status === "vigente" && nova.substitui_id === ALVO, "nova ficou vigente");
  assert(turno.registrosNoTurno === 0, "substituir nao consome o teto de registros do turno");

  // Sem novo_contexto: null.
  const db2 = dbCorr([alvoRow()]);
  const r2 = await corrigirAprendizado(db2, { id: "abc123", acao: "substituir", motivo: "mudou", evidencia: evidenciaCorr, novo_fato: "O gestor quer ver o custo por conversa antes do CPL" }, turnoCorr());
  assert(r2.resultado === "gravado" && db2.ultimoInsert().contexto === null && db2.ultimoInsert().linha === null, "sem novo_contexto: null");

  // Retorno de ferramenta: nova linha sai como observada.
  const db3 = dbCorr([alvoRow()]);
  const r3 = await corrigirAprendizado(db3, {
    id: "abc123", acao: "substituir", motivo: "dado novo", novo_fato: "A conta usa conversas iniciadas como resultado principal",
    evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "a conta usa conversas iniciadas como resultado principal" },
  }, turnoCorr({ retornos: [{ tool: "get_funnel", retorno: { nota: "a conta usa conversas iniciadas como resultado principal" } }] }));
  assert(r3.resultado === "gravado" && db3.ultimoInsert().confianca === "observada", "retorno de ferramenta: linha nova observada");
}

{
  // Substituir recusado: a antiga continua vigente, nada novo fica.
  const base = { id: "abc123", acao: "substituir", motivo: "mudou", evidencia: evidenciaCorr };
  const casos: [string, unknown, CfgDb?][] = [
    ["sem novo_fato", base],
    ["novo_fato curto", { ...base, novo_fato: "curto" }],
    ["novo_fato volatil", { ...base, novo_fato: "CPL de ontem foi R$ 12 na campanha" }],
    ["marca de outra empresa", { ...base, novo_fato: "No Legal e Viver o gestor quer ver o custo por conversa" }],
    ["act_ alheio", { ...base, novo_fato: "A conta act_999888777 usa conversas iniciadas como resultado" }],
    ["duas linhas", { ...base, novo_fato: "A La Felicita e o Juridico usam o mesmo criterio de custo" }],
    ["trigger do banco", { ...base, novo_fato: "O gestor quer ver o custo por conversa antes do CPL" }, { gatilho: () => "aprendizado_cita_outra_linha" }],
  ];
  for (const [nome, args, extra] of casos) {
    const d = dbCorr([alvoRow()], extra);
    const rr = await corrigirAprendizado(d, args, turnoCorr());
    assert(rr.resultado === "recusado" && !!rr.motivo, `substituir recusa: ${nome}`);
    assert(d.updates().length === 0 && d.linhasDe().length === 1 && d.linhasDe()[0].status === "vigente", `substituir recusa sem tocar na antiga: ${nome}`);
  }

  // Linha divergente: o registro e do Juridico e o fato novo cita La Felicita.
  const dDiv = dbCorr([alvoRow({ linha: "juridico" })]);
  const rDiv = await corrigirAprendizado(dDiv, { ...base, novo_fato: "A La Felicita quer ver o custo por conversa antes do CPL" }, turnoCorr());
  assert(rDiv.resultado === "recusado" && !!rDiv.motivo?.includes("divergente") && dDiv.updates().length === 0, "substituir em outra linha: recusa por divergencia");

  // Fato novo igual ao antigo bate no unique do dedupe exato: nada muda.
  const dIgual = dbCorr([alvoRow()]);
  const rIgual = await corrigirAprendizado(dIgual, { ...base, novo_fato: "O gestor quer ver o CPL antes do custo por conversa!" }, turnoCorr());
  assert(rIgual.resultado === "recusado" && dIgual.linhasDe().length === 1 && dIgual.linhasDe()[0].status === "vigente", "fato novo igual ao antigo: recusa e a antiga fica");
}

{
  // Falha no meio da troca: a linha nova e desfeita (aposentada com motivo), a antiga fica vigente.
  const novoFato = "O gestor quer ver o custo por conversa antes do CPL";
  const dbFalha = dbCorr([alvoRow()], { falhaUpdateSe: (p) => (p.status === "substituida" ? "falha simulada no update" : null) });
  const r = await corrigirAprendizado(dbFalha, { id: "abc123", acao: "substituir", motivo: "mudou", evidencia: evidenciaCorr, novo_fato: novoFato }, turnoCorr());
  assert(r.resultado === "recusado" && !!r.motivo?.includes("falha simulada"), "falha ao marcar a antiga: recusado");
  const antiga = dbFalha.linhasDe().find((l) => l.id === ALVO)!;
  const nova = dbFalha.linhasDe().find((l) => l.id !== ALVO)!;
  assert(antiga.status === "vigente", "falha ao marcar a antiga: ela continua vigente");
  assert(!!nova && nova.status === "aposentada" && !!String(nova.motivo_status).trim(), "falha ao marcar a antiga: a nova e desfeita com motivo (sem duas vigentes)");

  // Corrida: outro turno aposentou a antiga entre a leitura e o UPDATE.
  const dbCorrida = dbCorr([alvoRow()], { antesDoUpdate: (d) => { d.linhasDe()[0].status = "aposentada"; d.linhasDe()[0].motivo_status = "outro turno"; } });
  const rc = await corrigirAprendizado(dbCorrida, { id: "abc123", acao: "substituir", motivo: "mudou", evidencia: evidenciaCorr, novo_fato: novoFato }, turnoCorr());
  assert(rc.resultado === "recusado", "corrida: antiga deixou de ser vigente, recusa");
  assert(!dbCorrida.linhasDe().some((l) => l.id !== ALVO && l.status === "vigente"), "corrida: a linha nova nao fica vigente");

  const dbCorridaApos = dbCorr([alvoRow()], { antesDoUpdate: (d) => { d.linhasDe()[0].status = "aposentada"; d.linhasDe()[0].motivo_status = "outro turno"; } });
  const rca = await corrigirAprendizado(dbCorridaApos, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(rca.resultado === "recusado", "corrida ao aposentar: nao finge que aposentou");

  // Erro/excecao do banco na busca ou no update: recusado, nunca excecao.
  const dbErroBusca = dbCorr([alvoRow()], { erroNaTabela: { agent_aprendizados: "banco fora" } });
  const re = await corrigirAprendizado(dbErroBusca, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(re.resultado === "recusado" && !!re.motivo?.includes("banco fora"), "erro na busca do id: recusado");
  const dbLanca = dbCorr([alvoRow()], { lancaNaTabela: { agent_aprendizados: "conexao perdida" } });
  const rl = await calado(() => corrigirAprendizado(dbLanca, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr()));
  assert(rl.resultado === "recusado" && !!rl.motivo?.includes("conexao perdida"), "excecao no banco: recusado");

  // Gravacao desligada tambem trava a correcao.
  const dbOff = dbCorr([alvoRow()], { tabelas: { memoria_config: [{ id: true, consulta_ativa: true, gravacao_ativa: false }] } });
  const ro = await corrigirAprendizado(dbOff, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr());
  assert(ro.resultado === "recusado" && !!ro.motivo?.includes("desligad") && dbOff.updates().length === 0, "gravacao desligada: correcao recusada");
}

// A empresa que nao e a COHAPM tambem nao enxerga o registro dela (terceira empresa do cadastro).
{
  const d = dbCorr([alvoRow()]);
  const r = await corrigirAprendizado(d, { id: "abc123", acao: "aposentar", motivo: "m", evidencia: evidenciaCorr }, turnoCorr({ companyId: COOPERATIVA }));
  assert(r.resultado === "recusado" && d.updates().length === 0 && d.linhasDe()[0].status === "vigente", "outra empresa nao aposenta o registro da COHAPM");
}

// =============================================================================================
// 5) REDE DE SEGURANCA DO CHAT: extrairAprendizadosDoTurno (spec 7.4)
// =============================================================================================
// O modelo barato e um fetch falso. O que importa provar: cada item passa pelo MESMO handler do
// registro (a parafrase cai em "cite a fala exata"), o teto do turno e o mesmo, e nada aqui lanca.
type ChamadaModelo = { url: string; body: any };
async function comModeloFalso<T>(
  resposta: (corpo: any) => Response | Promise<Response>,
  fn: (chamadas: ChamadaModelo[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const chamadas: ChamadaModelo[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    chamadas.push({ url: String(url), body });
    return await resposta(body);
  }) as typeof fetch;
  try { return await fn(chamadas); } finally { globalThis.fetch = original; }
}
const respostaDoModelo = (conteudo: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), {
    status, headers: { "content-type": "application/json" },
  });
const FALA_REDE = "Nao e assim. A partir de agora mostre sempre o custo por conversa antes do CPL nos relatorios";
const RESPOSTA_REDE = "Entendido, vou trazer o custo por conversa primeiro nos proximos relatorios.";
const itemLiteral = {
  fato: "O gestor quer ver o custo por conversa antes do CPL nos relatorios",
  contexto: "Corrigiu a ordem das metricas no relatorio",
  categoria: "preferencia_do_gestor",
  evidencia: { tipo: "fala_do_gestor", trecho: "mostre sempre o custo por conversa antes do CPL" },
  confianca: "confirmada",
};
const itemParafrase = {
  fato: "O gestor prefere que a conversa venha antes do custo por lead",
  contexto: "Mesma correcao, dita com outras palavras",
  categoria: "preferencia_do_gestor",
  evidencia: { tipo: "fala_do_gestor", trecho: "o gestor prefere a conversa antes do custo por lead" },
  confianca: "confirmada",
};
const turnoRede = (over: Partial<TurnoAprendizado> = {}) => novoTurno({ falasDoGestor: [FALA_REDE], ...over });

{
  // Dois itens: o literal grava, a parafrase e recusada pelo handler.
  const db = dbReg();
  const turno = turnoRede();
  const r = await comModeloFalso(
    () => respostaDoModelo(JSON.stringify({ aprendizados: [itemLiteral, itemParafrase] })),
    async (chamadas) => {
      const out = await extrairAprendizadosDoTurno({ supa: db, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno });
      assert(chamadas.length === 1 && chamadas[0].url.includes("openrouter.ai"), "rede: uma chamada ao modelo");
      const corpo = chamadas[0].body;
      assert(!!corpo.model && Array.isArray(corpo.messages), "rede: corpo montado pelo roteador (model + messages)");
      const textoUser = JSON.stringify(corpo.messages);
      assert(textoUser.includes("A partir de agora mostre sempre") && textoUser.includes("Entendido, vou trazer"), "rede: o modelo le a fala do gestor e a resposta");
      assert(corpo.reasoning?.effort === "low", "rede: tipo mais barato do roteador (raciocinio no piso)");
      return out;
    },
  );
  assert(r.length === 2, "rede: um resultado por item");
  assert(r[0]?.resultado === "gravado", "rede: trecho literal grava");
  assert(r[1]?.resultado === "recusado" && !!r[1]?.motivo?.includes("cite a fala exata"), "rede: parafrase recusada pelo handler");
  assert(db.inserts().length === 1 && db.ultimoInsert().fato === itemLiteral.fato, "rede: so o literal foi gravado");
  assert(db.ultimoInsert().company_id === COMPANY_COHAPM && db.ultimoInsert().superficie === "chat" && db.ultimoInsert().conversation_id === CONVERSA, "rede: grava com o turno do chat");
  assert(turno.registrosNoTurno === 1, "rede: conta no teto do mesmo turno");
}

{
  // Fetch lancando: devolve [] sem lancar e sem tocar no banco.
  const db = dbReg();
  const r = await calado(() => comModeloFalso(
    () => { throw new Error("rede caiu"); },
    () => extrairAprendizadosDoTurno({ supa: db, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno: turnoRede() }),
  ));
  assert(Array.isArray(r) && r.length === 0, "rede: fetch que lanca devolve []");
  assert(db.inserts().length === 0, "rede: fetch que lanca nao grava");

  // HTTP de erro, conteudo que nao e JSON e lista ausente: [] sem lancar.
  for (const [nome, resp] of [
    ["http 402", () => respostaDoModelo("{}", 402)],
    ["conteudo nao e JSON", () => respostaDoModelo("nao sei responder isso")],
    ["sem lista", () => respostaDoModelo(JSON.stringify({ outra: [] }))],
    ["corpo invalido", () => new Response("<html>", { status: 200 })],
  ] as [string, () => Response][]) {
    const d = dbReg();
    const rr = await calado(() => comModeloFalso(resp, () =>
      extrairAprendizadosDoTurno({ supa: d, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno: turnoRede() })));
    assert(Array.isArray(rr) && rr.length === 0 && d.inserts().length === 0, `rede: ${nome} devolve [] sem gravar`);
  }

  // Sem chave: nem chama o modelo.
  const dSem = dbReg();
  const rSem = await comModeloFalso(() => respostaDoModelo("{}"), async (chamadas) => {
    const out = await extrairAprendizadosDoTurno({ supa: dSem, openRouterKey: "", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno: turnoRede() });
    assert(chamadas.length === 0, "rede: sem chave nao chama o modelo");
    return out;
  });
  assert(rSem.length === 0, "rede: sem chave devolve []");
}

{
  // No maximo 2 itens, JSON dentro de cerca de markdown, e a evidencia e sempre a fala do gestor.
  const db = dbReg();
  const deResposta = {
    ...itemLiteral,
    fato: "O agente vai trazer o custo por conversa primeiro nos relatorios",
    evidencia: { tipo: "retorno_de_ferramenta", ferramenta: "get_funnel", trecho: "vou trazer o custo por conversa primeiro" },
    confianca: "observada",
  };
  const terceiro = { ...itemLiteral, fato: "Um terceiro aprendizado que nao deveria nem ser lido aqui" };
  const r = await comModeloFalso(
    () => respostaDoModelo("```json\n" + JSON.stringify({ aprendizados: [deResposta, itemLiteral, terceiro] }) + "\n```"),
    () => extrairAprendizadosDoTurno({
      supa: db, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE,
      // O retorno existe no turno: so a regra "a rede so cita a fala do gestor" recusa o item.
      turno: turnoRede({ retornos: [{ tool: "get_funnel", retorno: { nota: "vou trazer o custo por conversa primeiro" } }] }),
    }),
  );
  assert(r.length === 2, "rede: no maximo 2 itens");
  assert(r[0]?.resultado === "recusado" && !!r[0]?.motivo?.includes("cite a fala exata"), "rede: trecho tirado da resposta do agente nao vira evidencia");
  assert(r[1]?.resultado === "gravado", "rede: JSON em cerca de markdown e lido");
  assert(db.inserts().length === 1 && db.ultimoInsert().evidencias[0].tipo === "fala_do_gestor", "rede: a evidencia gravada e fala do gestor");
}

{
  // Mesmo teto do turno: com o turno cheio, a rede nao grava.
  const db = dbReg();
  const r = await comModeloFalso(
    () => respostaDoModelo(JSON.stringify({ aprendizados: [itemLiteral] })),
    () => extrairAprendizadosDoTurno({ supa: db, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno: turnoRede({ registrosNoTurno: TETO_REGISTROS_TURNO }) }),
  );
  assert(r.length === 1 && r[0].resultado === "recusado" && !!r[0].motivo?.includes("turno") && db.inserts().length === 0, "rede: respeita o teto do turno");

  // Lista vazia: nada a fazer.
  const dv = dbReg();
  const rv = await comModeloFalso(() => respostaDoModelo(JSON.stringify({ aprendizados: [] })), () =>
    extrairAprendizadosDoTurno({ supa: dv, openRouterKey: "chave-falsa", msgGestor: FALA_REDE, resposta: RESPOSTA_REDE, turno: turnoRede() }));
  assert(rv.length === 0 && dv.inserts().length === 0, "rede: lista vazia nao grava");
}

if (falhas) { console.error(`\n${falhas} falha(s)`); Deno.exit(1); }
console.log("ok - aprendizados (consulta, registro, correcao, rede)");
