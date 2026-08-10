// supabase/functions/meta-actions/index.ts (v5.5)
// v5.5 (07/08/2026) - ABO DE VERDADE PELO PIPEBOARD. O gestor decidiu o regime: ABO (campanha SEM
//   orcamento, dinheiro em cada conjunto). Ate aqui montarCriacao montava ABO "por construcao"
//   (corpo sem orcamento), mas o conector Pipeboard INJETAVA daily_budget=1000, e TODA campanha
//   criada pelo Pipeboard nascia CBO - foi o que aconteceu com a NOVA-01 (120254323578040191).
//   DESCOBERTA (sonda tools/list do Pipeboard + teste descartavel controlado, 07/08): o
//   create_campaign do conector tem um parametro DEDICADO, use_adset_level_budgets (boolean,
//   default false). EXPERIMENTO, mesmo caminho de codigo, so o flag mudando:
//   [TESTE-ABO-DESCARTAR-01] com use_adset_level_budgets=true -> Graph SEM daily_budget (o conector
//   respondeu budget_strategy=ad_set_level); [TESTE-ABO-DESCARTAR-02] com false -> Graph
//   daily_budget=1000. As duas campanhas foram apagadas (effective_status=DELETED). Conserto:
//   (1) criar_campanha aceita regime_orcamento no pedido; ABO (default) manda
//       use_adset_level_budgets=true e nenhum orcamento de campanha; regime != 'abo' RECUSA por
//       nome (regime_orcamento_nao_suportado), e o contrato recusa o MESMO no validador
//       (contrato_de_execucao.valores_aceitos=['abo']) para preservar a PO-17.
//   (2) o flag e do CONECTOR: escreverCriacao o remove antes de qualquer POST direto na Graph.
//   (3) a sonda de reconciliacao passa a provar a captura da injecao: a conferencia "limpa" de
//       campanha usa TESTE-A (ABO real na Graph), e um caso novo usa a NOVA-01 (ABO pedida, R$10
//       injetado) exigindo divergencia - antes a v41 usava a propria NOVA-01 como caso "conferido".
// v5.4 (07/08/2026) - TRES DEFEITOS DA MESMA FAMILIA: o sistema sabia da falha e nao contava.
//   (1) FALHA INVISIVEL NO CARD. Card b5e2f338: aprovado 20:55:58, create_adset recusado pelo
//       Pipeboard 20:56:01 por conflito de orcamento, e o card ficou status=approved /
//       executed_at=NULL / execution_result=NULL. get_aprovacoes leu esse estado e devolveu
//       "aprovado, ainda NAO executado"; o agente completou a lacuna e disse ao gestor "aguarde
//       alguns instantes, o conjunto esta sendo criado". A falha so existia no audit_log.
//       Agora TODA saida por meta_action_failed/meta_action_blocked marca approval_requests
//       .ultima_falha - com nome da recusa, motivo em linguagem de gestor, tentativa e se o card
//       segue re-executavel. A marcacao esta pendurada em audit(), nao em cada `continue`: sao 12
//       saidas nos dois caminhos, e marcar uma a uma garante que a proxima nasca invisivel.
//       executed_at NAO mudou de significado - continua sendo "a escrita terminou e o card esta
//       fechado", que e do que dependem a varredura (executed_at is null) e o fechamento apos
//       escrita PARCIAL. ultima_falha e eixo novo, ortogonal, e some no sucesso.
//   (2) CBO x ABO RECUSA ANTES DE CHAMAR A META. Mesmo padrao do gate de Dynamic Creative da
//       v5.2: le o orcamento da campanha PAI e recusa por nome (campanha_usa_orcamento_proprio_cbo)
//       em vez de descobrir pelo texto de erro da plataforma depois de gastar a aprovacao do
//       gestor. Falha de leitura recusa - nao ha default seguro entre "a campanha manda no
//       dinheiro" e "o conjunto manda no dinheiro". contrato_de_estado_execucao fecha o outro
//       lado, entao o card nem chega a aprovacao.
//   (3) A CAMPANHA NASCEU DIFERENTE DO PEDIDO E A CONFERENCIA NAO OLHAVA. MEDIDO: o corpo enviado
//       em create_campaign nao tinha daily_budget nem bid_strategy; a Graph devolve, para
//       120254323578040191, daily_budget=1000 (R$ 10,00/dia) e bid_strategy=
//       LOWEST_COST_WITHOUT_CAP. As campanhas TESTE-A/B/C foram criadas com o MESMO corpo -
//       inclusive is_adset_budget_sharing_enabled "false" - porem pelo driver GRAPH, e estao sem
//       orcamento. A unica variavel e o DRIVER: o conector Pipeboard INJETA orcamento de campanha
//       quando create_campaign nao traz um. O erro do Pipeboard estava certo; a campanha e CBO de
//       verdade, e ninguem pediu isso. A reconciliacao de campanha passa a pedir daily_budget/
//       lifetime_budget e a tratar CAMPO NAO PEDIDO QUE VOLTOU COM VALOR como divergencia
//       (exigir_ausentes) - antes o comparador so olhava campo presente no pedido, e o pedido era
//       vazio justamente ali. O espelho tambem para de gravar o literal daily_budget=0, que era um
//       palpite ("ABO: orcamento vive no conjunto") apresentado como fato e que ficou dias dizendo
//       o contrario da Meta.
// v5.3 (07/08/2026) - A CONFERENCIA POS-ESCRITA ESTAVA CONFERINDO O NIVEL ERRADO, E CHAMAVA
//   CEGUEIRA DE DIVERGENCIA. Dois defeitos, um em cima do outro.
//   (1) CAMPOS POR NIVEL. reconciliarAposEscrita tinha um parametro `campos` com default fixo -
//       "id,name,status,effective_status,adset_id,creative{id}", a lista DO ANUNCIO - e a unica
//       chamada existente nunca passava nada. Campanha e conjunto eram lidos pedindo adset_id e
//       creative{id}. A Graph NAO ignora campo inexistente: ela derruba a consulta INTEIRA com
//       OAuthException #100. A lista agora vem de nivelDaAcao(); nao existe mais default global,
//       e acao sem nivel mapeado FALHA DECLARANDO em vez de adivinhar lista.
//       PRECEDENTE: GT-12, quando pedir url_tags no nivel de anuncio derrubou a coleta completa
//       com o mesmo #100. A licao ficou na coleta e nao chegou na reconciliacao. Pior: o default
//       do anuncio foi escrito na manha de 07/08 para consertar exatamente esse #100 no anuncio -
//       consertou um nivel e quebrou os outros dois. Por isso a correcao e derivar do tipo, nao
//       trocar o palpite. O PEDIDO comparado tambem passou a ser por nivel (pedidoDeReconciliacao):
//       objective num conjunto ou daily_budget num anuncio e o mesmo defeito pelo outro lado.
//       daily_budget compara por NUMERO (centavos nos dois lados; texto faria 7200 divergir de
//       "7200.0").
//   (2) FALHA DE LEITURA != DIVERGENCIA. Corpo com `error` ou HTTP != 200 nao autoriza nenhuma
//       conclusao sobre o objeto, e era exatamente isso que acontecia: o `lido` virava envelope de
//       erro, o comparador lia name=null e anunciava divergencia. Agora ha estado explicito
//       (conferido | leitura_falhou | nivel_desconhecido) e DUAS acoes de audit_log:
//       meta_action_reconciliacao_falhou = nao consegui olhar;
//       meta_action_reconciliacao_divergente = olhei e a Meta tem outro valor.
//       Mesma distincao que o resto do sistema ja faz (UNKNOWN != NULL, coletor parado != conta sem
//       entrega). execution_result e o resultado devolvido carregam o estado, nao so um ok.
//   EVIDENCIA MEDIDA que motivou a versao: campanha 120254323578040191
//   ([LEV][LP][LEADS][CLT][NOVA-01][AGO26]), criada com sucesso via Pipeboard e PAUSED na Meta,
//   gerou meta_action_reconciliacao_divergente as 20:03:59Z com
//   divergencias: ["name: pediu=[LEV][LP][LEADS][CLT][NOVA-01][AGO26] graph=null"] e
//   objeto_criado: {"error":{"code":100,"message":"(#100) Tried accessing nonexisting field
//   (adset_id)"}}. As 17:16:45Z o anuncio 120254319507370191 tinha caido igual, com
//   "nonexisting field (daily_budget)". A campanha e o anuncio estavam CERTOS; a conferencia e que
//   estava quebrada. Os dois falsos positivos permanecem no audit_log como historia.
//   O MESMO DEFEITO existia no caminho v1 (modificar existente), que lia
//   "name,status,effective_status,daily_budget" para qualquer alvo - #100 garantido em
//   pausar_criativo (nivel de anuncio). Corrigido junto: consertar so a metade de cima deixaria a
//   de baixo para a proxima execucao real descobrir, que e como este bug chegou aqui.
//   modo=sonda_reconciliacao: bateria SO DE LEITURA sobre objetos que ja existem, exercitando o
//   mesmo reconciliarAposEscrita nos tres niveis, com teste negativo (divergencia real ainda
//   dispara) e casos de falha de leitura. Ela nao emite alarme de verdade - declara o que o
//   executor emitiria. Sem ela, provar a reconciliacao custava criar objeto na Meta.
// v5.2 (07/08/2026) - DESTINO DYNAMIC CREATIVE RECUSA ANTES DE QUALQUER ESCRITA. A Graph nao
//   aceita create_ad avulso em adset com is_dynamic_creative=true. Antes, montarCriacao criava o
//   adcreative e so descobria isso no POST /ads, deixando creative orfao. Agora le o conjunto
//   destino primeiro e recusa por nome; contrato/pedido fecham o card antes da aprovacao.
// v5.1 (07/08/2026) - CARROSSEL E FOTO PARAM DE FALHAR EM SILENCIO. montarCriacao ignorava
//   child_attachments e meta_image_hash: o pedido caia no ramo de replicacao pura e a Meta
//   publicava o criativo do MOLDE. O gestor aprovava "sobe o carrossel novo", a peca antiga ia
//   ao ar, o dinheiro saia. Era o oposto da rota de video, que desde a v4.4 recusa com nome.
//   Agora os dois campos recusam por nome (carrossel_nao_suportado / foto_nao_suportada) antes
//   de ler o molde. O contrato fecha o outro lado (contrato_de_execucao.suportado=false), entao
//   o card nem chega a aprovacao - este gate e o ULTIMO, nao o unico.
// v5 (06/08/2026) - DRIVER DE ESCRITA Pipeboard. So o ULTIMO passo muda.
//   driver_escrita vem de meta_execution_config (o mesmo campo que pode_executar_acao devolve).
//   Default e 'graph': com ele o comportamento das chamadas Meta permanece o de hoje.
//   'pipeboard' chama o MCP hospedado (tools/call), NUNCA com access_token preenchido.
//   dry_run nativo do conector so existe em create_campaign/update_campaign — nos demais
//   niveis o dry_run local continua e o card declara a lacuna. Depois de escrita real,
//   reconciliacao pela Graph e obrigatoria (o Pipeboard nao expoe log exportavel).
//   Monitor de token_status da conexao (login pessoal) entra em toda corrida com token.
//   Nenhuma action_flag e ligada por este card.
// v4.4 (04/08/2026) - GT-13: a executora aceita PECA NOVA. criar_anuncio_a_partir_de passa a ler
//   payload.meta_video_id e, quando ele existe, COPIA o object_story_spec do molde e TROCA a
//   midia (video_id + capa), em vez de replicar o criativo inteiro. Duas coisas sao inegociaveis
//   neste caminho: (1) a capa e OBRIGATORIA e sai do proprio video novo, escolhida POR PESO -
//   is_preferred da Meta foi medido e pode ser o quadro mais fraco; (2) NAO ha degradacao para
//   reusar_creative_id. No caminho de replicacao pura esse fallback e correto, porque o pedido e
//   publicar o criativo do molde; com peca nova ele publicaria a PECA ERRADA - o gestor aprova
//   "sobe o video novo" e a Meta entrega o antigo, gastando, sem ninguem notar. Cada
//   pre-requisito ausente (spec, video_data, page_id, link, capa) recusa com nome proprio.
//   O espelho passa a gravar procedencia do texto: legenda_fonte, legenda_referencias e
//   compliance_verificado_em. Sem elas, "quem escreveu esta legenda" so tem resposta no card,
//   que expira em 24h.
// v4.3.1 (04/08/2026) - o default do espelho deixa de ser literal. Ele apontava para "ACTIVE",
//   escrito na v4.2, e a v4.3 passou a criar PAUSED: default de contrato revogado gravava verde
//   falso no espelho quando a releitura na Graph nao trazia status. Agora segue o status que a
//   propria executora enviou (bodyFinal.status), com PAUSED apenas como ultimo recurso.
// v4.3 (03/08/2026) - REVERSAO DO CONTRATO DE ATIVACAO. O objeto volta a nascer PAUSED.
//   Motivo: o gestor Roberto pediu por audio em 03/08 14:45 - "ela tem que nascer pausada para
//   poder olhar e ativar ou nao" - e o Ryan acatou. A mudanca de 31/07 (aprovar = ativar) foi
//   decisao tecnica que NAO passou pelo gestor, e ele operou dias acreditando ter um freio manual
//   que nao existia mais. O desenho novo separa CRIAR de GASTAR em dois atos com donos
//   diferentes: aprovar card = criar (nao gasta); ativar no Gerenciador = gastar (gestor).
//   Aviso de arqueologia: o bloco "TRAVAS" mais abaixo neste cabecalho descrevia
//   status=PAUSED e categoria CREDIT e ficou correto por acidente na parte do PAUSED - mas a
//   categoria certa e FINANCIAL_PRODUCTS_SERVICES desde a v4.1. Corrigido nesta versao.
// v4.2 (03/08/2026) - ESPELHO NO ATO. A executora passa a gravar em campaigns/ad_sets/ads o
//   objeto que acabou de criar, com marca criado_pelo_sistema e link para o card de origem.
//   Motivo: o windsor-sync nao devolve campanha sem entrega, logo o sistema ficava cego para o
//   que ele mesmo criava - justamente na fase de montagem da estrutura. Falha de espelho nao
//   derruba a execucao (o objeto ja existe na Meta) mas e declarada no audit_log e no card.
// v4.1 (31/07/2026, minutos depois) - a Meta APOSENTOU a categoria especial CREDIT
//   (erro 2909060: "nao esta mais disponivel; escolha Produtos e servicos financeiros").
//   special_ad_categories agora envia FINANCIAL_PRODUCTS_SERVICES. Segunda evolucao de
//   plataforma pega na mesma noite pela execucao real - fail-loud pagando de novo.
// v4 (31/07/2026) - tres mudancas da primeira execucao real:
//   (1) is_adset_budget_sharing_enabled=false na criacao de campanha ABO - campo que a Meta
//       passou a EXIGIR (erro 100/4834011 recusou os 3 primeiros cards reais). false = cada
//       conjunto com o proprio orcamento, sem os 20% compartilhaveis: e o default que casa
//       com a disciplina de teto por conjunto; ligar compartilhamento = decisao declarada.
//   (2) APROVACAO = ATIVACAO (decisao do Ryan, 31/07): objeto criado nasce ACTIVE, nao mais
//       PAUSED. O portao passou a ser a APROVACAO HUMANA no card (sino) - quem aprova card
//       de ANUNCIO esta ligando entrega/gasto no ato; o resumo do card e o execution_result
//       dizem isso com todas as letras.
//   (3) Idempotencia verificada e mantida: executed_at so no sucesso; varredura exige
//       executed_at null; falha continua re-executavel. (v3) — F4.2 + criação + ISOLAMENTO POR EMPRESA
// v3 — A configuracao de execucao deixou de ser global. meta_execution_config era singleton
//   (check constraint travava id=1) e a linha unica valia para TODAS as empresas: ligar
//   master_enabled alcançaria as 8 campanhas da COHAPM sob a configuracao calibrada para a
//   Legal e Viver. Agora existe uma linha por empresa, e o executor carrega a config pela
//   company_id DO PROPRIO CARD, dentro do loop - nao mais uma vez no inicio.
//   Empresa sem linha propria NAO executa nada (antes herdaria a config da Legal).
//   Mesma classe do bug do contasOk[0] no traffic-chat: seguro por acidente com uma empresa,
//   errado com duas.
// v2 — ACOES DE CRIACAO. O v1 sabia MODIFICAR objeto existente (POST /{id}); criar e
// diferente em quatro pontos que exigiram caminho proprio:
//   (a) nao existe target_external_id: o alvo e a CONTA, e o v1 falhava sem esse campo;
//   (b) o endpoint e de COLECAO (POST /act_X/campaigns), nao de objeto;
//   (c) existem 20 contas meta_ads em integrations - criar na conta errada nao tem reversa
//       simples, por isso toda criacao valida a conta contra meta_execution_config
//       .contas_permitidas_criacao e RECUSA se nao estiver na lista;
//   (d) configuracao de conjunto (optimization_goal, billing_event, promoted_object,
//       destination_type, targeting, attribution_spec) nao pode ser inventada. Por isso
//       conjunto e anuncio sao REPLICADOS: o executor LE o molde na Graph API e troca apenas
//       nome, destino, orcamento e status.
// TRAVAS (decisoes do Ryan, todas no codigo):
//   status=PAUSED forcado em tudo que nasce (v4.3 restaurou isso); special_ad_categories=
//   ['FINANCIAL_PRODUCTS_SERVICES'] forcado na campanha (v4.1 - a Meta aposentou CREDIT);
//   teto de sanidade de orcamento; 3 camadas (master + flag + rate) preservadas;
//   dry_run mostra exatamente o que criaria sem escrever nada.
// UTM: o anuncio novo recebe url_tags gerado pelo traffic-chat. Como creative existente e
//   imutavel, criamos um adcreative NOVO reaproveitando o object_story_spec do molde (sem
//   upload de midia) so para poder aplicar as UTMs. Se o molde nao expuser object_story_spec
//   (tipico de Advantage+ com asset_feed_spec), reusamos o creative_id e DECLARAMOS que as
//   UTMs serao as do molde - degradar com aviso, nunca silenciosamente.
// v1: executor da fila de aprovações (pausar_criativo, pausar_campanha, alterar_orcamento).
//   escalar_criativo segue NAO automatizado (pulado com nota — decisão manual).
// Token: META_ADS_TOKEN (redigido de qualquer saída). Auth: x-mcp-key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { traduzirFalha } from "../_shared/aprovacoes.ts";
import {
  acaoDeAuditoriaDaReconciliacao,
  argsAdDeGraph,
  argsAdsetDeGraph,
  argsCampanhaDeGraph,
  argsCreativeDeGraph,
  camposDeReconciliacao,
  compararPedidoComGraph,
  driverDe,
  monitorConexaoPipeboard,
  nivelDaAcao,
  pipeboardCall,
  pipeboardToken,
  reconciliacaoNivelDesconhecido,
  type ConexaoPipeboard,
  type DriverEscrita,
  type NivelMeta,
  type Reconciliacao,
} from "../_shared/pipeboard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();
const GRAPH = "https://graph.facebook.com/v21.0";
const EXECUTAVEIS = ["pausar_criativo", "pausar_campanha", "alterar_orcamento", "renomear_campanha"];
const CRIACAO = ["criar_campanha", "criar_conjunto_a_partir_de", "criar_anuncio_a_partir_de"];

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
function redact(s: string): string {
  if (!TOKEN) return s;
  return s
    .split(TOKEN)
    .join("[TOKEN-REDACTED]")
    .replace(/access_token=[A-Za-z0-9]+/g, "access_token=[TOKEN-REDACTED]");
}
function json(obj: unknown, status = 200) {
  return new Response(redact(JSON.stringify(obj)), {
    status,
    headers: { "content-type": "application/json" },
  });
}
async function g(path: string, method = "GET", body?: Record<string, string>) {
  const form = new URLSearchParams({ ...(body ?? {}), access_token: TOKEN });
  const sep = path.includes("?") ? "&" : "?";
  const r =
    method === "GET"
      ? await fetch(`${GRAPH}${path}${sep}${form.toString()}`)
      : await fetch(`${GRAPH}${path}`, { method, body: form });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(redact(t)) };
  } catch {
    return { status: r.status, body: redact(t.slice(0, 300)) };
  }
}

async function segredoIntegracao(nome: string): Promise<string> {
  const { data } = await supa
    .from("integration_secrets")
    .select("value")
    .eq("name", nome)
    .maybeSingle();
  return String(data?.value ?? "");
}

type ResultadoEscrita = {
  status: number;
  body: any;
  id: string | null;
  driver: DriverEscrita;
  ferramenta?: string;
  dry_run_nativo?: boolean | null;
  nota_dry_run?: string | null;
  erro?: string;
  ok?: boolean;
};

// Ultimo passo: Graph (inalterado) ou Pipeboard. Travas, montarCriacao e espelhar ficam fora.
async function escreverCriacao(
  driver: DriverEscrita,
  acao: string,
  conta: string,
  path: string,
  body: Record<string, string>,
  pbToken: string,
  opts?: { dry_run?: boolean },
): Promise<ResultadoEscrita> {
  if (driver !== "pipeboard") {
    // use_adset_level_budgets e parametro do CONECTOR Pipeboard, nao da Graph. A Graph faz ABO
    // simplesmente NAO recebendo orcamento de campanha (medido nas TESTE-A/B/C, driver graph, sem
    // daily_budget). Enviar o flag a Graph arriscaria um erro de parametro desconhecido, entao ele
    // sai do corpo aqui - o unico ponto por onde o POST direto na Graph passa.
    const graphBody = { ...body };
    delete graphBody.use_adset_level_budgets;
    const exec = await g(path, "POST", graphBody);
    const id = (exec.body as any)?.id ?? null;
    return {
      status: exec.status,
      body: exec.body,
      id,
      driver: "graph",
      dry_run_nativo: null,
      ok: exec.status === 200 && !!id,
    };
  }

  if (opts?.dry_run && acao !== "criar_campanha") {
    // dry_run nativo so documentado em create_campaign/update_campaign. Nos demais niveis
    // nao inventamos: simulamos localmente e declaramos a lacuna (lacuna 5.1 do briefing).
    return {
      status: 200,
      body: { simulado_local: true, path, body },
      id: null,
      driver: "pipeboard",
      dry_run_nativo: false,
      nota_dry_run:
        "Pipeboard nao expoe dry_run nativo neste nivel (so create_campaign/update_campaign). Simulacao local; nada foi persistido.",
      ok: true,
    };
  }

  let tool = "";
  let args: Record<string, unknown> = {};
  if (acao === "criar_campanha") {
    tool = "create_campaign";
    args = argsCampanhaDeGraph(conta, body, { dry_run: !!opts?.dry_run });
  } else if (acao === "criar_conjunto_a_partir_de") {
    tool = "create_adset";
    args = argsAdsetDeGraph(conta, body);
  } else {
    return {
      status: 0,
      body: null,
      id: null,
      driver: "pipeboard",
      erro: `acao sem mapeamento Pipeboard: ${acao}`,
      ok: false,
    };
  }

  const r = await pipeboardCall(tool, args, pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: tool,
    dry_run_nativo: opts?.dry_run ? true : null,
    erro: r.erro,
    ok: opts?.dry_run ? r.ok || r.dry_run === true || !r.erro : r.ok && !!r.id,
  };
}

async function escreverCreative(
  driver: DriverEscrita,
  conta: string,
  path: string,
  body: Record<string, string>,
  pbToken: string,
): Promise<ResultadoEscrita> {
  if (driver !== "pipeboard") {
    const cc = await g(path, "POST", body);
    const id = (cc.body as any)?.id ?? null;
    return {
      status: cc.status,
      body: cc.body,
      id,
      driver: "graph",
      ok: cc.status === 200 && !!id,
    };
  }
  const r = await pipeboardCall("create_ad_creative", argsCreativeDeGraph(conta, body), pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: "create_ad_creative",
    erro: r.erro,
    ok: r.ok && !!r.id,
  };
}

async function escreverAd(
  driver: DriverEscrita,
  conta: string,
  path: string,
  body: Record<string, string>,
  creativeId: string,
  pbToken: string,
): Promise<ResultadoEscrita> {
  if (driver !== "pipeboard") {
    const exec = await g(path, "POST", body);
    const id = (exec.body as any)?.id ?? null;
    return {
      status: exec.status,
      body: exec.body,
      id,
      driver: "graph",
      ok: exec.status === 200 && !!id,
    };
  }
  const r = await pipeboardCall("create_ad", argsAdDeGraph(conta, body, creativeId), pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: r.id,
    driver: "pipeboard",
    ferramenta: "create_ad",
    erro: r.erro,
    ok: r.ok && !!r.id,
  };
}

async function escreverUpdate(
  driver: DriverEscrita,
  acao: string,
  alvoExt: string,
  post: Record<string, string>,
  pbToken: string,
  opts?: { dry_run?: boolean },
): Promise<ResultadoEscrita> {
  // Contrato: renomear campanha usa o update_campaign nativo do Pipeboard, sem fallback Graph.
  if (acao === "renomear_campanha" && driver !== "pipeboard") {
    return { status: 409, body: { erro: "renomear_campanha_exige_pipeboard", driver_recebido: driver },
      id: alvoExt, driver, erro: "renomear_campanha_exige_pipeboard", ok: false };
  }
  if (driver !== "pipeboard") {
    const exec = await g(`/${alvoExt}`, "POST", post);
    return {
      status: exec.status,
      body: exec.body,
      id: alvoExt,
      driver: "graph",
      dry_run_nativo: null,
      ok: exec.status === 200,
    };
  }

  let tool = "update_ad";
  if (acao === "pausar_campanha" || acao === "renomear_campanha") tool = "update_campaign";
  if (acao === "alterar_orcamento") tool = "update_adset";

  if (opts?.dry_run && tool !== "update_campaign") {
    return {
      status: 200,
      body: { simulado_local: true, alvo: alvoExt, post },
      id: alvoExt,
      driver: "pipeboard",
      dry_run_nativo: false,
      nota_dry_run:
        "Pipeboard nao expoe dry_run nativo neste nivel (so create_campaign/update_campaign). Simulacao local; nada foi persistido.",
      ok: true,
    };
  }

  const args: Record<string, unknown> = { ...post };
  if (tool === "update_campaign") args.campaign_id = alvoExt;
  else if (tool === "update_adset") args.adset_id = alvoExt;
  else args.ad_id = alvoExt;
  if (post.daily_budget) args.daily_budget = Number(post.daily_budget);
  if (opts?.dry_run) args.dry_run = true;

  const r = await pipeboardCall(tool, args, pbToken);
  return {
    status: r.status || (r.ok ? 200 : 502),
    body: r.body,
    id: alvoExt,
    driver: "pipeboard",
    ferramenta: tool,
    dry_run_nativo:
      opts?.dry_run && tool === "update_campaign" ? true : opts?.dry_run ? false : null,
    erro: r.erro,
    ok: r.ok,
  };
}

// v5.3: a lista de campos vem do NIVEL do objeto (nivelDaAcao), nao de um default de parametro.
// Nao existe default aqui de proposito: o parametro com valor fixo era o defeito, porque quem
// chamava nunca passava nada e os tres niveis liam a lista de UM deles.
async function reconciliarAposEscrita(
  novoId: string,
  acao: string,
  pedido: Record<string, unknown>,
): Promise<{ graph: { status: number; body: unknown }; reconciliacao: Reconciliacao }> {
  const nivel = nivelDaAcao(acao);
  if (!nivel) {
    return {
      graph: { status: 0, body: null },
      reconciliacao: reconciliacaoNivelDesconhecido(acao),
    };
  }
  const campos = camposDeReconciliacao(nivel);
  const depois = await g(`/${novoId}?fields=${campos}`);
  return {
    graph: depois,
    reconciliacao: compararPedidoComGraph(pedido, depois.body, {
      http_status: depois.status,
      campos,
      // A executora NUNCA envia orcamento ao criar campanha (montarCriacao monta ABO por
      // contrato). Se a Graph devolver orcamento de campanha, alguem no caminho o colocou - e em
      // 07/08/2026 esse alguem foi o conector Pipeboard. Sem esta linha a divergencia e invisivel,
      // porque o comparador so olha campo presente no pedido e o pedido e vazio aqui.
      exigir_ausentes: nivel === "campanha" ? ["daily_budget", "lifetime_budget"] : undefined,
    }),
  };
}

// O PEDIDO tambem e por nivel. Mandar objective na comparacao de um conjunto, ou daily_budget na de
// um anuncio, produz divergencia falsa pelo lado do pedido - o mesmo defeito visto do outro angulo.
// So entra o que a executora REALMENTE enviou naquele nivel.
function pedidoDeReconciliacao(
  acao: string,
  body: Record<string, string>,
  payload: any,
): Record<string, unknown> {
  const nivel = nivelDaAcao(acao);
  if (nivel === "campanha") {
    return {
      name: body.name,
      status: body.status,
      objective: body.objective ?? payload?.objetivo,
    };
  }
  if (nivel === "conjunto") {
    return {
      name: body.name,
      status: body.status,
      daily_budget: body.daily_budget, // centavos; a comparacao e numerica
      campaign_id: body.campaign_id, // conjunto no pai errado e caro e silencioso
    };
  }
  if (nivel === "anuncio") {
    return { name: body.name, status: body.status, adset_id: body.adset_id };
  }
  return {};
}
// v4.4 (04/08/2026) - GT-13: a thumbnail do video_data e OBRIGATORIA na Meta, e ela nao vem de
// graca: o quadro do molde e o do video ANTIGO. Os quadros do video novo saem de
// GET /{video_id}/thumbnails, gerados pela Meta na ingestao.
// POR PESO, NAO POR is_preferred: foi medido nos 19 videos do Drive que o quadro marcado como
// preferido pela Meta pode ser justamente o mais fraco - abertura em fundo liso, quase uniforme,
// que pesa uma fracao dos demais. Peso em bytes e o proxy de densidade visual disponivel sem
// baixar e decodificar imagem, o que este runtime nao faz.
// SEM PESO MENSURAVEL A FUNCAO RECUSA. Escolher por posicao seria escolher no escuro e entregar
// como se fosse critério; quem precisar de capa especifica passa thumbnail_url no payload.
async function escolherThumbnail(
  videoId: string,
  urlExplicita: string,
): Promise<{
  url?: string;
  erro?: string;
  indice?: number;
  bytes?: number;
  total?: number;
  criterio?: string;
}> {
  if (urlExplicita)
    return { url: urlExplicita, criterio: "url informada no payload (nao foi escolhida por peso)" };

  const r = await g(`/${videoId}/thumbnails?fields=id,uri,width,height,is_preferred`);
  if (r.status !== 200) {
    return {
      erro: `a Meta nao devolveu os quadros do video ${videoId} (HTTP ${r.status}). Sem quadro nao ha capa, e a Meta exige capa em video_data.`,
    };
  }
  const lista: any[] = Array.isArray((r.body as any)?.data) ? (r.body as any).data : [];
  if (!lista.length) {
    return {
      erro: `o video ${videoId} nao tem quadro gerado pela Meta ainda. A geracao acontece na ingestao e pode nao ter terminado - tente de novo, ou passe thumbnail_url no payload.`,
    };
  }

  const medidos: { i: number; uri: string; bytes: number | null }[] = [];
  for (let i = 0; i < lista.length; i++) {
    const uri = String(lista[i]?.uri ?? "");
    if (!uri) {
      medidos.push({ i, uri, bytes: null });
      continue;
    }
    let bytes: number | null = null;
    try {
      const h = await fetch(uri, { method: "HEAD" });
      const cl = h.headers.get("content-length");
      bytes = h.ok && cl ? Number(cl) : null;
    } catch {
      bytes = null;
    }
    medidos.push({ i, uri, bytes });
  }
  const comPeso = medidos.filter((m) => typeof m.bytes === "number" && (m.bytes as number) > 0);
  if (!comPeso.length) {
    return {
      erro: `nenhum dos ${lista.length} quadros do video ${videoId} respondeu ao HEAD com content-length, entao NAO ha como escolher por densidade visual. Escolher por posicao seria escolher no escuro. Passe thumbnail_url no payload se quiser uma capa especifica.`,
    };
  }
  comPeso.sort((a, b) => (b.bytes as number) - (a.bytes as number));
  const melhor = comPeso[0];
  return {
    url: melhor.uri,
    indice: melhor.i,
    bytes: melhor.bytes as number,
    total: lista.length,
    criterio: `quadro mais pesado entre os ${comPeso.length} de ${lista.length} que responderam ao HEAD (peso = proxy de densidade visual; is_preferred da Meta foi IGNORADO de proposito)`,
  };
}

// ==================== v5.3: SONDA DE RECONCILIACAO (SOMENTE LEITURA) ====================
// POR QUE EXISTE: ate aqui a reconciliacao so era exercitada por uma ESCRITA REAL. Provar que ela
// funciona custava criar objeto na Meta - e foi por isso que os dois falsos positivos de 07/08 so
// apareceram DEPOIS de a campanha e o anuncio existirem, com dinheiro e evidencia envolvidos.
// A sonda le objetos que JA existem, chama o MESMO reconciliarAposEscrita e a MESMA
// acaoDeAuditoriaDaReconciliacao do caminho de execucao, e nao emite POST nenhum na Meta.
//
// O PEDIDO VEM DO ESPELHO LOCAL (campaigns/ad_sets/ads), nao da propria Graph: comparar a Graph com
// ela mesma provaria apenas que a leitura respondeu, nunca que o comparador compara. O espelho e
// fonte independente, gravada no ato da criacao por espelhar().
//
// A SONDA NAO EMITE meta_action_reconciliacao_divergente NEM _falhou DE VERDADE. Alarme fabricado
// por teste fica indistinguivel de alarme real semanas depois, e o que esta em jogo nesta rodada e
// justamente poder confiar nesse alarme. Ela DECLARA a acao que o executor emitiria, calculada pela
// funcao compartilhada, e grava o resultado sob a acao propria meta_action_reconciliacao_sonda.
type CasoSonda = {
  nome: string;
  acao: string;
  external_id: string;
  espera: "conferido_ok" | "divergente" | "falhou";
  pedido: Record<string, unknown>;
  campos_forcados?: string;
  nota?: string;
};

const SONDA_CAMPANHA = "120254323578040191"; // [LEV][LP][LEADS][CLT][NOVA-01][AGO26]
// v5.5: a conferencia "limpa" de campanha precisa de uma campanha SEM orcamento na Graph. NOVA-01
// nao serve mais: ela nasceu com R$ 10/dia injetados pelo Pipeboard, entao usa-la como caso
// "conferido_ok" fazia o proprio exigir_ausentes acusar divergencia (a v41 reportava esse caso como
// FALHOU sem saber). TESTE-A foi criada pelo driver GRAPH, sem orcamento, e continua ABO na Graph.
const SONDA_CAMPANHA_ABO_LIMPA = "120254137750140191"; // [LEV][LP][LEADS][CLT][TESTE-A][AGO26]
const SONDA_CAMPANHA_CBO_INJETADA = "120254323578040191"; // NOVA-01: ABO pedida, R$10 injetado
const SONDA_CONJUNTO_LAL = "120253389922700191"; // molde LAL 1%
const SONDA_CONJUNTO_AMPLO = "120249671585580191"; // molde amplo BR 18-65
const SONDA_ANUNCIO = "120254319507370191"; // anuncio de prova do GT-13
const SONDA_ID_INEXISTENTE = "120000000000000000";

async function pedidoDoEspelho(
  nivel: NivelMeta,
  externalId: string,
): Promise<{ pedido: Record<string, unknown>; fonte: string } | null> {
  if (nivel === "campanha") {
    const { data } = await supa
      .from("campaigns")
      .select("name,status,objective")
      .eq("provider", "meta_ads")
      .eq("external_id", externalId)
      .maybeSingle();
    if (!data) return null;
    // campaigns guarda status em minusculo; o comparador normaliza caixa dos dois lados.
    return {
      pedido: { name: data.name, status: data.status, objective: data.objective },
      fonte: "espelho campaigns",
    };
  }
  if (nivel === "conjunto") {
    const { data } = await supa
      .from("ad_sets")
      .select("name,status,daily_budget,campaign_id")
      .eq("provider", "meta_ads")
      .eq("external_id", externalId)
      .maybeSingle();
    if (!data) return null;
    // ad_sets.campaign_id e uuid INTERNO - o id da Meta esta em campaigns.external_id.
    let campanhaExt: string | null = null;
    if (data.campaign_id) {
      const { data: c } = await supa
        .from("campaigns")
        .select("external_id")
        .eq("id", data.campaign_id)
        .maybeSingle();
      campanhaExt = c?.external_id ?? null;
    }
    return {
      pedido: {
        name: data.name,
        status: data.status,
        daily_budget: data.daily_budget, // NUMERO no espelho, string na Graph: e o par que a comparacao numerica existe para nao confundir
        ...(campanhaExt ? { campaign_id: campanhaExt } : {}),
      },
      fonte: campanhaExt
        ? "espelho ad_sets + campaigns.external_id"
        : "espelho ad_sets (campanha nao resolvida no espelho)",
    };
  }
  const { data } = await supa
    .from("ads")
    .select("name,status,adset_external_id")
    .eq("provider", "meta_ads")
    .eq("external_id", externalId)
    .maybeSingle();
  if (!data) return null;
  return {
    pedido: {
      name: data.name,
      status: data.status,
      ...(data.adset_external_id ? { adset_id: data.adset_external_id } : {}),
    },
    fonte: "espelho ads",
  };
}

async function bateriaDaSonda(): Promise<{ casos: CasoSonda[]; sem_espelho: string[] }> {
  const casos: CasoSonda[] = [];
  const sem_espelho: string[] = [];
  const alvos: { nivel: NivelMeta; acao: string; id: string; apelido: string }[] = [
    { nivel: "campanha", acao: "criar_campanha", id: SONDA_CAMPANHA_ABO_LIMPA, apelido: "campanha_abo_limpa" },
    {
      nivel: "conjunto",
      acao: "criar_conjunto_a_partir_de",
      id: SONDA_CONJUNTO_LAL,
      apelido: "conjunto_molde_lal1",
    },
    {
      nivel: "conjunto",
      acao: "criar_conjunto_a_partir_de",
      id: SONDA_CONJUNTO_AMPLO,
      apelido: "conjunto_molde_amplo",
    },
    { nivel: "anuncio", acao: "criar_anuncio_a_partir_de", id: SONDA_ANUNCIO, apelido: "anuncio_gt13" },
  ];

  for (const a of alvos) {
    const esp = await pedidoDoEspelho(a.nivel, a.id);
    if (!esp) {
      sem_espelho.push(`${a.apelido} (${a.id}) nao esta no espelho - sem fonte independente de pedido`);
      continue;
    }
    casos.push({
      nome: `${a.apelido}_conferido`,
      acao: a.acao,
      external_id: a.id,
      espera: "conferido_ok",
      pedido: esp.pedido,
      nota: `pedido vindo do ${esp.fonte}; prova que os campos do nivel ${a.nivel} devolvem OBJETO e batem`,
    });

    // TESTE NEGATIVO: divergencia REAL tem de continuar disparando. Alarme que parou de tocar nao
    // prova que o problema acabou - prova que pode ter sido silenciado.
    if (a.nivel === "conjunto") {
      const centavos = Number(esp.pedido.daily_budget ?? 0);
      casos.push({
        nome: `${a.apelido}_divergencia_real_orcamento`,
        acao: a.acao,
        external_id: a.id,
        espera: "divergente",
        pedido: { ...esp.pedido, daily_budget: centavos + 1 },
        nota: "orcamento propositalmente 1 centavo diferente: se isto nao disparar, a conferencia de dinheiro esta cega",
      });
      casos.push({
        nome: `${a.apelido}_orcamento_texto_vs_numero`,
        acao: a.acao,
        external_id: a.id,
        espera: "conferido_ok",
        pedido: { ...esp.pedido, daily_budget: `${centavos}.0` },
        nota: "mesmo valor em centavos escrito como texto decimal: comparacao por TEXTO acusaria divergencia falsa, a numerica nao",
      });
    } else {
      casos.push({
        nome: `${a.apelido}_divergencia_real_nome_e_status`,
        acao: a.acao,
        external_id: a.id,
        espera: "divergente",
        pedido: {
          ...esp.pedido,
          name: `${String(esp.pedido.name ?? "")} [DIVERGENCIA-FORCADA-PELA-SONDA]`,
          status: "ACTIVE",
        },
        nota: "nome e status propositalmente errados contra objeto que existe e foi lido",
      });
    }
  }

  // PROVA v5.5: a reconciliacao de campanha PEGA a injecao de orcamento do Pipeboard. NOVA-01 foi
  // pedida SEM orcamento (ABO) e a Graph a devolve com daily_budget=1000 que o conector injetou. O
  // pedido reconstruido do espelho NAO carrega orcamento (a executora nunca envia orcamento de
  // campanha), e reconciliarAposEscrita aplica exigir_ausentes=[daily_budget,lifetime_budget]: se
  // isto nao virar divergencia, a conferencia de dinheiro da campanha esta cega - que foi o defeito
  // ate a v41. Depende de NOVA-01 seguir com o orcamento injetado ate o Ryan decidir (o card manda
  // deixa-la PAUSED e orfa), e e por isso um caso REAL, nao fabricado.
  const espInjecao = await pedidoDoEspelho("campanha", SONDA_CAMPANHA_CBO_INJETADA);
  if (espInjecao) {
    casos.push({
      nome: "campanha_abo_injecao_de_orcamento_pega",
      acao: "criar_campanha",
      external_id: SONDA_CAMPANHA_CBO_INJETADA,
      espera: "divergente",
      pedido: espInjecao.pedido,
      nota: "campanha ABO (pedido sem orcamento) que a Graph devolve com daily_budget=1000 injetado pelo Pipeboard: exigir_ausentes tem de acusar a divergencia. Fonte do pedido: espelho, que nao guarda orcamento de campanha.",
    });
  } else {
    sem_espelho.push(
      "NOVA-01 (campanha CBO injetada) nao esta no espelho - nao da para provar a captura da injecao de orcamento",
    );
  }

  // Falha de leitura 1: objeto que nao existe.
  casos.push({
    nome: "leitura_falhou_id_inexistente",
    acao: "criar_campanha",
    external_id: SONDA_ID_INEXISTENTE,
    espera: "falhou",
    pedido: { name: "nao importa - nada sera lido", status: "PAUSED" },
    nota: "id inexistente: a Graph responde erro, e erro de leitura NAO e divergencia",
  });
  // Falha de leitura 2: o defeito de 07/08 reproduzido de proposito - campos DO ANUNCIO pedidos no
  // nivel de CAMPANHA. Antes desta versao este caso virava meta_action_reconciliacao_divergente
  // com "name: pediu=... graph=null". Agora tem de virar _falhou.
  casos.push({
    nome: "leitura_falhou_campo_de_outro_nivel",
    acao: "criar_campanha",
    external_id: SONDA_CAMPANHA,
    espera: "falhou",
    pedido: { name: "[LEV][LP][LEADS][CLT][NOVA-01][AGO26]", status: "PAUSED" },
    campos_forcados: "id,name,status,effective_status,adset_id,creative{id}",
    nota: "reproduz o default global de 07/08 (lista do anuncio na campanha): #100 derruba a consulta inteira",
  });
  // Nivel desconhecido: falha declarando, sem tentar leitura nenhuma.
  casos.push({
    nome: "nivel_desconhecido_declara_em_vez_de_adivinhar",
    acao: "acao_sem_nivel_conhecido",
    external_id: SONDA_CAMPANHA,
    espera: "falhou",
    pedido: { name: "nao importa - nenhuma leitura e tentada" },
    nota: "acao sem nivel mapeado nao recebe lista de campos por palpite",
  });

  return { casos, sem_espelho };
}

async function rodarSondaReconciliacao(companyId: string) {
  const { casos, sem_espelho } = await bateriaDaSonda();
  const detalhes: any[] = [];
  for (const caso of casos) {
    let rec: Reconciliacao;
    let httpStatus = 0;
    if (caso.campos_forcados) {
      const lida = await g(`/${caso.external_id}?fields=${caso.campos_forcados}`);
      httpStatus = lida.status;
      rec = compararPedidoComGraph(caso.pedido, lida.body, {
        http_status: lida.status,
        campos: caso.campos_forcados,
      });
    } else {
      const r = await reconciliarAposEscrita(caso.external_id, caso.acao, caso.pedido);
      rec = r.reconciliacao;
      httpStatus = r.graph.status;
    }
    const obtido: CasoSonda["espera"] =
      rec.estado !== "conferido" ? "falhou" : rec.ok ? "conferido_ok" : "divergente";
    detalhes.push({
      nome: caso.nome,
      acao: caso.acao,
      external_id: caso.external_id,
      nivel: nivelDaAcao(caso.acao),
      espera: caso.espera,
      obtido,
      veredito: obtido === caso.espera ? "PASSOU" : "FALHOU",
      acao_de_auditoria_que_o_executor_emitiria: acaoDeAuditoriaDaReconciliacao(rec),
      estado: rec.estado,
      ok: rec.ok,
      http_status: httpStatus,
      campos_pedidos: rec.campos_pedidos,
      campos_comparados: rec.campos_comparados,
      pedido: caso.pedido,
      divergencias: rec.divergencias,
      erro_leitura: rec.erro_leitura,
      lido: rec.lido,
      nota: caso.nota ?? null,
    });
  }

  const resumo = {
    total: detalhes.length,
    passou: detalhes.filter((d) => d.veredito === "PASSOU").length,
    falhou: detalhes.filter((d) => d.veredito === "FALHOU").length,
    escritas_na_meta: 0,
    alarmes_gravados_no_audit_log: 0,
  };
  const resultado = {
    versao: "meta-actions-v5.5-sonda-reconciliacao",
    somente_leitura: true,
    nota: "Nenhum POST na Meta. As acoes de auditoria sao DECLARADAS pela funcao compartilhada, nao emitidas - alarme de teste nao entra na mesma gaveta do alarme real.",
    resumo,
    alvos_sem_espelho: sem_espelho,
    casos: detalhes,
  };
  await supa.from("audit_log").insert({
    company_id: companyId,
    action: "meta_action_reconciliacao_sonda",
    target_type: "sonda_reconciliacao",
    target_id: SONDA_CAMPANHA,
    details: JSON.parse(redact(JSON.stringify(resultado))),
  });
  return resultado;
}

async function audit(
  companyId: string,
  userId: string,
  action: string,
  approvalId: string,
  details: unknown,
) {
  await supa.from("audit_log").insert({
    company_id: companyId,
    user_id: userId,
    action,
    target_type: "approval_request",
    target_id: approvalId,
    details: JSON.parse(redact(JSON.stringify(details))),
  });

  // v5.4: o audit_log deixa de ser o UNICO lugar onde a falha aparece. As duas acoes que
  // significam "esta tentativa acabou mal" tambem marcam o card, que e onde os leitores olham.
  // As demais (executed, espelho_falhou, reconciliacao_*) NAO marcam: nelas o objeto existe.
  if (action === "meta_action_failed" || action === "meta_action_blocked") {
    const d: any = details ?? {};
    await marcarFalhaNoCard(approvalId, {
      etapa: action === "meta_action_blocked" ? "bloqueio" : String(d.etapa ?? "execucao"),
      recusa: d.motivo ? String(d.motivo) : null,
      mensagem: d.detalhe ? String(d.detalhe) : null,
      bruto: d.resposta ?? d.detalhe ?? d.motivo ?? null,
      driver: d.driver_escrita ?? null,
      bloqueado: action === "meta_action_blocked",
    });
  }
}
// ==================== v5.4: TODA TENTATIVA QUE TERMINA MAL MARCA O CARD ====================
// O card b5e2f338 ficou status=approved / executed_at=NULL / execution_result=NULL depois de o
// Pipeboard recusar create_adset. Quem lesse esse card - e o agente leu - so podia concluir
// "ainda nao executou". A falha estava no audit_log, e get_aprovacoes nao olha o audit_log.
// Daqui em diante nenhum `continue` deste executor sai sem dizer no CARD o que aconteceu.
// NAO mexemos em executed_at de proposito: ele continua significando "a escrita terminou e o card
// esta fechado", que e o que a varredura (executed_at is null) e o fechamento pos-escrita-parcial
// dependem. ultima_falha e o eixo novo: "a ultima tentativa acabou, e acabou assim".
// POR QUE ISTO PENDURA NO audit() E NAO EM CADA `continue`: sao 12 saidas de falha/bloqueio so
// neste arquivo, nos dois caminhos (criacao e modificacao). Marcar uma a uma garante que a
// proxima saida nova nasca invisivel de novo - que e literalmente a historia deste bug. Toda
// saida ja chama audit(); pendurar aqui e o unico ponto por onde TODAS passam.
async function marcarFalhaNoCard(
  cardId: string,
  dados: {
    etapa: string;
    recusa?: string | null;
    mensagem?: string | null;
    bruto?: unknown;
    driver?: string | null;
    re_executavel?: boolean;
    bloqueado?: boolean;
  },
) {
  const t = dados.bloqueado
    ? {
        recusa: String(dados.recusa ?? "bloqueado_por_trava_do_sistema"),
        motivo_para_o_gestor: `a execucao NAO foi tentada porque uma trava do sistema barrou o pedido: ${String(dados.recusa ?? "motivo nao registrado")}. Nada foi enviado a Meta. Enquanto a trava estiver assim, aprovar de novo nao muda o resultado.`,
      }
    : traduzirFalha(dados.bruto ?? dados.recusa ?? dados.etapa, dados.recusa, dados.mensagem);

  const { data: atual } = await supa
    .from("approval_requests")
    .select("ultima_falha")
    .eq("id", cardId)
    .maybeSingle();

  await supa
    .from("approval_requests")
    .update({
      ultima_falha: {
        em: new Date().toISOString(),
        etapa: dados.etapa,
        recusa: t.recusa,
        motivo_para_o_gestor: t.motivo_para_o_gestor,
        detalhe_tecnico: redact(
          typeof dados.bruto === "string" ? dados.bruto : JSON.stringify(dados.bruto ?? null),
        ).slice(0, 1000),
        tentativa: Number((atual as any)?.ultima_falha?.tentativa ?? 0) + 1,
        // Falha ANTES de qualquer escrita mantem o card elegivel para nova tentativa, de
        // proposito. Isso NAO significa "esta sendo processado": a tentativa terminou.
        re_executavel: dados.re_executavel !== false,
        driver_escrita: dados.driver ?? null,
      },
    })
    .eq("id", cardId);
}

// v2: normaliza act_123 e 123 para o mesmo formato, porque integrations guarda sem prefixo
// e a lista branca guarda com prefixo.
const actId = (v: string) => {
  const s = String(v ?? "").trim();
  return s.startsWith("act_") ? s : `act_${s}`;
};

// v5.1: espelho EXATO de public.campo_presente_no_pedido(jsonb, text). Os dois lados do portao
// (contrato/verificacao no banco e executor aqui) precisam recusar o MESMO conjunto de pedidos:
// se um considerar "" ou [] presente e o outro nao, volta a existir completo=true com o executor
// recusando - o padrao que a PO-17 v2 proibe. Vazio nao e pedido: string em branco, array vazio
// e objeto vazio contam como ausentes nos dois lugares.
export function campoPresente(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

// v2: monta o corpo de criacao lendo o molde quando necessario. Retorna o path de colecao,
// o body do POST e, opcionalmente, um passo previo (criacao de adcreative).
// v5.1: exportada para que as recusas nomeadas sejam verificaveis fora de uma execucao real. Sem
// isso, a unica forma de provar que carrossel recusa era emitir um card de verdade - caro demais
// para uma prova que precisa ser repetida a cada mudanca de contrato.
export async function montarCriacao(acao: string, p: any, conta: string, tetoSanidade: number) {
  if (acao === "criar_campanha") {
    const nome = String(p?.nome_novo ?? "").trim();
    if (!nome) return { erro: "payload sem nome_novo" };

    // ============ v5.5: REGIME DE ORCAMENTO DECLARADO; ABO REAL PELO PIPEBOARD ============
    // O gestor decide o regime no pedido (regime_orcamento). Hoje o UNICO regime suportado e ABO -
    // orcamento vive em cada CONJUNTO, a campanha fica SEM orcamento -, que e o desenho de todo o
    // sistema: o gate campanha_usa_orcamento_proprio_cbo existe justamente para manter conjunto
    // fora de campanha CBO. Ausente = 'abo' (o default historico e a decisao do gestor). Valor
    // diferente de 'abo' RECUSA por nome; o contrato (contrato_de_execucao.valores_aceitos=['abo'])
    // recusa o MESMO conjunto no validador, para nunca haver validador=aceita com executor=recusa.
    const regime = (String(p?.regime_orcamento ?? "").trim().toLowerCase() || "abo");
    if (regime !== "abo") {
      return {
        erro: "regime_orcamento_nao_suportado",
        detalhe:
          `O pedido declara regime_orcamento="${regime}", e este sistema so cria campanha em ABO (orcamento no conjunto, campanha sem orcamento). CBO — orcamento na campanha — nao e suportado: o conjunto so entra em campanha sem orcamento proprio (e o que o gate campanha_usa_orcamento_proprio_cbo garante), entao criar a campanha ja com orcamento fecharia o caminho do conjunto. Peca a campanha em ABO (ou omita o regime, que ja assume ABO).`,
      };
    }

    // ABO de verdade: use_adset_level_budgets=true e a chave. Sem ele, o Pipeboard injeta
    // daily_budget=1000 (provado por teste descartavel controlado em 07/08/2026). Nenhum orcamento
    // de campanha e enviado. O flag e do CONECTOR; escreverCriacao o remove antes de um POST Graph.
    return {
      path: `/${conta}/campaigns`,
      body: {
        name: nome,
        objective: String(p?.objetivo ?? "OUTCOME_LEADS"),
        status: "PAUSED", // v4.3: aprovar CRIA; ativar e ato do gestor no Gerenciador
        special_ad_categories: JSON.stringify(["FINANCIAL_PRODUCTS_SERVICES"]), // TRAVA (forcado; v4.1: a Meta aposentou CREDIT - erro 2909060 - e exige a categoria nova "Produtos e servicos financeiros")
        buying_type: "AUCTION",
        is_adset_budget_sharing_enabled: "false", // v4: exigido pela Meta em ABO; false = sem compartilhamento de orcamento entre conjuntos
        use_adset_level_budgets: "true", // v5.5: ABO real — impede o Pipeboard de injetar orcamento de campanha (CBO)
      } as Record<string, string>,
      regime_orcamento: "abo",
    };
  }

  if (acao === "criar_conjunto_a_partir_de") {
    const molde = String(p?.molde_external_id ?? "");
    const campanha = String(p?.campanha_destino_external_id ?? "");
    const nome = String(p?.nome_novo ?? "").trim();
    const reais = Number(p?.orcamento_diario_reais ?? 0);
    if (!molde || !campanha || !nome)
      return {
        erro: "payload incompleto (molde_external_id, campanha_destino_external_id, nome_novo)",
      };
    if (!(reais > 0)) return { erro: "orcamento_diario_reais ausente ou invalido" };
    if (reais > tetoSanidade)
      return { erro: `orcamento ${reais} acima do teto de sanidade ${tetoSanidade}` };

    // ============ v5.4: ORCAMENTO DA CAMPANHA PAI, ANTES DE ESCREVER ============
    // Mesmo padrao do gate de Dynamic Creative da v5.2: le o estado do objeto PAI e recusa por
    // nome, em vez de descobrir pelo texto de erro da plataforma depois de gastar a aprovacao.
    // EVIDENCIA (07/08/2026, card b5e2f338): create_adset com daily_budget foi recusado porque a
    // campanha 120254323578040191 tem daily_budget proprio (CBO) - e ela tem esse orcamento sem
    // que ninguem o tenha pedido, porque o conector Pipeboard o injetou na criacao. Enquanto essa
    // injecao existir, campanha criada pelo sistema pode nascer CBO, e este gate e o que impede o
    // conjunto de morrer na Meta depois da aprovacao do gestor.
    // A leitura vem da Graph com o token proprio (nao do espelho): o espelho pode estar velho, e
    // aqui estamos a um passo da escrita. Falha de leitura RECUSA - nao ha default seguro entre
    // "a campanha manda no dinheiro" e "o conjunto manda no dinheiro".
    const orc = await g(`/${campanha}?fields=daily_budget,lifetime_budget`);
    if (orc.status !== 200) {
      return {
        erro: "falha_ao_verificar_campanha_destino",
        detalhe:
          "Nao consegui ler o orcamento da campanha de destino, e sem isso nao da para saber se definir R$/dia neste conjunto vai conflitar com a campanha. Nao vou criar o conjunto sem essa confirmacao: se a campanha tiver orcamento proprio, a Meta recusa a criacao e a aprovacao do gestor e gasta a toa. Tente de novo quando a consulta a campanha estiver disponivel.",
      };
    }
    const ob: any = orc.body ?? {};
    const cbo = Number(ob.daily_budget ?? 0) > 0 || Number(ob.lifetime_budget ?? 0) > 0;
    if (cbo) {
      return {
        erro: "campanha_usa_orcamento_proprio_cbo",
        // A saida "peca o conjunto SEM orcamento" saiu daqui de proposito: ela nao existe. O
        // contrato torna orcamento_diario_reais obrigatorio e este mesmo bloco recusa reais <= 0
        // logo acima, entao o gestor que seguisse o conselho bateria numa segunda recusa.
        detalhe:
          "Nao criei o conjunto porque a campanha de destino ja tem orcamento PROPRIO (Otimizacao de Orcamento de Campanha, o CBO), e a Meta nao aceita orcamento na campanha e no conjunto ao mesmo tempo. Ou o dinheiro vive na CAMPANHA e ela distribui entre os conjuntos, ou vive em CADA CONJUNTO e a campanha fica sem. Para seguir: escolha uma campanha de destino SEM orcamento proprio, e ai o R$/dia deste conjunto vale. Criar conjunto SEM orcamento, herdando o da campanha, ainda NAO e suportado por este sistema - o orcamento diario e obrigatorio no pedido -, entao nao adianta pedir assim.",
        campanha_orcamento_centavos: Number(ob.daily_budget ?? 0) || Number(ob.lifetime_budget ?? 0),
      };
    }

    const campos = [
      "optimization_goal",
      "billing_event",
      "bid_strategy",
      "targeting",
      "promoted_object",
      "destination_type",
      "attribution_spec",
      "bid_amount",
      "dsa_beneficiary",
      "dsa_payor",
    ].join(",");
    const m = await g(`/${molde}?fields=${campos}`);
    if (m.status !== 200) return { erro: "falha ao ler o conjunto molde na Meta", detalhe: m.body };
    const mb: any = m.body ?? {};

    const body: Record<string, string> = {
      name: nome,
      campaign_id: campanha,
      daily_budget: String(Math.round(reais * 100)), // centavos
      status: "PAUSED", // v4.3: aprovar CRIA; ativar e ato do gestor
    };
    // Replica apenas o que o molde realmente tem - nada e inventado.
    if (mb.optimization_goal) body.optimization_goal = String(mb.optimization_goal);
    if (mb.billing_event) body.billing_event = String(mb.billing_event);
    if (mb.bid_strategy) body.bid_strategy = String(mb.bid_strategy);
    if (mb.destination_type) body.destination_type = String(mb.destination_type);
    if (mb.bid_amount) body.bid_amount = String(mb.bid_amount);
    if (mb.targeting) body.targeting = JSON.stringify(mb.targeting);
    if (mb.promoted_object) body.promoted_object = JSON.stringify(mb.promoted_object);
    if (mb.attribution_spec) body.attribution_spec = JSON.stringify(mb.attribution_spec);
    if (mb.dsa_beneficiary) body.dsa_beneficiary = String(mb.dsa_beneficiary);
    if (mb.dsa_payor) body.dsa_payor = String(mb.dsa_payor);

    return { path: `/${conta}/adsets`, body, molde_lido: mb };
  }

  if (acao === "criar_anuncio_a_partir_de") {
    const creativeMolde = String(p?.creative_id ?? "");
    const adset = String(p?.conjunto_destino_external_id ?? "");
    const nome = String(p?.nome_novo ?? "").trim();
    const urlTags = String(p?.url_tags ?? "").trim();
    const videoNovo = String(p?.meta_video_id ?? "").trim(); // v4.4: peca nova
    const legendaNova = String(p?.legenda ?? "").trim();
    if (!creativeMolde || !adset || !nome)
      return { erro: "payload incompleto (creative_id, conjunto_destino_external_id, nome_novo)" };

    // ============ v5.1: FORMATOS SEM CAMINHO RECUSAM POR NOME, ANTES DE LER O MOLDE ============
    // Ate aqui, child_attachments e meta_image_hash nao eram lidos por ramo nenhum: o pedido
    // atravessava intacto e terminava na replicacao pura, publicando o criativo do MOLDE. Isso e
    // pior que erro - e acerto aparente. O card volta "CRIADO", o espelho grava, e o que foi ao ar
    // e a peca ANTIGA, gastando. A rota de video ja tinha essa licao aprendida na v4.4 (recusa com
    // molde_sem_video_data, molde_sem_link_de_destino); estes dois formatos ficaram de fora.
    // Vem ANTES da leitura do molde de proposito: nao ha por que consultar a Graph para um pedido
    // que nao tem execucao possivel. Suportar carrossel exige montar child_attachments com peca,
    // link e CTA por cartao; suportar foto exige trocar video_data por image_hash e mudar o
    // formato do anuncio - as duas coisas sao trabalho novo, nao ajuste, e nenhuma sera adivinhada.
    if (campoPresente(p?.child_attachments)) {
      return {
        erro: "carrossel_nao_suportado",
        detalhe:
          "O pedido traz child_attachments (carrossel) e esta executora NAO monta carrossel: ela replica o criativo do molde ou troca a midia de um video_data. Antes desta versao o campo era ignorado em silencio e a Meta publicava o CRIATIVO DO MOLDE - a peca antiga no ar, com o gestor achando que aprovou o carrossel novo. Monte o carrossel no Gerenciador, ou peca o suporte a carrossel como trabalho declarado.",
      };
    }
    if (campoPresente(p?.meta_image_hash)) {
      return {
        erro: "foto_nao_suportada",
        detalhe:
          "O pedido traz meta_image_hash (foto) e esta executora so publica peca nova em VIDEO: a rota da v4.4 copia o object_story_spec do molde e troca video_id, e um molde de video nao vira anuncio de imagem trocando um campo - muda o formato do anuncio, nao so a peca. Antes desta versao o campo era ignorado em silencio e ia ao ar o criativo do molde. Publique a foto pelo Gerenciador, ou peca o suporte a imagem como trabalho declarado.",
      };
    }

    // ============ v5.2: ESTADO DO DESTINO, ANTES DO ADCREATIVE ============
    // is_dynamic_creative nao e campo do pedido: e estado do conjunto na Graph. Por isso nao cabe
    // no eixo contrato_de_execucao.suportado. A leitura e legitima; qualquer escrita antes dela
    // deixa creative orfao quando create_ad recusa o conjunto Dynamic Creative.
    const destino = await g(`/${adset}?fields=is_dynamic_creative`);
    if (destino.status !== 200) {
      return {
        erro: "falha_ao_verificar_conjunto_destino",
        detalhe:
          "Nao consegui confirmar se o conjunto de destino aceita um anuncio avulso. Nao vou criar a peca antes dessa confirmacao, porque uma falha posterior deixaria um item orfao. Tente novamente quando a consulta ao conjunto estiver disponivel.",
      };
    }
    const dynamicCreative =
      (destino.body as any)?.is_dynamic_creative === true ||
      String((destino.body as any)?.is_dynamic_creative ?? "").toLowerCase() === "true";
    if (dynamicCreative) {
      return {
        erro: "conjunto_destino_criativo_dinamico",
        detalhe:
          "Nao emiti o anuncio porque o conjunto de destino esta configurado para Criativo Dinamico. Esse tipo de conjunto nao aceita a criacao de um anuncio avulso. Escolha um conjunto com Criativo Dinamico desativado ou crie um novo conjunto a partir do molde; as replicas criadas pelo sistema nascem com essa opcao desativada.",
      };
    }

    // Le o creative do molde para tentar recria-lo com as UTMs novas.
    const c = await g(
      `/${creativeMolde}?fields=object_story_spec,url_tags,name,degrees_of_freedom_spec`,
    );
    const cb: any = c.body ?? {};
    const temStorySpec = c.status === 200 && cb.object_story_spec;

    // ============ v4.4: PECA NOVA (video do Drive ja na biblioteca da conta) ============
    // Rota: COPIAR o object_story_spec do molde e TROCAR a midia. So esta rota existe porque a
    // configuracao que faz um anuncio funcionar (page_id, link de destino, CTA, titulo) nao esta
    // em tabela nenhuma do sistema - ela vive dentro do spec do molde. Montar do zero exigiria
    // inventar a URL de destino, e inventar URL de anuncio de credito nao esta em questao.
    // AQUI NAO EXISTE DEGRADACAO. No caminho de replicacao pura, cair para reusar_creative_id e
    // correto - o pedido E publicar o criativo do molde. Com peca nova seria publicar A PECA
    // ERRADA: o gestor aprovaria "subir o video novo" e a Meta entregaria o video antigo, sem
    // ninguem notar, gastando. Por isso cada pre-requisito ausente RECUSA, com nome proprio.
    if (videoNovo) {
      if (!temStorySpec) {
        return {
          erro: "molde_sem_object_story_spec",
          detalhe: `O anuncio molde (creative ${creativeMolde}) nao expoe object_story_spec - tipico de criativo flexivel/Advantage+, onde midia, textos e link vivem no asset_feed_spec. Sem o spec nao ha de onde copiar page_id, link de destino e CTA, e este caminho NAO reusa o criativo do molde: reusar publicaria a peca ANTIGA num card que pede a peca NOVA. Escolha um molde que exponha o spec (na conta da Legal e Viver os CREATIVE_LPV2_Reel* expoem) ou monte o anuncio no Gerenciador.`,
        };
      }
      const vd: any = cb.object_story_spec?.video_data ?? null;
      if (!vd) {
        return {
          erro: "molde_sem_video_data",
          detalhe: `O molde expoe object_story_spec, mas sem video_data (chaves presentes: ${Object.keys(cb.object_story_spec ?? {}).join(", ") || "nenhuma"}). Trocar a midia de um spec de imagem por video mudaria o formato do anuncio, nao so a peca - e isso nao e replicar molde. Use como molde um anuncio de VIDEO.`,
        };
      }
      if (!cb.object_story_spec?.page_id) {
        return {
          erro: "molde_sem_page_id",
          detalhe:
            "O object_story_spec do molde nao traz page_id, e a Meta recusa adcreative sem pagina. Nao ha default seguro: publicar por outra pagina mudaria o emissor do anuncio.",
        };
      }
      // §7 do briefing: a URL de destino nao existe em tabela nenhuma - ela vem do molde ou nao vem.
      const linkMolde = vd?.call_to_action?.value?.link ?? vd?.link ?? null;
      if (!linkMolde) {
        return {
          erro: "molde_sem_link_de_destino",
          detalhe: `O video_data do molde nao traz link de destino (chaves: ${Object.keys(vd).join(", ")}). A URL de destino nao esta em nenhuma tabela do sistema, so dentro do spec do molde - e nao sera inventada. Escolha um molde que carregue o link.`,
        };
      }
      const th = await escolherThumbnail(videoNovo, String(p?.thumbnail_url ?? ""));
      if (th.erro) {
        return { erro: "thumbnail_obrigatoria_nao_resolvida", detalhe: th.erro };
      }

      // image_hash do molde e o quadro do video ANTIGO: mantido, a Meta publicaria a capa errada.
      const novoVd: any = { ...vd, video_id: videoNovo, image_url: th.url };
      delete novoVd.image_hash;
      if (legendaNova) novoVd.message = legendaNova;
      const novoSpec = { ...cb.object_story_spec, video_data: novoVd };

      return {
        path: `/${conta}/ads`,
        body: { name: nome, adset_id: adset, status: "PAUSED" } as Record<string, string>,
        criativo: {
          modo: "novo_adcreative_peca_nova",
          path: `/${conta}/adcreatives`,
          body: {
            name: `${nome} - creative`,
            object_story_spec: JSON.stringify(novoSpec),
            ...(urlTags ? { url_tags: urlTags } : {}),
          } as Record<string, string>,
        },
        peca_nova: {
          meta_video_id: videoNovo,
          thumbnail: th,
          link_herdado_do_molde: linkMolde,
          legenda_substituida: !!legendaNova,
          creative_molde: creativeMolde,
        },
      };
    }

    return {
      path: `/${conta}/ads`,
      body: { name: nome, adset_id: adset, status: "PAUSED" } as Record<string, string>, // v4.3: anuncio nasce pausado - a entrega so comeca quando o gestor ativar
      criativo: temStorySpec
        ? {
            modo: "novo_adcreative",
            path: `/${conta}/adcreatives`,
            body: {
              name: `${nome} - creative`,
              object_story_spec: JSON.stringify(cb.object_story_spec),
              ...(urlTags ? { url_tags: urlTags } : {}),
            } as Record<string, string>,
          }
        : {
            modo: "reusar_creative_id",
            creative_id: creativeMolde,
            aviso:
              "O criativo do molde nao expoe object_story_spec (tipico de Advantage+ com asset_feed_spec), entao o anuncio novo REUSA o criativo original e herda as UTMs dele - a utm_campaign pedida NAO sera aplicada. Ajustar manualmente no Gerenciador se a rastreabilidade for necessaria.",
          },
    };
  }

  return { erro: `acao de criacao desconhecida: ${acao}` };
}

// v4.2 (03/08/2026) - ESPELHO NO ATO DA CRIACAO.
// PROBLEMA QUE ISSO RESOLVE: a executora criava o objeto na Meta e nao gravava em
// campaigns/ad_sets/ads. O espelho dependia do windsor-sync, que por construcao nao devolve
// campanha sem entrega - logo o sistema ficava cego para o que ele mesmo acabou de criar,
// exatamente durante a montagem da estrutura. As 3 campanhas de 31/07 ficaram 3 dias fora do
// banco, e foi essa cegueira que fez o agente e o gestor operarem sobre estado falso.
// CAIXA DO STATUS (nao mexer sem ler): campaigns usa MINUSCULO nesta base (24 'paused' +
// 2 'active'), ad_sets e ads usam MAIUSCULO. Gravar a caixa errada faz a linha piscar a cada
// sync. Seguimos a convencao de cada tabela; a divergencia entre elas e item separado (GT-09).
// CONTA: campaigns.external_account_id e ad_sets/ads.account_id guardam o id SEM o prefixo act_.
// FALHA DE ESPELHO NAO DERRUBA A EXECUCAO: o objeto JA existe na Meta nesse ponto. Mas tambem
// nao e silenciosa - vai para o audit_log e para o execution_result do card.
async function espelhar(
  acao: string,
  novoId: string,
  objeto: any,
  p: any,
  conta: string,
  companyId: string,
  approvalId: string,
  moldeLido: any,
  creativeUsado: string | null,
  statusEnviado: string,
): Promise<{ ok: boolean; erro?: string; tabela?: string }> {
  const contaSemPrefixo = conta.replace(/^act_/, "");
  // v4.3.1 (04/08/2026): tres fontes, em ordem de autoridade. (1) o que a Meta devolveu na
  // releitura do objeto criado; (2) o que a executora ACABOU de enviar no corpo - fato conhecido,
  // nao palpite; (3) PAUSED como ultimo recurso, que e a direcao segura. O literal "ACTIVE" que
  // estava aqui foi escrito na v4.2, quando o objeto nascia ativo, e virou VERDE FALSO no
  // instante em que a v4.3 passou a criar pausado - default digitado a mao aponta para o
  // contrato do dia em que foi escrito, e este mudou duas vezes em quatro dias.
  const statusMeta = String(objeto?.status ?? statusEnviado ?? "PAUSED") || "PAUSED";
  try {
    if (acao === "criar_campanha") {
      const { error } = await supa.from("campaigns").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          objective: String(p?.objetivo ?? "OUTCOME_LEADS"),
          status: statusMeta.toLowerCase(), // campaigns = minusculo
          // v5.4: o literal `0` que estava aqui era um PALPITE apresentado como fato ("ABO:
          // orcamento vive no conjunto"). Em 07/08/2026 ele gravou 0 para uma campanha que a Meta
          // criou com R$ 10,00/dia, e o espelho passou dias afirmando o contrario do real. Agora
          // segue o objeto lido na Graph; sem leitura, NULO - que e o valor que
          // avaliar_estado_destino_execucao trata como "nao verificado" e recusa fechado, em vez
          // de um numero que finge conhecimento.
          daily_budget: objeto?.daily_budget != null ? Number(objeto.daily_budget) : null,
          lifetime_budget: objeto?.lifetime_budget != null ? Number(objeto.lifetime_budget) : null,
          external_id: novoId,
          external_account_id: contaSemPrefixo,
          special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
        },
        { onConflict: "provider,external_id" },
      );
      return error
        ? { ok: false, erro: error.message, tabela: "campaigns" }
        : { ok: true, tabela: "campaigns" };
    }

    if (acao === "criar_conjunto_a_partir_de") {
      // ad_sets.campaign_id e o uuid INTERNO, nao o id da Meta - precisa resolver.
      const { data: camp } = await supa
        .from("campaigns")
        .select("id")
        .eq("provider", "meta_ads")
        .eq("external_id", String(p?.campanha_destino_external_id ?? ""))
        .maybeSingle();
      const { error } = await supa.from("ad_sets").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          account_id: contaSemPrefixo,
          campaign_id: camp?.id ?? null, // null e aceito (FK ON DELETE SET NULL)
          external_id: novoId,
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          status: statusMeta.toUpperCase(), // ad_sets = MAIUSCULO
          daily_budget: Math.round(Number(p?.orcamento_diario_reais ?? 0) * 100), // centavos
          bid_strategy: moldeLido?.bid_strategy ?? null,
          targeting: moldeLido?.targeting ?? null,
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
        },
        { onConflict: "provider,external_id" },
      );
      const aviso = camp?.id
        ? undefined
        : "conjunto gravado SEM vinculo de campanha: a campanha destino nao esta no espelho";
      return error
        ? { ok: false, erro: error.message, tabela: "ad_sets" }
        : { ok: true, tabela: "ad_sets", ...(aviso ? { erro: aviso } : {}) };
    }

    if (acao === "criar_anuncio_a_partir_de") {
      // Sobe pelo conjunto para achar a campanha - o anuncio guarda as duas referencias.
      const { data: aset } = await supa
        .from("ad_sets")
        .select("campaign_id")
        .eq("provider", "meta_ads")
        .eq("external_id", String(p?.conjunto_destino_external_id ?? ""))
        .maybeSingle();
      const { error } = await supa.from("ads").upsert(
        {
          company_id: companyId,
          provider: "meta_ads",
          account_id: contaSemPrefixo,
          campaign_id: aset?.campaign_id ?? null,
          adset_external_id: String(p?.conjunto_destino_external_id ?? ""),
          external_id: novoId,
          name: String(objeto?.name ?? p?.nome_novo ?? ""),
          creative_id: creativeUsado,
          status: statusMeta.toUpperCase(), // ads = MAIUSCULO
          criado_pelo_sistema: true,
          criado_por_approval_id: approvalId,
          // v4.4 (GT-13): PROCEDENCIA DO TEXTO. Sem isso, um anuncio criado pelo sistema fica
          // indistinguivel de um sincronizado, e a pergunta "quem escreveu esta legenda" nao tem
          // resposta no banco - so no card, que expira. legenda_fonte vem da verificacao
          // (pedido_de_anuncio_completo), nao de palpite daqui; ausente = nao declarada, e nulo
          // e a resposta honesta. compliance_verificado_em e o instante do veredito que LIBEROU
          // o card, nao o da execucao: o que foi avaliado foi o texto, antes de existir anuncio.
          ...(p?.legenda ? { body: String(p.legenda) } : {}),
          ...(p?.legenda_fonte ? { legenda_fonte: String(p.legenda_fonte) } : {}),
          ...(p?.legenda_referencias ? { legenda_referencias: p.legenda_referencias } : {}),
          ...(p?.compliance?.validado_em
            ? { compliance_verificado_em: String(p.compliance.validado_em) }
            : {}),
        },
        { onConflict: "provider,external_id" },
      );
      return error
        ? { ok: false, erro: error.message, tabela: "ads" }
        : { ok: true, tabela: "ads" };
    }

    return { ok: false, erro: `acao sem regra de espelho: ${acao}` };
  } catch (e) {
    return { ok: false, erro: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ error: "META_ADS_TOKEN ausente" }, 500);
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "header-only"));
  if (!auth.ok) return json({ error: "unauthorized", motivo: auth.motivo }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* */
  }
  const onlyId: string | null = body?.approval_id ?? null;

  // v5.3: sonda de reconciliacao. Retorna ANTES de tocar a fila, de proposito: com dry_run=false e
  // flags ligadas, uma corrida normal executaria cards aprovados - conferir a conferencia nao pode
  // ter esse efeito colateral.
  if (body?.modo === "sonda_reconciliacao") {
    const companyId = String(body?.company_id ?? "").trim();
    if (!companyId) {
      return json({ error: "sonda_reconciliacao exige company_id (a evidencia e por empresa)" }, 400);
    }
    return json({
      ok: true,
      modo: "sonda_reconciliacao",
      mcp_chamador: auth.chamador,
      sonda: await rodarSondaReconciliacao(companyId),
    });
  }

  // v3: a config NAO e mais lida aqui. Cada card carrega a da sua propria empresa, dentro do
  // loop - uma leitura global voltaria a aplicar a configuracao de uma empresa a outra.

  // v5: monitor de conexao Pipeboard (login pessoal). Roda quando ha token; alerta se
  // token_status != active. Nao bloqueia o caminho graph.
  const pbToken = await pipeboardToken(segredoIntegracao);
  let pipeboardMonitor: ConexaoPipeboard | null = null;
  if (pbToken) pipeboardMonitor = await monitorConexaoPipeboard(pbToken);

  let q = supa
    .from("approval_requests")
    .select("*")
    .eq("status", "approved")
    .is("executed_at", null);
  if (onlyId) q = q.eq("id", onlyId);
  const { data: fila } = await q.order("created_at", { ascending: true }).limit(10);
  if (!fila?.length)
    return json({
      ok: true,
      processados: 0,
      nota: "fila vazia (nenhum aprovado pendente de execução)",
      pipeboard_conexao: pipeboardMonitor ?? {
        ok: false,
        token_status: null,
        connection_id: null,
        alerta:
          "PIPEBOARD_API_TOKEN ausente — monitor e driver pipeboard indisponiveis ate cadastrar o Edge Secret",
        erro: "token_ausente",
      },
      versao: "meta-actions-v5",
      mcp_chamador: auth.chamador,
      mcp_chave_legada: auth.legado,
    });

  const { count: naHora } = await supa
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "meta_action_executed")
    .gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  let executadasNaHora = naHora ?? 0;

  const resultados: any[] = [];
  for (const r of fila) {
    const acao = String(r.action);
    const alvoExt = String(r.payload?.target_external_id ?? "");
    const alvoNome = String(r.payload?.target_name ?? r.summary);
    const sistema = r.reviewed_by ?? r.requested_by;

    // v3: config DA EMPRESA DESTE CARD. Sem linha propria, nada executa.
    const { data: conf } = await supa
      .from("meta_execution_config")
      .select("*")
      .eq("company_id", r.company_id)
      .maybeSingle();
    if (!conf) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "empresa sem configuracao de execucao propria",
        acao,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "empresa sem configuracao de execucao - nada e executado sem config propria",
      });
      continue;
    }
    const contasOk: string[] = (conf.contas_permitidas_criacao ?? []).map((x: string) => actId(x));
    const tetoSanidade = Number(conf.teto_sanidade_orcamento_diario ?? 5000);
    const flagsOk = conf.master_enabled === true && conf.action_flags?.[acao] === true;
    const rateOk = executadasNaHora < conf.max_actions_per_hour;
    // v5: driver vem da config da empresa — o mesmo campo que pode_executar_acao devolve.
    // Diz por ONDE o ultimo passo sai, nunca SE sai.
    const driver = driverDe(conf);

    // ==================== CAMINHO DE CRIACAO (v2) ====================
    if (CRIACAO.includes(acao)) {
      // v2: expiracao - cards vencidos ja viram 'rejected' pelo cron, mas checamos de novo
      // porque aprovacao antiga executando contra conta mudada e o risco que motivou o prazo.
      if (r.expires_at && new Date(r.expires_at) < new Date()) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "pedido expirado",
          acao,
          prazo: r.expires_at,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: "pedido expirado (24h)",
          driver_escrita: driver,
        });
        continue;
      }

      const conta = actId(String(r.payload?.conta_destino ?? ""));
      if (!contasOk.length || !contasOk.includes(conta)) {
        const motivo = `conta de destino ${conta || "(vazia)"} nao esta na lista de contas permitidas para criacao`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          contas_permitidas: contasOk,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }

      // v28.11 (06/08/2026) - PECA EM REVISAO DE COMPLIANCE E IMPEDIMENTO, TAMBEM AQUI.
      // pedido_de_anuncio_completo passou a recusar antes de existir card, mas este gate existe
      // porque tres caminhos furam o de cima: card emitido ANTES desta correcao, pedido montado
      // por fora do traffic-chat, e peca escalada DEPOIS da aprovacao e antes da execucao. O
      // ultimo passo e o que gasta, e e o unico lugar onde nada mais vem depois.
      // Vale inclusive em dry_run, de proposito: gate que a simulacao atravessa nao e gate, e o
      // dry_run e justamente onde se conferiria que ele pega.
      // A doutrina fica na RPC (peca_bloqueada_por_revisao), a mesma que a verificacao do pedido
      // usa - reescreve-la aqui seria a mesma regra em dois lugares, divergindo com o tempo.
      if (acao === "criar_anuncio_a_partir_de") {
        const { data: bloq, error: bloqErr } = await supa.rpc("peca_bloqueada_por_revisao", {
          p_company_id: r.company_id,
          p_drive_file_id: r.payload?.drive_file_id ?? null,
          p_meta_video_id: r.payload?.meta_video_id ?? null,
        });
        // Verificador que nao respondeu nao liberou nada: sem resposta, nao executa.
        const indisponivel = !!bloqErr || !bloq;
        if (indisponivel || (bloq as any).bloqueada === true) {
          const motivo = indisponivel
            ? `verificacao_de_peca_em_revisao_indisponivel (${bloqErr?.message ?? "resposta vazia"})`
            : "peca_em_revisao_bloqueia_uso";
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
            peca_em_revisao: bloq ?? null,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "bloqueado",
            motivo: (bloq as any)?.mensagem ?? motivo,
            driver_escrita: driver,
          });
          continue;
        }
      }

      // v5.5 (07/08/2026) - PAR LEGENDA+PECA REPROVADO E IMPEDIMENTO, TAMBEM AQUI. Espelha o gate
      // de peca em revisao logo acima e pela mesma razao: pedido_de_anuncio_completo passou a CHAMAR
      // checar_par_texto_e_peca na emissao e recusar em reprova, mas tres caminhos furam o de cima -
      // card emitido ANTES desta correcao, pedido montado por fora do traffic-chat, e legenda ou peca
      // trocada DEPOIS da aprovacao. O ultimo passo e o que gasta. So bloqueia quando existem OS DOIS
      // lados (legenda e peca com texto lido) e o veredito e 'reprova'; falta de um lado NAO bloqueia
      // aqui (nao se inventa recusa por ausencia). A doutrina fica na RPC - a mesma que a emissao usa.
      if (
        acao === "criar_anuncio_a_partir_de" &&
        r.payload?.drive_file_id &&
        String(r.payload?.legenda ?? "").trim()
      ) {
        const { data: par, error: parErr } = await supa.rpc("checar_par_texto_e_peca", {
          p_company_id: r.company_id,
          p_legenda: String(r.payload.legenda),
          p_drive_file_id: String(r.payload.drive_file_id),
        });
        const cob = (par as any)?.cobertura ?? {};
        const doisLados = cob?.peca_encontrada === true && cob?.texto_da_peca_lido === true;
        // Verificador que nao respondeu nao liberou nada: fail-closed, como o gate de revisao.
        if (parErr || !par) {
          const motivo = `verificacao_do_par_texto_e_peca_indisponivel (${parErr?.message ?? "resposta vazia"})`;
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
          });
          resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
          continue;
        }
        if (doisLados && (par as any).veredito === "reprova") {
          const motivo = "par_texto_e_peca_reprova";
          const detalhe =
            "O PAR legenda+peca reprovou no compliance de texto: a peca MOSTRA valor/taxa/prazo na tela e a legenda da publicacao nao traz o CET. O card NAO foi executado - uma peca liberada sob condicao viraria anuncio com a condicao nao cumprida. Para liberar, a legenda da publicacao precisa trazer o CET.";
          await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
            motivo,
            detalhe,
            acao,
            driver_escrita: driver,
            dry_run: conf.dry_run === true,
            par_texto_e_peca: par,
          });
          resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo: detalhe, driver_escrita: driver });
          continue;
        }
      }

      if (driver === "pipeboard" && pipeboardMonitor && !pipeboardMonitor.ok) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "pipeboard_conexao_inativa",
          alerta: pipeboardMonitor.alerta,
          token_status: pipeboardMonitor.token_status,
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo: pipeboardMonitor.alerta ?? "pipeboard_conexao_inativa",
          driver_escrita: driver,
        });
        continue;
      }
      if (driver === "pipeboard" && !pbToken) {
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo: "PIPEBOARD_API_TOKEN ausente",
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "bloqueado",
          motivo:
            "PIPEBOARD_API_TOKEN ausente — cadastre o Edge Secret antes de usar driver pipeboard",
          driver_escrita: driver,
        });
        continue;
      }

      const plano = await montarCriacao(acao, r.payload, conta, tetoSanidade);
      if ((plano as any).erro) {
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: (plano as any).erro,
          detalhe: (plano as any).detalhe ?? null,
          // "recusa_do_proprio_sistema" distingue, no card, o "nao" que NOS demos - antes de
          // qualquer chamada - do "nao" que veio da plataforma. Os dois sao falha; so um deles
          // significa que a Meta chegou a ser consultada.
          etapa: "recusa_do_proprio_sistema",
          acao,
          driver_escrita: driver,
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: (plano as any).erro,
          driver_escrita: driver,
        });
        continue;
      }
      const pl: any = plano;

      if (conf.dry_run) {
        // v5: com pipeboard + dry_run, campanha chega ao conector (dry_run nativo).
        // Demais niveis: simulacao local + lacuna declarada (5.1).
        let ensaioPipeboard: ResultadoEscrita | null = null;
        if (driver === "pipeboard" && acao === "criar_campanha") {
          ensaioPipeboard = await escreverCriacao(driver, acao, conta, pl.path, pl.body, pbToken, {
            dry_run: true,
          });
        }
        await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
          SIMULADO: true,
          acao,
          conta,
          driver_escrita: driver,
          criaria_em: pl.path,
          com_body: pl.body,
          criativo: pl.criativo ?? null,
          molde_lido: pl.molde_lido ?? null,
          peca_nova: pl.peca_nova ?? null,
          pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
          pipeboard_resposta: ensaioPipeboard?.body ?? null,
          pipeboard_nota:
            ensaioPipeboard?.nota_dry_run ??
            (driver === "pipeboard" && acao !== "criar_campanha"
              ? "dry_run nativo so em create_campaign/update_campaign; neste nivel a simulacao e local"
              : null),
          pipeboard_conexao: pipeboardMonitor,
          flags_permitiriam: {
            master: conf.master_enabled,
            flag_acao: conf.action_flags?.[acao] === true,
            rate_ok: rateOk,
          },
          nota: "dry_run=true: NADA foi criado na Meta; executed_at NÃO preenchido",
        });
        resultados.push({
          id: r.id,
          acao,
          resultado: "SIMULADO",
          conta,
          driver_escrita: driver,
          criaria_em: pl.path,
          nome_novo: pl.body?.name,
          status_inicial: pl.body?.status,
          criativo_modo: pl.criativo?.modo ?? null,
          criativo_aviso: pl.criativo?.aviso ?? null,
          peca_nova: pl.peca_nova ?? null,
          flags_permitiriam: flagsOk && rateOk,
          pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
        });
        continue;
      }

      if (!flagsOk || !rateOk) {
        const motivo = !conf.master_enabled
          ? "master_enabled=false"
          : conf.action_flags?.[acao] !== true
            ? `flag ${acao}=false`
            : "rate limit atingido";
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }

      // Passo previo: criar adcreative novo (so no caso do anuncio com object_story_spec).
      const bodyFinal: Record<string, string> = { ...pl.body };
      let creativeCriado: any = null;
      // v4.4: cobre "novo_adcreative" (replicacao com UTM nova) e "novo_adcreative_peca_nova"
      // (spec do molde com a midia trocada). Os dois criam adcreative antes do anuncio.
      if (String(pl.criativo?.modo ?? "").startsWith("novo_adcreative")) {
        const cc = await escreverCreative(
          driver,
          conta,
          pl.criativo.path,
          pl.criativo.body,
          pbToken,
        );
        if (cc.status !== 200 || !cc.id) {
          await audit(r.company_id, sistema, "meta_action_failed", r.id, {
            motivo: "falha ao criar adcreative",
            etapa: "create_ad_creative",
            resposta: cc,
            acao,
            driver_escrita: driver,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "falha_meta",
            etapa: "adcreative",
            driver_escrita: driver,
            detalhe: cc.body,
          });
          continue;
        }
        creativeCriado = cc.id;
        bodyFinal.creative = JSON.stringify({ creative_id: creativeCriado });
      } else if (pl.criativo?.modo === "reusar_creative_id") {
        bodyFinal.creative = JSON.stringify({ creative_id: pl.criativo.creative_id });
      }

      // Timeout / resposta ambigua: antes de repetir, a protecao continua sendo
      // executed_at null + varredura. Em pipeboard, se a resposta nao trouxer id, nao
      // marcamos sucesso — a proxima corrida pode conferir na Graph se o objeto nasceu.
      let exec: ResultadoEscrita;
      if (acao === "criar_anuncio_a_partir_de") {
        const creativeId =
          creativeCriado ??
          (pl.criativo?.modo === "reusar_creative_id" ? pl.criativo.creative_id : null);
        if (!creativeId) {
          await audit(r.company_id, sistema, "meta_action_failed", r.id, {
            motivo: "sem creative_id para criar anuncio",
            etapa: "create_ad",
            detalhe:
              "Nao criei o anuncio porque nao havia criativo para associar a ele. Nada foi criado na Meta.",
            acao,
            driver_escrita: driver,
          });
          resultados.push({
            id: r.id,
            acao,
            resultado: "falha",
            motivo: "sem creative_id",
            driver_escrita: driver,
          });
          continue;
        }
        exec = await escreverAd(driver, conta, pl.path, bodyFinal, String(creativeId), pbToken);
      } else {
        exec = await escreverCriacao(driver, acao, conta, pl.path, bodyFinal, pbToken);
      }
      const novoId = exec.id;
      const sucesso = !!novoId && !exec.erro && (exec.status === 200 || exec.ok === true);
      // Confere o estado do que nasceu: o status (PAUSED desde a v4.3) e verificado, nao assumido.
      // v5: reconciliacao pela Graph e obrigatoria apos escrita real (unica forma de saber o
      // que o Pipeboard fez — nao ha log exportavel do conector).
      let depois: { status: number; body: any } = { status: 0, body: null };
      let reconciliacao: Reconciliacao | null = null;
      if (sucesso && novoId) {
        const rec = await reconciliarAposEscrita(
          novoId,
          acao,
          pedidoDeReconciliacao(acao, bodyFinal, r.payload),
        );
        depois = rec.graph;
        reconciliacao = rec.reconciliacao;
      }
      // Objeto lido SO existe quando a leitura deu certo. Passar um envelope de erro adiante como
      // se fosse objeto e o que faz erro de leitura virar dado.
      const objetoLido = reconciliacao?.estado === "conferido" ? depois.body : null;

      await audit(
        r.company_id,
        sistema,
        sucesso ? "meta_action_executed" : "meta_action_failed",
        r.id,
        {
          acao,
          conta,
          etapa: acao === "criar_conjunto_a_partir_de" ? "create_adset" : "escrita_na_meta",
          driver_escrita: driver,
          ferramenta_pipeboard: exec.ferramenta ?? null,
          criado_em: pl.path,
          body_enviado: bodyFinal,
          adcreative_criado: creativeCriado,
          resposta: exec,
          // Objeto so quando a leitura deu certo; a resposta crua da Graph (inclusive envelope de
          // erro) fica em reconciliacao.lido, sem se disfarcar de objeto.
          objeto_criado: objetoLido,
          reconciliacao,
          reconciliacao_estado: reconciliacao?.estado ?? null,
          criativo_aviso: pl.criativo?.aviso ?? null,
          peca_nova: pl.peca_nova ?? null,
          pipeboard_conexao: driver === "pipeboard" ? pipeboardMonitor : null,
        },
      );

      if (sucesso) {
        executadasNaHora++;
        // v4.2: espelha ANTES de fechar o card, para que o proximo turno do agente ja veja.
        const esp = await espelhar(
          acao,
          novoId!,
          objetoLido,
          r.payload,
          conta,
          r.company_id,
          r.id,
          pl.molde_lido ?? null,
          creativeCriado ?? pl.criativo?.creative_id ?? null,
          String(bodyFinal.status ?? ""),
        );
        if (!esp.ok) {
          await audit(r.company_id, sistema, "meta_action_espelho_falhou", r.id, {
            acao,
            id_criado: novoId,
            tabela: esp.tabela ?? null,
            erro: esp.erro,
            driver_escrita: driver,
            nota: "O OBJETO EXISTE NA META. Falhou apenas a gravacao no espelho local - o sistema ficara cego para este objeto ate o proximo sync.",
          });
        }
        // v5.3: DUAS acoes, nao uma. "nao consegui olhar" (falhou) e "olhei e a Meta tem outro
        // valor" (divergente) sao fatos diferentes, e quem le o audit_log precisa distinguir sem
        // abrir o details. A escolha e da funcao compartilhada - a sonda usa a MESMA.
        const acaoRec = acaoDeAuditoriaDaReconciliacao(reconciliacao);
        if (acaoRec && reconciliacao) {
          await audit(r.company_id, sistema, acaoRec, r.id, {
            acao,
            id_criado: novoId,
            estado: reconciliacao.estado,
            divergencias: reconciliacao.divergencias,
            erro_leitura: reconciliacao.erro_leitura,
            campos_pedidos: reconciliacao.campos_pedidos,
            campos_comparados: reconciliacao.campos_comparados,
            http_status: depois.status,
            lido: reconciliacao.lido,
            driver_escrita: driver,
            nota:
              reconciliacao.estado === "conferido"
                ? "OLHEI o objeto na Graph e um valor difere do que foi pedido."
                : "NAO consegui olhar o objeto na Graph. Isto NAO afirma que o objeto esta errado - nada foi concluido sobre valor nenhum. O objeto EXISTE na Meta (a escrita voltou id).",
          });
        }
        await supa
          .from("approval_requests")
          .update({
            executed_at: new Date().toISOString(),
            // Sucesso APAGA a falha anterior: card que deu certo depois de uma tentativa ruim nao
            // pode continuar exibindo o erro velho como se fosse o estado atual.
            ultima_falha: null,
            execution_result: {
              ok: true,
              id_criado: novoId,
              objeto: objetoLido,
              adcreative_criado: creativeCriado,
              aviso: pl.criativo?.aviso ?? null,
              peca_nova: pl.peca_nova ?? null,
              espelho_gravado: esp.ok,
              espelho_tabela: esp.tabela ?? null,
              espelho_erro: esp.erro ?? null,
              driver_escrita: driver,
              reconciliacao,
              reconciliacao_estado: reconciliacao?.estado ?? null,
              reconciliacao_conferida: reconciliacao?.estado === "conferido",
              reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
              lembrete:
                "Objeto criado PAUSADO (v4.3). A aprovacao CRIOU o objeto e NAO iniciou entrega nem gasto. Para comecar a entregar, o gestor precisa ATIVAR manualmente no Gerenciador - conferindo a arvore inteira antes.",
            },
          })
          .eq("id", r.id);
      }
      // Falha DEPOIS de criar adcreative deixa o card re-executavel (executed_at null) e a
      // proxima corrida cria OUTRO creative orfao. Evidencia 07/08: card e4dd146d gerou
      // 2635490320208656 e 1023859480523471 no mesmo conjunto DC. Fecha o card com ok=false
      // quando ja houve escrita parcial; retry exige card novo (decisao humana).
      if (!sucesso) {
        const t = traduzirFalha(exec.body ?? exec.erro ?? null);
        if (creativeCriado) {
          await supa
            .from("approval_requests")
            .update({
              executed_at: new Date().toISOString(),
              execution_result: {
                ok: false,
                etapa: "create_ad",
                adcreative_criado: creativeCriado,
                id_criado: null,
                detalhe: exec.body ?? exec.erro ?? null,
                recusa: t.recusa,
                motivo_para_o_gestor: t.motivo_para_o_gestor,
                driver_escrita: driver,
                nota:
                  "Escrita parcial: adcreative nasceu na Meta/Pipeboard, create_ad falhou. Card fechado para nao duplicar creative. Limpar orfao no Gerenciador se necessario.",
              },
              ultima_falha: {
                em: new Date().toISOString(),
                etapa: "create_ad",
                recusa: t.recusa,
                motivo_para_o_gestor: t.motivo_para_o_gestor,
                detalhe_tecnico: redact(JSON.stringify(exec.body ?? exec.erro ?? null)).slice(0, 1000),
                tentativa: Number(r.ultima_falha?.tentativa ?? 0) + 1,
                re_executavel: false,
                driver_escrita: driver,
              },
            })
            .eq("id", r.id);
        }
        // Sem creativeCriado, NADA foi escrito na Meta: o card segue elegivel para nova tentativa
        // e executed_at continua nulo, de proposito. Esse e o caso do b5e2f338, e ele ja saiu
        // marcado pelo audit("meta_action_failed") logo acima - o unico caminho que, antes desta
        // versao, nao deixava rastro nenhum no card.
      }
      resultados.push({
        id: r.id,
        acao,
        resultado: sucesso ? "CRIADO" : "falha_meta",
        id_criado: novoId,
        status: (objetoLido as any)?.status ?? null,
        aviso: pl.criativo?.aviso ?? null,
        detalhe: sucesso ? null : (exec.body ?? exec.erro),
        driver_escrita: driver,
        reconciliacao,
        reconciliacao_estado: reconciliacao?.estado ?? null,
        reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
        adcreative_orfao: !sucesso && creativeCriado ? creativeCriado : null,
      });
      continue;
    }

    // ==================== CAMINHO v1: MODIFICAR EXISTENTE ====================
    if (!EXECUTAVEIS.includes(acao)) {
      resultados.push({
        id: r.id,
        acao,
        resultado: "pulado",
        motivo: "ação não automatizada (decisão manual)",
      });
      continue;
    }
    if (!alvoExt) {
      resultados.push({
        id: r.id,
        acao,
        resultado: "falha",
        motivo: "payload sem target_external_id",
      });
      await audit(r.company_id, sistema, "meta_action_failed", r.id, {
        motivo: "sem target_external_id",
        acao,
      });
      continue;
    }
    if (r.expires_at && new Date(r.expires_at) < new Date()) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "pedido expirado",
        acao,
        prazo: r.expires_at,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "pedido expirado (24h)",
        driver_escrita: driver,
      });
      continue;
    }

    if (driver === "pipeboard" && pipeboardMonitor && !pipeboardMonitor.ok) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "pipeboard_conexao_inativa",
        alerta: pipeboardMonitor.alerta,
        token_status: pipeboardMonitor.token_status,
        acao,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: pipeboardMonitor.alerta ?? "pipeboard_conexao_inativa",
        driver_escrita: driver,
      });
      continue;
    }
    if (driver === "pipeboard" && !pbToken) {
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo: "PIPEBOARD_API_TOKEN ausente",
        acao,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        resultado: "bloqueado",
        motivo: "PIPEBOARD_API_TOKEN ausente",
        driver_escrita: driver,
      });
      continue;
    }

    // v5.3: mesma lista derivada por nivel do caminho de criacao. A lista fixa que estava aqui
    // pedia daily_budget SEMPRE - em pausar_criativo (nivel de anuncio) isso derruba o GET inteiro
    // com #100 e o "antes"/"depois" do card viram envelope de erro. O defeito era o mesmo nos dois
    // caminhos; consertar so um deixaria a metade de baixo para a proxima execucao real descobrir.
    const nivelAlvo = nivelDaAcao(acao);
    const camposAlvo = nivelAlvo ? camposDeReconciliacao(nivelAlvo) : null;
    const antes: { status: number; body: any } = camposAlvo
      ? await g(`/${alvoExt}?fields=${camposAlvo}`)
      : { status: 0, body: null };

    let post: Record<string, string> | null = null;
    if (acao === "pausar_criativo" || acao === "pausar_campanha") post = { status: "PAUSED" };
    if (acao === "renomear_campanha") {
      const novoNome = String(r.payload?.novo_nome ?? "").trim();
      if (!novoNome) {
        resultados.push({ id: r.id, acao, resultado: "falha", motivo: "novo_nome ausente/vazio", driver_escrita: driver });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: "novo_nome ausente/vazio", payload: r.payload, driver_escrita: driver,
        });
        continue;
      }
      if (driver !== "pipeboard") {
        const motivo = `renomear_campanha_exige_pipeboard (driver atual: ${driver})`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, { motivo, acao, driver_escrita: driver });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }
      post = { name: novoNome };
    }
    if (acao === "alterar_orcamento") {
      const reais = Number(r.payload?.novo_orcamento_diario_reais ?? 0);
      if (!(reais > 0)) {
        resultados.push({
          id: r.id,
          acao,
          resultado: "falha",
          motivo: "novo_orcamento_diario_reais ausente/inválido",
          driver_escrita: driver,
        });
        await audit(r.company_id, sistema, "meta_action_failed", r.id, {
          motivo: "orcamento invalido",
          payload: r.payload,
          driver_escrita: driver,
        });
        continue;
      }
      // v2: teto de sanidade tambem na alteracao - a confusao reais/centavos vale aqui igual.
      if (reais > tetoSanidade) {
        const motivo = `orcamento ${reais} acima do teto de sanidade ${tetoSanidade}`;
        await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
          motivo,
          acao,
          payload: r.payload,
          driver_escrita: driver,
        });
        resultados.push({ id: r.id, acao, resultado: "bloqueado", motivo, driver_escrita: driver });
        continue;
      }
      post = { daily_budget: String(Math.round(reais * 100)) };
    }

    if (conf.dry_run) {
      let ensaioPipeboard: ResultadoEscrita | null = null;
      if (driver === "pipeboard" && (acao === "pausar_campanha" || acao === "renomear_campanha") && post) {
        ensaioPipeboard = await escreverUpdate(driver, acao, alvoExt, post, pbToken, {
          dry_run: true,
        });
      }
      await audit(r.company_id, sistema, "meta_action_dry_run", r.id, {
        SIMULADO: true,
        acao,
        alvo: alvoNome,
        alvo_external_id: alvoExt,
        driver_escrita: driver,
        chamaria: post,
        estado_atual_meta: antes.body,
        pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
        pipeboard_resposta: ensaioPipeboard?.body ?? null,
        pipeboard_nota:
          ensaioPipeboard?.nota_dry_run ??
          (driver === "pipeboard" && acao !== "pausar_campanha" && acao !== "renomear_campanha"
            ? "dry_run nativo so em create_campaign/update_campaign; neste nivel a simulacao e local"
            : null),
        pipeboard_conexao: pipeboardMonitor,
        flags_permitiriam: {
          master: conf.master_enabled,
          flag_acao: conf.action_flags?.[acao] === true,
          rate_ok: rateOk,
        },
        nota: "dry_run=true: NADA foi enviado à Meta; executed_at NÃO preenchido",
      });
      resultados.push({
        id: r.id,
        acao,
        alvo: alvoNome,
        resultado: "SIMULADO",
        chamaria: post,
        estado_atual: (antes.body as any)?.status,
        flags_permitiriam: flagsOk && rateOk,
        driver_escrita: driver,
        pipeboard_dry_run_nativo: ensaioPipeboard?.dry_run_nativo ?? null,
      });
      continue;
    }

    if (!flagsOk || !rateOk) {
      const motivo = !conf.master_enabled
        ? "master_enabled=false"
        : conf.action_flags?.[acao] !== true
          ? `flag ${acao}=false`
          : "rate limit atingido";
      await audit(r.company_id, sistema, "meta_action_blocked", r.id, {
        motivo,
        acao,
        alvo: alvoNome,
        driver_escrita: driver,
      });
      resultados.push({
        id: r.id,
        acao,
        alvo: alvoNome,
        resultado: "bloqueado",
        motivo,
        driver_escrita: driver,
      });
      continue;
    }
    const exec = await escreverUpdate(driver, acao, alvoExt, post!, pbToken);
    const depois: { status: number; body: any } = camposAlvo
      ? await g(`/${alvoExt}?fields=${camposAlvo}`)
      : { status: 0, body: null };
    // O transporte MCP pode responder HTTP 200 com erro no corpo; `ok` é o veredito normalizado.
    const sucesso = exec.ok === true;
    // O pedido de update ja e naturalmente por nivel: post traz status (pausas) ou daily_budget
    // (orcamento), nunca os dois.
    const reconciliacao: Reconciliacao | null = !sucesso
      ? null
      : camposAlvo
        ? compararPedidoComGraph(
            { status: post?.status, daily_budget: post?.daily_budget, name: post?.name },
            depois.body,
            { http_status: depois.status, campos: camposAlvo },
          )
        : reconciliacaoNivelDesconhecido(acao);
    const alvoLido = reconciliacao?.estado === "conferido" ? depois.body : null;
    await audit(
      r.company_id,
      sistema,
      sucesso ? "meta_action_executed" : "meta_action_failed",
      r.id,
      {
        acao,
        alvo: alvoNome,
        alvo_external_id: alvoExt,
        driver_escrita: driver,
        ferramenta_pipeboard: exec.ferramenta ?? null,
        chamada: post,
        resposta: exec,
        antes: antes.body,
        depois: depois.body,
        reconciliacao,
        reconciliacao_estado: reconciliacao?.estado ?? null,
        pipeboard_conexao: driver === "pipeboard" ? pipeboardMonitor : null,
      },
    );
    if (sucesso) {
      executadasNaHora++;
      const acaoRec = acaoDeAuditoriaDaReconciliacao(reconciliacao);
      if (acaoRec && reconciliacao) {
        await audit(r.company_id, sistema, acaoRec, r.id, {
          acao,
          alvo_external_id: alvoExt,
          estado: reconciliacao.estado,
          divergencias: reconciliacao.divergencias,
          erro_leitura: reconciliacao.erro_leitura,
          campos_pedidos: reconciliacao.campos_pedidos,
          campos_comparados: reconciliacao.campos_comparados,
          http_status: depois.status,
          lido: reconciliacao.lido,
          driver_escrita: driver,
          nota:
            reconciliacao.estado === "conferido"
              ? "OLHEI o objeto na Graph e um valor difere do que foi pedido."
              : "NAO consegui olhar o objeto na Graph depois da escrita. Isto NAO afirma que a alteracao falhou - nada foi concluido sobre o valor.",
        });
      }
      await supa
        .from("approval_requests")
        .update({
          executed_at: new Date().toISOString(),
          ultima_falha: null, // sucesso apaga a falha da tentativa anterior
          execution_result: {
            ok: true,
            antes: antes.body,
            depois: alvoLido,
            driver_escrita: driver,
            reconciliacao,
            reconciliacao_estado: reconciliacao?.estado ?? null,
            reconciliacao_conferida: reconciliacao?.estado === "conferido",
            reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
          },
        })
        .eq("id", r.id);
    }
    resultados.push({
      id: r.id,
      acao,
      alvo: alvoNome,
      resultado: sucesso ? "EXECUTADO" : "falha_meta",
      antes: (antes.body as any)?.status,
      depois: (alvoLido as any)?.status ?? null,
      driver_escrita: driver,
      reconciliacao,
      reconciliacao_estado: reconciliacao?.estado ?? null,
      reconciliacao_erro_leitura: reconciliacao?.erro_leitura ?? null,
    });
  }

  // v3: nao ha "modo" unico - cada card foi avaliado sob a config da sua empresa.
  return json({
    ok: true,
    versao: "meta-actions-v5",
    mcp_chamador: auth.chamador,
    mcp_chave_legada: auth.legado,
    processados: resultados.length,
    resultados,
    pipeboard_conexao: pipeboardMonitor ?? {
      ok: false,
      token_status: null,
      connection_id: null,
      alerta: pbToken
        ? null
        : "PIPEBOARD_API_TOKEN ausente — monitor e driver pipeboard indisponiveis ate cadastrar o Edge Secret",
      erro: pbToken ? undefined : "token_ausente",
    },
    nota: "configuracao de execucao e por empresa (meta_execution_config.company_id); driver_escrita diz por onde o ultimo passo sai (graph|pipeboard), nunca SE sai. Nenhuma action_flag foi alterada por este deploy.",
  });
});
