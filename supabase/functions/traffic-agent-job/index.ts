// supabase/functions/traffic-agent-job/index.ts (v3.6)
// v3.6 (20/08/2026) - HARDENING LITE/META + SINTESE: RE_META_DICA passa a casar
//   "musicas"/"recomendacao" (antes so "musica"/"recomendac" com word-boundary quebrava
//   o forcarPlano); fallback do planner invalido e por tier (lite Meta -> alertas,
//   nunca desempenho/criativos); sintese com timeout duro por chamada + parede de fase
//   e job vira error (Reenviar) se nao houver texto — nunca "escrevendo" infinito.
// v3.5 (20/08/2026) - ROTEADOR DE CAPACIDADE (lite | standard | deep): o esforco do
//   pipeline escala com a complexidade da pergunta, sem baixar o padrao de resposta
//   completa (veredito + evidencia + recomendacao; proibido "vou ler"). Classificacao
//   DETERMINISTICA no codigo (heuristicas de tamanho/palavras-chave/follow-up), nao
//   no LLM. lite = 1 especialista, sem devolucao/checkpoint, caps curtos; standard =
//   planner 1-2 especialistas, 1 devolucao, checkpoint se parede exigir; deep =
//   multi-especialista, devolucao plena, segmentos. Ato/anexo continuam no sync.
// v3.4 (20/08/2026) - FAST-TRACK DEEP: pergunta curta / follow-up / dica Meta-musica
//   roda 1 segmento, ate 2 especialistas, SEM devolucao e SEM checkpoint. Evita a
//   maratona "segmento 2: retomando" em Q&A focado (caso medido: 2 dicas de musica
//   ficou 9+ min em Planejando apos devolucao+checkpoint). OpenRouter ganha timeout
//   para nao deixar o worker silencioso. Analise ampla continua com multi-segmento.
// v3.3 (20/08/2026) - Sintese: proibe narracao de intencao; resposta completa em um turno
//   (veredito + evidencia + recomendacao), inclusive em follow-up de dicas Meta/musica.
// v3.2 (12/08/2026) - ESP-41: tool ler_entregas_digest (RPC read-only) no subagente
//   alertas_recomendacoes. Config de cadencia/destino do digest + entregas recentes.
// v3.1 (12/08/2026) - ESP-30: tool saude_dos_tokens (RPC read-only) no subagente
//   alertas_recomendacoes. Expiracao/escopo dos tokens Meta por metadado (meta_tokens),
//   populado pelo meta-token-monitor. Nao chama a Graph, nunca expoe o valor do token.
// v3.0 (12/08/2026) - ESP-38: tool score_de_prontidao (RPC read-only) exposta no subagente
//   alertas_recomendacoes. Score 0-100 de prontidao da empresa (config, integracao, postura,
//   brand, destino, driver) com nivel, checks, bloqueios e recomendacoes. Nao altera nada.
// v1.1 - RELATORIO DE SUBAGENTE COMPLETO + SINTESE CIENTE DE CORTE (achado da auditoria
//   verificada de 28/07 noite): no questionario do auditor, o subagente estrutura_conta
//   terminou o relatorio em finish=length (teto de 3.500 tokens) ANTES dos numeros de
//   CBO/ABO, e a sintese - que so enxerga relatorios - converteu "nao chegou ate mim" em
//   "relatorio de estrutura retornou vazio", um FALSO NEGATIVO: get_estrutura_conjuntos
//   devolvia 25.432 bytes com 53 conjuntos naquele instante. Duas correcoes:
//   (1) SUB_MAX_TOKENS 3500 -> 5000 e CONTINUACAO INTERNA do relatorio (ate 3 partes,
//       mesma tecnica da sintese: contexto preservado em memoria, zero re-coleta),
//       guardada pelo prazo do job;
//   (2) cada relatorio chega a sintese marcado COMPLETO ou INCOMPLETO, e o prompt da
//       sintese obriga a declarar "o levantamento de X veio incompleto" em vez de
//       "nao disponivel" - truncamento nao pode virar inexistencia (regra R3 aplicada
//       tambem ao proprio pipeline).
// v2.9 (04/08/2026) - CONSERTO: na base multiquadro o filtro de video passou a ser aplicado antes
//   do corte por `limite`, nao dentro do laco. Com limite 12 os 12 primeiros pendentes eram
//   imagens e a corrida devolveu 0 analisadas em 5s - nao gravou nada errado, simplesmente nao
//   fez. Foi a telemetria da v2.8 que tornou o no-op visivel.
// v2.8 (04/08/2026) - o detalhe do filtro de peso (quantos dos 15 quadros passaram, quantos foram
//   usados, quais indices, e os videos sem video_id) sai NO RETORNO do modo drive_watch. Na corrida
//   de 5 videos esses numeros existiam so na telemetria interna e tiveram de ser reconstruidos
//   chamando a thumbnails de novo - numero que precisa ser reconstruido e numero que ninguem confere.
// v2.7 (04/08/2026) - GT-45: MULTIQUADRO EM VIDEO. Base `multiquadro/criterio-v2.4`: 5 quadros da
//   Meta por video em vez de uma miniatura do Drive. Os quadros vem da acao thumbnails da
//   upload-midia (unica edge com META_ADS_TOKEN); este job usa a mcp key, nao o token.
//   Selecao por PESO e nao por posicao: descarta quadro abaixo de 40% da mediana de bytes (quase
//   uniforme) e distribui 5 no tempo entre os que sobram. `is_preferred` e ignorado - medido que a
//   capa escolhida pela Meta tinha 26 KB contra 186 KB dos vizinhos, ou seja, pode ser o pior
//   quadro para julgar conteudo. Sem audio de proposito: se audio entrasse junto e o resultado
//   melhorasse, nao se saberia qual dos dois resolveu.
// v2.6 (04/08/2026) - BASE DA ANALISE NO CONTRATO + CONSERTO DE FALHA SILENCIOSA.
//   (1) O pipeline de visao e o modo drive_watch aceitam base_da_analise (default thumbnail, para
//       o cron das 08:45 nao regredir). O plano e pedido PARA a base, com recorte opcional por
//       nome, por tipo (somente_imagens) e por limite - o aceite parcial de 5 antes de 48.
//   (2) CONSERTO: o upsert citava onConflict (drive_file_id, drive_modified_time) e esse indice de
//       2 colunas deixou de existir quando a chave virou (arquivo, versao, base). Toda gravacao
//       falharia com 42P10 - e o erro era DESCARTADO: analisados++ acontecia igual e a telemetria
//       diria "analisado". O cron de hoje devolveu 0 pecas novas, entao a quebra nunca foi
//       exercitada; a primeira peca nova no Drive teria sumido em silencio.
// v2.5 (04/08/2026) - COBERTURA DO DRIVE VEM DA TABELA + MODO VIGIA PARA O CRON.
//   (B) As pastas a varrer saem de drive_pastas_monitoradas (RPC drive_plano_de_varredura), nao
//       mais do segredo DRIVE_CRIATIVOS_FOLDER_ID - acrescentar pasta passou a ser INSERT, sem
//       deploy. Acesso amplo da conta de servico nunca foi cobertura: o codigo olhava um id fixo.
//       O segredo fica como FALLBACK DECLARADO (se a lista vier vazia, avisa no retorno).
//       Cada arquivo carrega pasta_monitorada, e a varredura de cada pasta e registrada.
//   (A) modo drive_watch: caminho barato para o cron - so varredura + visao no que mudou, sem
//       PLANNER, sem subagentes, sem sintese. Devolve "0 pecas novas em N pastas" em vez de
//       silencio, porque silencio e indistinguivel de falha.
// v2.4 (31/07/2026) - CRITERIO DO GESTOR no pipeline de visao (audios do Roberto):
//   o universo criativo da marca e "credito CLT + educacao financeira + dicas de seguranca
//   financeira" - peca desses temas e SIM. NAO fica reservado a peca que mostra
//   explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente,
//   consorcio, imovel). Vale para PECAS FUTURAS; o acervo atual ja esta liberado pela
//   camada de aprovacao humana (aprovado_pelo_gestor, decisao 31/07).
//
// v2.3 (31/07/2026) - vereditos visuais expostos como TOOL (get_analise_visual_drive):
//   os demais especialistas e a sintese leem a classificacao persistida sem repetir visao.
//
// v2.2 (31/07/2026) - OLHOS: analise VISUAL das midias do Drive.
//   O especialista criativos_drive lia a miniatura como URL EM TEXTO - o modelo nunca via
//   os pixels, e recusar "classifique cada arquivo" era o comportamento correto de um
//   analista cego. Agora existe o especialista analise_visual_drive: pipeline CODIFICADO
//   (nao e loop de tools) que baixa a miniatura em alta resolucao (=s1600), entrega os
//   pixels ao modelo em LOTES e PERSISTE cada veredito em drive_midia_analises (chave
//   arquivo+versao: rodadas sucessivas so analisam o que falta ou mudou - segmentos e
//   devolucoes convergem para a cobertura total sem reanalisar). Limite declarado em cada
//   linha: base_da_analise='thumbnail' - de video se ve UM FRAME, nunca o interior.
//
// v2.1 (30/07/2026, mesma noite) - PAGINACAO DE DADOS: fecha a terceira lacuna, achada no
//   teste real com a pergunta integral do gestor. Os mecanismos do v2 cobrem TEMPO
//   (segmentos) e RELATORIO RUIM (devolucao) - mas nao cobriam DADO TRUNCADO no payload da
//   ferramenta: 26 de 30 legendas ficaram invisiveis e o aviso "peca um recorte" apontava
//   para um parametro que nao existia. Agora: get_criativos_conteudo aceita pagina
//   (RPC paginada por gasto desc), o subagente tem ORDEM de paginar ate cobrir quando o
//   foco exigir, e a mae ganhou o criterio 5: aceitar corte com paginacao disponivel =
//   relatorio devolvido.
//
// v2 (30/07/2026) - TRES FRENTES NOVAS:
//   (A) SUBAGENTE criativos_drive: le a pasta de criativos do Google Drive via service
//       account (somente leitura), caminha a arvore (1o nivel=FORMATO, 2o nivel=EIXO),
//       traz thumbnail de video/imagem e cruza com as legendas vencedoras (eixo validado
//       vs hipotese). Limite declarado: video = thumbnail+nome+caminho; sem ffmpeg em edge.
//   (B) DEVOLUCAO COORDENADOR->SUBAGENTE: apos a fase 2, a coordenacao (modelo da sintese)
//       valida cada relatorio contra a pergunta e o foco atribuido; relatorio reprovado
//       volta ao subagente COM O PARECER ("faltou X; a pergunta era A, voce respondeu B").
//       Maximo DEVOLUCOES_MAX rodadas; ao esgotar, o relatorio entra marcado FALHO e a
//       sintese declara a lacuna - nunca o meio-termo silencioso.
//   (C) SEGMENTOS ENCADEADOS: o teto de ~330s e por INVOCACAO, nao por trabalho. Ao chegar
//       perto do limite com trabalho pendente, o job grava CHECKPOINT em chat_jobs
//       (relatorios validados congelados + fila de devolucoes) e reinvoca a PROPRIA edge;
//       o novo worker retoma do ponto exato com orcamento zerado. Ate MAX_SEGMENTOS=3
//       (~14 min de parede). Relatorio validado NUNCA e refeito.
//   (D) SPLIT DE MODELO: planejador e subagentes leem OPENROUTER_MODEL_SUB (fallback p/ o
//       principal); coordenacao e sintese leem OPENROUTER_MODEL. Permite Opus na sintese
//       mantendo a extracao paralela no modelo mais barato.
//
// SUBAGENTES + JOB ASSINCRONO (EdgeRuntime.waitUntil) - remove o teto de 150s em vez de
// negociar com ele, como declarado no v27 do traffic-chat.
//
// DESENHO:
//   POST identico ao traffic-chat (message, conversation_id?, company?) -> responde em ~1s
//   com {ok, async:true, job_id, conversation_id} e processa em BACKGROUND:
//     FASE 1  PLANNER    - 1 chamada LLM devolve JSON {subagentes:[{nome,foco}]}; o CODIGO
//                          valida contra a whitelist (LLM identifica, codigo decide). JSON
//                          invalido -> degrada DECLARADO para todos os subagentes.
//                          ROTEAMENTO MINIMO: o planner escolhe o MENOR conjunto que cobre a
//                          pergunta - tarefa de um unico dominio vai para UM especialista.
//     FASE 2  SUBAGENTES - executados em PARALELO, com ESCOPO ESTRITO: um especialista por
//                          capacidade implementada, ferramentas restritas, e ordem explicita
//                          de RECUSAR (registrando em LACUNAS) tarefa fora do proprio dominio:
//                            desempenho_campanhas  (numeros de midia: gasto, funil, CTR,
//                                                   ranking, series, metas)
//                            criativos             (conteudo real das pecas: legendas,
//                                                   titulos, CTA, gasto por legenda)
//                            compliance            (auditoria das legendas na base de regras
//                                                   FIN/CRI/LGL, ate 8 verificacoes - a
//                                                   auditoria completa que o teto sincrono
//                                                   de 12 tools nunca deixou terminar)
//                            estrutura_conta       (CBO/ABO, orcamento, lance, targeting)
//                            whatsapp_waba         (tier/qualidade dos numeros, envios,
//                                                   leitura e cliques por template - as
//                                                   tabelas do F5.4/F5.5 viram ferramenta)
//                            alertas_recomendacoes (pendencias do sistema)
//                            conhecimento          (base tecnica agent_knowledge)
//     FASE 3  SINTESE    - pergunta INTEIRA + relatorios; se finish=length, CONTINUACAO
//                          INTERNA em memoria (contexto preservado, ZERO re-coleta de tool
//                          - mata a costura do front e seu custo medido de ~76k tokens).
//   Resultado = UMA mensagem completa em chat_messages (Realtime ja entrega ao front).
//   Ciclo de vida/progresso/telemetria em chat_jobs (migracao subagentes_tabela_chat_jobs).
//
// LIMITES HONESTOS (v1):
//   - Worker de background do Supabase tem teto de parede (~400s). JOB_LIMIT_MS=330s com
//     reserva; se estourar, a sintese fecha com o que tem e DECLARA o corte (licao 10).
//     Job preso >15min vira error via cron expira-chat-jobs-hora.
//   - Subagentes sao READ-ONLY: propose_action NAO existe aqui. Acao continua no chat
//     sincrono, com aprovacao de admin. Decisao deliberada de v1, nao esquecimento.
//   - As funcoes de ferramenta sao COPIA FIEL do traffic-chat v27.1 (sem propose/cards).
//     Risco conhecido: copia diverge com o tempo (licao do CORS do JurisAI). Pendencia
//     registrada: extrair para _shared/traffic-tools.ts quando os dois estabilizarem.
//   - Sem prompt caching na v1 (prompts diferem por subagente; avaliar depois com medida).
// Auth: Bearer <user JWT> OU x-mcp-key (identico ao traffic-chat).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bearerDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { pipeboardToken } from "../_shared/pipeboard.ts";
import {
  callReadTool,
  companyMetaAccounts,
  isReadOnlyTool,
  listReadTools,
  scopeArgsToCompany,
  truncatePipeboardPayload,
} from "../_shared/pipeboard_read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const MODEL = (Deno.env.get("OPENROUTER_MODEL") ?? "openai/gpt-5.6-luna").trim();
// v2: modelo dos SUBAGENTES e do planejador (extracao estrita nao precisa do modelo caro).
const MODEL_SUB = ((Deno.env.get("OPENROUTER_MODEL_SUB") ?? "").trim()) || MODEL;
// v2: credencial do Drive (service account) + pasta raiz dos criativos.
const GOOGLE_SA_KEY_B64 = (Deno.env.get("GOOGLE_SA_KEY_B64") ?? "").trim();
const DRIVE_CRIATIVOS_FOLDER_ID = (Deno.env.get("DRIVE_CRIATIVOS_FOLDER_ID") ?? "").trim();

// Orcamentos do JOB (parede de ~400s do worker; 330s de trabalho + reserva de gravacao).
const JOB_LIMIT_MS = 330_000;
const RESERVA_FINAL_MS = 12_000;
// v2: segmentos e devolucao
const MAX_SEGMENTOS = 3;
const DEVOLUCOES_MAX = 2;          // rodadas de devolucao por job (nao por subagente)
const CHECKPOINT_MIN_MS = 75_000;  // se falta trabalho e o prazo esta abaixo disto, segmenta
// v3.5: caps por tier de capacidade (roteador deterministico).
const LITE_MAX_ESPECIALISTAS = 1;
const STANDARD_MAX_ESPECIALISTAS = 2;
const LITE_OPENROUTER_TIMEOUT_MS = 60_000;
const STANDARD_OPENROUTER_TIMEOUT_MS = 90_000;
const OPENROUTER_TIMEOUT_MS = 120_000;
const LITE_DEVOLUCOES_MAX = 0;
const STANDARD_DEVOLUCOES_MAX = 1;
// deep usa DEVOLUCOES_MAX (2)
// v2.2: pipeline de visao
const VISAO_LOTE = 6;               // imagens por chamada de visao
const VISAO_MAX_POR_RODADA = 30;    // teto de arquivos analisados por segmento
const VISAO_MIN_PRAZO_MS = 45_000;  // abaixo disto, para o lote e declara parcial
const TOKENS_POR_SEGUNDO = 60;
// Planner: classificacao curta, sem raciocinio longo.
const PLANNER_MAX_TOKENS = 1200;
// Subagente: ate 6 rodadas de tool + relatorio.
// v1.1: 3500 -> 5000 (o corte em 3500 produziu falso negativo em producao) e o relatorio
// ganha continuacao interna de ate SUB_RELATORIO_MAX_PARTES partes, guardada pelo prazo.
const SUB_MAX_ITER = 6;
const SUB_MAX_TOKENS = 5000;
const SUB_RELATORIO_MAX_PARTES = 3;
const SUB_REASONING = { max_tokens: 2000 };
// Sintese: partes de ate 10000 tokens, com continuacao interna ate 4 partes.
const SINT_MAX_TOKENS = 10_000;
const SINT_MAX_PARTES = 4;
const REASONING_OFF = { enabled: false };

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-mcp-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
// Data no fuso da operacao (BRT). Em UTC, depois das 21h de Brasilia a data virava o dia
// seguinte e o agente passava a tratar amanha como hoje.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const brl = (n: number) => "R$ " + (Math.round(n * 100) / 100).toFixed(2);
const deacc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) => deacc(s.toLowerCase()).replace(/[-_\s]+/g, "");

// v3.5: roteador de capacidade — lite | standard | deep.
// Deterministico: tamanho + palavras-chave + follow-up. O LLM NAO escolhe o tier.
// Resposta completa em todos os tiers (sintese nao muda o padrao de qualidade).
type CapacidadeTier = "lite" | "standard" | "deep";
type Capacidade = {
  tier: CapacidadeTier;
  motivo: string;
  maxEspecialistas: number;
  devolucoesMax: number;
  permitirCheckpoint: boolean;
  openRouterTimeoutMs: number;
  forcarPlano?: { nome: string; foco: string }[];
};

const RE_DEEP = /\b(analise tudo|analise completa|auditoria|todas as campanhas|todas campanhas|todas as contas|comparar|comparacao|cruzar|panorama|inventario|conta inteira|conta toda|relatorio completo|diagnostico completo|visao geral|tudo da conta|tudo sobre|multiplas campanhas|todas as pecas|cobertura total|pontos? a pontos?)\b/;
// Prefixos com \w*: "recomendac\b" NAO casava "recomendacao"; "musica\b" NAO casava "musicas".
const RE_META_DICA = /\b(dicas?|recomendac\w*|opportunity(?:\s*score)?|musicas?|boost|impulsionar|meta\s+emitiu|recomendacao\s+da\s+meta)\b/;
const RE_FOLLOW_UP = /^(sobre|e |dessas|dessa|desses|desse|analise|me (informe|diga|recomenda)|o que (voce|acha)|e as |e os |e essas|e esses)|\b(essas duas|analise[- ]as|o que me recomenda|me informe o que|e viavel|faz sentido)\b/;
const RE_STATUS_SIMPLES = /\b(status|como (esta|estao)|ta ativa|esta ativa|pausad[ao]|ligada|desligada)\b/;
const RE_JULGAMENTO_CURTO = /^(sim|nao|ok|pode|confirma|vale a pena|e bom|e ruim)\b|\b(essas? (duas|2)|1[-–]2|uma ou duas)\b.*\b(recomend|dica|opca)/;
const FOCO_META_DICAS =
  "Levantar as dicas/recomendacoes da Meta (get_meta_dicas) citadas na pergunta — em especial musica/boost/Opportunity Score — e devolver julgamento acionavel (viavel ou nao + o que fazer). Nao inventariar criativos nem abrir outras frentes.";
// Parede da fase de sintese: alem do timeout por chamada OpenRouter, a fase inteira
// nao pode ficar "escrevendo" alem disto (worker morto deixa job running para sempre).
const SINT_FASE_HARD_MS = 150_000;

function classificarCapacidade(pergunta: string): Capacidade {
  const raw = pergunta.trim();
  const p = deacc(raw.toLowerCase());
  const len = raw.length;
  const linhas = raw.split(/\n/).filter((l) => l.trim().length > 0).length;
  const perguntas = (raw.match(/\?/g) ?? []).length;
  const deepHit = RE_DEEP.test(p)
    || len >= 1400
    || (len >= 900 && (perguntas >= 3 || linhas >= 8))
    || (perguntas >= 4 && len >= 500);
  if (deepHit) {
    return {
      tier: "deep",
      motivo: RE_DEEP.test(p) ? "brief amplo / multi-familia" : "pedido longo multi-parte",
      maxEspecialistas: 99,
      devolucoesMax: DEVOLUCOES_MAX,
      permitirCheckpoint: true,
      openRouterTimeoutMs: OPENROUTER_TIMEOUT_MS,
    };
  }
  const metaDica = RE_META_DICA.test(p);
  const followUp = RE_FOLLOW_UP.test(p);
  const statusSimples = RE_STATUS_SIMPLES.test(p) && len <= 400;
  const julgamentoCurto = RE_JULGAMENTO_CURTO.test(p) && len <= 500;
  const curta = len <= 600;
  if (curta && metaDica) {
    return {
      tier: "lite",
      motivo: "follow-up/dica-meta curta",
      maxEspecialistas: LITE_MAX_ESPECIALISTAS,
      devolucoesMax: LITE_DEVOLUCOES_MAX,
      permitirCheckpoint: false,
      openRouterTimeoutMs: LITE_OPENROUTER_TIMEOUT_MS,
      forcarPlano: [{ nome: "alertas_recomendacoes", foco: FOCO_META_DICAS }],
    };
  }
  if (curta && (followUp || statusSimples || julgamentoCurto || len <= 280)) {
    return {
      tier: "lite",
      motivo: followUp ? "follow-up focado" : statusSimples ? "status pontual" : julgamentoCurto ? "julgamento curto" : "pergunta curta",
      maxEspecialistas: LITE_MAX_ESPECIALISTAS,
      devolucoesMax: LITE_DEVOLUCOES_MAX,
      permitirCheckpoint: false,
      openRouterTimeoutMs: LITE_OPENROUTER_TIMEOUT_MS,
    };
  }
  return {
    tier: "standard",
    motivo: "operacao / diagnostico pontual",
    maxEspecialistas: STANDARD_MAX_ESPECIALISTAS,
    devolucoesMax: STANDARD_DEVOLUCOES_MAX,
    permitirCheckpoint: true,
    openRouterTimeoutMs: STANDARD_OPENROUTER_TIMEOUT_MS,
  };
}

async function resolveCompany(name?: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supa.from("companies").select("id,name");
  if (!data?.length || !name?.trim()) return null;
  const needle = norm(name);
  const exact = data.filter((c) => norm(c.name) === needle);
  if (exact.length === 1) return exact[0];
  const partial = data.filter((c) => norm(c.name).includes(needle) || needle.includes(norm(c.name)));
  return partial.length === 1 ? partial[0] : null;
}

// ============================================================================
// FERRAMENTAS - copia fiel do traffic-chat v27.1 (somente leitura; sem propose_action).
// Pendencia registrada: extrair para _shared/traffic-tools.ts.
// ============================================================================
async function t_overview(companyId: string) {
  const { data: camps } = await supa.from("campaigns").select("name,status,category,spend,external_account_id").eq("company_id", companyId);
  const ativos = (camps ?? []).filter((c) => c.status === "active");
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data: snaps } = await supa.from("metric_snapshots")
    .select("spend,impressions,link_clicks,form_leads,messaging_started,leads,snapshot_date")
    .eq("company_id", companyId).gte("snapshot_date", from);
  const s = (snaps ?? []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0),
    link: a.link + Number(r.link_clicks || 0), forms: a.forms + Number(r.form_leads || 0),
    msg: a.msg + Number(r.messaging_started || 0), leads: a.leads + Number(r.leads || 0),
  }), { spend: 0, imp: 0, link: 0, forms: 0, msg: 0, leads: 0 });
  const dias = new Set((snaps ?? []).map((r) => r.snapshot_date)).size;
  return {
    campanhas_ativas: ativos.length, campanhas_total: (camps ?? []).length,
    ultimos_7_dias: { gasto: brl(s.spend), dias_com_dado: dias, impressoes: s.imp, cliques_link: s.link,
      formularios: s.forms, conversas_whatsapp: s.msg,
      custo_por_formulario: s.forms ? brl(s.spend / s.forms) : null,
      custo_por_lead_lp: s.link ? brl(s.spend / s.link) : null },
    campanhas_ativas_lista: ativos.map((c) => ({ nome: c.name, categoria: c.category, conta: c.external_account_id, gasto_acumulado: brl(Number(c.spend || 0)) })),
    nota: "status vem do effective_status real da Meta (cron 09:10). dias_com_dado<7 indica cobertura incompleta: nao conclua queda sem checar isso.",
  };
}
async function t_alerts(companyId: string) {
  const { data } = await supa.from("alerts").select("severity,title,description,created_at,resolved")
    .eq("company_id", companyId).eq("resolved", false).order("created_at", { ascending: false }).limit(20);
  return { alertas_ativos: data ?? [] };
}
async function t_recos(companyId: string) {
  const { data } = await supa.from("ai_recommendations").select("category,impact,title,description,status,created_at")
    .eq("company_id", companyId).eq("status", "new").order("created_at", { ascending: false }).limit(20);
  return { recomendacoes_pendentes: data ?? [], nota: "regua destas recomendacoes e custo de MIDIA, nao contrato pago." };
}
async function t_rpc(nome: string, parametros: Record<string, unknown>) {
  const { data, error } = await supa.rpc(nome, parametros);
  return error ? { erro: `falha ao chamar ${nome}: ${error.message}` } : data;
}
async function t_funnel(companyId: string, date_from?: string, date_to?: string) {
  let q = supa.from("metric_snapshots").select("campaign_id,snapshot_date,spend,impressions,clicks,link_clicks,landing_page_views,form_leads,messaging_started").eq("company_id", companyId);
  if (date_from) q = q.gte("snapshot_date", date_from);
  if (date_to) q = q.lte("snapshot_date", date_to);
  const { data } = await q;
  const linhas = data ?? [];
  const s = linhas.reduce((a, r) => ({
    spend: a.spend + Number(r.spend || 0), imp: a.imp + Number(r.impressions || 0), clk: a.clk + Number(r.clicks || 0),
    link: a.link + Number(r.link_clicks || 0), lpv: a.lpv + Number(r.landing_page_views || 0),
    forms: a.forms + Number(r.form_leads || 0), msg: a.msg + Number(r.messaging_started || 0),
  }), { spend: 0, imp: 0, clk: 0, link: 0, lpv: 0, forms: 0, msg: 0 });
  // v29 (14/08): custo por resultado escopado as campanhas que registram o evento (auditoria COHAPM:
  // gasto de engajamento sem conversa inflava o custo por conversa de R$ 21,13 para R$ 31,89).
  const porCampanha = new Map<string, { spend: number; forms: number; msg: number }>();
  for (const r of linhas) {
    const k = String(r.campaign_id ?? "sem_campanha");
    const cur = porCampanha.get(k) ?? { spend: 0, forms: 0, msg: 0 };
    cur.spend += Number(r.spend || 0);
    cur.forms += Number(r.form_leads || 0);
    cur.msg += Number(r.messaging_started || 0);
    porCampanha.set(k, cur);
  }
  const gastoOnde = (tem: (v: { forms: number; msg: number }) => boolean) =>
    [...porCampanha.values()].filter(tem).reduce((a, v) => a + v.spend, 0);
  const gastoComForm = gastoOnde((v) => v.forms > 0);
  const gastoComConversa = gastoOnde((v) => v.msg > 0);
  const semEvento = [...porCampanha.values()].filter((v) => v.spend > 0 && v.forms === 0 && v.msg === 0);
  const datas = linhas.map((r) => r.snapshot_date).sort();
  return { periodo_solicitado: { de: date_from ?? "inicio", ate: date_to ?? "hoje" },
    janela_sem_data_informada: !date_from && !date_to ? "ATENCAO: nenhuma data foi passada, entao esta e a serie INTEIRA da empresa (veja cobertura_real). NAO chame isso de '7 dias' nem atribua a uma campanha especifica." : undefined,
    cobertura_real: { primeiro_dia: datas[0] ?? null, ultimo_dia: datas[datas.length - 1] ?? null, dias_com_dado: new Set(datas).size },
    funil_midia: { impressoes: s.imp, cliques_todos: s.clk, cliques_no_link: s.link, visualizacoes_lp: s.lpv, formularios: s.forms, conversas_whatsapp: s.msg },
    gasto: brl(s.spend),
    custos: { por_clique_no_link: s.link ? brl(s.spend / s.link) : null, por_visualizacao_lp: s.lpv ? brl(s.spend / s.lpv) : null,
      por_formulario: s.forms ? brl(gastoComForm / s.forms) : null, por_conversa: s.msg ? brl(gastoComConversa / s.msg) : null,
      gasto_base_do_por_formulario: s.forms ? brl(gastoComForm) : null,
      gasto_base_do_por_conversa: s.msg ? brl(gastoComConversa) : null },
    gasto_de_campanhas_sem_formulario_nem_conversa: semEvento.length ? brl(semEvento.reduce((a, v) => a + v.spend, 0)) : null,
    campanhas_sem_formulario_nem_conversa: semEvento.length,
    nota: "funil de MIDIA agregado da conta. cliques_todos = todos os cliques; cliques_no_link = so os que levam ao destino - nao misture as bases. visualizacoes_lp e resultado valido, reporte. CUSTO POR RESULTADO: por_formulario e por_conversa usam SO o gasto das campanhas que registraram aquele evento (veja gasto_base_do_*); e PROIBIDO recalcular dividindo `gasto` total pelo evento. Se a janela mistura objetivos, diga QUAL campanha sustenta o custo antes de usar como benchmark. Conversao final (CRM) esta fora de escopo por decisao de 28/07." };
}
async function t_ads_ranking(companyId: string, days = 7) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: ads } = await supa.from("ads").select("external_id,name,campaign_id").eq("company_id", companyId);
  const { data: camps } = await supa.from("campaigns").select("id,name,category").eq("company_id", companyId).eq("status", "active");
  const campMap = new Map((camps ?? []).map((c) => [c.id, c]));
  const active = (ads ?? []).filter((a) => campMap.has(a.campaign_id));
  if (!active.length) return { ranking: [], nota: "sem criativos em campanhas ativas" };
  const ids = active.map((a) => a.external_id);
  const { data: snaps } = await supa.from("ad_metric_snapshots").select("ad_external_id,spend,form_leads,messaging_started").gte("snapshot_date", from).in("ad_external_id", ids);
  const agg = new Map<string, { spend: number; res: number }>();
  for (const s of snaps ?? []) {
    const ad = active.find((a) => a.external_id === s.ad_external_id); if (!ad) continue;
    const cat = campMap.get(ad.campaign_id)?.category;
    const res = cat === "mensagem" ? Number(s.messaging_started || 0) : Number(s.form_leads || 0);
    const cur = agg.get(s.ad_external_id) ?? { spend: 0, res: 0 };
    cur.spend += Number(s.spend || 0); cur.res += res; agg.set(s.ad_external_id, cur);
  }
  const rows = [...agg.entries()].filter(([, v]) => v.spend > 0).map(([id, v]) => {
    const ad = active.find((a) => a.external_id === id)!;
    return { criativo: ad.name, campanha: campMap.get(ad.campaign_id)?.name, gasto: brl(v.spend), resultados: v.res,
      custo_por_resultado: v.res ? brl(v.spend / v.res) : "sem resultado", amostra_pequena: v.res < 20, _c: v.res ? v.spend / v.res : 1e9 };
  }).sort((a, b) => a._c - b._c).map(({ _c, ...r }) => r);
  return { janela_dias: days, ranking: rows.slice(0, 15),
    nota: "RECORTE por custo MEDIO de midia. A Meta aloca por custo MARGINAL: PROIBIDO prescrever pausa so por esta ordenacao (Breakdown Effect)." };
}
async function t_campaign_detail(companyId: string, name_like: string) {
  const { data: all } = await supa.from("campaigns").select("id,name,status,category,spend").eq("company_id", companyId);
  const needle = norm(name_like);
  const camps = (all ?? []).filter((c) => norm(c.name).includes(needle)).slice(0, 3);
  if (!camps.length) return { erro: `nenhuma campanha com nome contendo '${name_like}'` };
  const c = camps[0];
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: serie } = await supa.from("metric_snapshots")
    .select("snapshot_date,spend,impressions,reach,clicks,link_clicks,form_leads,messaging_started,frequency,landing_page_views")
    .eq("campaign_id", c.id).gte("snapshot_date", from).order("snapshot_date");
  const rows = serie ?? [];
  const num = (v: unknown) => Number(v || 0);
  const pct = (n: number, d: number) => d > 0 ? `${(100 * n / d).toFixed(2)}%` : null;
  // v30 (14/08): nome do campo carrega a semantica (alcance_soma_diaria_nao_deduplicada) e
  // media diaria sai pronta so com dias fechados - vide comentario em traffic-chat.
  const hoje = new Date().toISOString().slice(0, 10);
  const linhaDia = (s: Record<string, unknown>) => {
    const spend = num(s.spend), imp = num(s.impressions), clkTodos = num(s.clicks), clkLink = num(s.link_clicks);
    return {
      dia: s.snapshot_date, gasto: brl(spend), impressoes: imp, alcance: num(s.reach),
      frequencia: s.frequency != null ? Number(num(s.frequency).toFixed(2)) : null,
      cliques_todos: clkTodos, cliques_no_link: clkLink, visualizacoes_lp: num(s.landing_page_views),
      formularios: num(s.form_leads), conversas: num(s.messaging_started),
      ctr_todos: pct(clkTodos, imp), ctr_link: pct(clkLink, imp),
      cpc_todos: clkTodos ? brl(spend / clkTodos) : null, cpc_link: clkLink ? brl(spend / clkLink) : null,
      cpm: imp ? brl(1000 * spend / imp) : null,
      ...(String(s.snapshot_date) === hoje ? { dia_parcial_em_coleta: true } : {}),
    };
  };
  const tot = rows.reduce((a, s: Record<string, unknown>) => ({
    spend: a.spend + num(s.spend), imp: a.imp + num(s.impressions), reach: a.reach + num(s.reach),
    clkTodos: a.clkTodos + num(s.clicks), link: a.link + num(s.link_clicks), lpv: a.lpv + num(s.landing_page_views),
    forms: a.forms + num(s.form_leads), msg: a.msg + num(s.messaging_started),
  }), { spend: 0, imp: 0, reach: 0, clkTodos: 0, link: 0, lpv: 0, forms: 0, msg: 0 });
  const fechados = rows.filter((s: Record<string, unknown>) => String(s.snapshot_date) < hoje);
  const gastoFechado = fechados.reduce((a, s: Record<string, unknown>) => a + num(s.spend), 0);
  return {
    campanha: { nome: c.name, status: c.status, categoria: c.category, gasto_acumulado: brl(num(c.spend)) },
    serie_diaria_14d: rows.map(linhaDia),
    totais_periodo: {
      dias_com_dado: rows.length, dias_fechados: fechados.length,
      inclui_dia_parcial: rows.some((s: Record<string, unknown>) => String(s.snapshot_date) === hoje),
      gasto: brl(tot.spend),
      gasto_medio_por_dia_fechado: fechados.length ? brl(gastoFechado / fechados.length) : null,
      impressoes: tot.imp, alcance_soma_diaria_nao_deduplicada: tot.reach,
      cliques_todos: tot.clkTodos, cliques_no_link: tot.link, visualizacoes_lp: tot.lpv,
      formularios: tot.forms, conversas: tot.msg,
      ctr_todos: pct(tot.clkTodos, tot.imp), ctr_link: pct(tot.link, tot.imp),
      cpc_todos: tot.clkTodos ? brl(tot.spend / tot.clkTodos) : null, cpc_link: tot.link ? brl(tot.spend / tot.link) : null,
      cpm: tot.imp ? brl(1000 * tot.spend / tot.imp) : null,
      custo_por_formulario: tot.forms ? brl(tot.spend / tot.forms) : null,
    },
    outras_encontradas: camps.slice(1).map((x) => x.name),
    nota: "serie diaria e totais vem de metric_snapshots (D-1, coletor oficial pipeboard:meta). DUAS BASES DE CLIQUE, NAO MISTURE: cliques_todos = TODOS os cliques; cliques_no_link = SO cliques que levam ao destino - ao falar de 'CTR/CPC de link' cite ctr_link/cpc_link. visualizacoes_lp e RESULTADO valido e deve ser reportado. dia sem linha = coleta D-1 ainda nao chegou, NAO e entrega zero. ALCANCE: alcance_soma_diaria_nao_deduplicada e a SOMA dos alcances diarios (mesma pessoa em 2 dias conta 2x) - e PROIBIDO apresenta-la como 'alcance do periodo reportado pela plataforma' ou pessoas unicas; alcance unico do periodo so ao vivo via ler_pipeboard (insights com time_range inteiro, sem quebra por dia). MEDIA DIARIA: use gasto_medio_por_dia_fechado para pacing e comparacao com orcamento - o dia corrente e parcial e dividir por ele dilui a media e esconde estouro de verba.",
  };
}

const TETO_TOOL_JSON = 11500;
function cortarLista(obj: Record<string, unknown>, campo: string, teto = TETO_TOOL_JSON) {
  const lista = Array.isArray(obj[campo]) ? (obj[campo] as unknown[]) : null;
  if (!lista) return obj;
  const baseLen = JSON.stringify({ ...obj, [campo]: [] }).length;
  const mantidos: unknown[] = [];
  let usados = 0;
  for (const item of lista) {
    const tam = JSON.stringify(item).length + 1;
    if (baseLen + usados + tam > teto) break;
    mantidos.push(item);
    usados += tam;
  }
  const omitidos = lista.length - mantidos.length;
  const out: Record<string, unknown> = { ...obj, [campo]: mantidos, exibidos: mantidos.length };
  if (omitidos > 0) {
    out.omitidos = omitidos;
    out.aviso_corte = `A lista '${campo}' foi truncada: ${mantidos.length} de ${lista.length} itens enviados. Os ${omitidos} restantes EXISTEM no banco - nao os trate como inexistentes nem como zero.`;
  }
  return out;
}
async function t_criativos_conteudo(somenteAtivas: boolean, companyId: string, pagina = 1, buscaNome = "") {
  // v2: p_company_id obrigatorio (isolamento). v2.1: paginacao - cada pagina de 20 cabe no
  // teto de payload da ferramenta; restantes>0 diz ao subagente que a lista continua.
  // v2.10: p_busca_nome na sobrecarga de 5 args (mesma da traffic-chat) para achar molde sem folhear.
  const TAM_PAGINA = 20;
  const off = (Math.max(1, pagina) - 1) * TAM_PAGINA;
  if (buscaNome) {
    const { data, error } = await supa.rpc("get_criativos_conteudo", {
      p_somente_ativas: somenteAtivas, p_company_id: companyId,
      p_offset: off, p_limit: TAM_PAGINA, p_busca_nome: buscaNome,
    });
    if (error) return { erro: `falha ao buscar criativo por nome: ${error.message}` };
    if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo (busca)" };
    const obj = data as Record<string, unknown>;
    const cortado = cortarLista(obj, "anuncios", 9000) as Record<string, unknown>;
    const nadaCasou = Number(obj.total_que_casam_com_a_busca ?? 0) === 0;
    const avisoUniverso = nadaCasou && somenteAtivas
      ? "ATENCAO: zero aqui significa 'nenhum anuncio ATIVO com esse nome', NAO 'o anuncio nao existe'. Repita com somente_ativas=false antes de concluir ausencia."
      : undefined;
    return { ...cortado, somente_campanhas_ativas: somenteAtivas, pagina,
      ...(avisoUniverso ? { aviso_universo_da_busca: avisoUniverso } : {}),
      nota_busca: "Recorte por NOME (campo anuncios). Sem busca_nome a listagem usa criativos + legendas_unicas." };
  }
  const { data, error } = await supa.rpc("get_criativos_conteudo", { p_somente_ativas: somenteAtivas, p_company_id: companyId, p_offset: off, p_limit: TAM_PAGINA });
  if (error) return { erro: `falha ao ler conteudo dos criativos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_criativos_conteudo" };
  const obj = data as Record<string, unknown>;
  const lista = Array.isArray(obj.criativos) ? (obj.criativos as Record<string, unknown>[]) : [];
  const grupos = new Map<string, Record<string, unknown>>();
  for (const c of lista) {
    const legenda = String(c.legenda ?? "").trim();
    if (!legenda) continue;
    const chave = norm(legenda).slice(0, 300);
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, { legenda, titulo: c.titulo ?? null, cta: c.cta ?? null,
        anuncios: 1, exemplos: [c.anuncio], gasto_total: Number(c.gasto_acumulado || 0),
        formularios_total: Number(c.formularios || 0), alguma_em_campanha_ativa: c.campanha_ativa === true });
    } else {
      g.anuncios = Number(g.anuncios) + 1;
      if ((g.exemplos as unknown[]).length < 3) (g.exemplos as unknown[]).push(c.anuncio);
      g.gasto_total = Number(g.gasto_total) + Number(c.gasto_acumulado || 0);
      g.formularios_total = Number(g.formularios_total) + Number(c.formularios || 0);
      if (c.campanha_ativa === true) g.alguma_em_campanha_ativa = true;
    }
  }
  const unicas = [...grupos.values()].sort((a, b) => Number(b.gasto_total) - Number(a.gasto_total));
  // v29 (14/08): lista peca-por-peca COMPACTA (legenda_resumo ~180) com campos estruturais
  // (object_type/cta/destino/destino_url) SEMPRE presentes, para os ativos caberem inteiros.
  // legendas_unicas segue com o texto INTEGRAL (compliance).
  const compactos = lista.map((c) => ({
    anuncio: c.anuncio ?? null,
    campanha: c.campanha ?? null,
    campanha_ativa: c.campanha_ativa === true,
    status_anuncio: c.status_anuncio ?? null,
    object_type: c.object_type ?? null,
    cta: c.cta ?? null,
    destino: c.destino ?? null,
    destino_url: c.destino_url ?? null,
    tem_imagem: c.tem_imagem ?? null,
    gasto_acumulado: c.gasto_acumulado ?? null,
    formularios: c.formularios ?? null,
    legenda_resumo: String(c.legenda ?? "").slice(0, 300),
    legenda_foi_cortada: String(c.legenda ?? "").length > 300,
  }));
  const cortado = cortarLista({ ...obj, criativos: compactos }, "criativos", 11000) as Record<string, unknown>;
  const comUnicas = cortarLista({ ...cortado, legendas_unicas: unicas,
    total_legendas_distintas: unicas.length,
    nota_legendas: "legendas_unicas traz o texto INTEGRAL de cada legenda distinta e e a UNICA fonte valida para compliance - audite por aqui, nunca por legenda_resumo. legenda_foi_cortada=true apenas indica que o recorte de ~300 chars nao cobre a peca; o texto inteiro esta em legendas_unicas.",
  }, "legendas_unicas", 6500);
  return { ...comUnicas, somente_campanhas_ativas: somenteAtivas };
}
async function pipeboardTokenFromDb(): Promise<string> {
  const { data: secret } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", "pipeboard_api_token")
    .maybeSingle();
  return await pipeboardToken(async () => String(secret?.value ?? ""));
}

async function t_listar_ferramentas_pipeboard() {
  const token = await pipeboardTokenFromDb();
  if (!token) return { erro: "PIPEBOARD_API_TOKEN ausente" };
  const catalog = await listReadTools(token);
  if (!catalog.ok) return { erro: catalog.erro ?? "falha ao listar ferramentas Pipeboard" };
  const cut = truncatePipeboardPayload({
    ok: true,
    source: "pipeboard:meta",
    total_pipeboard: catalog.total_pipeboard,
    total_leitura: catalog.total_leitura,
    tools: catalog.tools.map((t) => ({
      name: t.name,
      description: t.description,
      argumentos: t.properties,
      obrigatorios: t.required,
    })),
    nota: "Ferramentas de LEITURA do Pipeboard. Chame ler_pipeboard com o nome exato. Preferir DB quando bastar; live quando faltar.",
  });
  return cut.data;
}

async function t_ler_pipeboard(companyId: string, ferramenta: string, argumentos: Record<string, unknown> = {}) {
  if (!companyId) return { erro: "company_id_obrigatorio" };
  const name = String(ferramenta ?? "").trim();
  if (!name) return { erro: "ferramenta_obrigatoria" };
  if (!isReadOnlyTool(name)) {
    return { erro: "ferramenta_nao_e_leitura", ferramenta: name };
  }
  const token = await pipeboardTokenFromDb();
  if (!token) return { erro: "PIPEBOARD_API_TOKEN ausente" };
  let allowed: string[] = [];
  try {
    allowed = await companyMetaAccounts(supa, companyId);
  } catch (error) {
    return { erro: String((error as Error).message ?? error) };
  }
  if (!allowed.length) return { erro: "empresa_sem_conta_meta_vinculada" };
  const catalog = await listReadTools(token);
  const toolMeta = catalog.tools.find((t) => t.name === name);
  const properties = Object.fromEntries((toolMeta?.properties ?? []).map((p) => [p, {}]));
  const scoped = scopeArgsToCompany(name, argumentos ?? {}, allowed, properties);
  if (!scoped.ok) {
    return { erro: scoped.erro, contas_da_empresa: scoped.contas_da_empresa ?? allowed };
  }
  const result = await callReadTool(name, scoped.args, token);
  const cut = truncatePipeboardPayload({
    ok: result.ok,
    source: "pipeboard:meta",
    company_id: companyId,
    ferramenta: name,
    args_usados: scoped.args,
    status: result.status ?? null,
    erro: result.erro ?? null,
    resultado: result.body ?? null,
  });
  return cut.data;
}

async function t_estrutura_conjuntos(companyId: string) {
  const { data, error } = await supa.rpc("get_estrutura_conjuntos", {
    p_company_id: companyId,
    p_offset: 0,
    p_limit: 100,
  });
  if (error) return { erro: `falha ao ler estrutura dos conjuntos: ${error.message}` };
  if (!data || typeof data !== "object") return { erro: "retorno inesperado de get_estrutura_conjuntos" };
  return cortarLista(data as Record<string, unknown>, "conjuntos");
}
async function t_check_compliance(companyId: string, legenda: string, mcpKey: string) {
  if (!legenda) return { erro: "forneca a legenda" };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/compliance-check`, { method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey }, body: JSON.stringify({ company_id: companyId, legenda }) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { erro: `compliance-check falhou (${r.status})` }; }
}
const TETO_CONHECIMENTO = 10000;
function dividirSecoes(md: string): { titulo: string; corpo: string }[] {
  const linhas = md.split("\n");
  const out: { titulo: string; corpo: string }[] = [];
  let tituloAtual = "(inicio)";
  let buffer: string[] = [];
  for (const l of linhas) {
    if (/^##\s+/.test(l)) {
      if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
      tituloAtual = l.replace(/^#+\s*/, "").trim();
      buffer = [];
    } else buffer.push(l);
  }
  if (buffer.length) out.push({ titulo: tituloAtual, corpo: buffer.join("\n").trim() });
  return out.filter((s) => s.corpo.length > 0);
}
async function t_conhecimento(tema: string, secao?: string) {
  if (!tema) return { erro: "informe o tema" };
  const { data, error } = await supa.from("agent_knowledge")
    .select("tema,descricao,conteudo,fonte,verificado_em,revalidar_ate")
    .eq("vigente", true).eq("tema", tema.trim().toLowerCase()).maybeSingle();
  if (error) return { erro: `falha ao ler conhecimento: ${error.message}` };
  if (!data) return { erro: `tema '${tema}' nao encontrado` };
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = data.revalidar_ate ? String(data.revalidar_ate) < hoje : false;
  const meta: Record<string, unknown> = { tema: data.tema, verificado_em: data.verificado_em, revalidar_ate: data.revalidar_ate, fonte: data.fonte };
  if (vencido) meta.aviso_validade = "Conhecimento VENCIDO: trate como NAO CONFIRMADO e declare que precisa reverificacao antes de virar decisao.";
  const conteudo = String(data.conteudo ?? "");
  const secoes = dividirSecoes(conteudo);
  if (secao) {
    const alvo = norm(secao);
    const hit = secoes.find((x) => norm(x.titulo).includes(alvo));
    if (!hit) return { ...meta, erro: `secao '${secao}' nao encontrada`, secoes_disponiveis: secoes.map((x) => x.titulo) };
    return { ...meta, secao: hit.titulo, conteudo: hit.corpo.slice(0, TETO_CONHECIMENTO) };
  }
  if (conteudo.length <= TETO_CONHECIMENTO) return { ...meta, conteudo };
  const entregues: string[] = [];
  let usados = 0;
  for (const sx of secoes) {
    const bloco = `## ${sx.titulo}\n${sx.corpo}`;
    if (usados + bloco.length > TETO_CONHECIMENTO) break;
    entregues.push(bloco); usados += bloco.length;
  }
  const n = entregues.length;
  return { ...meta, conteudo: entregues.join("\n\n"),
    secoes_entregues: secoes.slice(0, n).map((x) => x.titulo),
    secoes_nao_entregues: secoes.slice(n).map((x) => x.titulo),
    instrucao: n < secoes.length ? "Tema extenso, veio parcial. As secoes nao entregues EXISTEM: chame de novo com 'secao'." : undefined };
}

// [WABA - F5.4/F5.5 viram ferramenta] Leitura das tabelas alimentadas pelo waba-sync (09:30)
// e monitoradas pelo evaluate_waba_tier_alerts (09:40).
async function t_waba_status(companyId: string) {
  const { data: nums } = await supa.from("waba_phone_numbers")
    .select("display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,platform_type")
    .eq("company_id", companyId).eq("platform_type", "CLOUD_API");
  const { data: snaps } = await supa.from("waba_phone_snapshots")
    .select("snapshot_date").eq("company_id", companyId).order("snapshot_date", { ascending: false }).limit(1);
  const porTier = new Map<string, number>();
  const porQual = new Map<string, number>();
  for (const n of nums ?? []) {
    porTier.set(n.messaging_limit_tier ?? "sem tier", (porTier.get(n.messaging_limit_tier ?? "sem tier") ?? 0) + 1);
    porQual.set(n.quality_rating ?? "sem dado", (porQual.get(n.quality_rating ?? "sem dado") ?? 0) + 1);
  }
  return {
    numeros_vivos_cloud_api: (nums ?? []).length,
    distribuicao_tier: Object.fromEntries(porTier),
    distribuicao_qualidade: Object.fromEntries(porQual),
    numeros: (nums ?? []).map((n) => ({ numero: n.display_phone_number, nome: n.verified_name, tier: n.messaging_limit_tier, qualidade: n.quality_rating, status: n.status })),
    ultimo_snapshot: snaps?.[0]?.snapshot_date ?? null,
    nota: "Tier define o limite diario de envios (TIER_UNLIMITED e o alvo). Mudancas de tier/qualidade geram alerta automatico diario; qualidade YELLOW/RED antecede queda de tier.",
  };
}
async function t_waba_template_insights(companyId: string, days = 30) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await supa.from("waba_template_analytics_daily")
    .select("template_external_id,template_name,date,sent,delivered,read,clicked")
    .eq("company_id", companyId).gte("date", from);
  const { data: tpls } = await supa.from("waba_templates").select("external_id,name").eq("company_id", companyId);
  const nomePor = new Map((tpls ?? []).map((t) => [t.external_id, t.name]));
  const agg = new Map<string, { nome: string; sent: number; delivered: number; read: number; clicked: number }>();
  for (const r of rows ?? []) {
    const nome = (r.template_name && String(r.template_name).trim()) || nomePor.get(r.template_external_id) || r.template_external_id;
    const cur = agg.get(nome) ?? { nome, sent: 0, delivered: 0, read: 0, clicked: 0 };
    cur.sent += Number(r.sent || 0); cur.delivered += Number(r.delivered || 0);
    cur.read += Number(r.read || 0); cur.clicked += Number(r.clicked || 0);
    agg.set(nome, cur);
  }
  const lista = [...agg.values()].sort((a, b) => b.clicked - a.clicked || b.sent - a.sent);
  const { data: ontem } = await supa.from("waba_analytics_daily")
    .select("sent").eq("company_id", companyId).eq("date", new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  const sentOntem = (ontem ?? []).reduce((a, r) => a + Number(r.sent || 0), 0);
  return cortarLista({
    janela_dias: days,
    templates: lista.map((t) => ({ template: t.nome, envios: t.sent, entregues: t.delivered, leituras: t.read, cliques: t.clicked,
      taxa_clique_sobre_envio: t.sent ? Math.round((t.clicked / t.sent) * 1000) / 10 + "%" : null })),
    templates_distintos: lista.length,
    templates_sem_clique: lista.filter((t) => t.clicked === 0).length,
    envios_ontem_agregado: sentOntem,
    nota: "cliques podem superar leituras (recibo de leitura desligado nao conta leitura; ha multiplos cliques por mensagem). O detalhe POR NUMERO ainda NAO e coletado (dado agregado da conta) - ausencia de recorte por numero nao significa zero.",
  }, "templates");
}

async function runTool(name: string, args: any, ctx: { companyId: string; mcpKey: string }) {
  try {
    switch (name) {
      case "get_overview": return await t_overview(ctx.companyId);
      case "get_alerts": return await t_alerts(ctx.companyId);
      case "get_recommendations": return await t_recos(ctx.companyId);
      case "get_meta_dicas": {
        const dias = Math.max(1, Math.min(90, Number(args?.dias ?? 14) || 14));
        const veredito = args?.veredito != null ? String(args.veredito) : null;
        const { data, error } = await supa.rpc("get_meta_dicas", {
          p_company_id: ctx.companyId,
          p_dias: dias,
          p_veredito: veredito,
        });
        if (error) return { erro: error.message };
        return data;
      }
      case "teto_vigente": return await t_rpc("teto_vigente", { p_company_id: ctx.companyId, p_metric: String(args?.metric ?? "") });
      case "checar_par_texto_e_peca": return await t_rpc("checar_par_texto_e_peca", { p_company_id: ctx.companyId, p_legenda: String(args?.legenda ?? ""), p_drive_file_id: String(args?.drive_file_id ?? "") });
      case "saude_das_integracoes": return await t_rpc("saude_das_integracoes", { p_company_id: ctx.companyId, p_dias_tolerancia: Number(args?.dias_tolerancia ?? 3) });
      case "custo_llm_periodo": return await t_rpc("custo_llm_periodo", { p_company_id: ctx.companyId, p_de: String(args?.de ?? ""), p_ate: String(args?.ate ?? "") });
      case "panorama_utm_anuncios": return await t_rpc("panorama_utm_anuncios", { p_company_id: ctx.companyId });
      case "nota_visual_da_peca": return await t_rpc("nota_visual_da_peca", { p_company_id: ctx.companyId, p_drive_file_id: String(args?.drive_file_id ?? "") });
      case "diagnosticar_custo": return await t_rpc("diagnosticar_custo", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "avaliar_fadiga": return await t_rpc("avaliar_fadiga", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "casar_criativo_performance": return await t_rpc("casar_criativo_performance", {
        p_company_id: ctx.companyId,
        p_drive_file_id: args?.drive_file_id == null || String(args.drive_file_id).trim() === "" ? null : String(args.drive_file_id),
        p_ad_external_id: args?.ad_external_id == null || String(args.ad_external_id).trim() === "" ? null : String(args.ad_external_id),
        p_dias: Number(args?.dias ?? 7),
      });
      case "ler_brand_identity": return await t_rpc("ler_brand_identity", { p_company_id: ctx.companyId });
      case "score_de_prontidao": return await t_rpc("score_de_prontidao", { p_company_id: ctx.companyId });
      case "saude_dos_tokens": return await t_rpc("saude_dos_tokens", { p_company_id: ctx.companyId });
      case "ler_entregas_digest": return await t_rpc("ler_entregas_digest", { p_company_id: ctx.companyId, p_dias: Number(args?.dias ?? 7) });
      case "computar_perfil_vencedor": return await t_rpc("computar_perfil_vencedor", {
        p_company_id: ctx.companyId,
        p_dias: Number(args?.dias ?? 7),
        p_forcar: args?.forcar === true,
      });
      case "ler_perfil_vencedor": return await t_rpc("ler_perfil_vencedor", {
        p_company_id: ctx.companyId,
        p_versao: args?.versao == null || String(args.versao).trim() === "" ? null : Number(args.versao),
      });
      case "pode_pausar_por_custo": return await t_rpc("pode_pausar_por_custo", { p_company_id: ctx.companyId, p_ad_external_id: String(args?.ad_external_id ?? "") });
      case "decidir_sobre_conjunto": return await t_rpc("decidir_sobre_conjunto", { p_company_id: ctx.companyId, p_adset_external_id: String(args?.adset_external_id ?? "") });
      case "avaliar_escala": return await t_rpc("avaliar_escala", { p_company_id: ctx.companyId, p_adset_external_id: String(args?.adset_external_id ?? "") });
      case "avaliar_pacing": return await t_rpc("avaliar_pacing", { p_company_id: ctx.companyId, p_meta_leads_dia: args?.meta_leads_dia == null ? null : Number(args.meta_leads_dia) });
      case "validar_pedido_contra_contrato": return await t_rpc("validar_pedido_contra_contrato", { p_acao: String(args?.acao ?? ""), p_pedido: args?.pedido ?? {} });
      case "get_funnel": return await t_funnel(ctx.companyId, args?.date_from, args?.date_to);
      case "get_ads_ranking": return await t_ads_ranking(ctx.companyId, Number(args?.days ?? 7));
      case "get_campaign_detail": return await t_campaign_detail(ctx.companyId, String(args?.name_like ?? ""));
      case "get_criativos_conteudo": {
        const buscaNome = String(args?.busca_nome ?? "").trim();
        const informouAtivas = typeof args?.somente_ativas === "boolean";
        const somenteAtivas = informouAtivas ? args.somente_ativas === true : !buscaNome;
        return await t_criativos_conteudo(somenteAtivas, ctx.companyId, Number(args?.pagina ?? 1), buscaNome);
      }
      case "get_estrutura_conjuntos": return await t_estrutura_conjuntos(ctx.companyId);
      case "listar_ferramentas_pipeboard": return await t_listar_ferramentas_pipeboard();
      case "ler_pipeboard":
        return await t_ler_pipeboard(
          ctx.companyId,
          String(args?.ferramenta ?? args?.tool ?? ""),
          (args?.argumentos && typeof args.argumentos === "object" && !Array.isArray(args.argumentos))
            ? args.argumentos as Record<string, unknown>
            : ((args?.args && typeof args.args === "object" && !Array.isArray(args.args))
              ? args.args as Record<string, unknown>
              : {}),
        );
      case "get_drive_criativos": return await t_drive_criativos(ctx.companyId);
      case "get_analise_visual_drive": {
        const { data, error } = await supa.rpc("get_drive_analises", { p_company_id: ctx.companyId });
        return error ? { erro: error.message } : data;
      }
      case "get_acervo_para_anuncio": {
        const produto = String(args?.produto ?? "").trim();
        const { data, error } = await supa.rpc("get_acervo_para_anuncio", {
          p_company_id: ctx.companyId,
          p_produto: produto || null,
          p_incluir_inaptas: args?.incluir_inaptas === false ? false : true,
        });
        return error ? { erro: error.message } : data;
      }
      case "upload_midia": {
        const dfid = String(args?.drive_file_id ?? "").trim();
        if (!dfid) return { erro: "drive_file_id obrigatorio" };
        const body: Record<string, unknown> = {
          acao: "executar",
          company: ctx.companyId,
          drive_file_id: dfid,
        };
        if (String(args?.account_id ?? "").trim()) body.account_id = String(args.account_id).trim();
        const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-midia`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-mcp-key": ctx.mcpKey },
          body: JSON.stringify(body),
        });
        const t = await r.text();
        let j: any; try { j = JSON.parse(t); } catch { return { erro: `upload-midia falhou (${r.status})` }; }
        return {
          ok: !j?.recusado && !j?.error && !j?.erro,
          dedup: !!j?.dedup,
          meta_video_id: j?.video_id ?? null,
          meta_image_hash: j?.image_hash ?? null,
          status_processamento: j?.status_processamento ?? null,
          pronto: j?.pronto ?? (j?.image_hash ? true : null),
          recusado: j?.recusado ?? false,
          motivo: j?.motivo ?? j?.error ?? j?.erro ?? null,
          nota: j?.nota ?? null,
        };
      }
      case "check_compliance": return await t_check_compliance(ctx.companyId, String(args?.legenda ?? "").trim(), ctx.mcpKey);
      case "get_conhecimento": return await t_conhecimento(String(args?.tema ?? ""), args?.secao ? String(args.secao) : undefined);
      case "get_waba_status": return await t_waba_status(ctx.companyId);
      case "get_waba_template_insights": return await t_waba_template_insights(ctx.companyId, Number(args?.days ?? 30));
      default: return { erro: `tool desconhecida: ${name}` };
    }
  } catch (e) { return { erro: String((e as any)?.message ?? e) }; }
}

// Schemas (subset do v27.1)
const DEF: Record<string, any> = {
  get_analise_visual_drive: { type: "function", function: { name: "get_analise_visual_drive", description: "VEREDITO VISUAL POR PECA das midias do Drive, ja persistido pelo especialista de visao: produto detectado pelos pixels, texto visivel, risco e veredito aproveitavel sim/nao/incerto com motivo. Leitura instantanea - nao repete a visao. Se total_analisados < inventario, pecas novas ainda nao passaram pela visao: declare, nao invente.", parameters: { type: "object", properties: {} } } },
  get_drive_criativos: { type: "function", function: { name: "get_drive_criativos", description: "INVENTARIO DA PASTA DE CRIATIVOS NOVOS no Google Drive (somente leitura): caminho (1o nivel=formato, 2o nivel=eixo de mensagem), nome, tipo, tamanho, data e thumbnail (um frame/preview) de cada arquivo, com resumo por formato e por eixo. Pode vir truncado: leia aviso_corte e nunca trate item omitido como inexistente. LIMITE: video e analisado por thumbnail+nome+caminho, nao pelo conteudo interno.", parameters: { type: "object", properties: {} } } },
  get_acervo_para_anuncio: { type: "function", function: { name: "get_acervo_para_anuncio", description: "LEITURA TOTAL do acervo Drive. Devolve inventario_global SEMPRE (videos/imagens/slides carrossel). Em lote/mix chame SEM produto primeiro. apta=true so = pronta pra publicar agora; NAO use para afirmar escassez. Slides Carrossel = imagem estatica usavel. Bloqueadas = legiveis e proponiveis via veredito. NAO use get_criativos_conteudo.", parameters: { type: "object", properties: { produto: { type: "string", description: "Opcional; em lote deixe vazio na 1a chamada." }, incluir_inaptas: { type: "boolean", description: "Padrao true (leitura total)." } } } } },
  upload_midia: { type: "function", function: { name: "upload_midia", description: "Sobe UMA peca do Drive para a biblioteca Meta (adimages/advideos) e grava meta_image_hash ou meta_video_id. USE quando get_acervo_para_anuncio mostrar na_biblioteca_da_meta=false. NAO cria anuncio. Respeita flag e teto 5/hora. Idempotente. Video: so considere pronta se pronto=true.", parameters: { type: "object", properties: { drive_file_id: { type: "string" }, account_id: { type: "string" } }, required: ["drive_file_id"] } } },
  get_overview: { type: "function", function: { name: "get_overview", description: "Visao geral de MIDIA: campanhas ativas (status real), gasto/resultados 7d, dias_com_dado.", parameters: { type: "object", properties: {} } } },
  get_alerts: { type: "function", function: { name: "get_alerts", description: "Alertas ativos do sistema.", parameters: { type: "object", properties: {} } } },
  get_recommendations: { type: "function", function: { name: "get_recommendations", description: "FILA INTERNA de custo de midia (nao e badge Ads Manager).", parameters: { type: "object", properties: {} } } },
  get_meta_dicas: { type: "function", function: { name: "get_meta_dicas", description: "Dicas da Meta (Opportunity Score + campo classico) com veredito interno. Cite sempre o veredito.", parameters: { type: "object", properties: { dias: { type: "integer" }, veredito: { type: "string" } } } } },
  teto_vigente: { type: "function", function: { name: "teto_vigente", description: "FONTE PRIORITARIA para teto vigente. Exige company_id do job e metrica; declara regua governante, denominador, autor/data/citacao, historico, aspiracao e divergencias. Targets isolado NAO e veredito de negocio.", parameters: { type: "object", properties: { metric: { type: "string" } }, required: ["metric"] } } },
  checar_par_texto_e_peca: { type: "function", function: { name: "checar_par_texto_e_peca", description: "Avalia legenda + peca juntas no company_id do job. Devolve PAR, leituras separadas, cobertura e lacunas. E deteccao por texto, NAO aprovacao; audio sem transcricao fica declarado como nao lido.", parameters: { type: "object", properties: { legenda: { type: "string" }, drive_file_id: { type: "string" } }, required: ["legenda", "drive_file_id"] } } },
  saude_das_integracoes: { type: "function", function: { name: "saude_das_integracoes", description: "Mede integracoes Meta do company_id por ads, snapshots, breakdown e relogios; declara divergencias com status sem altera-lo. Nao cobre alem do retorno.", parameters: { type: "object", properties: { dias_tolerancia: { type: "integer" } } } } },
  custo_llm_periodo: { type: "function", function: { name: "custo_llm_periodo", description: "Custo derivado em USD dos tokens gravados de chat/jobs do company_id no periodo. Nao e fatura; declara modelos presumidos, cache-teto, tokens ausentes e visao/compliance invisiveis.", parameters: { type: "object", properties: { de: { type: "string" }, ate: { type: "string" } }, required: ["de", "ate"] } } },
  panorama_utm_anuncios: { type: "function", function: { name: "panorama_utm_anuncios", description: "Panorama do company_id para url_tags e destino: nunca lido, sem/com rotulo, rotulos e ambiguidades. Nao mede leads por UTM; token cobre so parte das contas.", parameters: { type: "object", properties: {} } } },
  nota_visual_da_peca: { type: "function", function: { name: "nota_visual_da_peca", description: "Nota textual de uma peca no company_id: revisao, base, produto, aproveitabilidade, risco, motivo e divergencia. Informa, nao aprova; ausencia de leitura nao e ausencia de risco.", parameters: { type: "object", properties: { drive_file_id: { type: "string" } }, required: ["drive_file_id"] } } },
  diagnosticar_custo: { type: "function", function: { name: "diagnosticar_custo", description: "Diagnostica por que o custo por formulario de um anuncio subiu, comparando o ultimo dia com entrega aos 3 anteriores. Exige company_id do job e ad_external_id. Devolve sinal, causa, acao, confirmacao, medidas e guarda de maturacao; sem base nao conclui, e pos-clique fica fora do escopo.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  avaliar_fadiga: { type: "function", function: { name: "avaliar_fadiga", description: "Avalia se a peca cansou, teve queda sem saturacao, frequencia alta antes da queda ou nenhum sinal. Exige company_id do job e ad_external_id. Sem entrega/base nao conclui; usa frequencia DIARIA e nao deriva a frequencia deduplicada de 30 dias.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  casar_criativo_performance: { type: "function", function: { name: "casar_criativo_performance", description: "ESP-33: casa peca Drive com anuncios criados pelo sistema e metricas da janela + amostra_pequena. Filtros opcionais: drive_file_id, ad_external_id, dias.", parameters: { type: "object", properties: { drive_file_id: { type: "string" }, ad_external_id: { type: "string" }, dias: { type: "integer" } } } } },
  ler_brand_identity: { type: "function", function: { name: "ler_brand_identity", description: "ESP-36: identidade de marca vigente do company_id do job: voz/tom, dos/donts, disclaimers, linhas de produto e referencias resolvidas (page_id/instagram/CTA/driver + destinos). Fonte curada de voz da marca; leitura pura.", parameters: { type: "object", properties: {} } } },
  computar_perfil_vencedor: { type: "function", function: { name: "computar_perfil_vencedor", description: "ESP-34: computa e VERSIONA o perfil do vencedor do company_id do job (regua evaluate_winners/ESP-01: >=30 resultados e >=30 gasto, custo <= teto_vigente*0,80; procedencia da peca ESP-33). Grava nova versao (dedup no mesmo dia salvo forcar). Nao substitui get_recommendations nem aprovacao humana; vencedor mora em ESCALA (ESP-39).", parameters: { type: "object", properties: { dias: { type: "integer" }, forcar: { type: "boolean" } } } } },
  ler_perfil_vencedor: { type: "function", function: { name: "ler_perfil_vencedor", description: "ESP-34: le a ultima versao (ou versao especifica) do perfil do vencedor ja computado para o company_id do job: vencedores, padroes, criterio, procedencia e lacunas. Leitura pura; se nunca computado, orienta chamar computar_perfil_vencedor.", parameters: { type: "object", properties: { versao: { type: "integer" } } } } },
  score_de_prontidao: { type: "function", function: { name: "score_de_prontidao", description: "ESP-38: score read-only 0-100 de prontidao do company_id do job para propor/executar anuncios: config (25), integracao viva (25), postura (20), brand (15), destino (10), driver (5). Devolve nivel (bloqueado|parcial|operacional|pronto), checks com evidencia/lacuna, bloqueios e recomendacoes. Nao altera nada nem substitui gates por pedido.", parameters: { type: "object", properties: {} } } },
  saude_dos_tokens: { type: "function", function: { name: "saude_dos_tokens", description: "ESP-30: saude dos tokens Meta (ads/waba) do company_id do job por metadado gravado (meta_tokens): dias para expirar, dias para data_access, escopos faltando vs esperado por papel e veredito. Leitura pura do ultimo estado do meta-token-monitor; nao chama a Graph e nunca expoe o valor do token.", parameters: { type: "object", properties: {} } } },
  ler_entregas_digest: { type: "function", function: { name: "ler_entregas_digest", description: "ESP-41: config de digest (cadencia/slots, e-mails, alerta critico) + entregas recentes (digest e alerta critico) do company_id do job, com status por entrega. Leitura pura; status sem_provedor/sem_destinatario indicam que o digest seguiu so no chat.", parameters: { type: "object", properties: { dias: { type: "integer" } } } } },
  pode_pausar_por_custo: { type: "function", function: { name: "pode_pausar_por_custo", description: "Libera avaliacao de pausa por custo quando o anuncio esta maduro ou atende a excecao dura de zero resultado, CTR baixo e piso de gasto. Exige company_id do job e ad_external_id. Nao verifica a guarda do unico conjunto/alternativa ativa; permitido nao significa seguro pausar.", parameters: { type: "object", properties: { ad_external_id: { type: "string" } }, required: ["ad_external_id"] } } },
  decidir_sobre_conjunto: { type: "function", function: { name: "decidir_sobre_conjunto", description: "Decide manter, maturar, trocar criativo ou preparar reversao usando custo, volume e tendencia. Exige company_id do job e adset_external_id. A guarda do unico conjunto entregando sobrescreve pausa; sem regua de IDEAL separada do teto, nao prescreve escala.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  avaliar_escala: { type: "function", function: { name: "avaliar_escala", description: "Avalia escala por duplicacao com no maximo +20%, usando arvore, custo ate 80% do teto, volume e espera. Exige company_id do job e adset_external_id. Nao cobre CBO sem orcamento proprio; a espera ve apenas escalas registradas pelo sistema.", parameters: { type: "object", properties: { adset_external_id: { type: "string" } }, required: ["adset_external_id"] } } },
  avaliar_pacing: { type: "function", function: { name: "avaliar_pacing", description: "Calcula capacidade diaria e, com meta_leads_dia opcional, o PISO de verba ao custo atual. Exige company_id do job. Nao ha meta registrada e a projecao nao e estimativa: escalar tende a elevar o custo, entao a verba real pode ser maior.", parameters: { type: "object", properties: { meta_leads_dia: { type: "number" } } } } },
  validar_pedido_contra_contrato: { type: "function", function: { name: "validar_pedido_contra_contrato", description: "Valida pedido jsonb contra contrato_de_execucao. Assinatura: (acao, pedido). contrato_desconhecido se acao sem linhas; recusa obrigatorios faltantes; extras nao invalidam. Lacunas: contrato de anuncio veio do codigo montarCriacao; url_tags opcional no adcreative; NAO substitui pedido_de_anuncio_completo.", parameters: { type: "object", properties: { acao: { type: "string" }, pedido: { type: "object" } }, required: ["acao", "pedido"] } } },
  get_funnel: { type: "function", function: { name: "get_funnel", description: "Funil de MIDIA num periodo, com cobertura_real.", parameters: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" } } } } },
  get_ads_ranking: { type: "function", function: { name: "get_ads_ranking", description: "RECORTE por custo MEDIO (Breakdown Effect: serve p/ ENTENDER, proibido prescrever pausa so por isto).", parameters: { type: "object", properties: { days: { type: "number" } } } } },
  get_campaign_detail: { type: "function", function: { name: "get_campaign_detail", description: "Detalhe e serie diaria 14d de UMA campanha pelo nome, com totais do periodo. Cada dia e os totais trazem: gasto, impressoes, alcance, frequencia, cliques_todos, cliques_no_link, visualizacoes_lp, formularios, conversas, e os derivados ctr_todos, ctr_link, cpc_todos, cpc_link e cpm. DUAS BASES DE CLIQUE - NUNCA misture: ctr_link/cpc_link usam SO cliques no link (use ao falar de 'CTR/CPC de link'); ctr_todos/cpc_todos usam TODOS os cliques (engajamento amplo). visualizacoes_lp e resultado valido e deve ser reportado (nao omita), sobretudo em engajamento/trafego. Esta e a fonte por-campanha de metricas basicas E avancadas - NUNCA diga que sao indisponiveis. Dia sem linha = coleta D-1 ainda nao chegou, nao entrega zero.", parameters: { type: "object", properties: { name_like: { type: "string" } }, required: ["name_like"] } } },
  get_criativos_conteudo: { type: "function", function: { name: "get_criativos_conteudo", description: "Legendas/titulo/CTA reais dos anuncios; traz tambem destino_url e destino (whatsapp quando wa.me, senao site) - o numero de WhatsApp de destino da peca sai daqui (CONFIG do criativo, nao a analitica WABA congelada). Sem busca_nome: PAGINADO por gasto (20). Com busca_nome: sobrecarga (somente_ativas, company, offset, limit, busca_nome) para achar molde sem folhear; default somente_ativas=false quando busca. Nunca trate item de outra pagina como inexistente.", parameters: { type: "object", properties: { somente_ativas: { type: "boolean" }, busca_nome: { type: "string", description: "Parte do nome do anuncio (ex.: LPV2_A2_Reel02 ou TESTE-GT02 no molde)." }, pagina: { type: "integer", description: "Pagina de 20, comecando em 1." } } } } },
  get_estrutura_conjuntos: { type: "function", function: { name: "get_estrutura_conjuntos", description: "CBO vs ABO, orcamento, lance, targeting por conjunto. Traz tambem a PEGADA por conjunto (optimization_goal, destination_type, pegada=engajamento_topo|trafego|trafego_para_whatsapp_nao_otimizado|conversao_mensagem_otimizada|leads|conversao_site, destino_predominante e numeros_whatsapp): use para classificar organico/engajamento x conversao-WhatsApp e dizer QUAL numero recebe cada conjunto.", parameters: { type: "object", properties: {} } } },
  listar_ferramentas_pipeboard: { type: "function", function: { name: "listar_ferramentas_pipeboard", description: "Catalogo ao vivo das ferramentas de LEITURA do Pipeboard. Use antes de ler_pipeboard quando nao souber o nome do endpoint.", parameters: { type: "object", properties: {} } } },
  ler_pipeboard: { type: "function", function: { name: "ler_pipeboard", description: "Leitura AO VIVO do Pipeboard (so get_/list_/search_/...). Preferir DB quando bastar; use ao vivo para breakdown, activities, pages, pixels, audiences, insights pontuais, config fresca. Escopo: contas da empresa do job.", parameters: { type: "object", properties: { ferramenta: { type: "string" }, argumentos: { type: "object" } }, required: ["ferramenta"] } } },
  check_compliance: { type: "function", function: { name: "check_compliance", description: "Valida UMA legenda contra a base de regras versionada (FIN/CRI/LGL).", parameters: { type: "object", properties: { legenda: { type: "string" } }, required: ["legenda"] } } },
  get_conhecimento: { type: "function", function: { name: "get_conhecimento", description: "Base tecnica: politicas Meta, metricas, otimizacao, criativo. Use 'secao' p/ temas extensos.", parameters: { type: "object", properties: { tema: { type: "string" }, secao: { type: "string" } }, required: ["tema"] } } },
  get_waba_status: { type: "function", function: { name: "get_waba_status", description: "Numeros WhatsApp vivos: tier de envio (caminho p/ TIER_UNLIMITED), qualidade (GREEN/YELLOW/RED) e status, por numero e agregado.", parameters: { type: "object", properties: {} } } },
  get_waba_template_insights: { type: "function", function: { name: "get_waba_template_insights", description: "Insights por TEMPLATE WhatsApp numa janela: envios, entregues, leituras, cliques e taxa de clique. Detalhe por numero ainda nao e coletado (declarado no retorno).", parameters: { type: "object", properties: { days: { type: "number", description: "janela em dias (default 30)" } } } } },
};

// Whitelist de subagentes: UM POR CAPACIDADE IMPLEMENTADA, escopo estrito (decisao do Ryan
// 28/07: tarefa de criativo vai pro de criativo, tarefa de insight vai pro de desempenho -
// especialista nao atende fora do proprio dominio, recusa e registra em LACUNAS).
const SUBAGENTES: Record<string, { tools: string[]; maxPorTool: Record<string, number>; maxToolsTotal: number; missao: string }> = {
  desempenho_campanhas: {
    tools: ["get_overview", "get_funnel", "get_ads_ranking", "get_campaign_detail", "teto_vigente", "panorama_utm_anuncios", "diagnosticar_custo", "avaliar_fadiga", "casar_criativo_performance", "computar_perfil_vencedor", "ler_perfil_vencedor", "pode_pausar_por_custo", "decidir_sobre_conjunto", "avaliar_escala", "avaliar_pacing", "listar_ferramentas_pipeboard", "ler_pipeboard"],
    maxPorTool: { get_campaign_detail: 3, computar_perfil_vencedor: 1, ler_pipeboard: 5, listar_ferramentas_pipeboard: 1 }, maxToolsTotal: 11,
    missao: "NUMEROS E DECISAO DE MIDIA das campanhas Meta: gasto, impressoes, cliques, CTR, formularios, custos vs teto_vigente, diagnostico de custo/fadiga, maturacao para pausa, decisao com guarda do unico conjunto, escala e pacing. Preferir DB; se faltar dado use listar_ferramentas_pipeboard + ler_pipeboard. Respeitar literalmente lacunas e guardas das RPCs; ranking medio isolado nunca prescreve pausa.",
  },
  criativos: {
    tools: ["get_criativos_conteudo", "get_conhecimento", "validar_pedido_contra_contrato", "listar_ferramentas_pipeboard", "ler_pipeboard"],
    maxPorTool: { get_criativos_conteudo: 4, get_conhecimento: 3, validar_pedido_contra_contrato: 2, ler_pipeboard: 3, listar_ferramentas_pipeboard: 1 }, maxToolsTotal: 10,
    missao: "CONTEUDO REAL DAS PECAS em operacao: legendas, titulos, CTAs, gasto e formularios por legenda distinta, hooks e formatos (fundamentar na base de conhecimento de criativo). Pode validar pedido contra contrato_de_execucao antes de propor criacao. Se o sync nao trouxe o detalhe, use ler_pipeboard (get_creative_details/get_ad_details). NAO faz auditoria de compliance (dominio do especialista compliance) nem analisa metricas de campanha (dominio do desempenho_campanhas).",
  },
  compliance: {
    tools: ["check_compliance", "checar_par_texto_e_peca", "get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { check_compliance: 8, checar_par_texto_e_peca: 8, get_criativos_conteudo: 3, get_conhecimento: 2 }, maxToolsTotal: 13,
    missao: "AUDITORIA DE COMPLIANCE: validar o PAR legenda+peca quando houver drive_file_id, declarando exatamente a cobertura e lacunas; para acervo em operacao, validar cada legenda distinta. Deteccao automatica nao e aprovacao.",
  },
  estrutura_conta: {
    tools: ["get_estrutura_conjuntos", "get_conhecimento", "listar_ferramentas_pipeboard", "ler_pipeboard"],
    maxPorTool: { get_estrutura_conjuntos: 1, get_conhecimento: 2, ler_pipeboard: 5, listar_ferramentas_pipeboard: 1 }, maxToolsTotal: 7,
    missao: "ESTRUTURA da conta: CBO vs ABO, orcamentos por conjunto, estrategia de lance, targeting, pegada e destino. Preferir get_estrutura_conjuntos; se faltar (activities, config fresca, pages), use ler_pipeboard. Apontar riscos com o dado visivel, sem inventar configuracao nao coletada.",
  },
  whatsapp_waba: {
    tools: ["get_waba_status", "get_waba_template_insights", "get_conhecimento"],
    maxPorTool: { get_waba_status: 1, get_waba_template_insights: 2, get_conhecimento: 2 }, maxToolsTotal: 5,
    missao: "CANAL WHATSAPP: tier de envio dos numeros (caminho para o TIER_UNLIMITED), qualidade GREEN/YELLOW/RED, envios, entregas, leituras e CLIQUES por template com taxa de clique. Declarar que o recorte por numero ainda nao e coletado quando relevante.",
  },
  alertas_recomendacoes: {
    tools: ["get_alerts", "get_recommendations", "get_meta_dicas", "saude_das_integracoes", "custo_llm_periodo", "score_de_prontidao", "saude_dos_tokens", "ler_entregas_digest"],
    maxPorTool: { get_alerts: 1, get_recommendations: 1, get_meta_dicas: 1, saude_das_integracoes: 1, custo_llm_periodo: 2, score_de_prontidao: 1, saude_dos_tokens: 1, ler_entregas_digest: 1 }, maxToolsTotal: 8,
    missao: "PENDENCIAS E OBSERVABILIDADE: alertas, recomendacoes INTERNAS e dicas da Meta (get_meta_dicas com veredito interno). Em pergunta sobre dica/boost/musica/Opportunity Score: levante as dicas e devolva julgamento acionavel (viavel ou nao + o que fazer) — nunca so listar. Tambem saude das integracoes, custo LLM, score de prontidao (ESP-38), saude dos tokens Meta (ESP-30) e entregas do digest (ESP-41), tudo read-only. Repetir divergencias, premissas e lacunas dos retornos.",
  },
  analise_visual_drive: {
    tools: [], maxPorTool: {}, maxToolsTotal: 0,  // pipeline codificado - nao usa loop de tools
    missao: "ANALISE VISUAL arquivo a arquivo das midias do Drive (pixels da miniatura em alta resolucao): produto detectado, texto visivel, riscos de compliance visiveis e veredito aproveitavel/nao/incerto por peca, persistido em banco. Use quando o gestor pedir para CLASSIFICAR/ANALISAR O CONTEUDO das pecas (nao apenas inventariar). Limite declarado: de video se ve UM FRAME.",
  },
  criativos_drive: {
    tools: ["get_acervo_para_anuncio", "upload_midia", "get_drive_criativos", "get_analise_visual_drive", "nota_visual_da_peca", "casar_criativo_performance", "ler_brand_identity", "get_criativos_conteudo", "get_conhecimento"],
    maxPorTool: { get_acervo_para_anuncio: 2, upload_midia: 2, get_drive_criativos: 2, get_analise_visual_drive: 1, nota_visual_da_peca: 8, casar_criativo_performance: 3, ler_brand_identity: 1, get_criativos_conteudo: 1, get_conhecimento: 2 }, maxToolsTotal: 10,
    missao: "CRIATIVOS NOVOS NO DRIVE: leitura total. Slate do gestor prevalece sobre inventario liberado (nao troque 3v+1carr+1card por 5 videos). CET: 'consulte o CET na sua simulacao' basta (FIN-04 v4). Carrossel via child_attachments. Cite taxonomia_drive antes de filtrar. Nunca get_criativos_conteudo para peca nova.",
  },
  conhecimento: {
    tools: ["get_conhecimento"],
    maxPorTool: { get_conhecimento: 5 }, maxToolsTotal: 5,
    missao: "FUNDAMENTO TECNICO puro (politicas Meta, definicao de metricas, metodo de otimizacao, boas praticas de criativo), citando o tema consultado e declarando [VENCIDO] quando for o caso. So e acionado quando a pergunta exige conceito alem do que os outros especialistas ja fundamentam.",
  },
};

// ============================================================================
// v2 - GOOGLE DRIVE (service account, somente leitura)
// ============================================================================
let _driveToken: { token: string; exp: number } | null = null;
function _pemParaDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function _b64url(dados: Uint8Array | string): string {
  const bin = typeof dados === "string" ? dados : String.fromCharCode(...dados);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function driveToken(): Promise<string> {
  if (_driveToken && _driveToken.exp > Date.now() + 60_000) return _driveToken.token;
  if (!GOOGLE_SA_KEY_B64) throw new Error("credencial do Drive nao configurada (GOOGLE_SA_KEY_B64)");
  const sa = JSON.parse(atob(GOOGLE_SA_KEY_B64));
  const agora = Math.floor(Date.now() / 1000);
  const header = _b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = _b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", _pemParaDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave,
    new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${_b64url(assinatura)}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}` });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`falha no token do Drive: ${JSON.stringify(j).slice(0, 200)}`);
  _driveToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in ?? 3600) - 120) * 1000 };
  return _driveToken.token;
}
// Caminha a arvore da pasta raiz. Convencao observada na pasta real (30/07/2026):
// 1o nivel = FORMATO (Videos, Cards, Carrossel N...), 2o nivel = EIXO DE MENSAGEM.
// v2.5 (04/08/2026) - COBERTURA VEM DA TABELA, NAO DO SEGREDO. Antes o codigo lia UMA pasta, do
// segredo DRIVE_CRIATIVOS_FOLDER_ID: por mais amplo que fosse o acesso da conta de servico, a
// cobertura era um id fixo, e acrescentar pasta exigia mudar segredo e deployar. Agora a lista
// vem de drive_pastas_monitoradas via drive_plano_de_varredura, e acrescentar pasta e um INSERT.
// O segredo fica como FALLBACK DECLARADO: se a RPC nao devolver pasta ativa, ele e usado E o
// retorno avisa - falha de leitura da tabela nao pode deixar o sistema cego em silencio.
async function t_drive_criativos(companyId: string) {
  const { data: plano, error: ePlano } = await supa.rpc("drive_plano_de_varredura", { p_company_id: companyId });
  const pastasAtivas: any[] = Array.isArray((plano as any)?.pastas_ativas) ? (plano as any).pastas_ativas : [];
  const desativadas: any[] = Array.isArray((plano as any)?.pastas_desativadas) ? (plano as any).pastas_desativadas : [];

  let raizes: { folder_id: string; nome: string }[] = pastasAtivas
    .map((p: any) => ({ folder_id: String(p.folder_id ?? ""), nome: String(p.nome ?? "(sem nome)") }))
    .filter((p) => p.folder_id);
  let avisoFallback: string | null = null;
  if (!raizes.length) {
    return {
      erro: "nenhuma_pasta_drive_configurada_para_esta_empresa",
      detalhe_rpc: ePlano?.message ?? null,
      aviso: "Falha fechada: o fallback global foi removido para impedir leitura de criativos de outra empresa.",
    };
  }

  let token: string;
  try { token = await driveToken(); }
  catch (e) { return { erro: String((e as any)?.message ?? e), aviso: "Sem acesso ao Drive nesta rodada - o dado NAO foi lido; nao trate como pasta vazia. Verificar credencial e compartilhamento da pasta com a service account." }; }
  const MAX_PASTAS = 40, MAX_ARQUIVOS = 250, MAX_PROFUNDIDADE = 4;
  type No = { id: string; caminho: string; nivel: number; raiz: string };
  // Tetos GLOBAIS entre as raizes: o que protege e o payload, que nao sabe de quantas pastas veio.
  const fila: No[] = raizes.map((r) => ({ id: r.folder_id, caminho: "", nivel: 0, raiz: r.nome }));
  const arquivos: any[] = [];
  const porPasta: Record<string, number> = {};
  let pastasLidas = 0, cortado = false;
  while (fila.length) {
    const no = fila.shift()!;
    if (pastasLidas >= MAX_PASTAS || arquivos.length >= MAX_ARQUIVOS) { cortado = true; break; }
    pastasLidas++;
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${no.id}' in parents and trashed=false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink)");
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) return { erro: `Drive respondeu ${r.status}`, detalhe: JSON.stringify(j).slice(0, 200) };
      for (const f of j.files ?? []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (no.nivel + 1 <= MAX_PROFUNDIDADE) fila.push({ id: f.id, caminho: no.caminho ? `${no.caminho}/${f.name}` : f.name, nivel: no.nivel + 1, raiz: no.raiz });
        } else if (arquivos.length < MAX_ARQUIVOS) {
          arquivos.push({ id: f.id, nome: f.name, caminho: no.caminho || "(raiz)",
            pasta_monitorada: no.raiz,
            formato_pasta: (no.caminho.split("/")[0] || "(raiz)"),
            eixo_pasta: (no.caminho.split("/")[1] ?? null),
            tipo: f.mimeType, tamanho_bytes: Number(f.size ?? 0) || null,
            modificado_em: f.modifiedTime ?? null, thumbnail: f.thumbnailLink ?? null });
          porPasta[no.raiz] = (porPasta[no.raiz] ?? 0) + 1;
        } else { cortado = true; }
      }
      pageToken = j.nextPageToken ?? "";
    } while (pageToken && arquivos.length < MAX_ARQUIVOS);
  }
  const porFormato: Record<string, number> = {};
  const porEixo: Record<string, number> = {};
  for (const a of arquivos) {
    porFormato[a.formato_pasta] = (porFormato[a.formato_pasta] ?? 0) + 1;
    if (a.eixo_pasta) porEixo[a.eixo_pasta] = (porEixo[a.eixo_pasta] ?? 0) + 1;
  }
  // v2.5: registra a varredura por pasta. `ultima_varredura_em` e o que distingue "varri e nao
  // achei peca nova" de "nunca varri" - sem isso, silencio e indistinguivel de falha.
  const registradas: string[] = [];
  if (!avisoFallback) {
    for (const r of raizes) {
      const { error } = await supa.rpc("drive_registrar_varredura", {
        p_company_id: companyId, p_folder_id: r.folder_id, p_pecas: porPasta[r.nome] ?? 0,
      });
      if (!error) registradas.push(r.nome);
    }
  }

  const out: any = {
    total_arquivos: arquivos.length, pastas_lidas: pastasLidas,
    pastas_monitoradas_varridas: raizes.map((r) => ({ nome: r.nome, arquivos: porPasta[r.nome] ?? 0 })),
    pastas_desativadas: desativadas,
    varredura_registrada_em: registradas,
    resumo_por_formato: porFormato, resumo_por_eixo_de_mensagem: porEixo,
    nota: "Inventario das pastas de criativo MONITORADAS desta empresa (somente leitura). Convencao: 1o nivel do caminho = formato, 2o nivel = eixo de mensagem. 'thumbnail' e um frame/preview servido pelo Google. LIMITE DECLARADO: video e analisado por thumbnail+nome+caminho; o conteudo interno (frames/audio) NAO e lido nesta versao.",
    declare_a_cobertura: (plano as any)?.declare_a_cobertura
      ?? "NUNCA diga que leu 'o Drive'. Diga quais pastas foram varridas e quando. Pasta fora da lista nao e lida por ninguem.",
    arquivos,
  };
  if (avisoFallback) out.aviso_fallback = avisoFallback;
  if (desativadas.length) {
    out.aviso_pastas_desativadas = `Existem ${desativadas.length} pasta(s) cadastradas e DESATIVADAS: elas nao foram lidas. Peca que exista nelas e invisivel para o sistema - declare isso se o gestor perguntar por peca que voce nao encontrou.`;
  }
  if (cortado) out.aviso_corte = `Inventario truncado nos tetos de leitura (${MAX_PASTAS} pastas / ${MAX_ARQUIVOS} arquivos), somados entre as pastas monitoradas. O que nao veio EXISTE nas pastas - nao trate como inexistente; peca um recorte por subpasta.`;
  return out;
}

// ============================================================================
// LLM
// ============================================================================
async function chamarLLM(messages: any[], opts: { tools?: any[]; maxTokens: number; reasoning?: any; model?: string; timeoutMs?: number }): Promise<any> {
  const payload: any = { model: opts.model ?? MODEL, messages, max_tokens: opts.maxTokens };
  if (opts.tools?.length) { payload.tools = opts.tools; payload.tool_choice = "auto"; }
  if (opts.reasoning) payload.reasoning = opts.reasoning;
  const timeoutMs = opts.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
  const headers = { "content-type": "application/json", authorization: `Bearer ${OPENROUTER_KEY}` };
  async function postOnce(body: any): Promise<{ resp: Response; text: string; aborted: boolean }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers, body: JSON.stringify(body), signal: ac.signal,
      });
      const text = await resp.text();
      return { resp, text, aborted: false };
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (ac.signal.aborted || /abort/i.test(msg)) {
        return { resp: new Response(null, { status: 408 }), text: `openrouter_timeout_${timeoutMs}ms`, aborted: true };
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  let { resp, text, aborted } = await postOnce(payload);
  if (aborted) return { erro: `openrouter_timeout_${timeoutMs}`, detalhe: text.slice(0, 300) };
  if (!resp.ok && (resp.status === 400 || resp.status === 422) && payload.reasoning) {
    // Degradacao: remove reasoning e retenta (mesmo padrao do traffic-chat v21).
    delete payload.reasoning;
    ({ resp, text, aborted } = await postOnce(payload));
    if (aborted) return { erro: `openrouter_timeout_${timeoutMs}`, detalhe: text.slice(0, 300) };
  }
  if (!resp.ok) return { erro: `openrouter_http_${resp.status}`, detalhe: text.slice(0, 300) };
  try { return { parsed: JSON.parse(text) }; } catch { return { erro: "openrouter_non_json", detalhe: text.slice(0, 300) }; }
}
function usoDe(parsed: any) {
  const u = parsed?.usage ?? {};
  return { tin: Number(u.prompt_tokens ?? 0), tout: Number(u.completion_tokens ?? 0),
    reas: Number(u.completion_tokens_details?.reasoning_tokens ?? 0) + Number(u.reasoning_tokens ?? 0) };
}

// ============================================================================
// FASE 1 - PLANNER (LLM identifica, codigo decide)
// ============================================================================
function extrairJSON(txt: string): any | null {
  const limpo = txt.replace(/```json|```/g, "").trim();
  const ini = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch { return null; }
}

/** Fallback quando o planner falha: por tier, nunca Object.keys() cego (lite Meta → alertas). */
function planoFallbackSeguro(
  nomes: string[],
  cap: Capacidade | undefined,
  pergunta: string,
): { nome: string; foco: string }[] {
  const maxEsp = Math.max(1, Math.min(cap?.maxEspecialistas ?? nomes.length, nomes.length));
  const p = deacc(pergunta.toLowerCase());
  const metaHit = RE_META_DICA.test(p);
  if (metaHit && nomes.includes("alertas_recomendacoes")) {
    return [{ nome: "alertas_recomendacoes", foco: FOCO_META_DICAS }];
  }
  if (cap?.tier === "lite") {
    const preferidos = ["desempenho_campanhas", "alertas_recomendacoes", "conhecimento"];
    const escolhido = preferidos.find((n) => nomes.includes(n)) ?? nomes[0];
    return [{ nome: escolhido, foco: "cobrir a parte da pergunta pertinente a sua especialidade" }];
  }
  if (cap?.tier === "standard") {
    const preferidos = ["desempenho_campanhas", "alertas_recomendacoes", "estrutura_conta"];
    return preferidos
      .filter((n) => nomes.includes(n))
      .slice(0, maxEsp)
      .map((n) => ({ nome: n, foco: "cobrir a parte da pergunta pertinente a sua especialidade" }));
  }
  return nomes.slice(0, maxEsp).map((n) => ({
    nome: n,
    foco: "cobrir a parte da pergunta pertinente a sua especialidade",
  }));
}

async function planejar(pergunta: string, tel: any, cap?: Capacidade): Promise<{ plano: { nome: string; foco: string }[]; degradado: boolean }> {
  const nomes = Object.keys(SUBAGENTES);
  const maxEsp = cap?.maxEspecialistas ?? nomes.length;
  if (cap?.forcarPlano?.length) {
    const plano = cap.forcarPlano.filter((p) => nomes.includes(p.nome)).slice(0, maxEsp);
    if (plano.length) {
      tel.planner = { tokens_in: 0, tokens_out: 0, forcado: true, motivo: cap.motivo, tier: cap.tier };
      return { plano, degradado: false };
    }
  }
  const hintCap = cap?.tier === "lite"
    ? "\nMODO LITE: no maximo 1 especialista; um dominio so."
    : cap?.tier === "standard"
      ? "\nMODO STANDARD: no maximo 2 especialistas; preferir 1 quando um dominio cobre."
      : "\nMODO DEEP: pode usar varios especialistas se a pergunta cruzar dominios; auditoria ampla inclui todos os pertinentes.";
  const sys = `Voce e o ROTEADOR de um gestor de trafego Meta Ads. Dada a pergunta do gestor, encaminhe a tarefa para o MENOR conjunto de especialistas que a cobre por inteiro - tarefa de um unico dominio vai para UM unico especialista.
Especialistas disponiveis (use exatamente estes nomes):
- desempenho_campanhas: numeros de midia (gasto, CTR, custos, ranking, series, metas)
- criativos: conteudo real das pecas (legendas, titulos, CTA, hooks, formatos)
- compliance: auditoria das legendas contra as regras de credito (FIN/CRI/LGL)
- estrutura_conta: CBO/ABO, orcamento por conjunto, lance, targeting
- whatsapp_waba: numeros WhatsApp (tier, qualidade) e templates (envios, leituras, cliques)
- alertas_recomendacoes: alertas ativos, recomendacoes pendentes e DICAS DA META (Opportunity Score, boost, musica)
- criativos_drive: pasta de criativos NOVOS no Google Drive (inventario, formatos, eixos, comparacao com vencedores)\n- analise_visual_drive: analise VISUAL arquivo a arquivo das pecas do Drive (produto, texto visivel, riscos, veredito aproveitavel) - so quando pedirem CLASSIFICAR/ANALISAR CONTEUDO das pecas
- conhecimento: fundamento tecnico puro (so quando a pergunta exige conceito alem do operacional)
REGRAS DE ATRIBUICAO: taxa de clique/insight de CAMPANHA -> desempenho_campanhas; taxa de clique de TEMPLATE WhatsApp -> whatsapp_waba; texto/ideia de anuncio -> criativos; "pode anunciar isso?"/violacao -> compliance; Drive/pasta de materiais/criativos novos ainda nao publicados -> criativos_drive; CLASSIFICAR/ANALISAR o CONTEUDO das pecas do Drive (aproveitavel ou nao, o que a peca diz, produto da peca) -> analise_visual_drive; dica/recomendacao/boost/musica/Opportunity Score da Meta -> SOMENTE alertas_recomendacoes (NAO acrescente criativos so porque a dica menciona musica). NAO inclua especialista cujo dominio a pergunta nao toca.${hintCap}
Responda APENAS com JSON valido, sem markdown, no formato:
{"subagentes":[{"nome":"...","foco":"instrucao curta e especifica do que ELE deve levantar"}]}
Para auditoria ampla da conta, inclua todos os pertinentes.`;
  const r = await chamarLLM(
    [{ role: "system", content: sys }, { role: "user", content: pergunta.slice(0, 12000) }],
    { maxTokens: PLANNER_MAX_TOKENS, reasoning: REASONING_OFF, model: MODEL_SUB, timeoutMs: cap?.openRouterTimeoutMs ?? OPENROUTER_TIMEOUT_MS },
  );
  if (r.erro) {
    return { plano: planoFallbackSeguro(nomes, cap, pergunta), degradado: true };
  }
  const u = usoDe(r.parsed); tel.planner = { tokens_in: u.tin, tokens_out: u.tout, tier: cap?.tier };
  const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
  const lista = Array.isArray(bruto?.subagentes) ? bruto.subagentes : null;
  if (!lista?.length) {
    return { plano: planoFallbackSeguro(nomes, cap, pergunta), degradado: true };
  }
  const plano = lista
    .map((x: any) => ({ nome: String(x?.nome ?? "").trim(), foco: String(x?.foco ?? "").trim().slice(0, 400) }))
    .filter((x: any) => nomes.includes(x.nome));
  if (!plano.length) {
    return { plano: planoFallbackSeguro(nomes, cap, pergunta), degradado: true };
  }
  // dedupe mantendo o primeiro foco
  const vistos = new Set<string>();
  let final = plano.filter((p: any) => (vistos.has(p.nome) ? false : (vistos.add(p.nome), true)));
  if (final.length > maxEsp) {
    final = final.slice(0, maxEsp);
    tel.planner_capado = true;
  }
  return { plano: final, degradado: false };
}

// ============================================================================
// FASE 2 - SUBAGENTE (loop restrito, relatorio final)
// ============================================================================
async function rodarSubagente(nome: string, foco: string, pergunta: string, ctx: { companyId: string; companyName: string; mcpKey: string }, prazo: () => number) {
  const cfg = SUBAGENTES[nome];
  const tools = cfg.tools.map((t) => DEF[t]);
  const isLegal = norm(ctx.companyName).includes("legal");
  const perfil = isLegal
    ? "empresa de credito consignado; aplique categoria especial somente quando o objeto lido confirmar esse produto"
    : "COHAPM/cooperativa habitacional; nao aplique doutrina, benchmark, identidade ou produto de credito da Legal e Viver";
  const sys = `Voce e o subagente '${nome}' do Gestor de Trafego IA da ${ctx.companyName} (${perfil}).
MISSAO: ${cfg.missao}
FOCO DESTE JOB: ${foco || "cobrir a parte da pergunta pertinente a sua especialidade"}
ESCOPO ESTRITO: voce so atende o que a sua MISSAO cobre. Se o foco recebido pedir algo de OUTRO dominio (ex.: metricas de campanha para um especialista de criativo), NAO tente responder com suas ferramentas - registre na linha LACUNAS que aquilo e de outro especialista e siga apenas com a sua parte.
REGRAS: todo numero vem de ferramenta CHAMADA AGORA (nunca de memoria); distinga zero / nao existe / nao coletado; incorpore campos 'nota'/'aviso' dos retornos; amostra pequena e hipotese; nao misture janelas.\nPAGINACAO OBRIGATORIA: se um retorno trouxer restantes > 0 ou aviso de corte E o seu foco exigir cobertura da lista inteira, chame a MESMA ferramenta pedindo a proxima pagina ate cobrir ou esgotar seu teto de consultas. Aceitar o corte sem tentar a proxima pagina e falha sua; se esgotar o teto antes de cobrir, declare em LACUNAS exatamente quantos itens ficaram sem leitura.
Ao terminar a coleta, escreva um RELATORIO conciso e denso em markdown com numeros + fonte + janela, terminando com a linha 'LACUNAS:' listando o que nao conseguiu cobrir (ou 'nenhuma').`;
  const messages: any[] = [{ role: "system", content: sys }, { role: "user", content: `Pergunta original do gestor (para contexto):\n${pergunta.slice(0, 8000)}` }];
  const usadas: string[] = [];
  let tin = 0, tout = 0, reas = 0, relatorio = "", finish = "";
  for (let iter = 0; iter < SUB_MAX_ITER; iter++) {
    if (prazo() <= 0) { finish = "prazo_do_job"; break; }
    const r = await chamarLLM(messages, { tools, maxTokens: SUB_MAX_TOKENS, reasoning: SUB_REASONING, model: MODEL_SUB });
    if (r.erro) { relatorio = `(subagente ${nome} falhou: ${r.erro})`; finish = "erro_llm"; break; }
    const u = usoDe(r.parsed); tin += u.tin; tout += u.tout; reas += u.reas;
    finish = String(r.parsed?.choices?.[0]?.finish_reason ?? "");
    const msg = r.parsed?.choices?.[0]?.message;
    if (!msg) { relatorio = `(subagente ${nome}: resposta vazia do provider)`; break; }
    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const tc of msg.tool_calls) {
        const nomeTc = String(tc.function?.name ?? "");
        const jaUsou = usadas.filter((t) => t === nomeTc).length;
        const limite = cfg.maxPorTool[nomeTc] ?? 2;
        if (usadas.length >= cfg.maxToolsTotal || jaUsou >= limite || !cfg.tools.includes(nomeTc)) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({
            erro: "consulta_nao_realizada",
            aviso: "Teto de consultas deste especialista atingido ou ferramenta fora do seu escopo. O dado NAO foi lido - nao trate como zero. Feche o relatorio com o que tem e registre em LACUNAS." }) });
          continue;
        }
        let args: any = {}; try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* */ }
        const result = await runTool(nomeTc, args, ctx);
        usadas.push(nomeTc);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 14000) });
      }
      continue;
    }
    relatorio = String(msg.content ?? "");
    break;
  }
  if (!relatorio) {
    // Estourou iteracoes/prazo coletando: forca o relatorio com o que ha.
    messages.push({ role: "user", content: "PARE de usar ferramentas. Escreva AGORA o relatorio final com os dados ja coletados, terminando com a linha LACUNAS:." });
    const rf = await chamarLLM(messages, { maxTokens: SUB_MAX_TOKENS, reasoning: REASONING_OFF, model: MODEL_SUB });
    if (!rf.erro) {
      const u = usoDe(rf.parsed); tin += u.tin; tout += u.tout;
      relatorio = String(rf.parsed?.choices?.[0]?.message?.content ?? "");
      finish = String(rf.parsed?.choices?.[0]?.finish_reason ?? finish) + "+forcado";
    }
  }
  // v1.1: CONTINUACAO INTERNA DO RELATORIO. Se o relatorio cortou em length, continua em
  // memoria (mesma tecnica da sintese: contexto preservado, zero re-coleta) ate fechar em
  // stop, esgotar as partes ou o prazo apertar. Sem tools de proposito: e hora de ESCREVER.
  let partes = relatorio ? 1 : 0;
  while (relatorio && finish.startsWith("length") && partes < SUB_RELATORIO_MAX_PARTES && prazo() > 25_000) {
    messages.push({ role: "assistant", content: relatorio });
    messages.push({ role: "user", content: "Seu relatorio foi cortado por limite de tamanho. Continue EXATAMENTE do ponto onde parou, na proxima palavra. Nao repita nada, nao reescreva secoes; ao concluir, termine com a linha LACUNAS:." });
    const maxTok = Math.max(1500, Math.min(SUB_MAX_TOKENS, Math.floor((prazo() / 1000) * TOKENS_POR_SEGUNDO)));
    const rc = await chamarLLM(messages, { maxTokens: maxTok, reasoning: REASONING_OFF, model: MODEL_SUB });
    if (rc.erro) break;
    const u = usoDe(rc.parsed); tin += u.tin; tout += u.tout;
    const pedaco = String(rc.parsed?.choices?.[0]?.message?.content ?? "");
    if (!pedaco) break;
    relatorio += pedaco;
    finish = String(rc.parsed?.choices?.[0]?.finish_reason ?? "length");
    partes++;
  }
  const relatorioCompleto = !!relatorio && !finish.startsWith("length");
  if (!relatorio) relatorio = `(subagente ${nome}: sem relatorio - registre como lacuna do job)`;
  return { nome, relatorio, completo: relatorioCompleto, partes, tools: usadas, tokens_in: tin, tokens_out: tout, reasoning_tokens: reas, finish };
}

// ============================================================================
// FASE 3 - SINTESE com continuacao INTERNA (contexto preservado, zero re-coleta)
// ============================================================================
async function sintetizar(
  companyName: string,
  pergunta: string,
  relatorios: { nome: string; relatorio: string; completo: boolean }[],
  estilo: string,
  memoria: string,
  prazo: () => number,
  tel: any,
  opts?: { timeoutMs?: number },
) {
  const isLegal = norm(companyName).includes("legal");
  const perfil = isLegal
    ? "empresa de credito consignado; regras financeiras so valem quando o produto estiver comprovado"
    : "cooperativa habitacional; doutrina, benchmarks e identidades da Legal e Viver nao se aplicam";
  const sys = `Voce e o Gestor de Trafego IA da ${companyName}. Hoje e ${today()}. Responde ao gestor (Roberto) em portugues brasileiro.
PERFIL EMPRESARIAL: ${perfil}.
ESCOPO RIGIDO: somente trafego pago (midia, criativo, publico, orcamento, custo). Bancos, esteira interna, politica de credito, atendimento humano e conversao final do CRM estao FORA - se a pergunta tocar nisso, declare fora de escopo e siga.
REGRAS INEGOCIAVEIS: (R1) todo numero desta conta vem dos RELATORIOS INTERNOS abaixo, coletados agora por especialistas - se um numero nao esta neles, escreva 'nao disponivel'; NUNCA estime nem complete com plausibilidade. (R1b) conhecimento de plataforma (conceitos Meta) voce explica normalmente, separado de dado da conta. (R2) nunca afirme configuracao da conta sem dado. (R3) distinga zero / nao existe / nao coletado - os relatorios marcam LACUNAS. (R3b - CORTE NAO E INEXISTENCIA) alguns relatorios chegam marcados como INCOMPLETOS (cortados por limite de tamanho): o que nao esta neles pode MUITO BEM existir no sistema. Para esses, escreva 'o levantamento do especialista veio incompleto nesta rodada' - e PROIBIDO dizer 'nao disponivel', 'retornou vazio' ou tratar a ausencia como inexistencia. (R4) nao misture janelas. (R4b) HOJE e a data declarada na primeira linha deste prompt - NUNCA redefina 'hoje' a partir do ultimo dia com dado. A coleta fecha em D-1, entao o ultimo dia coletado costuma ser ONTEM; chamar esse dia de 'hoje' e ERRO. Ao declarar a janela, diga a data de hoje e, separadamente, qual foi o ultimo dia com dado. (R5) amostra pequena = hipotese. (R6) ordem das datas antes de causalidade. (R8) voce NAO executa acoes: se uma acao for recomendavel, descreva-a e diga que o gestor pode pedi-la no chat para virar pedido de aprovacao. (R9) incoerencia entre numeros: aponte. Sem jargao interno (nomes de ferramenta, codigos de regra, limites de implementacao).
PROIBIDO NARRAR INTENCAO: nunca escreva "vou cruzar/ler/consultar/verificar". Entregue UMA resposta completa e elaborada neste turno — veredito + evidencia + recomendacao — mesmo quando o levantamento veio de um unico especialista (capacidade lite). Em dicas/recomendacoes da Meta (ex.: impulsionar com musica): diga se e viavel ou nao e o que fazer, sem filler operacional. Capacidade menor NAO autoriza resposta curta de dialogo nem "vou analisar".
FORMATO (regras vigentes do sistema):
${estilo}
MEMORIA INSTITUCIONAL (fatos verificados):
${memoria}
Responda a pergunta INTEIRA, bloco a bloco na ordem pedida, com numero + fonte ('levantamento interno de hoje') + ressalva. Escreva de forma continua ate concluir.`;
  const blocos = relatorios.map((r) => `=== RELATORIO ${r.nome} [${r.completo ? "COMPLETO" : "INCOMPLETO - cortado por limite de tamanho; ausencias aqui NAO significam que o dado nao existe"}] ===\n${r.relatorio}`).join("\n\n");
  const messages: any[] = [
    { role: "system", content: sys },
    { role: "user", content: `PERGUNTA DO GESTOR (responda por completo):\n${pergunta}\n\n=== RELATORIOS DOS ESPECIALISTAS (sua unica fonte de numeros da conta) ===\n${blocos}` },
  ];
  const perCallTimeout = opts?.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
  const hardDeadline = Date.now() + Math.min(SINT_FASE_HARD_MS, Math.max(prazo(), 8_000));
  let texto = "", partes = 0, tin = 0, tout = 0, finish = "";
  while (partes < SINT_MAX_PARTES) {
    const restanteMs = Math.min(prazo(), hardDeadline - Date.now());
    if (restanteMs <= 0) {
      finish = (finish || "stop") + (texto ? "+sintese_timeout_parcial" : "+sintese_timeout");
      break;
    }
    const maxTok = Math.max(1500, Math.min(SINT_MAX_TOKENS, Math.floor((restanteMs / 1000) * TOKENS_POR_SEGUNDO)));
    const callTimeout = Math.min(perCallTimeout, Math.max(5_000, restanteMs));
    const r = await chamarLLM(messages, { maxTokens: maxTok, reasoning: REASONING_OFF, timeoutMs: callTimeout });
    if (r.erro) {
      if (!texto) texto = "";
      finish = `erro_llm:${r.erro}`;
      break;
    }
    const u = usoDe(r.parsed); tin += u.tin; tout += u.tout;
    const msg = r.parsed?.choices?.[0]?.message;
    const pedaco = String(msg?.content ?? "");
    finish = String(r.parsed?.choices?.[0]?.finish_reason ?? "");
    texto += pedaco;
    partes++;
    if (finish !== "length") break;
    // Continuacao interna: mesmo contexto em memoria - nada e re-coletado, nada se perde.
    messages.push({ role: "assistant", content: pedaco });
    messages.push({ role: "user", content: "Continue EXATAMENTE do ponto onde parou, na proxima palavra. Nao repita nada, nao reescreva titulos, nao cumprimente." });
  }
  tel.sintese = { partes, tokens_in: tin, tokens_out: tout, finish_reason: finish };
  if (finish === "length" || finish.includes("sintese_timeout_parcial")) {
    texto += "\n\n*(resposta encerrada no limite de tamanho do processamento; peca a parte que faltou que eu completo)*";
  }
  return texto;
}

// ============================================================================
// v2.2 - ANALISE VISUAL DO DRIVE (pipeline codificado com visao, persistido)
// ============================================================================
async function baixarThumb(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const alta = url.replace(/=s\d+(-c)?$/, "=s1600");
    let r = await fetch(alta);
    if (!r.ok) { const t = await driveToken(); r = await fetch(alta, { headers: { authorization: `Bearer ${t}` } }); }
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") ?? "image/jpeg";
    const u = new Uint8Array(await r.arrayBuffer());
    if (u.length > 1_800_000) return null; // grande demais p/ lote - pula com registro
    let bin = ""; const CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) bin += String.fromCharCode.apply(null, u.subarray(i, i + CH) as any);
    return { b64: btoa(bin), mime };
  } catch { return null; }
}

// v2.6 (04/08/2026) - BASE DA ANALISE NO CONTRATO. A chave de drive_midia_analises passou a ser
// (drive_file_id, drive_modified_time, base_da_analise): reanalise com base DIFERENTE cria linha
// nova e o veredito antigo permanece. Convencao do nome: "<evidencia>/criterio-<versao do prompt>"
// - se o prompt de visao mudar, a base muda e a reanalise dispara por construcao, sem ninguem
// precisar lembrar de inventar nome. Foi exatamente esse esquecimento que deixou as 67 pecas de
// 31/07 julgadas 2h11 ANTES do deploy que trouxe a taxonomia do gestor (educacao financeira e
// seguranca), com zero pecas nesses dois temas.
const BASE_PADRAO = "thumbnail";
type OpcoesVisao = { base?: string; somenteNomes?: string[]; limite?: number; somenteImagens?: boolean };

// v2.7 (04/08/2026) - QUADROS DA META. O Drive entrega UMA miniatura por arquivo e nao aceita
// offset de tempo; extrair quadro do mp4 no runtime da edge nao existe (isolate V8 sem shell,
// Deno.Command bloqueado, ffmpeg.wasm estoura os 256 MB). Mas a Meta gera 15 quadros 1080x1920 por
// video enviado, todos baixaveis sem credencial - medido em 04/08. Entao os quadros vem de la, via
// a acao `thumbnails` da upload-midia (que tem o META_ADS_TOKEN; este job nao tem, e nao deve ter).
// FILTRO POR PESO, nao por posicao: um quadro muito mais leve que os vizinhos e quase uniforme -
// abertura em fundo liso. Medido: num dos videos o quadro `is_preferred` tinha 26 KB contra 186 KB
// dos vizinhos, ou seja, a capa que a Meta escolhe pode ser o PIOR quadro para julgar conteudo.
// Por isso `is_preferred` e ignorado de proposito.
const QUADROS_POR_VIDEO = 5;
const PESO_MINIMO_DA_MEDIANA = 0.40;

async function quadrosDaMeta(videoId: string, mcpKey: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-midia`, {
    method: "POST", headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ acao: "thumbnails", video_id: videoId, medir_todos: true }),
  });
  const t = await r.text();
  let j: any; try { j = JSON.parse(t); } catch { return { erro: `thumbnails falhou (${r.status})` }; }
  const v = Array.isArray(j?.videos) ? j.videos[0] : null;
  if (!v || v.erro) return { erro: String(v?.erro ?? "sem quadros na resposta") };
  const todos: any[] = Array.isArray(v.quadros) ? v.quadros : [];
  const mediana = Number(v.mediana_bytes ?? 0);
  const piso = mediana > 0 ? mediana * PESO_MINIMO_DA_MEDIANA : 0;
  const sobreviventes = todos.filter((q) => typeof q.bytes === "number" && q.bytes >= piso && q.uri);
  // Distribui os 5 ao longo do TEMPO entre os que sobraram (a ordem do array e a ordem temporal).
  const escolhidos: any[] = [];
  if (sobreviventes.length <= QUADROS_POR_VIDEO) escolhidos.push(...sobreviventes);
  else {
    const passo = (sobreviventes.length - 1) / (QUADROS_POR_VIDEO - 1);
    for (let k = 0; k < QUADROS_POR_VIDEO; k++) escolhidos.push(sobreviventes[Math.round(k * passo)]);
  }
  return { total: todos.length, mediana, piso, sobreviventes: sobreviventes.length,
    descartados_por_peso: todos.length - sobreviventes.length, escolhidos };
}

async function rodarAnaliseVisual(foco: string, ctx: { companyId: string; mcpKey?: string }, prazo: () => number, tel: any, opts: OpcoesVisao = {}) {
  const base = String(opts.base ?? BASE_PADRAO).trim() || BASE_PADRAO;
  const nomeSub = "analise_visual_drive";
  const inv = await t_drive_criativos(ctx.companyId);
  if ((inv as any)?.erro) return { nome: nomeSub, relatorio: `LACUNAS: inventario do Drive indisponivel (${(inv as any).erro}) - nenhuma analise visual feita nesta rodada.`, completo: false };
  const arquivos: any[] = (inv as any).arquivos ?? [];

  // v2.5: as impressoes digitais vem do MESMO plano que definiu as pastas, em vez de uma consulta
  // propria - uma fonte so para "o que varrer" e "o que ja foi analisado".
  // v2.6: o plano e pedido PARA A BASE desejada. `ja_analisados` sao as que ja foram vistas NESSA
  // base (pulam); `vistos_em_base_mais_rasa` sao as vistas de forma menos completa (reanalisam).
  const { data: plano } = await supa.rpc("drive_plano_de_varredura", {
    p_company_id: ctx.companyId, p_base_desejada: base,
  });
  const jaAnalisados: any[] = Array.isArray((plano as any)?.ja_analisados) ? (plano as any).ja_analisados : [];
  const jaFeito = new Set(jaAnalisados.map((f: any) => `${f.f}|${f.m ?? ""}`));
  const emBaseMaisRasa = Array.isArray((plano as any)?.vistos_em_base_mais_rasa) ? (plano as any).vistos_em_base_mais_rasa.length : 0;
  // v2.6: filtros do recorte da rodada. `somenteImagens` existe porque reanalisar VIDEO por
  // miniatura com critério novo gastaria visão para continuar vendo um quadro - o video espera a
  // rota de quadros. `somenteNomes` e `limite` servem ao aceite parcial: provar em 5 antes de 48.
  const alvoNomes = (opts.somenteNomes ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean);
  // v2.9: o recorte por TIPO entra AQUI, antes do corte por `limite`. Na v2.8 a base multiquadro
  // filtrava video dentro do laco, depois do slice(0, limite): com limite 12 os 12 primeiros
  // pendentes eram imagens, todas foram puladas e a corrida devolveu 0 analisadas em 5s. Nao
  // quebrou nada e nao gravou nada errado - simplesmente nao fez, e so a telemetria nova
  // (multiquadro: [] com falhas 0) tornou isso visivel em vez de parecer "nada a fazer".
  const soVideo = base.startsWith("multiquadro");
  const pendentes = arquivos.filter((a: any) => {
    if (!a.thumbnail) return false;
    if (jaFeito.has(`${a.id ?? a.nome}|${a.modificado_em ?? ""}`)) return false;
    const ehVideo = String(a.tipo ?? "").startsWith("video/");
    if (opts.somenteImagens && ehVideo) return false;
    if (soVideo && !ehVideo) return false;
    if (alvoNomes.length && !alvoNomes.includes(String(a.nome ?? "").trim().toLowerCase())) return false;
    return true;
  });
  const semThumb = arquivos.filter((a: any) => !a.thumbnail);

  let analisados = 0, falhasThumb = 0, falhasGravacao = 0;
  const teto = Math.max(1, Math.min(Number(opts.limite ?? VISAO_MAX_POR_RODADA), VISAO_MAX_POR_RODADA));
  const fila = pendentes.slice(0, teto);
  const modoMultiquadro = base.startsWith("multiquadro");
  const detalheQuadros: any[] = [];
  const semVideoId: string[] = [];

  // ---------- caminho MULTIQUADRO: 5 quadros da Meta por video, um video por chamada ----------
  if (modoMultiquadro) {
    for (const arq of fila) {
      if (prazo() < VISAO_MIN_PRAZO_MS) break;
      if (!String(arq.tipo ?? "").startsWith("video/")) continue;   // multiquadro so faz sentido em video
      if (!ctx.mcpKey) { falhasThumb++; continue; }
      // O quadro vem da Meta, entao exige o video JA na biblioteca. Sem video_id nao ha o que ler -
      // e isso e lacuna declarada, nao peca ruim.
      const { data: up } = await supa.from("media_uploads")
        .select("meta_video_id").eq("drive_file_id", String(arq.id ?? ""))
        .eq("status", "enviado").not("meta_video_id", "is", null).maybeSingle();
      const videoId = up?.meta_video_id ? String(up.meta_video_id) : "";
      if (!videoId) { semVideoId.push(String(arq.nome ?? arq.id)); continue; }

      const q: any = await quadrosDaMeta(videoId, ctx.mcpKey);
      if (q.erro) { falhasThumb++; detalheQuadros.push({ nome: arq.nome, erro: q.erro }); continue; }
      const imagens: { b64: string; mime: string; indice: number }[] = [];
      for (const esc of q.escolhidos ?? []) {
        const th = await baixarThumb(String(esc.uri));
        if (th) imagens.push({ b64: th.b64, mime: th.mime, indice: esc.indice });
      }
      detalheQuadros.push({ nome: arq.nome, video_id: videoId, total_da_meta: q.total,
        mediana_bytes: q.mediana, descartados_por_peso: q.descartados_por_peso,
        sobreviventes: q.sobreviventes, usados: imagens.length,
        indices_usados: imagens.map((x) => x.indice) });
      if (!imagens.length) { falhasThumb++; continue; }

      const content: any[] = [{ type: "text", text:
        `Voce analisa um VIDEO de anuncio a partir de ${imagens.length} QUADROS extraidos ao longo dele (ordem cronologica). A operacao e EXCLUSIVAMENTE de credito consignado CLT (categoria especial na Meta). O UNIVERSO CRIATIVO DA MARCA, por decisao do gestor (31/07/2026), inclui tres temas: credito consignado CLT, EDUCACAO FINANCEIRA e DICAS DE SEGURANCA financeira - pecas desses temas SAO aproveitaveis. Devolve UM objeto JSON para o video inteiro. Campos: produto_detectado (consignado CLT, educacao financeira, seguranca, imovel, consorcio, financiamento, abertura de conta, indeterminado); confianca ("alta"|"media"|"baixa"); quadro_que_sustenta (o numero do quadro, de 1 a ${imagens.length}, que sustenta a conclusao); texto_visivel (transcreva o texto legivel somando os quadros, sem repetir); menciona_taxa_prazo_ou_valor (true/false - materia de compliance de credito) e qual_valor (o trecho, ou vazio); quadros_divergem (true/false - se os quadros contam historias diferentes entre si, o que num video e comum e e informacao valiosa) e o_que_diverge (uma frase, ou vazio); riscos_compliance (promessa de aprovacao, taxa prometida, "garantido", urgencia enganosa, ausencia de ressalva - so o que estiver VISIVEL); aproveitavel: "sim" se e credito CLT, educacao financeira ou seguranca e sem risco visivel, "nao" APENAS se mostra explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente, consorcio, imovel) ou tem risco claro, "incerto" se os quadros nao permitem afirmar; motivo (uma frase). LIMITE REAL: voce ve ${imagens.length} quadros de um video, NAO o video - nao ha audio e o que acontece entre os quadros nao foi visto. "indeterminado" e "incerto" continuam sendo respostas legitimas: com mais evidencia devem ficar mais raros, nao proibidos. Forcar classificacao produz numero bonito e falso. Responda APENAS JSON: {"produto_detectado":"...","confianca":"...","quadro_que_sustenta":1,"texto_visivel":"...","menciona_taxa_prazo_ou_valor":false,"qual_valor":"","quadros_divergem":false,"o_que_diverge":"","riscos_compliance":"","aproveitavel":"sim|nao|incerto","motivo":"..."}` +
        `\nArquivo: ${arq.nome} (pasta: ${arq.caminho})` }];
      for (const im of imagens) content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } });
      const r = await chamarLLM([{ role: "user", content }], { maxTokens: 1500, reasoning: REASONING_OFF, model: MODEL_SUB });
      if (r.erro) continue;
      const it = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? "")) ?? {};
      const aprov = ["sim", "nao", "incerto"].includes(String(it?.aproveitavel)) ? String(it.aproveitavel) : "incerto";
      const extras = [
        it?.confianca ? `confianca: ${it.confianca}` : "",
        it?.quadro_que_sustenta ? `quadro ${it.quadro_que_sustenta} sustenta` : "",
        it?.menciona_taxa_prazo_ou_valor === true ? `MENCIONA VALOR/TAXA/PRAZO: ${String(it?.qual_valor ?? "").slice(0, 80)}` : "",
        it?.quadros_divergem === true ? `QUADROS DIVERGEM: ${String(it?.o_que_diverge ?? "").slice(0, 80)}` : "",
      ].filter(Boolean).join(" · ");
      const { error: eUp } = await supa.from("drive_midia_analises").upsert({
        company_id: ctx.companyId, drive_file_id: String(arq.id ?? arq.nome), drive_modified_time: arq.modificado_em ?? "",
        base_da_analise: base,
        nome: arq.nome, caminho: arq.caminho, formato_pasta: arq.formato_pasta, eixo_pasta: arq.eixo_pasta, mime: arq.tipo,
        produto_detectado: String(it?.produto_detectado ?? "indeterminado").slice(0, 120),
        texto_visivel: String(it?.texto_visivel ?? "").slice(0, 800),
        riscos_compliance: String(it?.riscos_compliance ?? "").slice(0, 400),
        aproveitavel: aprov,
        motivo: `${String(it?.motivo ?? "sem motivo")}${extras ? ` [${extras}]` : ""}`.slice(0, 400),
        modelo: MODEL_SUB, analisado_em: new Date().toISOString(),
      }, { onConflict: "drive_file_id,drive_modified_time,base_da_analise" });
      if (eUp) { falhasGravacao++; continue; }
      analisados++;
    }
  }

  for (let i = 0; !modoMultiquadro && i < fila.length; i += VISAO_LOTE) {
    if (prazo() < VISAO_MIN_PRAZO_MS) break;
    const lote = fila.slice(i, i + VISAO_LOTE);
    const imagens: { arq: any; b64: string; mime: string }[] = [];
    for (const arq of lote) {
      const th = await baixarThumb(String(arq.thumbnail));
      if (th) imagens.push({ arq, b64: th.b64, mime: th.mime }); else falhasThumb++;
    }
    if (!imagens.length) continue;
    const content: any[] = [{ type: "text", text:
      `Voce analisa criativos de anuncio para uma operacao cuja campanha e EXCLUSIVAMENTE de credito consignado CLT (categoria especial de credito na Meta). O UNIVERSO CRIATIVO DA MARCA, por decisao do gestor (31/07/2026), inclui tres temas: credito consignado CLT, EDUCACAO FINANCEIRA e DICAS DE SEGURANCA financeira - pecas educativas e de seguranca SAO aproveitaveis. Para CADA imagem, na ordem, devolva um item JSON. Criterios: produto_detectado (o que a peca vende ou trata, pelo que esta VISIVEL: consignado CLT, educacao financeira, seguranca, imovel, consorcio, financiamento, abertura de conta, indeterminado); texto_visivel (transcreva o texto legivel da peca); riscos_compliance (promessa de aprovacao, taxa prometida, "garantido", urgencia enganosa, ausencia de ressalva de analise - so o que estiver VISIVEL); aproveitavel: "sim" se a peca e de credito CLT, educacao financeira ou dicas de seguranca e sem risco visivel, "nao" APENAS se mostra explicitamente OUTRO produto financeiro (financiamento de veiculo, conta corrente, consorcio, imovel) ou tem risco claro de texto, "incerto" se nao da para afirmar pelo frame. motivo: uma frase. LEMBRE: voce ve UM FRAME/miniatura - se a peca e video, o interior nao foi visto; na duvida, "incerto" e melhor que chute. Responda APENAS JSON: {"itens":[{"nome":"...","produto_detectado":"...","texto_visivel":"...","riscos_compliance":"...","aproveitavel":"sim|nao|incerto","motivo":"..."}]}` + `\nArquivos nesta ordem: ${imagens.map((x) => `${x.arq.nome} (pasta: ${x.arq.caminho})`).join(" | ")}` }];
    for (const im of imagens) content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.b64}` } });
    const r = await chamarLLM([{ role: "user", content }], { maxTokens: 2500, reasoning: REASONING_OFF, model: MODEL_SUB });
    if (r.erro) continue;
    const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
    const itens = Array.isArray(bruto?.itens) ? bruto.itens : [];
    for (let k = 0; k < imagens.length; k++) {
      const arq = imagens[k].arq; const it = itens[k] ?? {};
      const aprov = ["sim", "nao", "incerto"].includes(String(it?.aproveitavel)) ? String(it.aproveitavel) : "incerto";
      const { error: eUp } = await supa.from("drive_midia_analises").upsert({
        company_id: ctx.companyId, drive_file_id: String(arq.id ?? arq.nome), drive_modified_time: arq.modificado_em ?? "",
        base_da_analise: base,
        nome: arq.nome, caminho: arq.caminho, formato_pasta: arq.formato_pasta, eixo_pasta: arq.eixo_pasta, mime: arq.tipo,
        produto_detectado: String(it?.produto_detectado ?? "indeterminado").slice(0, 120),
        texto_visivel: String(it?.texto_visivel ?? "").slice(0, 800),
        riscos_compliance: String(it?.riscos_compliance ?? "").slice(0, 400),
        aproveitavel: aprov, motivo: String(it?.motivo ?? "sem motivo").slice(0, 400),
        modelo: MODEL_SUB, analisado_em: new Date().toISOString(),
        // v2.6: o onConflict TEM de citar as tres colunas da uq_drive_analise. A versao anterior
        // citava (drive_file_id, drive_modified_time) e esse indice de 2 colunas NAO EXISTE MAIS -
        // toda gravacao falharia com 42P10, e o erro era descartado: `analisados++` acontecia de
        // qualquer jeito e a telemetria diria "analisado". Falha silenciosa, achada antes de rodar.
      }, { onConflict: "drive_file_id,drive_modified_time,base_da_analise" });
      if (eUp) { falhasGravacao++; continue; }
      analisados++;
    }
  }

  // relatorio = estado ACUMULADO da tabela (inclui rodadas anteriores) NA BASE DESTA RODADA.
  // v2.6: sem o filtro por base, o relatorio somaria o veredito de 31/07 com o novo e a contagem
  // de cobertura passaria do total - duas leituras da mesma peca nao sao duas pecas.
  const { data: tudo } = await supa.from("drive_midia_analises")
    .select("nome, caminho, formato_pasta, eixo_pasta, produto_detectado, aproveitavel, motivo, riscos_compliance")
    .eq("company_id", ctx.companyId).eq("base_da_analise", base).order("caminho");
  const linhas = (tudo ?? []).map((t2: any) =>
    `- [${t2.aproveitavel.toUpperCase()}] ${t2.caminho}/${t2.nome} | produto: ${t2.produto_detectado} | ${t2.motivo}${t2.riscos_compliance ? " | risco: " + t2.riscos_compliance : ""}`).join("\n");
  const cobertura = (tudo ?? []).length;
  const totalComThumb = arquivos.filter((a: any) => a.thumbnail).length;
  const rel = `ANALISE VISUAL DAS MIDIAS DO DRIVE (persistida em banco; base desta leitura: ${base} - se a base cita "thumbnail", de video se ve UM frame, nunca o interior)\n` +
    `Cobertura acumulada NESTA BASE: ${cobertura} de ${totalComThumb} arquivos com miniatura (${arquivos.length} no inventario; ${semThumb.length} sem miniatura disponivel). Nesta rodada: ${analisados} analisados, ${falhasThumb} miniaturas falharam, ${falhasGravacao} falharam ao gravar.\n` +
    (emBaseMaisRasa ? `${emBaseMaisRasa} peca(s) tem leitura em base mais rasa e estao sendo reavaliadas nesta base - o veredito anterior NAO foi apagado, continua no banco sob a base antiga.\n` : "") +
    `Resumo: SIM=${(tudo ?? []).filter((x: any) => x.aproveitavel === "sim").length} · NAO=${(tudo ?? []).filter((x: any) => x.aproveitavel === "nao").length} · INCERTO=${(tudo ?? []).filter((x: any) => x.aproveitavel === "incerto").length}\n` +
    linhas +
    (cobertura < totalComThumb ? `\nLACUNAS: ${totalComThumb - cobertura} arquivos ainda sem analise (teto por rodada/prazo) - nova rodada continua de onde parou, nada se refaz.` : "\nCobertura completa dos arquivos com miniatura.") +
    (semThumb.length ? `\nSem miniatura (nao analisaveis por visao): ${semThumb.map((x: any) => x.nome).slice(0, 10).join(", ")}${semThumb.length > 10 ? "..." : ""}` : "");
  tel.visao = { base, analisados_nesta_rodada: analisados, cobertura_acumulada: cobertura,
    total: totalComThumb, falhas_thumb: falhasThumb, falhas_gravacao: falhasGravacao,
    candidatas_nesta_base: pendentes.length, em_base_mais_rasa: emBaseMaisRasa,
    ...(modoMultiquadro ? { multiquadro: detalheQuadros, sem_video_id: semVideoId } : {}) };
  return { nome: nomeSub, relatorio: rel.slice(0, 24000), completo: cobertura >= totalComThumb };
}

// ============================================================================
// v2 - VALIDACAO DA COORDENACAO ("a mae"): aprova ou devolve com parecer
// ============================================================================
// A mae nao valida "esta certo" no sentido absoluto - valida criterios VERIFICAVEIS:
// cobriu o foco atribuido? tem numero+fonte+janela? saiu do escopo? termina em LACUNAS?
// Veredito subjetivo de "qualidade" e proibido de proposito: e a receita do loop infinito.
async function validarRelatorios(
  pergunta: string,
  plano: { nome: string; foco: string }[],
  relatorios: { nome: string; relatorio: string; completo: boolean }[],
  tel: any,
): Promise<{ nome: string; motivo: string }[]> {
  const resumo = relatorios.map((r) => {
    const foco = plano.find((p) => p.nome === r.nome)?.foco ?? "";
    return `--- ${r.nome} (foco atribuido: ${foco || "geral"}) [${r.completo ? "COMPLETO" : "INCOMPLETO-cortado"}] ---\n${r.relatorio.slice(0, 3200)}`;
  }).join("\n\n");
  const sys = `Voce e a COORDENACAO de uma equipe de especialistas de trafego pago. Avalie cada relatorio contra CRITERIOS VERIFICAVEIS, nunca contra gosto:
(1) COBERTURA: o relatorio atende o foco que foi atribuido ao especialista? (2) FORMA: numeros vem com fonte e janela, e existe a linha LACUNAS? (3) ESCOPO: ele respondeu o que era de OUTRO especialista em vez do proprio dominio? (4) COERENCIA INTERNA: ha contradicao evidente dentro do proprio relatorio? (5) COBERTURA PAGINAVEL: o relatorio aceitou corte de dados ('X de Y exibidos', 'restantes') SEM esgotar as paginas disponiveis, quando o foco exigia a lista inteira? Isso E motivo de devolucao - a ferramenta pagina e o especialista tinha teto sobrando.
NAO devolva por: estilo, tamanho, relatorio marcado INCOMPLETO-cortado (isso e limite de tamanho, nao erro do especialista), ou lacuna JA DECLARADA na linha LACUNAS (declarar lacuna e comportamento correto).
Responda APENAS JSON valido: {"avaliacoes":[{"nome":"...","veredito":"ok"|"devolver","motivo":"especifico: o que faltou/errou e o que a nova tentativa deve trazer"}]}`;
  const r = await chamarLLM(
    [{ role: "system", content: sys },
     { role: "user", content: `PERGUNTA DO GESTOR:\n${pergunta.slice(0, 4000)}\n\nRELATORIOS:\n${resumo}` }],
    { maxTokens: 1500, reasoning: REASONING_OFF },
  );
  if (r.erro) { tel.validacao = { erro: r.erro, aviso: "validacao indisponivel - relatorios seguem sem devolucao" }; return []; }
  const u = usoDe(r.parsed);
  const bruto = extrairJSON(String(r.parsed?.choices?.[0]?.message?.content ?? ""));
  const lista = Array.isArray(bruto?.avaliacoes) ? bruto.avaliacoes : [];
  const nomesValidos = new Set(relatorios.map((x) => x.nome));
  const devolver = lista
    .filter((a: any) => String(a?.veredito ?? "") === "devolver" && nomesValidos.has(String(a?.nome ?? "")))
    .map((a: any) => ({ nome: String(a.nome), motivo: String(a?.motivo ?? "sem motivo declarado").slice(0, 500) }));
  tel.validacao = { tokens_in: u.tin, tokens_out: u.tout, devolvidos: devolver.map((d: any) => d.nome) };
  return devolver;
}

// ============================================================================
// O JOB (roda em background via EdgeRuntime.waitUntil)
// ============================================================================
async function pushProgresso(jobId: string, fase: string, detalhe: string) {
  const { data } = await supa.from("chat_jobs").select("progresso").eq("id", jobId).maybeSingle();
  const arr = Array.isArray(data?.progresso) ? data!.progresso : [];
  arr.push({ fase, detalhe, em: new Date().toISOString() });
  await supa.from("chat_jobs").update({ progresso: arr }).eq("id", jobId);
}

// v2: helpers de lote, checkpoint e reinvocacao ------------------------------
async function executarLote(
  lote: { nome: string; foco: string }[], pergunta: string,
  ctx: { companyId: string; companyName: string; mcpKey: string }, prazo: () => number, tel: any,
): Promise<{ nome: string; relatorio: string; completo: boolean }[]> {
  const resultados = await Promise.allSettled(lote.map((p) =>
    p.nome === "analise_visual_drive"
      ? rodarAnaliseVisual(p.foco, ctx, prazo, tel)
      : rodarSubagente(p.nome, p.foco, pergunta, ctx, prazo)));
  const saida: { nome: string; relatorio: string; completo: boolean }[] = [];
  for (let i = 0; i < resultados.length; i++) {
    const res = resultados[i];
    if (res.status === "fulfilled") {
      saida.push({ nome: res.value.nome, relatorio: res.value.relatorio, completo: res.value.completo });
      // rodarAnaliseVisual devolve so { nome, relatorio, completo }; rodarSubagente
      // devolve tambem tools/tokens/finish/partes. Acessar os campos de token no
      // primeiro caso gravava undefined em silencio na telemetria - agora a ausencia
      // e declarada no tipo e o campo simplesmente nao entra no registro.
      const t = res.value as Partial<{
        tools: unknown; tokens_in: number; tokens_out: number;
        reasoning_tokens: number; finish: string; partes: number;
      }>;
      tel.subagentes.push({
        nome: res.value.nome, relatorio_completo: res.value.completo,
        ...(t.tools !== undefined ? { tools: t.tools } : {}),
        ...(t.tokens_in !== undefined ? { tokens_in: t.tokens_in } : {}),
        ...(t.tokens_out !== undefined ? { tokens_out: t.tokens_out } : {}),
        ...(t.reasoning_tokens !== undefined ? { reasoning_tokens: t.reasoning_tokens } : {}),
        ...(t.finish !== undefined ? { finish: t.finish } : {}),
        ...(t.partes !== undefined ? { partes_relatorio: t.partes } : {}),
      });
    } else {
      saida.push({ nome: lote[i].nome, relatorio: `(especialista falhou: ${String(res.reason).slice(0, 200)} - trate como LACUNA)`, completo: false });
      tel.subagentes.push({ nome: lote[i].nome, erro: String(res.reason).slice(0, 200), relatorio_completo: false });
    }
  }
  return saida;
}

async function gravarCheckpointEReinvocar(
  jobId: string, convId: string, companyId: string, mcpKey: string,
  cp: { pergunta: string; plano: any[]; relatorios: any[]; devolver: any[]; rodada: number; tel_parcial: any; segmento: number; direto_para_sintese?: boolean },
) {
  await supa.from("chat_jobs").update({
    checkpoint: cp, segmento: cp.segmento,
    status: "running",
  }).eq("id", jobId);
  await pushProgresso(jobId, "segmento", `prazo do worker esgotando: continuando no segmento ${cp.segmento} de ${MAX_SEGMENTOS} (nada sera re-pensado)`);
  // Reinvoca a PROPRIA edge. fire-and-forget: se o POST falhar, o watchdog adota o orfao.
  await fetch(`${SUPABASE_URL}/functions/v1/traffic-agent-job`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mcp-key": mcpKey },
    body: JSON.stringify({ continuar: true, job_id: jobId }),
  }).then(() => {}, () => {});
}

async function processarJob(jobId: string, convId: string, companyId: string, pergunta: string, mcpKey: string, retomada?: any) {
  const t0 = Date.now();
  const prazo = () => JOB_LIMIT_MS - (Date.now() - t0) - RESERVA_FINAL_MS;
  const segmento: number = Number(retomada?.segmento ?? 1);
  const cap = classificarCapacidade(pergunta);
  const tel: any = retomada?.tel_parcial ?? { versao: "job-v3.6", subagentes: [] };
  tel.versao = "job-v3.6";
  tel.capacidade = { tier: cap.tier, motivo: cap.motivo, max_especialistas: cap.maxEspecialistas, devolucoes_max: cap.devolucoesMax };
  // Compat: telemetria antiga lia perfil_fast
  if (cap.tier === "lite") { tel.perfil_fast = true; tel.perfil_fast_motivo = cap.motivo; }
  try {
    const { data: companyRow } = await supa.from("companies").select("name").eq("id", companyId).maybeSingle();
    const companyName = String(companyRow?.name ?? "").trim();
    if (!companyName) throw new Error("empresa_do_job_nao_encontrada");
    await supa.from("chat_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

    // v2: RETOMADA DE CHECKPOINT - pula direto para o ponto onde o segmento anterior parou.
    // lite nunca grava checkpoint; retomada so ocorre em standard/deep.
    if (retomada) {
      await pushProgresso(jobId, "segmento", `segmento ${segmento}: retomando do checkpoint`);
      const { data: styleRows0 } = await supa.from("agent_style").select("secao,regra").eq("vigente", true).order("ordem");
      const estilo0 = (styleRows0 ?? []).map((r: any) => `- [${String(r.secao).toUpperCase()}] ${r.regra}`).join("\n") || "(sem regras cadastradas)";
      const { data: ctxRows0 } = await supa.from("agent_context").select("categoria,fato,desde").eq("vigente", true)
        .or(`company_id.is.null,company_id.eq.${companyId}`).order("categoria");
      const memoria0 = (ctxRows0 ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n") || "(sem fatos registrados)";
      let relatorios: { nome: string; relatorio: string; completo: boolean }[] = retomada.relatorios ?? [];
      const plano: { nome: string; foco: string }[] = retomada.plano ?? [];
      let rodada: number = Number(retomada.rodada ?? 0);
      const devolucoesCap = cap.devolucoesMax;
      // devolucoes pendentes deste checkpoint (ja com parecer da coordenacao anexavel)
      if (!retomada.direto_para_sintese && Array.isArray(retomada.devolver) && retomada.devolver.length) {
        await pushProgresso(jobId, "subagentes", `reexecutando: ${retomada.devolver.map((d: any) => d.nome).join(", ")}`);
        const refeitos = await executarLote(
          retomada.devolver.map((d: any) => ({ nome: String(d.nome),
            foco: `${plano.find((p) => p.nome === d.nome)?.foco ?? ""}\n\nDEVOLUCAO DA COORDENACAO (rodada ${rodada}): seu relatorio anterior foi recusado. Motivo: ${String(d.motivo)}\nCorrija exatamente isso.` })),
          pergunta, { companyId, companyName, mcpKey }, prazo, tel,
        );
        for (const novo of refeitos) {
          const i = relatorios.findIndex((r) => r.nome === novo.nome);
          if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
        }
        // uma re-validacao final se ainda ha rodadas e prazo
        while (rodada < devolucoesCap) {
          const devolver2 = await validarRelatorios(pergunta, plano, relatorios, tel);
          if (!devolver2.length) break;
          rodada++;
          if (cap.permitirCheckpoint && prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
            await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
              pergunta, plano, relatorios, devolver: devolver2, rodada, tel_parcial: tel, segmento: segmento + 1 });
            return;
          }
          await pushProgresso(jobId, "subagentes", `reexecutando: ${devolver2.map((d) => d.nome).join(", ")}`);
          const refeitos2 = await executarLote(
            devolver2.map((d) => ({ nome: d.nome, foco: `DEVOLUCAO DA COORDENACAO (rodada ${rodada}): ${d.motivo}. Corrija exatamente isso.` })),
            pergunta, { companyId, companyName, mcpKey }, prazo, tel,
          );
          for (const novo of refeitos2) {
            const i = relatorios.findIndex((r) => r.nome === novo.nome);
            if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
          }
        }
      }
      tel.rodadas_devolucao = rodada;
      tel.segmento = segmento;
      await pushProgresso(jobId, "sintese", "escrevendo a resposta final");
      const texto0 = await sintetizar(companyName, pergunta, relatorios, estilo0, memoria0, prazo, tel, {
        timeoutMs: cap.openRouterTimeoutMs,
      });
      if (!String(texto0 ?? "").trim()) {
        throw new Error(`sintese_vazia (${tel.sintese?.finish_reason ?? "sem_finish"})`);
      }
      tel.ms_total = Date.now() - t0;
      const finishSint0 = tel.sintese?.finish_reason ?? "stop";
      await supa.from("chat_messages").insert({
        conversation_id: convId, company_id: companyId, role: "assistant", content: texto0, model: MODEL,
        tokens_in: tel.subagentes.reduce((a: number, s2: any) => a + (s2.tokens_in ?? 0), 0) + (tel.sintese?.tokens_in ?? 0),
        tokens_out: tel.subagentes.reduce((a: number, s2: any) => a + (s2.tokens_out ?? 0), 0) + (tel.sintese?.tokens_out ?? 0),
        diagnostico: { ...tel, finish_reason: finishSint0, origem: "traffic-agent-job" },
      });
      await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      await supa.from("chat_jobs").update({ status: "done", finished_at: new Date().toISOString(), diagnostico: tel, checkpoint: null }).eq("id", jobId);
      return;
    }

    // Contexto institucional (mesmas fontes do chat)
    const { data: ctxRows } = await supa.from("agent_context")
      .select("categoria,fato,desde").eq("vigente", true)
      .or(`company_id.is.null,company_id.eq.${companyId}`).order("categoria");
    const memoria = (ctxRows ?? []).length
      ? (ctxRows ?? []).map((r: any) => `- [${String(r.categoria).toUpperCase()}${r.desde ? " " + String(r.desde) : ""}] ${r.fato}`).join("\n")
      : "(sem fatos registrados)";
    const { data: styleRows } = await supa.from("agent_style").select("secao,regra").eq("vigente", true).order("ordem");
    const estilo = (styleRows ?? []).length
      ? (styleRows ?? []).map((r: any) => `- [${String(r.secao).toUpperCase()}] ${r.regra}`).join("\n")
      : "(sem regras cadastradas)";

    // FASE 1 - planner
    const rotuloTier = cap.tier === "lite" ? "leve" : cap.tier === "deep" ? "profunda" : "padrao";
    await pushProgresso(jobId, "planner", `capacidade ${rotuloTier} (${cap.motivo}): escolhendo especialistas`);
    const { plano, degradado } = await planejar(pergunta, tel, cap);
    tel.plano = plano.map((p) => p.nome);
    tel.planner_degradado = degradado;
    await pushProgresso(jobId, "planner", `especialistas: ${plano.map((p) => p.nome).join(", ")}${degradado ? " (plano padrao - planejador nao devolveu JSON valido)" : ""} [${cap.tier}]`);

    // FASE 2 - subagentes em paralelo
    await pushProgresso(jobId, "subagentes", `executando ${plano.length} em paralelo`);
    let relatorios = await executarLote(plano, pergunta, { companyId, companyName, mcpKey }, prazo, tel);
    await pushProgresso(jobId, "subagentes", "relatorios prontos");

    // FASE 2.5 - VALIDACAO + DEVOLUCAO (escala com o tier)
    let rodada = 0;
    const falhosDefinitivos: string[] = [];
    if (cap.devolucoesMax > 0) {
      while (rodada < cap.devolucoesMax) {
        const devolver = await validarRelatorios(pergunta, plano, relatorios, tel);
        if (!devolver.length) break;
        rodada++;
        await pushProgresso(jobId, "devolucao", `rodada ${rodada}: ${devolver.map((d) => d.nome).join(", ")}`);
        if (cap.permitirCheckpoint && prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
          await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
            pergunta, plano, relatorios, devolver, rodada, tel_parcial: tel, segmento: segmento + 1 });
          return;
        }
        await pushProgresso(jobId, "subagentes", `reexecutando: ${devolver.map((d) => d.nome).join(", ")}`);
        const refeitos = await executarLote(
          devolver.map((d) => ({ nome: d.nome,
            foco: `${plano.find((p) => p.nome === d.nome)?.foco ?? ""}\n\nDEVOLUCAO DA COORDENACAO (rodada ${rodada}): seu relatorio anterior foi recusado. Motivo: ${d.motivo}\nCorrija exatamente isso; o que ja estava certo nao precisa ser repetido do zero.` })),
          pergunta, { companyId, companyName, mcpKey }, prazo, tel,
        );
        for (const novo of refeitos) {
          const i = relatorios.findIndex((r) => r.nome === novo.nome);
          if (i >= 0) relatorios[i] = novo; else relatorios.push(novo);
        }
        if (rodada >= cap.devolucoesMax) {
          for (const d of devolver) if (!falhosDefinitivos.includes(d.nome)) falhosDefinitivos.push(d.nome);
        }
      }
    } else {
      tel.devolucao_pulada = `capacidade_${cap.tier}`;
      await pushProgresso(jobId, "subagentes", `capacidade ${rotuloTier}: seguindo direto para a resposta (sem devolucao)`);
    }
    if (falhosDefinitivos.length) {
      tel.devolucao_esgotada = falhosDefinitivos;
      for (const nome of falhosDefinitivos) {
        const i = relatorios.findIndex((r) => r.nome === nome);
        if (i >= 0) relatorios[i] = { ...relatorios[i], relatorio: `[RELATORIO COM DEVOLUCAO ESGOTADA - a coordenacao recusou ${cap.devolucoesMax}x; use com reserva e declare a limitacao]\n` + relatorios[i].relatorio };
      }
    }
    tel.rodadas_devolucao = rodada;
    tel.segmento = segmento;

    // Checkpoint/segmentos so em tiers que permitem (lite nunca)
    if (cap.permitirCheckpoint && prazo() < CHECKPOINT_MIN_MS && segmento < MAX_SEGMENTOS) {
      await gravarCheckpointEReinvocar(jobId, convId, companyId, mcpKey, {
        pergunta, plano, relatorios, devolver: [], rodada, tel_parcial: tel, segmento: segmento + 1, direto_para_sintese: true });
      return;
    }

    // FASE 3 - sintese
    await pushProgresso(jobId, "sintese", "escrevendo a resposta final");
    const texto = await sintetizar(companyName, pergunta, relatorios, estilo, memoria, prazo, tel, {
      timeoutMs: cap.openRouterTimeoutMs,
    });
    if (!String(texto ?? "").trim()) {
      throw new Error(`sintese_vazia (${tel.sintese?.finish_reason ?? "sem_finish"})`);
    }

    tel.ms_total = Date.now() - t0;
    const finishSint = tel.sintese?.finish_reason ?? "stop";
    await supa.from("chat_messages").insert({
      conversation_id: convId, company_id: companyId, role: "assistant", content: texto, model: MODEL,
      tokens_in: (tel.planner?.tokens_in ?? 0) + tel.subagentes.reduce((a: number, s: any) => a + (s.tokens_in ?? 0), 0) + (tel.sintese?.tokens_in ?? 0),
      tokens_out: (tel.planner?.tokens_out ?? 0) + tel.subagentes.reduce((a: number, s: any) => a + (s.tokens_out ?? 0), 0) + (tel.sintese?.tokens_out ?? 0),
      diagnostico: { ...tel, finish_reason: finishSint, origem: "traffic-agent-job" },
    });
    await supa.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    await supa.from("chat_jobs").update({ status: "done", finished_at: new Date().toISOString(), diagnostico: tel }).eq("id", jobId);
  } catch (e) {
    const erro = String((e as any)?.message ?? e).slice(0, 500);
    tel.ms_total = Date.now() - t0;
    // Degradar com aviso, nunca em silencio: o gestor recebe uma mensagem, nao um vacuo.
    await supa.from("chat_messages").insert({
      conversation_id: convId, company_id: companyId, role: "assistant",
      content: "O processamento em segundo plano falhou antes de concluir. Tente de novo; se repetir, o problema esta registrado para o suporte tecnico.",
      model: MODEL, diagnostico: { ...tel, erro, origem: "traffic-agent-job", finish_reason: "erro_job" },
    }).then(() => {}, () => {});
    await supa.from("chat_jobs").update({ status: "error", erro, finished_at: new Date().toISOString(), diagnostico: tel }).eq("id", jobId);
  }
}

// ============================================================================
// HANDLER - responde rapido, processa depois.
// ============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENROUTER_KEY) return json({ error: "missing_openrouter_key" }, 500);

  const xKey = (req.headers.get("x-mcp-key") ?? "").trim();
  const bearer = bearerDe(req);
  let userId: string | null = null, authed = false;
  if (xKey) {
    const v = await mcpKeyValida(supa, xKey);
    if (!v.ok) return json({ error: "unauthorized", motivo: v.motivo }, 401);
    authed = true;
  } else if (bearer) {
    const { data: u } = await supa.auth.getUser(bearer);
    if (u?.user) { authed = true; userId = u.user.id; }
    else {
      const v = await mcpKeyValida(supa, bearer);
      if (v.ok) authed = true;
    }
  }
  if (!authed) return json({ error: "unauthorized" }, 401);
  const { data: cfg } = await supa.from("mcp_config").select("api_key").eq("id", 1).maybeSingle();

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  // v2.5 (04/08/2026) - MODO VIGIA DO DRIVE: {"modo":"drive_watch","company_id":"..."}.
  // Existe para o cron ter o que chamar. Roda SO a varredura das pastas monitoradas e a visao
  // nas pecas novas - sem PLANNER, sem subagentes, sem sintese, portanto sem nenhuma chamada de
  // LLM de raciocinio: o custo e a visao nas pecas que mudaram, e zero quando nada mudou.
  // Modo em vez de edge nova pelo mesmo motivo do GT-09: acrescentar caminho a algo que ja sabe
  // baixar e analisar e mais barato que uma segunda edge competindo pela mesma tabela.
  // O retorno NUNCA e silencioso: "0 pecas novas em N pastas" e resposta, silencio seria
  // indistinguivel de falha - e essa distincao e o que ultima_varredura_em existe para preservar.
  if (String(body?.modo ?? "") === "drive_watch") {
    const companyId = String(body?.company_id ?? "").trim();
    if (!companyId) return json({ error: "drive_watch exige company_id - a RPC do plano e por empresa e a pasta de uma empresa nao pode ser lida sob outra" }, 400);
    const tw = Date.now();
    const prazoW = () => JOB_LIMIT_MS - (Date.now() - tw) - RESERVA_FINAL_MS;
    const telW: any = {};
    // v2.6: base e recorte pelo body. Default 'thumbnail' para o cron das 08:45 nao regredir.
    const baseW = String(body?.base_da_analise ?? BASE_PADRAO).trim() || BASE_PADRAO;
    const nomesW: string[] = Array.isArray(body?.somente_nomes) ? body.somente_nomes.map((x: unknown) => String(x)) : [];
    const opts: OpcoesVisao = {
      base: baseW,
      somenteNomes: nomesW.length ? nomesW : undefined,
      limite: body?.limite !== undefined ? Number(body.limite) : undefined,
      somenteImagens: body?.somente_imagens === true,
    };
    const { data: planoW } = await supa.rpc("drive_plano_de_varredura", { p_company_id: companyId, p_base_desejada: baseW });
    const nPastas = Array.isArray((planoW as any)?.pastas_ativas) ? (planoW as any).pastas_ativas.length : 0;
    const nDesativadas = Array.isArray((planoW as any)?.pastas_desativadas) ? (planoW as any).pastas_desativadas.length : 0;
    // v2.7: mcpKey vai no ctx porque o caminho multiquadro precisa chamar a upload-midia (que tem o
    // token da Meta). Este job nao tem META_ADS_TOKEN e nao deve ter - um segredo, um dono.
    const r = await rodarAnaliseVisual("varredura automatica do Drive",
      { companyId, mcpKey: String(cfg?.api_key ?? "") }, prazoW, telW, opts);
    const v = telW.visao ?? { analisados_nesta_rodada: 0, cobertura_acumulada: null, total: null, falhas_thumb: 0, falhas_gravacao: 0 };
    return json({ ok: true, modo: "drive_watch", versao: "job-v2.9",
      base_da_analise: baseW, recorte: { somente_imagens: !!opts.somenteImagens, somente_nomes: nomesW, limite: opts.limite ?? null },
      pastas_ativas: nPastas, pastas_desativadas: nDesativadas,
      pecas_novas_analisadas: v.analisados_nesta_rodada,
      cobertura_acumulada: v.cobertura_acumulada, total_com_miniatura: v.total,
      miniaturas_que_falharam: v.falhas_thumb, falhas_ao_gravar: v.falhas_gravacao ?? 0,
      candidatas_nesta_base: v.candidatas_nesta_base ?? null, em_base_mais_rasa: v.em_base_mais_rasa ?? null,
      // v2.8: o detalhe do filtro de peso sai NO RETORNO. Na corrida de 5 videos eu tive de
      // reconstruir esses numeros chamando a thumbnails de novo - numa corrida grande isso nao
      // escala, e numero que precisa ser reconstruido e numero que ninguem confere.
      multiquadro: v.multiquadro ?? null,
      sem_video_id: v.sem_video_id ?? null,
      completo: (r as any)?.completo ?? null,
      resumo: `${v.analisados_nesta_rodada} peca(s) analisada(s) na base '${baseW}' em ${nPastas} pasta(s) monitorada(s)` +
        (nDesativadas ? ` (${nDesativadas} pasta(s) desativada(s) NAO foram lidas)` : "") +
        ((v.falhas_gravacao ?? 0) > 0 ? ` - ATENCAO: ${v.falhas_gravacao} falha(s) ao GRAVAR, o veredito foi produzido e nao persistiu` : "") +
        (v.analisados_nesta_rodada === 0 ? " - nada a analisar nesta base, o que NAO e falha" : ""),
      duracao_ms: Date.now() - tw });
  }

  // v2: CONTINUACAO DE SEGMENTO - a propria edge se reinvoca com o job_id; o novo worker
  // le o checkpoint do banco e retoma do ponto exato, com orcamento de tempo zerado.
  if (body?.continuar === true && body?.job_id) {
    const { data: job } = await supa.from("chat_jobs")
      .select("id, conversation_id, company_id, message, status, checkpoint, segmento")
      .eq("id", String(body.job_id)).maybeSingle();
    if (!job) return json({ error: "job nao encontrado" }, 404);
    if (job.status === "done" || job.status === "error") return json({ ok: true, aviso: "job ja finalizado - nada a continuar" }, 200);
    if (!job.checkpoint) return json({ error: "job sem checkpoint - nada a retomar" }, 400);
    if (Number(job.segmento ?? 1) > MAX_SEGMENTOS) return json({ error: "teto de segmentos atingido" }, 400);
    const cp = job.checkpoint as any;
    // limpa o checkpoint consumido ANTES de processar: reentrega duplicada nao reprocessa
    await supa.from("chat_jobs").update({ checkpoint: null }).eq("id", job.id);
    (globalThis as any).EdgeRuntime?.waitUntil
      ? (globalThis as any).EdgeRuntime.waitUntil(processarJob(job.id, job.conversation_id, job.company_id, String(job.message ?? cp.pergunta ?? ""), cfg?.api_key ?? "", cp))
      : processarJob(job.id, job.conversation_id, job.company_id, String(job.message ?? cp.pergunta ?? ""), cfg?.api_key ?? "", cp);
    return json({ ok: true, async: true, job_id: job.id, segmento: cp.segmento, aviso: "segmento retomado do checkpoint" }, 202);
  }

  const message = String(body?.message ?? "").trim();
  if (!message) return json({ error: "message obrigatorio" }, 400);

  const company = await resolveCompany(body?.company ? String(body.company) : undefined);
  if (!company) return json({ error: "empresa nao encontrada" }, 400);

  let convId: string | null = body?.conversation_id ?? null;
  if (convId) {
    const { data: conv } = await supa.from("chat_conversations").select("id,company_id").eq("id", convId).maybeSingle();
    if (!conv) convId = null;
    else if (String(conv.company_id) !== company.id) {
      return json({ error: "conversation_company_mismatch" }, 409);
    }
  }
  if (!convId) {
    const { data: conv, error: ce } = await supa.from("chat_conversations")
      .insert({ company_id: company.id, title: message.slice(0, 60), kind: "chat", created_by: userId })
      .select("id").single();
    if (ce) return json({ error: "conv_create_failed", detail: ce.message }, 500);
    convId = conv.id;
  }

  await supa.from("chat_messages").insert({ conversation_id: convId, company_id: company.id, role: "user", content: message, user_id: userId });

  const { data: job, error: je } = await supa.from("chat_jobs")
    .insert({ conversation_id: convId, company_id: company.id, user_id: userId, message, status: "queued" })
    .select("id").single();
  if (je) return json({ error: "job_create_failed", detail: je.message }, 500);

  // O ponto que remove o teto de 150s: responde JA e continua em background.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil
    ? (globalThis as any).EdgeRuntime.waitUntil(processarJob(job.id, convId!, company.id, message, cfg?.api_key ?? ""))
    : processarJob(job.id, convId!, company.id, message, cfg?.api_key ?? "");

  return json({ ok: true, async: true, job_id: job.id, conversation_id: convId,
    aviso: "processando em segundo plano; a resposta chega na conversa (Realtime) e o ciclo de vida esta em chat_jobs" }, 202);
});
