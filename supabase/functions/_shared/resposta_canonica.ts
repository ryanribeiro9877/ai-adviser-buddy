// Resolucao de resposta canonica: dado um molde e parametros, produzir a resposta SEM geracao
// livre. Texto armazenado sai literal; molde sai preenchido por valor calculado.
//
// A FRONTEIRA E ASSIMETRICA, e isto e a decisao central do modulo.
//
// Errar para o lado do LLM custa um turno caro e uma resposta com variancia — ruim, e o que
// acontece hoje em 100% dos turnos. Errar para o lado do molde produz resposta confiantemente
// errada, com a autoridade de um texto fixo, que o gestor nao tem como distinguir de uma
// resposta correta. Os dois erros nao tem o mesmo custo, entao o portao nao e simetrico:
//
//   emite canonico  <=>  molde exato E todos os campos obrigatorios preenchidos
//                        E o item nao passou de revalidar_ate E o registro nao esta degradado
//   qualquer duvida  ->  caminho LLM, com o motivo registrado
//
// Um campo obrigatorio faltando NAO vira "nao disponivel" dentro do molde. Molde com lacuna
// e a forma mais perigosa de resposta errada: a forma fixa empresta credibilidade ao buraco.
// Falta campo, cai para o LLM, que ao menos pode declarar a lacuna com contexto.
//
// SOBRE agent_knowledge / agent_context / agent_style (avaliados em 03/09/2026): nenhuma das
// tres produz resposta deterministica hoje, e nao e defeito de conteudo — e de consumo.
// agent_context entra no system prompt como bloco `memoria`; agent_style entra como bloco
// `estilo`; agent_knowledge entra como INDICE e o conteudo vem por get_conhecimento sob
// demanda. Nos tres casos o texto e RECUPERADO E PARAFRASEADO pelo modelo. O determinismo se
// perde no consumo, nao no armazenamento — escrever mais regra ali nao mudaria isso. Esta
// camada e o caminho de EMISSAO que faltava.

import { arredondar } from "./metrica_canonica.ts";
import type { ClasseDeMolde, Molde } from "./molde_pergunta.ts";

// ============================================================================
// FORMATACAO DETERMINISTICA
// ============================================================================
//
// Intl.NumberFormat NAO e usado aqui de proposito. A saida do Intl depende da versao do ICU
// embutida no runtime: o separador de milhar do pt-BR e o espaco antes do simbolo mudaram
// entre versoes do Deno, e a Meta separa NBSP de espaco comum. Um byte diferente por causa do
// runtime derrubaria a prova de reprodutibilidade sem que nenhuma formula tivesse mudado.

/** "1234.5" -> "1.234,50". Sempre duas casas, sempre ponto de milhar, sempre virgula decimal. */
export function brl(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "indisponivel";
  const n = Number(v);
  const neg = n < 0;
  const cent = Math.round(Math.abs(n) * 100);
  const inteiro = Math.floor(cent / 100).toString();
  const dec = (cent % 100).toString().padStart(2, "0");
  let mil = "";
  for (let i = 0; i < inteiro.length; i++) {
    if (i > 0 && (inteiro.length - i) % 3 === 0) mil += ".";
    mil += inteiro[i];
  }
  return `${neg ? "-" : ""}R$ ${mil},${dec}`;
}

/** Percentual com duas casas: "1.5" -> "1,50%". */
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "indisponivel";
  const n = arredondar(Number(v), 2) ?? 0;
  return `${n.toFixed(2).replace(".", ",")}%`;
}

/** Inteiro com ponto de milhar: 1234 -> "1.234". */
export function inteiro(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "indisponivel";
  const s = Math.round(Math.abs(Number(v))).toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ".";
    out += s[i];
  }
  return `${Number(v) < 0 ? "-" : ""}${out}`;
}

// ============================================================================
// REGISTRO DE MOLDES
// ============================================================================

export type TipoDeCampo = "texto" | "dinheiro" | "percentual" | "inteiro" | "data" | "lista";

export type CampoDoMolde = {
  nome: string;
  tipo: TipoDeCampo;
  /** Onde o valor nasce. Vai para a telemetria: campo sem origem declarada nao entra no molde. */
  origem: string;
  obrigatorio: boolean;
};

/**
 * Como o molde convive com analise livre em volta.
 *
 * O criterio e um so e vale para os tres: um molde e componivel quando texto livre depois dele
 * NAO consegue tornar o canonico falso nem repeti-lo.
 *
 * - `turno_inteiro`       o molde responde tudo; nao ha analise a acrescentar.
 * - `segmento_componivel` o molde trava um pedaco e a analise do modelo entra em volta.
 * - `nao_componivel`      texto livre em volta falsifica ou dilui o canonico. E o DEFAULT.
 *
 * O default e o restritivo de proposito: molde novo nasce emitindo sozinho, e liberar
 * composicao e decisao explicita. Assimetria igual a da fronteira canonico/LLM — soltar
 * analise em volta de um molde que nao aceita produz contradicao dentro da mesma mensagem,
 * enquanto travar demais so custa uma resposta mais seca.
 */
export type GrupoDeComposicao = "turno_inteiro" | "segmento_componivel" | "nao_componivel";

/** Vocabulario aceito. Rotulo fora daqui cai no restritivo em vez de passar. */
export const GRUPOS_DE_COMPOSICAO: readonly string[] = [
  "turno_inteiro",
  "segmento_componivel",
  "nao_componivel",
];

export type MoldeRegistro = {
  codigo: string;
  classe: ClasseDeMolde;
  titulo: string;
  /** Texto com lacunas `{campo}`. Para texto_canonico, normalmente sem lacuna alguma. */
  gabarito: string;
  campos: CampoDoMolde[];
  /** Quando NAO usar este molde. Fica no registro para ser revisado junto com o gabarito. */
  fronteira: string | null;
  composicao: GrupoDeComposicao;
  verificado_em: string;
  revalidar_ate: string | null;
  versao: number;
};

export type RegistroDeMoldes = {
  moldes: MoldeRegistro[];
  /** true = leitura da tabela falhou e o registro veio do fallback local. */
  degradado: boolean;
};

// Fallback local com as cinco recusas e a sonda.
//
// So texto_canonico entra aqui, e por um motivo: recusa e a classe onde o conteudo nao depende
// de dado nenhum, entao o fallback consegue ser CORRETO offline. Molde calculado depende de
// numero do banco — se o banco caiu, o fallback nao teria o numero e emitiria forma fixa com
// lacuna, que e justamente o que este modulo proibe. Molde calculado degradado cai para o LLM.
const FALLBACK: MoldeRegistro[] = [
  {
    codigo: "REC_SEGMENTAR_IDADE",
    classe: "texto_canonico",
    titulo: "Recusa de segmentacao por idade em Categoria Especial",
    gabarito:
      "Nao vou segmentar por faixa de idade nesta conta.\n\n" +
      "As campanhas de credito rodam em **Categoria Especial de Anuncio (Credito)**. Nessa categoria a Meta remove idade, genero e CEP das opcoes de segmentacao, e o motivo nao e tecnico: e tratamento justo. Restringir a oferta de credito por idade e exatamente o que a regra existe para impedir. Nao e uma trava que se contorna — e uma condicao para a conta continuar entregando.\n\n" +
      "O que da para fazer com o mesmo objetivo:\n" +
      "- **Criativo**: peca e linguagem que conversam com o publico que voce quer, sem excluir ninguem na segmentacao.\n" +
      "- **Angulo de oferta**: o beneficio que importa para esse perfil no texto e no gancho.\n" +
      "- **Leitura por faixa**: o relatorio de resultado ainda pode ser aberto por idade. Voce ve onde o custo e melhor sem restringir a entrega.\n\n" +
      "Se quiser, eu abro o desempenho por faixa de idade da janela atual para escolhermos o angulo com base no que ja aconteceu.",
    campos: [],
    fronteira:
      "Nao usar quando a conta NAO esta em Categoria Especial. Fora dela a segmentacao por idade e permitida e a recusa seria errada.",
    // Analise livre depois de uma recusa a torna FALSA: uma ressalva anexada reabre o que a
    // recusa fechou, e o gestor le a ressalva como permissao.
    composicao: "nao_componivel",
    verificado_em: "2026-09-03",
    revalidar_ate: "2027-03-03",
    versao: 1,
  },
  {
    codigo: "REC_ESCALAR_CRIATIVO",
    classe: "texto_canonico",
    titulo: "Escalar criativo nao e ato — escala mora no orcamento do conjunto",
    gabarito:
      "\"Escalar criativo\" nao existe como acao na Meta. O que escala e o **orcamento do conjunto** onde o criativo esta rodando.\n\n" +
      "A diferenca importa na pratica: o criativo nao tem verba propria. Se o objetivo e dar mais volume ao vencedor, o caminho e aumentar o orcamento diario do conjunto que o contem — e ai o aumento vale para todos os anuncios daquele conjunto, nao so para o vencedor. Se a intencao e isolar o vencedor, o caminho e outro: conjunto novo so com ele.\n\n" +
      "Me diga qual dos dois voce quer e eu monto o card:\n" +
      "1. **Aumentar o orcamento do conjunto atual** — mais rapido, o vencedor divide a verba com os demais anuncios do conjunto.\n" +
      "2. **Conjunto novo isolado com o vencedor** — a verba fica toda nele, mas reinicia fase de aprendizado.\n\n" +
      "Nao vou emitir card antes de voce escolher, porque os dois mudam coisas diferentes na conta.",
    campos: [],
    fronteira:
      "Nao usar quando o pedido ja nomeia orcamento, conjunto ou campanha como alvo do aumento — nesse caso o pedido e legitimo e tem caminho proprio.",
    // O gabarito termina pedindo ESCOLHA entre dois caminhos. Analise em volta responderia a
    // pergunta no lugar do gestor, e o molde existe justamente para nao escolher por ele.
    composicao: "nao_componivel",
    verificado_em: "2026-09-03",
    revalidar_ate: "2027-03-03",
    versao: 1,
  },
  {
    codigo: "REC_PECA_FORA_BIBLIOTECA",
    classe: "texto_canonico",
    titulo: "Peca fora da biblioteca da Meta e impedimento, nao aviso",
    gabarito:
      "Nao consigo criar o anuncio: a peca ainda nao esta na biblioteca da Meta.\n\n" +
      "Isto e um **impedimento**, nao uma ressalva. O anuncio nasce apontando para um `creative_id` que so existe depois do upload. Emitir o card agora produziria um pedido que o gestor aprova e que morre na execucao, sem anuncio e sem motivo legivel.\n\n" +
      "A ordem que funciona:\n" +
      "1. Subir a peca do Drive para a biblioteca da Meta.\n" +
      "2. Confirmar que o `creative_id` voltou.\n" +
      "3. Emitir o card do anuncio.\n\n" +
      "Se voce me disser qual peca e, eu faco o upload e volto com o card na sequencia — sem card intermediario.",
    campos: [],
    fronteira: "Nao usar quando a peca ja tem creative_id conhecido: nesse caso o pedido esta completo.",
    // O gabarito afirma IMPEDIMENTO, "nao uma ressalva". Texto livre em volta e exatamente a
    // ressalva que ele nega ser.
    composicao: "nao_componivel",
    verificado_em: "2026-09-03",
    revalidar_ate: "2027-03-03",
    versao: 1,
  },
  {
    codigo: "REC_CONFIG_OUTRA_EMPRESA",
    classe: "texto_canonico",
    titulo: "Isolamento entre empresas — configuracao nao se empresta",
    gabarito:
      "Nao vou usar a configuracao de outra empresa para liberar esta acao aqui.\n\n" +
      "Cada empresa tem a sua configuracao de execucao, e essa separacao e o que impede que uma decisao tomada para um cliente passe a valer para outro sem ninguem ter decidido. O que esta liberado la foi liberado para o contexto de la — conta, produto, risco e responsavel sao outros.\n\n" +
      "Para liberar aqui, o caminho e habilitar a acao **nesta** empresa, de forma explicita e registrada. Se voce quiser, eu digo exatamente qual permissao esta faltando nesta conta para o ato que voce pediu.",
    campos: [],
    fronteira: null,
    // Recusa de ISOLAMENTO entre empresas. Analise em volta tenderia a citar o que a outra
    // empresa tem liberado — vazando justamente o que a recusa protege.
    composicao: "nao_componivel",
    verificado_em: "2026-09-03",
    revalidar_ate: "2027-03-03",
    versao: 1,
  },
  {
    codigo: "REC_TABELA_DE_MEMORIA",
    classe: "texto_canonico",
    titulo: "Nao remontar numero de lembranca",
    gabarito:
      "Nao vou reproduzir aquela tabela de memoria.\n\n" +
      "Eu nao tenho como garantir que os numeros que eu reescrevesse agora sao os mesmos que sairam antes, e uma tabela de orcamento remontada de lembranca parece exata sem ser — e o tipo de erro que ninguem pega, porque a forma esta certa.\n\n" +
      "Duas saidas honestas:\n" +
      "- **Eu busco agora** e monto a tabela com o dado da fonte, marcando a janela e o horario da leitura. Se algo mudou desde a semana passada, voce ve o que mudou.\n" +
      "- **Voce me manda a tabela antiga** e eu confiro linha por linha contra a fonte atual.\n\n" +
      "Qual dos dois?",
    campos: [],
    fronteira: null,
    // A recusa e sobre NAO remontar numero de lembranca. Analise livre em volta remontaria o
    // numero — o modelo tem o historico no contexto e a tentacao e reproduzi-lo.
    composicao: "nao_componivel",
    verificado_em: "2026-09-03",
    revalidar_ate: "2027-03-03",
    versao: 1,
  },
  {
    codigo: "SIS_SONDA_OK",
    classe: "texto_canonico",
    titulo: "Sonda de disponibilidade",
    gabarito: "ok",
    campos: [],
    fronteira: "So para sonda automatizada que pede resposta literal.",
    // O pedido e literalmente "responda apenas ok". Qualquer texto a mais reprova a sonda.
    composicao: "turno_inteiro",
    verificado_em: "2026-09-03",
    revalidar_ate: null,
    versao: 1,
  },
];

export function registroFallback(): RegistroDeMoldes {
  return { moldes: FALLBACK, degradado: true };
}

export async function carregarRegistroDeMoldes(
  // deno-lint-ignore no-explicit-any
  supa: { from: (t: string) => any },
): Promise<RegistroDeMoldes> {
  try {
    const { data, error } = await supa.from("moldes_de_resposta")
      .select("codigo,classe,titulo,gabarito,campos,fronteira,composicao,verificado_em,revalidar_ate,versao")
      .eq("vigente", true).order("codigo");
    if (error || !Array.isArray(data) || !data.length) return registroFallback();
    return {
      // deno-lint-ignore no-explicit-any
      moldes: data.map((r: any) => ({
        codigo: String(r.codigo),
        classe: r.classe as ClasseDeMolde,
        titulo: String(r.titulo ?? ""),
        gabarito: String(r.gabarito ?? ""),
        campos: Array.isArray(r.campos) ? r.campos as CampoDoMolde[] : [],
        fronteira: r.fronteira ? String(r.fronteira) : null,
        // Valor desconhecido cai no restritivo. Uma coluna nova que chegue vazia, ou um rotulo
        // que o banco passe a aceitar e este codigo ainda nao conheca, NAO deve destravar
        // analise livre por omissao — o erro barato e travar demais.
        composicao: GRUPOS_DE_COMPOSICAO.includes(r.composicao)
          ? r.composicao as GrupoDeComposicao
          : "nao_componivel",
        verificado_em: String(r.verificado_em ?? ""),
        revalidar_ate: r.revalidar_ate ? String(r.revalidar_ate) : null,
        versao: Number(r.versao ?? 1),
      })),
      degradado: false,
    };
  } catch {
    return registroFallback();
  }
}

// ============================================================================
// PREENCHIMENTO
// ============================================================================

export type ValoresDoMolde = Record<string, unknown>;

export type Resolucao =
  | {
    caminho: "canonico";
    molde: string;
    classe: ClasseDeMolde;
    /** Decide se este texto admite analise em volta. Lido do registro, nao inferido da classe. */
    composicao: GrupoDeComposicao;
    versao: number;
    texto: string;
    /** Campos usados, com origem declarada. Vai para a telemetria e para a auditoria. */
    campos_usados: { nome: string; origem: string; valor: string }[];
  }
  | {
    caminho: "llm";
    /** Motivo legivel. E o dado de governanca: motivo recorrente aponta molde mal desenhado. */
    motivo: string;
    molde?: string;
  };

function formatar(tipo: TipoDeCampo, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  switch (tipo) {
    case "dinheiro": {
      const s = brl(Number(v));
      return s === "indisponivel" ? null : s;
    }
    case "percentual": {
      const s = pct(Number(v));
      return s === "indisponivel" ? null : s;
    }
    case "inteiro": {
      const s = inteiro(Number(v));
      return s === "indisponivel" ? null : s;
    }
    case "lista": {
      if (!Array.isArray(v)) return null;
      const itens = v.map((x) => String(x).trim()).filter(Boolean);
      return itens.length ? itens.map((x) => `- ${x}`).join("\n") : null;
    }
    case "data": {
      const s = String(v).trim();
      // Aceita so ISO. Data em formato livre reintroduziria variancia na saida.
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : null;
    }
    default: {
      const s = String(v).trim();
      return s.length ? s : null;
    }
  }
}

/** Lacunas `{campo}` presentes no gabarito, em ordem de aparicao e sem repetir. */
export function lacunasDoGabarito(gabarito: string): string[] {
  const out: string[] = [];
  for (const m of String(gabarito ?? "").matchAll(/\{([a-z0-9_]+)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Preenche o gabarito. Devolve null se QUALQUER campo obrigatorio ficar sem valor.
 *
 * Devolver null em vez de escrever "indisponivel" na lacuna e a regra que impede o pior
 * defeito desta camada: forma fixa com buraco soa como resposta completa.
 */
export function preencher(
  molde: MoldeRegistro,
  valores: ValoresDoMolde,
): { texto: string; campos_usados: { nome: string; origem: string; valor: string }[] } | { falta: string } {
  const usados: { nome: string; origem: string; valor: string }[] = [];
  let texto = molde.gabarito;

  for (const campo of molde.campos) {
    const bruto = valores[campo.nome];
    const fmt = formatar(campo.tipo, bruto);
    if (fmt === null) {
      if (campo.obrigatorio) return { falta: `campo obrigatorio sem valor: ${campo.nome} (origem ${campo.origem})` };
      continue;
    }
    usados.push({ nome: campo.nome, origem: campo.origem, valor: fmt });
    texto = texto.split(`{${campo.nome}}`).join(fmt);
  }

  // Lacuna que sobrou nao declarada em `campos`: gabarito e registro divergiram.
  const sobrando = lacunasDoGabarito(texto);
  if (sobrando.length) return { falta: `lacuna no gabarito sem campo declarado: ${sobrando.join(", ")}` };

  return { texto, campos_usados: usados };
}

// ============================================================================
// A FRONTEIRA
// ============================================================================

export type ContextoDaFronteira = {
  /** Data de referencia em ISO. Injetada, nao lida do relogio: prova precisa ser reprodutivel. */
  hojeIso: string;
  /** true quando o registro veio do fallback local. */
  degradado: boolean;
};

/**
 * Decide entre caminho canonico e caminho LLM, e resolve o texto quando canonico.
 *
 * As cinco condicoes de recusa abaixo sao TODAS fail-open para o LLM. Nenhuma delas produz
 * resposta parcial.
 */
export function resolverRespostaCanonica(opts: {
  molde: Molde;
  registro: RegistroDeMoldes;
  valores?: ValoresDoMolde;
  ctx: ContextoDaFronteira;
}): Resolucao {
  const { molde, registro, ctx } = opts;

  // 1. Sem molde, ou molde apenas provavel. `fraca` existe para telemetria, nao para emitir.
  if (!molde.codigo) return { caminho: "llm", motivo: "turno nao casou nenhum molde" };
  if (molde.confianca !== "exata") {
    return { caminho: "llm", motivo: `molde apenas provavel (${molde.confianca})`, molde: molde.codigo };
  }

  // 2. Molde classificado mas nao registrado.
  //
  //    O motivo distingue os dois casos porque a acao de conserto e oposta: registro degradado
  //    e falha de INFRAESTRUTURA (o banco nao respondeu, o molde pode existir e estar la); molde
  //    ausente com registro vivo e DIVERGENCIA entre codigo e dado, que exige seed ou remocao do
  //    gatilho. Um motivo que confunde os dois manda o plantao investigar o lugar errado.
  const reg = registro.moldes.find((m) => m.codigo === molde.codigo);
  if (!reg) {
    return {
      caminho: "llm",
      motivo: registro.degradado
        ? "registro degradado: molde nao esta no fallback local"
        : "molde classificado nao existe no registro",
      molde: molde.codigo,
    };
  }

  // 3. Registro degradado e molde que depende de dado. Recusa canonica offline continua
  //    correta porque nao depende de numero; numero nao.
  if (registro.degradado && reg.classe !== "texto_canonico") {
    return { caminho: "llm", motivo: "registro degradado e molde depende de dado", molde: reg.codigo };
  }

  // 4. ENVELHECIMENTO. Este e o risco de primeira ordem da camada: conhecimento fixo e errado
  //    e pior que geracao variavel, porque e consistentemente errado e soa autoritativo.
  //    Passou de revalidar_ate, o molde para de emitir — nao emite com aviso.
  if (reg.revalidar_ate && reg.revalidar_ate < ctx.hojeIso) {
    return { caminho: "llm", motivo: `molde vencido em ${reg.revalidar_ate}`, molde: reg.codigo };
  }

  // 5. Campo obrigatorio faltando.
  const feito = preencher(reg, opts.valores ?? {});
  if ("falta" in feito) return { caminho: "llm", motivo: feito.falta, molde: reg.codigo };

  return {
    caminho: "canonico",
    molde: reg.codigo,
    classe: reg.classe,
    composicao: reg.composicao,
    versao: reg.versao,
    texto: feito.texto,
    campos_usados: feito.campos_usados,
  };
}

// A TELEMETRIA MUDOU DE CASA. `linhaDeTelemetria` vivia aqui e produzia `caminho` com dois
// valores possiveis. Foi REMOVIDA de proposito, e nao apenas marcada como obsoleta: com o
// hibrido existem tres caminhos, e uma funcao que so sabe emitir dois passaria pelo CHECK da
// tabela (que aceita os tres) contando todo turno hibrido como canonico. O erro seria
// silencioso e cairia exatamente sobre o numero que a auditoria precisa medir — a proporcao
// real de texto travado. Deixar a funcao antiga acessivel para quem for ligar a camada era
// deixar a armadilha montada.
//
// Use `linhaDeComposicao` de _shared/composicao_hibrida.ts.

// ============================================================================
// PONTO DE LIGACAO — NAO APLICADO DE PROPOSITO — versao HIBRIDA
// ============================================================================
//
// Esta camada esta pronta e provada, mas NAO esta ligada: o traffic-chat pertence a outro
// agente nesta rodada e segue sob medicao de latencia. O diff exato esta aqui para nao
// precisar ser redescoberto.
//
// A versao anterior deste diff descrevia a ligacao BINARIA: um curto-circuito unico, antes do
// modelo, que emitia canonico ou nao fazia nada. O hibrido exige TRES pontos, porque a
// composicao acontece em dois tempos: a instrucao ao modelo tem de entrar antes da geracao, e
// o bloco s'o pode ser resolvido depois das ferramentas.
//
// ARQUIVO: supabase/functions/traffic-chat/index.ts
//
// ----------------------------------------------------------------------------
// (1) IMPORTS, junto de intencao_turno.ts (hoje linha ~795)
// ----------------------------------------------------------------------------
//
//     import { classificarMolde } from "../_shared/molde_pergunta.ts";
//     import { carregarRegistroDeMoldes, resolverRespostaCanonica }
//       from "../_shared/resposta_canonica.ts";
//     import { compor, conferirIntegridade, instrucaoDeComposicao, linhaDeComposicao }
//       from "../_shared/composicao_hibrida.ts";
//
// ----------------------------------------------------------------------------
// (2) PONTO A — curto-circuito dos que emitem sozinhos, e a instrucao dos componiveis
// ----------------------------------------------------------------------------
//
// Entra DEPOIS de persistir a fala do gestor e ANTES do comentario "v20: prompt caching" —
// hoje logo apos o fecha-chaves do `if (!ehRetomada)` da linha ~6590, imediatamente antes da
// ~6594. Os tres motivos da versao anterior seguem valendo:
//   - a fala do gestor ja esta em chat_messages, entao a conversa nao perde turno;
//   - `objetivoOriginal` ja passou pelo objetivoDoFio, ou seja, "e o mesmo para o CONJ.5?" ja
//     virou o pedido inteiro. Classificar `message` cru quebraria todo turno de continuidade;
//   - esta ANTES de montarFerramentas e do cacheSystem, entao o turno que emite sozinho nao
//     paga roteador, nem catalogo de ferramentas, nem chamada de modelo.
//
//     const moldeDoTurno = classificarMolde(objetivoOriginal);
//     let instruiuOmitir = false;
//     let registroDeMoldes: Awaited<ReturnType<typeof carregarRegistroDeMoldes>> | null = null;
//
//     if (moldeDoTurno.confianca === "exata") {
//       registroDeMoldes = await carregarRegistroDeMoldes(supa);
//       const resol = resolverRespostaCanonica({
//         molde: moldeDoTurno, registro: registroDeMoldes, valores: {},
//         // `hojeIso` ja existe no escopo (linha ~6377). `degradado` vem do registro e nao do
//         // chamador de proposito: quem leu a tabela e quem sabe se a leitura falhou.
//         ctx: { hojeIso, degradado: registroDeMoldes.degradado },
//       });
//
//       // Emite sozinho: nao_componivel e turno_inteiro. Nunca chama modelo.
//       if (resol.caminho === "canonico" && resol.composicao !== "segmento_componivel") {
//         const c = compor({ resolucao: resol });
//         await supa.from("resolucoes_de_molde").insert({
//           company_id: company.id, conversation_id: convId,
//           ...linhaDeComposicao(moldeDoTurno, c),
//         });
//         await supa.from("chat_messages").insert({
//           conversation_id: convId, company_id: company.id, role: "assistant",
//           content: c.texto, model: `molde:${c.molde}`,
//           diagnostico: {
//             caminho: c.caminho, molde: c.molde, versao: c.versao,
//             composicao: c.composicao, chars_canonicos: c.bloco_canonico.length,
//           },
//         });
//         return json({ reply: c.texto, actionCards: [] });
//       }
//
//       // Componivel: NAO emite aqui. So avisa o modelo para nao escrever o bloco.
//       const linha = instrucaoDeComposicao(resol);
//       if (linha) { instrucaoExtra = linha; instruiuOmitir = true; }
//     }
//
//     `instrucaoExtra` e uma string a concatenar no system prompt. Ela tem de ir FORA do bloco
//     marcado com cache_control (hoje ~6594-6616), no mesmo lugar em que o bloco de agentes
//     entra: e conteudo que varia por turno, e dentro do bloco cacheavel invalidaria o cache
//     de prompt a cada pergunta — trocaria 34 tokens por um cache miss inteiro.
//
// ----------------------------------------------------------------------------
// (3) PONTO B — a composicao, DEPOIS do filtro pos-sintese
// ----------------------------------------------------------------------------
//
// Entra depois do bloco do `claimSan` (hoje ~7255-7258) e antes do insert final do assistant.
// A ORDEM AQUI NAO E NEGOCIAVEL, e o motivo esta na proxima secao.
//
//     if (moldeDoTurno.confianca === "exata" && registroDeMoldes) {
//       const resol = resolverRespostaCanonica({
//         molde: moldeDoTurno, registro: registroDeMoldes,
//         valores: valoresDoMolde,   // montado das RPCs/toolResults deste turno
//         ctx: { hojeIso, degradado: registroDeMoldes.degradado },
//       });
//       const c = compor({ resolucao: resol, gerado: reply, instruiuOmitir });
//       const integ = conferirIntegridade(c);
//       if (c.caminho === "hibrido" && integ.intacto) {
//         reply = c.texto;
//       }
//       await supa.from("resolucoes_de_molde").insert({
//         company_id: company.id, conversation_id: convId,
//         ...linhaDeComposicao(moldeDoTurno, c),
//       });
//       // diagnostico do insert final ganha: caminho, molde, composicao, chars_canonicos,
//       // chars_gerados e integ.inicio_do_gerado — este ultimo e o que a verificacao
//       // pos-resposta precisa para checar SO o trecho gerado. Ver contrato no fim.
//     }
//
// ============================================================================
// ARMADILHAS. A primeira e nova e e a mais grave do diff.
// ============================================================================
//
//   [1] O FILTRO POS-SINTESE APAGA O BLOCO CANONICO SE A COMPOSICAO VIER ANTES DELE.
//
//       `filtroPosSintese` (~6096-6197) existe por causa do incidente IMPULSAO de 20/08: se a
//       resposta AFIRMA card emitido e `actionCards` esta vazio, ele descarta o texto e troca
//       por um aviso. E a linha ~6192 e explicita: se o que sobrou ainda casa
//       RE_CLAIM_CARD_EMITIDO (~5972), zera tudo.
//
//       O gabarito de ATO_CONFIRMACAO_CARD casa esse regex por construcao — ele existe
//       justamente para afirmar cards emitidos. Compor ANTES do filtro significa que, em toda
//       rodada em que os cards nao entraram em `actionCards`, o bloco canonico e DELETADO. O
//       determinismo nao seria parafraseado, seria apagado, e a telemetria diria "hibrido"
//       para uma mensagem que saiu sem bloco nenhum.
//
//       Por isso o ponto B e depois do claimSan, e nao antes. Efeito colateral que e um ganho:
//       o filtro continua julgando SO o texto gerado, que e o unico que pode mentir. O bloco
//       canonico vem de approval_requests e nao tem como afirmar card que nao existe — foi
//       exatamente para isso que ele foi desenhado.
//
//       Consequencia para quem aplicar: se algum dia a composicao for movida para antes da
//       sintese, este filtro tem de passar a receber `integ.inicio_do_gerado` e julgar so o
//       slice. Mover sem isso reintroduz o incidente de 20/08 com aparencia de determinismo.
//
//   [2] MOLDE CALCULADO DEPENDE DE RPC — e o hibrido RESOLVE isso, com uma ressalva nova.
//
//       Na versao binaria isto era um beco: o unico ponto de ligacao era antes das RPCs, e
//       molde calculado sem numero cai para o LLM com "campo obrigatorio sem valor". O ponto
//       B esta DEPOIS das ferramentas, entao os 6 moldes calculados e os 2 de ato passam a
//       ter valor disponivel — e sao exatamente os 7 componiveis.
//
//       A ressalva nova: `valoresDoMolde` nao existe hoje: alguem tem de montar o mapa
//       campo->valor a partir dos toolResults, e a origem de cada campo esta declarada em
//       `moldes_de_resposta.campos[].origem` justamente para isso. Enquanto esse mapa nao
//       existir, o ponto B resolve para llm com "campo obrigatorio sem valor" e — atencao —
//       com `instruiuOmitir` verdadeiro, o que cai na armadilha [3].
//
//   [3] RESPOSTA MUTILADA: instruir a omitir e nao entregar o bloco.
//
//       O ponto A promete ao modelo que o bloco vem; o ponto B pode falhar. O modelo obedeceu
//       e omitiu os numeros, e a resposta sai comentando numeros que nao aparecem. Nao e
//       resposta errada, e resposta INCOMPLETA que parece completa.
//
//       `compor` devolve `defeito` preenchido nesse caso (por isso `instruiuOmitir` e
//       obrigatorio no ponto B). O conserto correto e regerar sem a instrucao; o aceitavel e
//       anexar uma nota honesta. O que NAO se pode fazer e entregar em silencio. O defeito
//       tambem vai para `resolucoes_de_molde.motivo`, entao um pico ali e alarme.
//
//   [4] Passar `objetivoOriginal` e obrigatorio, `message` nao serve. Ver motivo em (2).
//
//   [5] A telemetria e gravada nos TRES caminhos, de proposito. Gravar so canonico e hibrido
//       esconde exatamente o dado que revela molde mal desenhado: um `motivo` repetido 200
//       vezes no caminho llm e uma fonte de campo quebrada que ninguem veria. E sem os tres
//       `proporcao_canonica_medida()` nao tem denominador.
//
//   [6] O `return json(...)` do ponto A tem de espelhar a FORMA que o front ja consome no fim
//       do handler. Se a chave mudou, e a unica linha do diff que precisa de conferencia.
//
// ============================================================================
// CONTRATO PARA A VERIFICACAO POS-RESPOSTA (dono: outro agente. Descrito, nao implementado.)
// ============================================================================
//
// Na versao binaria eu propus que o verificador ignorasse turno com caminho = "canonico".
// MUDEI DE OPINIAO, e o hibrido e o motivo: um turno hibrido tem as duas naturezas, e ignorar
// o turno inteiro abriria um buraco na verificacao justamente na parte gerada — que e a unica
// que pode alucinar. Seria trocar um falso positivo por um falso negativo, no lado errado.
//
// O contrato correto e por TRECHO, nao por turno:
//
//   caminho = "llm"        verifica o texto inteiro. Nada muda.
//
//   caminho = "canonico"   NAO verifica. Nao passou por geracao; reprovar aqui e sempre falso
//                          positivo. Se o texto canonico esta errado, o conserto e no registro
//                          (`moldes_de_resposta`) e a deteccao e por revalidar_ate, nao pelo
//                          verificador de saida.
//
//   caminho = "hibrido"    verifica SO `texto.slice(inicio_do_gerado)`. O `diagnostico` do
//                          turno carrega `inicio_do_gerado` e `chars_canonicos` para isso, e
//                          `conferirIntegridade` devolve o offset ja calculado.
//
// Tres condicoes que o dono daquela camada precisa saber:
//
//   a) O offset e confiavel porque o bloco esta SEMPRE em posicao 0 e o separador e fixo
//      ("\n\n"). Nao ha delimitador a procurar no texto, e nao ha heuristica.
//
//   b) Se `conferirIntegridade` reprovar, o turno NAO deve ser verificado por trecho — deve
//      ser tratado como incidente da camada de composicao, porque significa que alguem mexeu
//      no texto entre a composicao e a persistencia. Verificar por trecho um texto adulterado
//      verificaria o slice errado.
//
//   c) O trecho gerado do hibrido foi produzido sob a instrucao de NAO repetir o bloco. Um
//      verificador que exija "a resposta declara os numeros" reprovaria o trecho por
//      obedecer. A regra de formato precisa ver a mensagem inteira para julgar completude, e
//      so o slice para julgar alucinacao. E a unica parte do contrato que nao e um simples
//      recorte, e vale discutir antes de implementar.

