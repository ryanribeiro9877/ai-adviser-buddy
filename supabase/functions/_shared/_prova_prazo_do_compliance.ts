// Prova do prazo do compliance dentro do turno do chat. Incidente de 15/10/2026, conversa
// bf4a8869, mensagem do gestor 790c520c (18:55:29 UTC): "agora atribua a esse conjunto os
// criativos: AD_C2_CARTAO_ARMADILHA / AD_C3_VALOR_INCORRETO / AD_C1_JUROS_ALTO" ficou SEM
// resposta. Conferido no banco e no log do gateway:
//   - 18:55:28.4 inicio do turno (worker 78ce9d71, chat-v29.24);
//   - card 1 (AD_C2): compliance-check leu as regras 18:56:10.3, a OpenRouter levou ~29,7s,
//     approval 32701d3c inserido 18:56:40.04;
//   - card 2: compliance-check leu as regras 18:56:41.87 e o worker NAO fez mais nenhuma
//     chamada — nem card, nem modelo, nem gravacao da resposta;
//   - o navegador recebeu 504 em 18:57:58 (150s do gateway) e varreu o banco 45s sem achar nada.
// t_check_compliance fazia `fetch` sem prazo: uma validacao lenta segurava o HTTP do chat alem
// dos 150s e a resposta nunca era gravada. Card 1 existia, o gestor nao soube.
// Roda com: deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_prazo_do_compliance.ts

import {
  buscarComPrazo,
  COMPLIANCE_PISO_MS,
  COMPLIANCE_TETO_MS,
  complianceSemPrazo,
  ERRO_CARD_SEM_TEMPO_DE_COMPLIANCE,
  ERRO_COMPLIANCE_SEM_PRAZO,
  prazoDoCompliance,
  recusaPorPrazoDoCompliance,
} from "./prazo_do_compliance.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

// Numeros do traffic-chat (HARD_LIMIT_MS, RESERVA_GRAVACAO_MS) e do gateway Supabase.
const HARD_LIMIT_MS = 118_000;
const RESERVA_GRAVACAO_MS = 8_000;
const IDLE_GATEWAY_MS = 150_000;

// ===== 1) O incidente: o card 2 comecou aos ~72s e a validacao nao voltou =====
{
  const tInicio = 0;
  const prazoEm = tInicio + HARD_LIMIT_MS - RESERVA_GRAVACAO_MS;
  const inicioCard2 = tInicio + 73_500; // compliance-check do card 2 lendo regras (18:56:41.87)
  const ms = prazoDoCompliance(inicioCard2, prazoEm);
  ok(ms > 0, "o card 2 do incidente nem teria tempo de tentar");
  ok(inicioCard2 + ms <= prazoEm, "o compliance passa do prazo do turno");
  ok(
    inicioCard2 + ms + RESERVA_GRAVACAO_MS < IDLE_GATEWAY_MS,
    "mesmo abortando no prazo, nao sobra tempo de gravar antes do 504 do gateway",
  );
}

// ===== 2) Sem prazo do turno (chamador fora do chat): teto, nunca infinito =====
{
  ok(prazoDoCompliance(1_000) === COMPLIANCE_TETO_MS, "sem prazo do turno o compliance fica sem teto");
  ok(prazoDoCompliance(1_000, null) === COMPLIANCE_TETO_MS, "prazo nulo nao cai no teto");
  // Medido em 15/10: 29,7 / 30,2 / 31,3 / 33,7 / 45,5s. O teto nao pode cortar a validacao normal.
  ok(COMPLIANCE_TETO_MS >= 46_000, "teto corta validacao que hoje leva 45,5s");
  ok(COMPLIANCE_TETO_MS < IDLE_GATEWAY_MS - RESERVA_GRAVACAO_MS, "teto sozinho ja estoura o gateway");
  ok(prazoDoCompliance(10_000, 5_000) === 0, "prazo vencido nao vira zero");
  ok(prazoDoCompliance(0, 500_000) === COMPLIANCE_TETO_MS, "prazo longe passa do teto");
}

// ===== 3) buscarComPrazo aborta de verdade a chamada que nao volta =====
{
  let abortou = false;
  const pendurada = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => {
        abortou = true;
        rej(new DOMException("aborted", "AbortError"));
      });
    })) as typeof fetch;
  const t0 = Date.now();
  const r = await buscarComPrazo(pendurada, "https://x/compliance-check", { method: "POST" }, COMPLIANCE_PISO_MS + 200);
  const gasto = Date.now() - t0;
  ok(r.estourou === true, "chamada pendurada nao foi dada como estourada");
  ok(abortou, "o sinal de abort nao chegou ao fetch");
  ok(gasto < COMPLIANCE_PISO_MS + 2_000, `buscarComPrazo esperou ${gasto}ms alem do prazo`);
}

// ===== 4) Sem tempo minimo nem chama =====
{
  let chamou = false;
  const espia = (() => {
    chamou = true;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  const r = await buscarComPrazo(espia, "https://x/compliance-check", { method: "POST" }, COMPLIANCE_PISO_MS - 1);
  ok(r.estourou === true, "sem tempo minimo deveria sair como estourado");
  ok(!chamou, "chamou o compliance sem tempo de esperar a resposta");
}

// ===== 5) Resposta que volta no prazo passa intacta =====
{
  const rapida = (() => Promise.resolve(new Response('{"veredito":"aprovado"}', { status: 200 }))) as typeof fetch;
  const r = await buscarComPrazo(rapida, "https://x/compliance-check", { method: "POST" }, 10_000);
  ok(r.estourou === false && r.status === 200 && /aprovado/.test(r.texto), "resposta no prazo foi alterada");
}

// ===== 6) Erro de rede nao vira "estourou" (continua sendo erro, como antes) =====
{
  const quebrada = (() => Promise.reject(new TypeError("connection reset"))) as typeof fetch;
  let lancou = false;
  try {
    await buscarComPrazo(quebrada, "https://x/compliance-check", { method: "POST" }, 10_000);
  } catch {
    lancou = true;
  }
  ok(lancou, "erro de rede foi disfarcado de prazo estourado");
}

// ===== 7) Card sem veredito: nao e aprovacao, nao e reprovacao, e continua no proximo bloco =====
{
  const comp = { erro: ERRO_COMPLIANCE_SEM_PRAZO, prazo_ms: 36_000 };
  ok(complianceSemPrazo(comp), "veredito ausente por prazo nao reconhecido");
  ok(!complianceSemPrazo({ veredito: "reprovado" }), "reprovacao confundida com prazo");
  ok(!complianceSemPrazo({ erro: "compliance-check falhou (500)" }), "erro do compliance confundido com prazo");
  const recusa = recusaPorPrazoDoCompliance(comp);
  ok(recusa.erro === ERRO_CARD_SEM_TEMPO_DE_COMPLIANCE, "recusa por prazo sem o codigo proprio");
  // O fim do turno separa falha dura (nao continua) de falta de tempo (continua). Mesma regex de
  // `proposesDuros` no traffic-chat: a recusa por prazo NAO pode cair nela.
  const RE_DURO =
    /peca_nova_sem_molde|compliance_bloqueou|pedido_incompleto|verificacao_do_pedido|molde_|legenda_|destino_|pergunta_nao_e_ato|comentario_do_post_nao_e_ato|orcamento_parece_centavos|orcamento_diferente_do_contrato/i;
  ok(!RE_DURO.test(recusa.erro), "recusa por prazo seria lida como falha dura e o turno pararia");
  const aviso = String(recusa.aviso ?? "").toLowerCase();
  ok(/nao foi criado/.test(aviso), "aviso nao diz que o card NAO foi criado");
  ok(/proximo bloco/.test(aviso), "aviso nao diz que o sistema continua no proximo bloco");
}

// ===== 8) O chat usa isto: fetch do compliance com prazo, recusa propria, prazo no ctx =====
{
  const chat = await Deno.readTextFile(new URL("../traffic-chat/index.ts", import.meta.url));
  const ini = chat.indexOf("async function t_check_compliance(");
  ok(ini > 0, "t_check_compliance sumiu do traffic-chat");
  const fim = chat.indexOf("\n}\n", ini);
  const corpo = chat.slice(ini, fim);
  ok(/buscarComPrazo\(/.test(corpo), "t_check_compliance nao usa buscarComPrazo");
  ok(!/await fetch\(/.test(corpo), "t_check_compliance ainda faz fetch sem prazo");
  ok(/prazoDoCompliance\(/.test(corpo), "t_check_compliance nao calcula o prazo");
  ok(
    /prazoFerramentasEm:\s*tInicio \+ HARD_LIMIT_MS - RESERVA_GRAVACAO_MS/.test(chat),
    "ctx do turno nao carrega o prazo das ferramentas",
  );
  const chamadas = chat.match(/await t_check_compliance\([^;]*;/g) ?? [];
  ok(chamadas.length >= 3, `esperava 3 chamadas de t_check_compliance, achei ${chamadas.length}`);
  for (const c of chamadas) {
    ok(/prazo/i.test(c), `chamada sem prazo: ${c.slice(0, 120)}`);
  }
  ok(
    (chat.match(/complianceSemPrazo\(comp\)/g) ?? []).length >= 2,
    "o card de anuncio nao trata o compliance sem veredito por prazo (1a chamada e a de FIN-01)",
  );
  ok(
    /ERRO_CARD_SEM_TEMPO_DE_COMPLIANCE[\s\S]{0,200}deadlineTools = true/.test(chat),
    "o laco nao marca deadlineTools quando o card ficou sem tempo de compliance",
  );
}

console.log("ok: _prova_prazo_do_compliance");
