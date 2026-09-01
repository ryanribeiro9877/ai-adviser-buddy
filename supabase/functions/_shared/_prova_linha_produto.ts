// deno run --allow-read supabase/functions/_shared/_prova_linha_produto.ts
// P0 25/08/2026: peca La Felicità NUNCA entra em campanha/conjunto Jurídico (e o inverso).
// P0 25/08/2026 (2): CONJ.1 NUNCA cai no CONJ.4 da mesma linha.
import {
  ERRO_CONJUNTO_ERRADO,
  ERRO_CRUZAMENTO_LINHA_PRODUTO,
  ERRO_VOZ_LINHA_ERRADA,
  classificarLinhaProdutoCohapm,
  conjuntoNomeCasaComNumero,
  conjuntoVivoParaDestino,
  desempateDeConjunto,
  ehProsaDeLegenda,
  escolherConjuntosDaMesmaLinha,
  escolherConjuntosPorNumeroELinha,
  numeroConjuntoDaFala,
  recusarConjuntoErrado,
  recusarCruzamentoLinhaProduto,
} from "./memoria_conjunto.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FALHA: ${msg}`);
}

const pecaLafAd01 = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD01_ChegandoEmCasa_V3";
const pecaLafAd02 = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26_AD02_FamiliaGourmet_V1";
const campJur = "COHAPM_JURIDICO_CONV_LEVA01";
const setJur = "JURIDICO_CONJ.01 - MATURACAO";
const campLaf = "COHAPM_LAFELICITA_CONV_AGO26";
const setLaf = "LAFELICITA_CONJ.01 - DESCOBERTA";
const pecaJur = "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02";

assert(classificarLinhaProdutoCohapm(pecaLafAd01) === "la_felicita", "_LAF_ no nome do criativo");
assert(classificarLinhaProdutoCohapm(pecaLafAd02) === "la_felicita", "AD02 LAF");
assert(classificarLinhaProdutoCohapm("CONJ.1_LAF_8CRIATIVOS_JUN/JUL26") === "la_felicita", "pasta slate LAF");
assert(classificarLinhaProdutoCohapm(campJur) === "juridico", "campanha JURIDICO");
assert(classificarLinhaProdutoCohapm(setJur) === "juridico", "conjunto JURIDICO_CONJ.01");
assert(classificarLinhaProdutoCohapm(campLaf) === "la_felicita", "campanha LAFELICITA");
assert(classificarLinhaProdutoCohapm(pecaJur) === "juridico", "JUR_CONV_ criativo");
assert(classificarLinhaProdutoCohapm("COHAPM - VISTTA") === "sistema_ocular", "pasta VISTTA");
assert(classificarLinhaProdutoCohapm("COHAPM_SISTEMA_OCULAR_CONV") === "sistema_ocular", "campanha ocular");
assert(classificarLinhaProdutoCohapm("VISTTA e JURIDICO misturados") === null, "ambiguidade ocular×jur");
assert(classificarLinhaProdutoCohapm("AD_CONJ.2_APENAS_OCULOS_3") === "sistema_ocular", "oculos no nome e Sistema Ocular");

const captionJurVazada =
  "Você tem sentido vista cansada ou dor de cabeça no fim do dia? Acompanhar a saúde dos olhos com exames regulares previne problemas graves e mantém sua qualidade de vida em dia. Não deixe o cuidado com a sua visão para depois. Toque no botão abaixo e fale com nossa equipe pelo WhatsApp oficial do Jurídico COHAPM para receber orientações informativas sobre seus direitos e atendimentos..";
assert(ehProsaDeLegenda(captionJurVazada), "legenda longa e prosa, nao nome");
assert(!ehProsaDeLegenda("AD_CONJ.2_APENAS_OCULOS_3"), "nome de criativo nao e prosa");
assert(!ehProsaDeLegenda("1WEyQ3PwF5i21Yx9WJVJSCI9Bo7cmsKuU"), "drive_file_id nao e prosa");

const cardOculos3 = recusarCruzamentoLinhaProduto({
  estruturaNomes: ["COHAPM_VISTTA_CONV_WA_SET26", "CONJ.2_VISTTA_WA_7199185-8107"],
  pecaSinais: [
    "AD_CONJ.2_APENAS_OCULOS_3",
    "1WEyQ3PwF5i21Yx9WJVJSCI9Bo7cmsKuU",
    captionJurVazada,
  ],
});
assert(!cardOculos3.ok && cardOculos3.erro === ERRO_VOZ_LINHA_ERRADA, "copy Juridico em VISTTA e voz, nao cruzamento de peca");
assert(/NAO mude a campanha/i.test(cardOculos3.ok ? "" : cardOculos3.detalhe), "nao manda mudar a campanha");
assert(!/Reemitir SOMENTE em a campanha COHAPM_JURIDICO/i.test(cardOculos3.ok ? "" : cardOculos3.detalhe), "nao aponta JURIDICO como destino");

const copyVisttaOk = recusarCruzamentoLinhaProduto({
  estruturaNomes: ["COHAPM_VISTTA_CONV_WA_SET26", "CONJ.2_VISTTA_WA_7199185-8107"],
  pecaSinais: [
    "AD_CONJ.2_APENAS_OCULOS_3",
    "Toque no link e venha conhecer o Sistema Ocular VISTTA.",
  ],
});
assert(copyVisttaOk.ok, "copy VISTTA em destino VISTTA passa");

const cruzOcular = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: ["COHAPM Sistema Ocular · VISTTA/2026/08. Agosto/Criativo 01.jpeg"],
});
assert(!cruzOcular.ok && cruzOcular.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "VISTTA em JUR recusa");
assert(/Sistema Ocular/i.test(cruzOcular.ok ? "" : cruzOcular.detalhe), "nomeia Sistema Ocular");

const incidente = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: [pecaLafAd01, "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26"],
});
assert(!incidente.ok && incidente.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "incidente 25/08 recusa");
assert(/ERRO GRAVE/.test(incidente.ok ? "" : incidente.detalhe), "copy diz ERRO GRAVE");
assert(/La Felicit/i.test(incidente.ok ? "" : incidente.detalhe), "nomeia La Felicita");
assert(/Jur[ií]dico/i.test(incidente.ok ? "" : incidente.detalhe), "nomeia Juridico");
assert(incidente.ok === false && incidente.detalhe.includes(campJur), "cita campanha escolhida");
assert(incidente.ok === false && incidente.detalhe.includes(pecaLafAd01), "cita a peca");

const inverso = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campLaf, setLaf],
  pecaSinais: [pecaJur],
});
assert(!inverso.ok && inverso.erro === ERRO_CRUZAMENTO_LINHA_PRODUTO, "inverso JUR→LAF recusa");

const okLaf = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campLaf, setLaf],
  pecaSinais: [pecaLafAd01],
});
assert(okLaf.ok, "LAF em LAF passa");

const okJur = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: [pecaJur],
});
assert(okJur.ok, "JUR em JUR passa");

const incompleto = recusarCruzamentoLinhaProduto({
  estruturaNomes: [campJur, setJur],
  pecaSinais: ["01. Chegando em casa.mp4"],
});
assert(incompleto.ok, "sem sinal na peca nao inventa recusa");

const hits = [
  { name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" },
  { name: setLaf, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" },
];
const alinhados = escolherConjuntosDaMesmaLinha(hits, [pecaLafAd01], (h) => h.campaign);
assert(alinhados.length === 1 && alinhados[0].name === setLaf, "auto-pick CONJ.1 prefere LAF, nao o Juridico mais novo");

const soJur = escolherConjuntosDaMesmaLinha(
  [{ name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" }],
  [pecaLafAd01],
  (h) => h.campaign,
);
assert(soJur.length === 0, "nao escolhe Juridico quando a peca e LAF");

const setLafConj1 = "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26";
const setLafConj1b = "CONJ.1_LAF_8CRIATIVOS_JUNJUL26";
const setLafConj4 = "CONJ.4_LAF_10CRIATIVOS_AGO26";
assert(numeroConjuntoDaFala(setLafConj1) === 1, "CONJ.1_LAF_ com underscore e slash");
assert(numeroConjuntoDaFala(setLafConj1b) === 1, "CONJ.1 sem slash");
assert(conjuntoNomeCasaComNumero(setLafConj1, 1), "casa CONJ.1 vs CONJ.01");
assert(conjuntoNomeCasaComNumero("CONJ.01_LAF_x", 1), "CONJ.01 = CONJ.1");
assert(!conjuntoNomeCasaComNumero(setLafConj4, 1), "CONJ.4 nao e CONJ.1");
assert(conjuntoNomeCasaComNumero(setLafConj4, 4), "casa CONJ.4");

const recusaConj4 = recusarConjuntoErrado({
  pedidoNumero: 1,
  destNome: setLafConj4,
  pecaSinais: [pecaLafAd01, setLafConj1],
});
assert(!recusaConj4.ok && recusaConj4.erro === ERRO_CONJUNTO_ERRADO, "CONJ.1 peca recusa dest CONJ.4");
assert(/ERRO GRAVE/.test(recusaConj4.ok ? "" : recusaConj4.detalhe), "conjunto errado diz ERRO GRAVE");
assert((recusaConj4.ok ? "" : recusaConj4.detalhe).includes(setLafConj4), "cita CONJ.4 atual");

const okConj1 = recusarConjuntoErrado({
  pedidoNumero: 1,
  destNome: setLafConj1,
  pecaSinais: [pecaLafAd01],
});
assert(okConj1.ok, "CONJ.1 em CONJ.1 passa");

const inversoConj = recusarConjuntoErrado({
  pedidoNumero: 4,
  destNome: setLafConj1,
  pecaSinais: ["CONJ.4_LAF_10CRIATIVOS_AGO26_AD01"],
});
assert(!inversoConj.ok, "CONJ.4 peca recusa dest CONJ.1");

const hitsLaf = [
  { name: setLafConj4, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" },
  { name: setLafConj1, campaign: campLaf, created_at: "2026-06-01T10:00:00Z" },
  { name: setJur, campaign: campJur, created_at: "2026-08-25T17:00:00Z" },
];
const pick1 = escolherConjuntosPorNumeroELinha(hitsLaf, 1, [pecaLafAd01], (h) => h.campaign);
assert(pick1.length === 1 && pick1[0].name === setLafConj1, "auto-pick CONJ.1 nao devolve CONJ.4 mais novo");
const pick4 = escolherConjuntosPorNumeroELinha(hitsLaf, 4, ["CONJ.4_LAF_10CRIATIVOS_AGO26_AD01"], (h) => h.campaign);
assert(pick4.length === 1 && pick4[0].name === setLafConj4, "auto-pick CONJ.4 nao devolve CONJ.1");
const pick1vazio = escolherConjuntosPorNumeroELinha(
  [{ name: setLafConj4, campaign: campLaf, created_at: "2026-08-20T10:00:00Z" }],
  1,
  [pecaLafAd01],
  (h) => h.campaign,
);
assert(pick1vazio.length === 0, "pool CONJ.1 vazio nao cai em CONJ.4");

const chat = Deno.readTextFileSync(new URL("../traffic-chat/index.ts", import.meta.url));
const meta = Deno.readTextFileSync(new URL("../meta-actions/index.ts", import.meta.url));
const job = Deno.readTextFileSync(new URL("../traffic-agent-job/index.ts", import.meta.url));
const mcp = Deno.readTextFileSync(new URL("../mcp-server/index.ts", import.meta.url));
assert(chat.includes("recusarCruzamentoLinhaProduto"), "traffic-chat chama o gate na emissao");
assert(chat.includes("if (cruzAd) return cruzAd"), "criar_anuncio recusa ANTES do card");
assert(meta.includes("recusarCruzamentoLinhaProduto"), "meta-actions chama o gate no apply");
assert(meta.includes("nomesDestinoEspelhoCohapm"), "apply resolve nomes no espelho");
assert(job.includes("recusarCruzamentoLinhaProduto"), "job checa cruzamento em compliance");
assert(mcp.includes("recusarCruzamentoLinhaProduto"), "mcp checar_par recusa cruzamento");
assert(chat.includes("cruzamento_linha_produto") || chat.includes("ERRO_CRUZAMENTO_LINHA_PRODUTO"), "erro nomeado no chat");
assert(/ERRO GRAVE/.test(chat), "prompt do chat trata como erro grave");
assert(chat.includes("recusarConjuntoErrado") || chat.includes("ERRO_CONJUNTO_ERRADO"), "chat recusa CONJ.N errado");
assert(chat.includes("escolherConjuntosPorNumeroELinha"), "auto-pick por numero+linha");
assert(/PROIBIDO pedir ao gestor o ID numerico da Meta/.test(chat), "nao pede ID Graph");
assert(meta.includes("recusarConjuntoErrado"), "apply recusa CONJ.N errado");
assert(job.includes("recusarConjuntoErrado"), "job recusa CONJ.N errado");
assert(mcp.includes("recusarConjuntoErrado"), "mcp recusa CONJ.N errado");

// 01/09/2026: duplicata arquivada travou os anuncios do CONJ.1_VISTTA por horas.
// Arquivado nao e candidato, e duplicata na MESMA campanha nao se desempata por campanha.
assert(conjuntoVivoParaDestino({ status: "ACTIVE" }), "ACTIVE e destino valido");
assert(conjuntoVivoParaDestino({ status: "PAUSED" }), "PAUSED ainda recebe anuncio");
assert(conjuntoVivoParaDestino({}), "status ausente nao some do pool");
assert(!conjuntoVivoParaDestino({ status: "ARCHIVED" }), "ARCHIVED fora do pool");
assert(!conjuntoVivoParaDestino({ status: "archived" }), "case nao muda o veredito");
assert(!conjuntoVivoParaDestino({ status: "DELETED" }), "DELETED fora do pool");

const mesmaCamp = desempateDeConjunto("Ha 2 conjuntos.", [
  { campaign_id: "c1", external_id: "120249829825270182" },
  { campaign_id: "c1", external_id: "120249830986060182" },
]);
assert(/NAO desempata/.test(mesmaCamp), "mesma campanha: campanha_destino nao resolve");
assert(/conjunto_destino_external_id/.test(mesmaCamp), "pede o id, que e o unico desempate");
assert(/120249830986060182/.test(mesmaCamp), "lista os ids para escolher");

const campsDiferentes = desempateDeConjunto("Ha 2 conjuntos.", [
  { campaign_id: "c1", external_id: "1" },
  { campaign_id: "c2", external_id: "2" },
]);
assert(/params\.campanha_destino/.test(campsDiferentes), "campanhas distintas: pedir a campanha");
assert(!/NAO desempata/.test(campsDiferentes), "nao contradiz quando a campanha resolve");

assert(chat.includes("conjuntoVivoParaDestino"), "chat filtra conjunto arquivado");
assert(chat.includes("desempateDeConjunto"), "chat usa o desempate honesto");
assert(chat.includes("metaVideoIdEarly"), "peca ja na biblioteca dispensa molde");
assert(chat.includes("meta_video_id_desconhecido"), "meta_video_id e validado no espelho");

console.log("ok: _prova_linha_produto");
