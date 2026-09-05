// RECUSA MECANICA ANTES DA ESCRITA: o ato so escreve no objeto do NIVEL que a acao declara.
//
// O BURACO QUE ISTO FECHA (nomeado em 05/09/2026). O executor le o alvo por nivel
// (`GET /{alvoExt}?fields=<campos do nivel>`) e nunca conferia a falha dessa leitura. A Graph nao
// ignora campo inexistente: ela derruba a consulta INTEIRA com OAuthException #100, mensagem
// "Tried accessing nonexisting field (X) on node type (Y)". Com o `antes` virando envelope de
// erro, o `POST { status: "PAUSED" }` seguia igual para o id informado — ou seja, um
// `pausar_criativo` apontado a uma campanha PAUSAVA A CAMPANHA. As guardas que existem (token de
// Ads por empresa, emissor resolvendo no espelho da propria empresa) contem o dano ao perimetro
// da empresa certa, mas nao ao objeto certo dentro dela.
//
// O sinal ja existia e estava sendo jogado fora. Este mesmo #100 foi diagnosticado duas vezes
// neste repositorio — GT-12 na coleta e v5.3 na reconciliacao — e nas duas vezes a licao parou em
// "peca a lista certa de campos". Ninguem ligou o sinal a decisao de escrever.
//
// POR QUE NAO E O CONTRATO DE CAMPOS. A presenca de `target_external_id` e `target_name` no
// pedido e conferida pelo contrato de campos, e passa igual quando o id e de outro objeto.
// `target_name` obrigatorio da LEGIBILIDADE a quem aprova, e esta escrito assim de proposito. O
// que falta e a recusa mecanica antes do POST, que nao depende de ninguem ler o card.
//
// O QUE NUNCA E ALVO ERRADO. Rede, token e limite de taxa derrubam a leitura sem dizer nada sobre
// o objeto. Tratar indisponibilidade como alvo errado trocaria um risco por uma paralisia e
// deixaria toda escrita refem da saude da Graph. Por isso a recusa exige EVIDENCIA POSITIVA de
// que o alvo e outro objeto; ausencia de informacao declara e segue.

import type { NivelMeta } from "./pipeboard.ts";

/** Espelho local de cada nivel. E a fonte que nao depende da Graph estar de pe. */
export const NIVEL_PARA_ESPELHO: Record<NivelMeta, "campaigns" | "ad_sets" | "ads"> = {
  campanha: "campaigns",
  conjunto: "ad_sets",
  anuncio: "ads",
};

/** Nome do tipo de no como a Graph o escreve, para traduzir o que ela observou. */
const NO_DA_GRAPH_PARA_NIVEL: Record<string, NivelMeta> = {
  campaign: "campanha",
  adcampaign: "campanha",
  adcampaigngroup: "campanha",
  adset: "conjunto",
  adcampaignset: "conjunto",
  ad: "anuncio",
  adgroup: "anuncio",
};

export function nivelDoNoDaGraph(no: string | null): NivelMeta | null {
  if (!no) return null;
  return NO_DA_GRAPH_PARA_NIVEL[no.trim().toLowerCase().replace(/\s+/g, "")] ?? null;
}

/**
 * Codigos da Graph que falam da DISPONIBILIDADE da leitura, nunca do objeto lido.
 * Nenhum deles pode virar recusa por alvo errado.
 */
const CODIGOS_DE_INDISPONIBILIDADE = new Set([
  1, // erro desconhecido/transitorio
  2, // servico temporariamente indisponivel
  4, // limite de taxa do app
  17, // limite de taxa do usuario
  32, // limite de taxa da pagina
  102, // sessao invalida
  104, // assinatura ausente
  190, // token invalido ou expirado
  341, // limite temporario
  613, // limite de chamadas
  2500, // token ausente
  80000,
  80001,
  80002,
  80003,
  80004,
  80005,
  80006, // limites por produto (inclui Ads)
]);

export type LeituraDoAlvo = { status: number; body: unknown };

export type ClassificacaoDaLeitura =
  /** A Graph entregou o objeto pedindo os campos daquele nivel. */
  | { classe: "confere" }
  /** Evidencia positiva: a Graph disse que o campo nao existe naquele tipo de no. */
  | { classe: "nivel_errado"; nivel_observado: NivelMeta | null; no_observado: string | null; assinatura: string }
  /** Evidencia positiva: o id nao resolve para este token. */
  | { classe: "alvo_nao_resolve"; assinatura: string }
  /** Nao da para dizer nada sobre o objeto. Declara, nao acusa. */
  | { classe: "indisponivel"; assinatura: string };

/**
 * Traduz a leitura por nivel em evidencia sobre o ALVO.
 *
 * O #100 e distinguivel de outras falhas de leitura por duas assinaturas, e so por elas:
 *  - "nonexisting field ... on node type (X)" => campo inexistente NAQUELE tipo de no. Alem de
 *    provar que o nivel esta errado, e o unico sinal que nomeia o tipo real do objeto.
 *  - error_subcode 33 => "Object with ID ... does not exist, cannot be loaded due to missing
 *    permissions, or does not support this operation".
 * Fora dessas duas, #100 tambem e "Invalid parameter" genérico — e ai nao se acusa o alvo.
 */
export function classificarLeituraDoAlvo(leitura: LeituraDoAlvo): ClassificacaoDaLeitura {
  if (leitura.status === 200) return { classe: "confere" };

  const corpo = leitura.body;
  const erro =
    corpo && typeof corpo === "object" && !Array.isArray(corpo)
      ? (corpo as { error?: unknown }).error
      : null;
  if (!erro || typeof erro !== "object" || Array.isArray(erro)) {
    // Corpo nao-JSON (o transporte trunca em texto) ou sem envelope de erro. Silencio da Graph
    // nao e informacao sobre o objeto.
    return { classe: "indisponivel", assinatura: `sem_envelope_de_erro:http_${leitura.status}` };
  }

  const bruto = erro as Record<string, unknown>;
  const codigo = Number(bruto.code);
  const subcodigo = Number(bruto.error_subcode);
  const mensagem = String(bruto.message ?? "");

  if (Number.isFinite(codigo) && CODIGOS_DE_INDISPONIBILIDADE.has(codigo)) {
    return { classe: "indisponivel", assinatura: `codigo_${codigo}` };
  }
  if (leitura.status >= 500) {
    return { classe: "indisponivel", assinatura: `http_${leitura.status}` };
  }

  if (codigo === 100) {
    if (/nonexisting field/i.test(mensagem)) {
      const no = /on node type \(([^)]+)\)/i.exec(mensagem)?.[1] ?? null;
      return {
        classe: "nivel_errado",
        nivel_observado: nivelDoNoDaGraph(no),
        no_observado: no,
        assinatura: "100:nonexisting_field",
      };
    }
    if (subcodigo === 33) {
      // A Graph conflaciona "nao existe" com "fora do alcance deste token". Nos dois casos a
      // ESCRITA no mesmo id tambem seria recusada, entao recusar antes nao cria paralisia: nao ha
      // ato possivel nesse id com este token.
      return { classe: "alvo_nao_resolve", assinatura: "100:subcodigo_33" };
    }
    return { classe: "indisponivel", assinatura: "100:sem_assinatura_conhecida" };
  }

  return {
    classe: "indisponivel",
    assinatura: `codigo_${Number.isFinite(codigo) ? codigo : "ausente"}`,
  };
}

/** Nome curto da leitura, para a declaracao. Recebe a uniao inteira de proposito. */
function descricaoDaLeitura(lido: ClassificacaoDaLeitura): string {
  return lido.classe === "indisponivel" ? lido.assinatura : lido.classe;
}

/** O que o espelho local soube dizer sobre o id. */
export type EspelhoDoAlvo =
  /** Encontrado; `niveis` sao TODOS os niveis em que o id aparece para aquela empresa. */
  | { consultado: true; niveis: NivelMeta[] }
  /** A consulta ao espelho falhou. Nao e ausencia do objeto, e ausencia de resposta. */
  | { consultado: false; erro: string };

export type DecisaoDeEscrita =
  | {
      escrever: true;
      /** Quem confirmou o nivel do alvo. `ninguem` = escreveu sem confirmacao, declarando. */
      confirmado_por: "espelho_e_graph" | "espelho" | "graph" | "ninguem";
      declaracao: string | null;
    }
  | { escrever: false; recusa: string; detalhe: string };

/**
 * Junta as duas fontes numa decisao unica antes do POST.
 *
 * Recusa SO com evidencia positiva de que o alvo e outro objeto:
 *  - o espelho da empresa conhece o id em outro nivel (deterministico, independe da Graph);
 *  - a Graph disse que o campo nao existe naquele tipo de no;
 *  - a Graph disse que o id nao resolve.
 *
 * Nao recusa por ausencia de informacao. Em particular, id ausente do espelho NAO e evidencia de
 * alvo errado: objeto recem-criado ainda nao espelhado cairia ai. E o inverso sustenta a escolha —
 * um alvo de nivel errado quase sempre ESTA no espelho, porque e de lá que o emissor tira o id que
 * confundiu; por isso a fonte deterministica pega justamente o caso que importa.
 */
export function decidirEscritaNoAlvo(entrada: {
  nivelDaAcao: NivelMeta;
  espelho: EspelhoDoAlvo;
  leitura: LeituraDoAlvo;
}): DecisaoDeEscrita {
  const { nivelDaAcao: nivel, espelho, leitura } = entrada;
  const lido = classificarLeituraDoAlvo(leitura);

  const espelhoConfere = espelho.consultado && espelho.niveis.includes(nivel);
  const outrosNiveis = espelho.consultado ? espelho.niveis.filter((n) => n !== nivel) : [];

  // 1) Evidencia positiva do espelho: o id e conhecido, e nao neste nivel.
  if (espelho.consultado && !espelhoConfere && outrosNiveis.length > 0) {
    return {
      escrever: false,
      recusa: "alvo_de_outro_nivel_no_espelho",
      detalhe:
        `a acao escreve em ${nivel}, mas o espelho da empresa conhece este id como ` +
        `${outrosNiveis.join("/")}`,
    };
  }

  // 2) Evidencia positiva da Graph.
  if (lido.classe === "nivel_errado") {
    const observado = lido.nivel_observado ?? lido.no_observado ?? "outro tipo de objeto";
    return {
      escrever: false,
      recusa: "alvo_de_outro_nivel_na_graph",
      detalhe:
        `a acao escreve em ${nivel}, mas a Graph recusou os campos deste nivel dizendo que o id ` +
        `e ${observado} (${lido.assinatura})`,
    };
  }
  if (lido.classe === "alvo_nao_resolve") {
    return {
      escrever: false,
      recusa: "alvo_nao_resolve_na_graph",
      detalhe:
        `o id nao existe ou esta fora do alcance do token desta empresa (${lido.assinatura}); ` +
        `a escrita no mesmo id tambem seria recusada`,
    };
  }

  // 3) Sem evidencia de erro: escreve, registrando QUEM confirmou o nivel.
  const graphConfere = lido.classe === "confere";
  if (espelhoConfere && graphConfere) {
    return { escrever: true, confirmado_por: "espelho_e_graph", declaracao: null };
  }
  if (espelhoConfere) {
    return {
      escrever: true,
      confirmado_por: "espelho",
      declaracao:
        `leitura na Graph indisponivel (${descricaoDaLeitura(lido)}); ` +
        `nivel do alvo confirmado pelo espelho da empresa`,
    };
  }
  if (graphConfere) {
    return {
      escrever: true,
      confirmado_por: "graph",
      declaracao:
        espelho.consultado
          ? "id ainda nao espelhado nesta empresa; nivel do alvo confirmado pela Graph"
          : `espelho nao respondeu (${espelho.erro}); nivel do alvo confirmado pela Graph`,
    };
  }
  // Nenhuma das duas fontes falou. Nao recusa: fechar por indisponibilidade trocaria um risco por
  // uma paralisia, e id fora do espelho nao e evidencia de alvo errado. Declara para virar numero.
  return {
    escrever: true,
    confirmado_por: "ninguem",
    declaracao:
      `nivel do alvo NAO conferido: ` +
      (espelho.consultado ? "id fora do espelho" : `espelho nao respondeu (${espelho.erro})`) +
      ` e leitura na Graph indisponivel (${descricaoDaLeitura(lido)})`,
  };
}
