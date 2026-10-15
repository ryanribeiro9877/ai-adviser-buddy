// Recusas da executora que dependem so do payload do card. Um dono so: montarCriacao
// (meta-actions) chama recusaDoPayloadDeCriacao antes de qualquer leitura, e o traffic-chat
// chama a mesma sobre o payload gravado antes de emitir o card. Card que passa aqui nao volta
// como recusa_do_proprio_sistema por estes motivos. Medido: 21-22/08/2026 quatro cards de
// conjunto aprovados morreram em whatsapp_phone_number_obrigatorio_para_mensagens /
// optimization_goal_nao_suportado_para_engajamento com o payload ja dizendo isso.
//
// Leituras ao vivo (molde e campanha na Graph, CBO, Criativo Dinamico, config da empresa,
// espelho, avaliar_escala) continuam so na executora: aqui nao ha rede.

import { ehFlagOrcamentoConfirmadoReais, conferirOrcamentoReais } from "./orcamento_reais.ts";
import { ehFlagSemMolde, ehSentinelaSemMolde, nomeCompostoForaDeEscopoTrafego } from "./memoria_conjunto.ts";
import { normalizarGeoDoPedido } from "./geo_targeting.ts";
import { prepararIdadeParaCriacao } from "./idade_targeting.ts";
import {
  type AdsetEngajamentoDefaults,
  defaultsConjuntoMensagens,
  defaultsConjuntoSocialTopo,
  defaultsConjuntoTrafegoWebsite,
  ehFamiliaSocialTopo,
  ehPedidoMensagens,
  ehPedidoTrafegoWebsite,
  familiaDeObjetivo,
  mensagemObjetivoNaoSuportado,
  resolverObjetivoOdax,
} from "./objetivo_odax.ts";
import { aplicarPosicionamentoPorPlataformas } from "./posicionamento.ts";

export type RecusaDoPayload = { erro: string; detalhe?: string };

// Espelho EXATO de public.campo_presente_no_pedido(jsonb, text). Os dois lados do portao
// (contrato/verificacao no banco e executor) precisam recusar o MESMO conjunto de pedidos:
// vazio nao e pedido; string em branco, array vazio e objeto vazio contam como ausentes.
export function campoPresente(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

/**
 * Familia do conjunto pelo payload (payload -> nome_partes/tag -> objetivo). Quando so a
 * campanha na Graph decide (familia vazia ou "conversao" sem sinal de conversa), devolve
 * precisaLerCampanha e a executora le o objective.
 */
export function familiaDoConjuntoPeloPayload(p: Record<string, unknown>, nomeFinal: string): {
  familia: string;
  tag: string;
  pedidoTrafegoWeb: boolean;
  pedidoMensagens: boolean;
  precisaLerCampanha: boolean;
} {
  let familia = String(p?.familia_objetivo ?? "").trim().toLowerCase();
  const tag = String((p?.nome_partes as Record<string, unknown> | undefined)?.objetivo_tag ?? p?.objetivo_tag ?? "").trim();
  const pedidoTrafegoWeb = ehPedidoTrafegoWebsite({
    optimization_goal: p?.optimization_goal,
    destination_type: p?.destination_type,
    familia_objetivo: p?.familia_objetivo,
    objetivo: p?.objetivo,
  });
  const pedidoMensagens = ehPedidoMensagens({
    optimization_goal: p?.optimization_goal,
    destination_type: p?.destination_type,
    familia_objetivo: p?.familia_objetivo,
    objetivo_tag: tag,
    objetivo: p?.objetivo,
    nome: `${p?.campanha_destino_nome ?? ""} ${p?.nome_novo ?? ""} ${nomeFinal}`,
  });
  if (pedidoTrafegoWeb) {
    familia = "trafego";
  } else if (pedidoMensagens) {
    familia = "mensagens";
  } else if (!familia || familia === "conversao") {
    if (ehFamiliaSocialTopo(tag) || ehFamiliaSocialTopo(p?.objetivo)) {
      familia = familiaDeObjetivo(p?.objetivo ?? tag);
    }
  }
  const precisaLerCampanha = (!familia || familia === "conversao") && !pedidoMensagens;
  return { familia, tag, pedidoTrafegoWeb, pedidoMensagens, precisaLerCampanha };
}

/** Defaults do conjunto pela familia. Mensagens e social exigem page_id. */
export function defaultsDoConjuntoPorFamilia(
  familia: string,
  pageId: string,
  p: Record<string, unknown>,
): AdsetEngajamentoDefaults | { erro: string; detalhe: string } {
  if (familia === "trafego") {
    return defaultsConjuntoTrafegoWebsite({
      destination_type: p?.destination_type,
      optimization_goal: p?.optimization_goal,
    });
  }
  if (familia === "mensagens") {
    return defaultsConjuntoMensagens(pageId, {
      whatsapp_phone_number: p?.whatsapp_phone_number,
      whats_app_business_phone_number_id: p?.whats_app_business_phone_number_id,
      destination_type: p?.destination_type,
      optimization_goal: p?.optimization_goal,
    });
  }
  return defaultsConjuntoSocialTopo(familia as "engajamento" | "reconhecimento", pageId, p?.optimization_goal);
}

function recusaCampanha(p: Record<string, unknown>): RecusaDoPayload | null {
  const nome = String(p?.nome_novo ?? p?.nome ?? p?.name ?? "").trim();
  if (!nome) return { erro: "payload sem nome_novo (nome livre obrigatorio)" };

  // O gestor decide o regime no pedido (regime_orcamento). Hoje o UNICO regime suportado e ABO -
  // orcamento vive em cada CONJUNTO, a campanha fica SEM orcamento -, que e o desenho de todo o
  // sistema: o gate campanha_usa_orcamento_proprio_cbo existe justamente para manter conjunto
  // fora de campanha CBO. Ausente = 'abo'. Valor diferente de 'abo' RECUSA por nome; o contrato
  // (contrato_de_execucao.valores_aceitos=['abo']) recusa o MESMO conjunto no validador, para
  // nunca haver validador=aceita com executor=recusa.
  const regime = String(p?.regime_orcamento ?? "").trim().toLowerCase() || "abo";
  if (regime !== "abo") {
    return {
      erro: "regime_orcamento_nao_suportado",
      detalhe:
        `O pedido declara regime_orcamento="${regime}", e este sistema so cria campanha em ABO (orcamento no conjunto, campanha sem orcamento). CBO — orcamento na campanha — nao e suportado: o conjunto so entra em campanha sem orcamento proprio (e o que o gate campanha_usa_orcamento_proprio_cbo garante), entao criar a campanha ja com orcamento fecharia o caminho do conjunto. Peca a campanha em ABO (ou omita o regime, que ja assume ABO).`,
    };
  }
  const objetivo = resolverObjetivoOdax({
    objetivo: p?.objetivo,
    objetivo_tag: (p?.nome_partes as Record<string, unknown> | undefined)?.objetivo_tag ?? p?.objetivo_tag,
  });
  if (!objetivo.ok) return mensagemObjetivoNaoSuportado(objetivo.bruto);
  return null;
}

function recusaConjunto(acao: string, p: Record<string, unknown>): RecusaDoPayload | null {
  const moldeRaw = String(p?.molde_external_id ?? "").trim();
  const semMolde = acao === "criar_conjunto_a_partir_de" && (ehFlagSemMolde(p?.sem_molde) || ehSentinelaSemMolde(moldeRaw));
  const molde = semMolde ? "" : moldeRaw;
  const campanha = String(p?.campanha_destino_external_id ?? "");
  const nome = String(p?.nome_novo ?? "").trim();
  if (!campanha || !nome) return { erro: "payload incompleto (campanha_destino_external_id, nome_novo)" };
  if (!semMolde && !molde) {
    return {
      erro: "payload incompleto (molde_external_id, campanha_destino_external_id, nome_novo)",
      detalhe: "Informe o conjunto molde (empresta targeting) OU sem_molde=true / molde_external_id=sem_molde para criar do zero.",
    };
  }
  const reais = Number(p?.orcamento_diario_reais ?? 0);
  if (!(reais > 0)) return { erro: "orcamento_diario_reais ausente ou invalido" };
  const orc = conferirOrcamentoReais({
    reais,
    confirmadoReais: ehFlagOrcamentoConfirmadoReais(p?.orcamento_confirmado_reais),
  });
  if (!orc.ok) return { erro: orc.erro, detalhe: orc.detalhe };

  if (acao === "criar_conjunto_a_partir_de") {
    const formato = String(p?.formato_midia_previsto ?? "").trim().toLowerCase();
    const plataformas = p?.plataformas_publicacao ?? p?.publisher_platforms ?? null;
    if (plataformas != null) {
      const derivado = aplicarPosicionamentoPorPlataformas({}, formato || "desconhecido", plataformas);
      if (derivado.erro || !derivado.targeting) {
        return { erro: derivado.erro ?? "posicionamento_por_plataformas_nao_derivado", detalhe: derivado.detalhe };
      }
    } else if (formato !== "video" && formato !== "imagem") {
      return {
        erro: "plataformas_de_publicacao_obrigatorias",
        detalhe:
          "Antes de criar o conjunto, declare plataformas_publicacao (facebook, instagram, …). Threads esta desabilitado. Tambem declare formato_midia_previsto quando Facebook fizer parte da escolha.",
      };
    }
    const geo = normalizarGeoDoPedido({
      geo_locations: p?.geo_locations,
      bairros: p?.bairros,
      neighborhoods: p?.neighborhoods,
    } as Record<string, unknown>);
    if (geo.erro) return { erro: geo.erro, detalhe: geo.detalhe };
    const idade = prepararIdadeParaCriacao(p);
    if (!idade.ok) return { erro: idade.erro, detalhe: idade.detalhe };
  }

  const fam = familiaDoConjuntoPeloPayload(p, nome);
  const pageId = String(p?.page_id ?? "").trim();
  const exigePagina = fam.familia === "mensagens" || fam.familia === "engajamento" || fam.familia === "reconhecimento";
  // Sem page_id no payload a executora cai na config da empresa: isso so ela sabe.
  if (!fam.precisaLerCampanha && (fam.familia === "trafego" || (exigePagina && pageId))) {
    const defs = defaultsDoConjuntoPorFamilia(fam.familia, pageId, p);
    if ("erro" in defs) return { erro: defs.erro, detalhe: defs.detalhe };
  }
  return null;
}

function recusaAnuncio(p: Record<string, unknown>): RecusaDoPayload | null {
  const creativeMolde = String(p?.creative_id ?? "").trim();
  const adset = String(p?.conjunto_destino_external_id ?? "");
  const videoNovo = String(p?.meta_video_id ?? "").trim();
  const imagemNova = String(p?.meta_image_hash ?? "").trim();
  const carrossel = campoPresente(p?.child_attachments);
  const pecaNovaSemMolde = !creativeMolde && !!(videoNovo || imagemNova || carrossel);
  if (!adset || !String(p?.nome_novo ?? "").trim()) return { erro: "payload incompleto (conjunto_destino_external_id, nome_novo)" };
  if (!creativeMolde && !pecaNovaSemMolde) return { erro: "payload incompleto (creative_id, conjunto_destino_external_id, nome_novo)" };

  // nome_novo do payload e a fonte da verdade — nunca sobrescrever por composto.
  const nome = String(p?.nome_novo ?? p?.nome ?? p?.name ?? "").trim();
  const casoDestino = String((p?.destino_do_anuncio as Record<string, unknown> | undefined)?.caso ?? "");
  const ehTrafego = casoDestino === "trafego_website" ||
    /TRAFFIC|WEBSITE|LANDING_PAGE/i.test(
      `${p?.objetivo_campanha_destino ?? ""} ${p?.destination_type ?? ""} ${p?.optimization_goal ?? ""}`,
    );
  if (ehTrafego && nomeCompostoForaDeEscopoTrafego(nome)) {
    return {
      erro: "nome_fora_do_escopo_trafego",
      detalhe:
        `O payload pede '${nome}', mas o conjunto/campanha e trafego WEBSITE/LPV. ` +
        "Nao gravo [WA][LEADS] nesse objeto. Use o nome livre do contrato.",
    };
  }

  // Video/imagem/carrossel sao mutuamente exclusivos.
  if (videoNovo && (imagemNova || carrossel)) {
    return {
      erro: "formatos_de_midia_conflitantes",
      detalhe:
        "O pedido mistura video com imagem/carrossel. Um anuncio avulso e de UM formato: video, imagem unica ou carrossel. Remova os campos conflitantes.",
    };
  }
  if (imagemNova && carrossel) {
    return {
      erro: "formatos_de_midia_conflitantes",
      detalhe:
        "O pedido traz meta_image_hash E child_attachments. Use so child_attachments para carrossel (varios slides) OU so meta_image_hash para imagem unica.",
    };
  }
  // A Coluna da direita do Facebook NAO veicula video. Veicular la exige asset por
  // posicionamento (asset_feed_spec com regras), e a executora monta um object_story_spec com
  // um unico video_data. Recusa por nome em vez de publicar so o video calado.
  if (
    campoPresente(p?.assets_por_posicionamento) ||
    campoPresente(p?.placement_asset_customization) ||
    campoPresente(p?.imagem_coluna_direita) ||
    campoPresente(p?.asset_customization_rules)
  ) {
    return {
      erro: "personalizacao_por_posicionamento_nao_suportada",
      detalhe:
        "O pedido pede midia diferente por posicionamento (ex.: imagem so na Coluna da direita do Facebook, que nao aceita video). Isso e placement asset customization - asset_feed_spec com regras por posicionamento - e esta executora NAO monta isso: ela monta um object_story_spec com um unico video_data. O padrao do sistema para anuncio de video e ACEITAR que a Coluna da direita nao veicule (e avisar isso no card antes da aprovacao). Se precisar veicular imagem nesse posicionamento, monte no Gerenciador ou peca o suporte a personalizacao por posicionamento como trabalho declarado.",
    };
  }
  // Sem molde nao ha texto a herdar. Com molde, video e imagem herdam a mensagem do molde;
  // carrossel monta link_data novo e tambem nao herda.
  if (!String(p?.legenda ?? "").trim()) {
    if (pecaNovaSemMolde) {
      return {
        erro: "legenda_obrigatoria_peca_nova",
        detalhe: "Peca nova (com ou sem molde) exige legenda no payload — nao ha texto a herdar de lugar nenhum.",
      };
    }
    if (carrossel) return { erro: "legenda_obrigatoria_peca_nova", detalhe: "Carrossel exige legenda no payload." };
  }
  return null;
}

/** Recusa que a executora daria so olhando o payload, ou null. */
export function recusaDoPayloadDeCriacao(acao: string, payload: Record<string, unknown> | null | undefined): RecusaDoPayload | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (acao === "criar_campanha") return recusaCampanha(p);
  if (acao === "criar_conjunto_a_partir_de" || acao === "escalar_duplicar") return recusaConjunto(acao, p);
  if (acao === "criar_anuncio_a_partir_de") return recusaAnuncio(p);
  return null;
}
