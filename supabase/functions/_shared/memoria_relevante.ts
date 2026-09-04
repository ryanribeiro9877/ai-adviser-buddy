// Memoria institucional POR RELEVANCIA, para o caminho profundo.
//
// POR QUE ISTO EXISTE
// A sintese do job recebia os 87 fatos vigentes inteiros, sempre: 63.750 chars (~19k tokens) de
// instrucao permanente contra ~1.200 tokens de coleta fresca — dezesseis vezes mais instrucao do
// que dado sobre o qual escrever. O chat sincrono ja tinha passado por esta correcao quando saiu
// de 56 ferramentas por turno para 34, injetando por contexto em vez de por atacado. Este modulo
// leva o mesmo principio para a sintese.
//
// O QUE ESTE MODULO NAO FAZ
// Nao apaga fato nenhum. `agent_context` continua intacta; o que muda e QUANDO cada fato entra.
//
// AS TRES REDES DE SEGURANCA (nesta ordem de importancia)
// (1) FAIL-OPEN NO MECANISMO: `selecionarMemoria` devolve `null` se qualquer coisa der errado, e
//     `null` significa "nao estreitar" — o chamador injeta tudo. Mesmo contrato de
//     `ferramentasDoTurno` em agentes.ts. Este projeto ja acumulou fail-opens demais achados a
//     duro custo; economia de token nao vale mais um.
// (2) FAIL-SAFE POR FATO: so sai da injecao permanente o fato POSITIVAMENTE classificado num
//     topico conhecido. Fato que nao casa com topico nenhum continua sempre presente. Assim, fato
//     novo cadastrado amanha nasce protegido: para ser dispensavel alguem precisa classifica-lo de
//     proposito, nunca por esquecimento.
// (3) NUCLEO EXPLICITO: fatos cuja ausencia permite uma classe de erro INDEPENDENTEMENTE da
//     pergunta nunca saem. Escolhidos pelo que protegem, nao pelo tamanho.
//
// O QUE A MEDICAO MOSTROU — E O QUE ELA NAO MOSTROU (04/09/2026)
// A hipotese que motivou esta mudanca era que o atacado de instrucao estivesse ESPREMENDO a
// resposta. Ela foi testada com a MESMA pergunta dos dois lados e NAO se confirmou:
//
//   antes (n=6, 21.205 tok de entrada):  119   249   622   924  1.207  13.254   mediana    773
//   depois (n=8,  ~8.500 tok de entrada): 100   744   940  1.026 1.282  2.148  2.502  15.557
//                                                                        mediana  1.154
//
//   Mann-Whitney U = 16 (critico 8 para n=6 vs n=8, alfa 0,05) -> NAO significativo.
//
// Ou seja: as faixas se sobrepoem quase inteiras, o extremo curto continua acontecendo (100 chars
// depois, contra 119 antes) e o extremo longo tambem. A dispersao e do modelo, como ja havia sido
// estabelecido na investigacao da bimodalidade, e cortar 60% da instrucao NAO a reduziu.
//
// NAO REABRA ESTA LINHA esperando saida melhor: o custo era de contexto, nao de qualidade.
// O que esta mudanca de fato entrega e JANELA — ~12.700 tokens que antes eram instrucao repetida
// e agora estao livres para a coleta, o que importa porque a coleta e que disputa a parede de
// tempo do job. Se um dia alguem quiser gastar essa folga aumentando a coleta, ela existe.

import type { FatoMemoria } from "./agent_memory.ts";
import { formatarMemoria } from "./agent_memory.ts";

/**
 * NUCLEO POR CATEGORIA — o equivalente do NUCLEO_SEMPRE de agentes.ts.
 *
 * Cada uma guarda contra uma classe de erro que independe do que foi perguntado:
 * - `armadilha`: restatement da Meta, nulo ambiguo, breakdown effect, fase de aprendizado, zero
 *   que pode ser sync quebrado. Sao as regras de "como nao concluir errado a partir de um numero",
 *   e toda resposta desta casa fala de numero.
 * - `metricas`: alcance somado exige rotulo; custo por resultado exige base declarada. Sem elas o
 *   agente publica numero sem denominador, que e o defeito que este projeto mais combateu.
 * - `escopo`: nao se autocorrigir em publico, nao citar codigo de regra interna, nao pedir para o
 *   gestor repetir o pedido. Higiene de saida, vale em toda resposta.
 * - `qualidade`: honestidade de capacidade — nao declarar indisponivel o que o sistema expoe.
 * - `metodo`: como os tetos de custo sao derivados. Se sair, o agente trata teto como meta.
 * - `midia`: orcamento diario e media e nao limite; pegada e destino sao legiveis na config.
 * - `incidente`: 255 chars sobre o sync quebrado de julho — ressalva historica barata que evita
 *   ler gasto zero daquela janela como queda real.
 */
const NUCLEO_CATEGORIAS = new Set([
  "armadilha",
  "metricas",
  "escopo",
  "qualidade",
  "metodo",
  "midia",
  "incidente",
]);

/**
 * NUCLEO POR MARCADOR — guardas analiticas que moram dentro de categorias grandes e mistas
 * (`doutrina` e `execucao` juntas sao 42k dos 63k chars, e nem tudo la dentro e dispensavel).
 * Cada marcador aponta um fato que responde "de onde vem este numero" ou "por que este vazio nao
 * e falha", que e exatamente o que uma leitura de desempenho precisa para nao mentir.
 */
const NUCLEO_MARCADORES =
  /ORCAMENTO DIARIO E MEDIA|AUSENCIA ESCOPADA NAO E FALHA DE COLETA|COLETOR DE METRICAS|COLETA ESTRUTURAL OFICIAL|LEITURA HIBRIDA PIPEBOARD|DELETED\/ARCHIVED SAEM DA MEMORIA/i;

/**
 * Topicos dispensaveis, com o porque de cada um.
 *
 * `fato` identifica o assunto do fato; `gatilho` e o que a pergunta precisa tocar para ele voltar.
 * `porque` e a justificativa de dispensa — ela existe para auditoria: sem justificativa escrita,
 * isto seria remocao silenciosa disfarcada de otimizacao.
 */
export type TopicoMemoria = {
  nome: string;
  fato: RegExp;
  gatilho: RegExp;
  porque: string;
};

export const TOPICOS_DISPENSAVEIS: TopicoMemoria[] = [
  {
    nome: "acao_e_emissao",
    fato:
      /\b(card|propose_action|acao sancionada|acoes sancionadas|renomear|escalar_|duplicac|criar_campanha|criar_conjunto|create_adset|contrato de ativacao|aprovar|emissao de cards|emite os n|alterar_categoria|permissao|execucao e sincrona|abo pelo pipeboard|conjunto sem orcamento|escrita meta habilitada|conta habilitada para criacao|driver de transporte)\b/i,
    gatilho:
      /\b(cri(a|e|ar|ando)|emit|card|aprov|renome|escal|duplic|pausa|ativa|desativa|subir|public|alter|execut|a[cç][aã]o|acoes|lance|or[cç]amento novo)\b/i,
    porque:
      "A sintese do job e READ-ONLY por contrato: o proprio prompt dela carrega '(R8) voce NAO executa acoes'. Doutrina de emissao de card, criacao, renomeacao e permissao de escrita nao pode mudar uma analise de desempenho — ela so ocupa janela. Volta assim que a pergunta fala em agir.",
  },
  {
    nome: "legenda_e_copy",
    fato:
      /\b(legenda|copy|motor de legenda|brand_identity|identidade de marca|identidade la felicita|slate|nomenclatura livre|nome livre|threads)\b/i,
    gatilho:
      /\b(legenda|copy|texto do an[uú]ncio|escrever|redig|nomenclatura|nomear|renomear|tom de voz|marca)\b/i,
    porque:
      "Sao regras de PRODUCAO DE TEXTO PUBLICITARIO (framework de legenda, voz da marca, slate de pecas). A sintese escreve analise para o gestor, nao copy de anuncio. Volta quando a pergunta pede legenda, copy ou nomenclatura.",
  },
  {
    nome: "drive_e_acervo",
    fato: /\b(drive|acervo|pasta|sistema ocular|vistta|exports finais|drive_file_id)\b/i,
    gatilho: /\b(drive|pasta|acervo|pe[cç]a|vistta|ocular|invent[aá]rio|arquivo)\b/i,
    porque:
      "Descrevem onde ficam as pecas no Drive e como o inventario e lido. Uma leitura de desempenho de campanha no ar nao consulta o Drive. Volta quando a pergunta cita Drive, pasta, acervo ou peca.",
  },
  {
    nome: "whatsapp_e_waba",
    fato: /\b(whatsapp|waba|ctwa|click-to-whatsapp|verified_name|tier)\b/i,
    gatilho: /\b(whatsapp|waba|ctwa|conversa|mensagem|numero|telefone)\b/i,
    porque:
      "Cobrem a camada WABA (status do numero, qualidade, tier, isolamento juridico vs La Felicita) e a criacao de conjunto CTWA. Sao irrelevantes quando a pergunta nao toca o canal. Volta com qualquer mencao a WhatsApp, conversa ou mensagem.",
  },
  {
    nome: "geo_e_publico",
    fato: /\b(geo|bairro|geo_targeting_presets|preset|targeting|sanitize targeting)\b/i,
    gatilho: /\b(geo|bairro|regi[aã]o|localiz|targeting|p[uú]blico|segmenta|raio|cidade)\b/i,
    porque:
      "Sao presets de geolocalizacao e regras de montagem de targeting, usadas na hora de CRIAR conjunto. Nao entram numa leitura de resultado. Voltam quando a pergunta fala de publico, regiao ou segmentacao.",
  },
  {
    nome: "compliance_e_regras",
    fato: /\b(compliance|FIN-0|CRI-0|veredito|special_ad_categor|categoria especial)\b/i,
    gatilho: /\b(compliance|conformidade|regra|veredito|juridic|categoria especial|restri)\b/i,
    porque:
      "Doutrina de veredito de compliance e de categoria especial financeira. A sintese do job nao emite veredito de peca. Volta quando a pergunta pede conformidade ou cita categoria especial.",
  },
  {
    nome: "infraestrutura_e_tokens",
    fato:
      /\b(token|edge secret|business manager|meta_business|meta_execution_config|cron|waba-sync|windsor|proxy pipeboard|saude dos tokens|score_de_prontidao|digest)\b/i,
    gatilho:
      /\b(token|cron|sync|integra|conector|pipeboard|windsor|infra|digest|e-mail|prontid[aã]o|sa[uú]de)\b/i,
    porque:
      "Descrevem encanamento: onde moram os tokens, quais crons rodam, o alcance do proxy. Nao mudam a leitura de um custo por resultado. Voltam quando a pergunta e sobre coleta, integracao ou saude do sistema.",
  },
  {
    nome: "arquitetura_do_produto",
    fato:
      /\b(molde|bloco canonico|moldes_de_resposta|composicao hibrida|arquitetura de agentes|AG-0|valores_do_molde|recomendacoes da ia|canal amplo)\b/i,
    gatilho: /\b(molde|can[oô]nico|agente|arquitetura|sistema|card de confirma|recomenda[cç][oõ]es da ia)\b/i,
    porque:
      "Explicam como o CHAT monta resposta deterministica (moldes, bloco canonico, catalogo de agentes). O job nao usa esse caminho — ele gera texto livre. Volta quando a pergunta e sobre o proprio sistema.",
  },
  {
    nome: "instagram_e_identidade_de_conta",
    fato: /\b(instagram|instagram_user_id|@coop_cohapm|@cohapm|object_story_spec)\b/i,
    gatilho: /\b(instagram|perfil|@|ig\b|posicionamento)\b/i,
    porque:
      "Identificam qual perfil do Instagram vincular ao criativo. So importa na criacao/classificacao de anuncio por perfil. Volta com qualquer mencao a Instagram ou perfil.",
  },
  {
    nome: "dicas_da_meta",
    fato: /\b(meta_recommendations|get_meta_dicas|opportunity score|dicas \/ recomendacoes da meta|dicas da meta)\b/i,
    gatilho: /\b(dica|recomenda|opportunity|sugest[aã]o da meta)\b/i,
    porque:
      "Cobrem a leitura das recomendacoes nativas da Meta, uma ferramenta especifica. Volta quando a pergunta pede dicas ou recomendacoes da plataforma.",
  },
];

export type FatoClassificado = {
  fato: FatoMemoria;
  topico: string | null;
  motivo: string;
};

export type SelecaoMemoria = {
  texto: string;
  injetados: FatoMemoria[];
  dispensados: FatoClassificado[];
  topicos_ativados: string[];
  chars_antes: number;
  chars_depois: number;
};

function ehNucleo(f: FatoMemoria): boolean {
  const cat = String(f.categoria ?? "").toLowerCase();
  if (NUCLEO_CATEGORIAS.has(cat)) return true;
  return NUCLEO_MARCADORES.test(String(f.fato ?? ""));
}

/**
 * Escolhe os fatos que entram nesta sintese.
 *
 * Devolve `null` para dizer "NAO ESTREITE" — o chamador deve injetar a memoria inteira. E o mesmo
 * contrato de `ferramentasDoTurno`: quando a selecao nao e confiavel, o certo e o excesso, nunca a
 * falta.
 */
export function selecionarMemoria(
  rows: FatoMemoria[],
  gatilhoTexto: string,
): SelecaoMemoria | null {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const gatilho = String(gatilhoTexto ?? "");
    // Sem pergunta nao ha como julgar relevancia: injeta tudo.
    if (gatilho.trim().length < 8) return null;

    const topicosAtivos = new Set(
      TOPICOS_DISPENSAVEIS.filter((t) => t.gatilho.test(gatilho)).map((t) => t.nome),
    );

    const injetados: FatoMemoria[] = [];
    const dispensados: FatoClassificado[] = [];

    for (const f of rows) {
      if (ehNucleo(f)) { injetados.push(f); continue; }
      const texto = String(f.fato ?? "");
      // FAIL-SAFE POR FATO: so o que casa com um topico CONHECIDO pode sair. O resto fica.
      const topico = TOPICOS_DISPENSAVEIS.find((t) => t.fato.test(texto));
      if (!topico) { injetados.push(f); continue; }
      if (topicosAtivos.has(topico.nome)) { injetados.push(f); continue; }
      dispensados.push({ fato: f, topico: topico.nome, motivo: topico.porque });
    }

    // Se o classificador dispensou tudo, ele esta quebrado, nao eficiente.
    if (injetados.length === 0) return null;

    const charsAntes = rows.reduce((a, r) => a + String(r.fato ?? "").length, 0);
    const charsDepois = injetados.reduce((a, r) => a + String(r.fato ?? "").length, 0);
    return {
      texto: formatarMemoria(injetados),
      injetados,
      dispensados,
      topicos_ativados: [...topicosAtivos],
      chars_antes: charsAntes,
      chars_depois: charsDepois,
    };
  } catch {
    return null; // fail-open: qualquer erro aqui vira memoria inteira
  }
}
