// Prova de regressao para guardas que precisam permanecer nos dois caminhos do agente.
// Rode: deno run --allow-read supabase/functions/_shared/_prova_isolamento_empresas.ts
const chat = await Deno.readTextFile(
  new URL("../traffic-chat/index.ts", import.meta.url),
);
const job = await Deno.readTextFile(
  new URL("../traffic-agent-job/index.ts", import.meta.url),
);
const compliance = await Deno.readTextFile(
  new URL("../compliance-check/index.ts", import.meta.url),
);
const legendas = await Deno.readTextFile(
  new URL("../gerar-legendas/index.ts", import.meta.url),
);
const metaActions = await Deno.readTextFile(
  new URL("../meta-actions/index.ts", import.meta.url),
);
const uploadMidia = await Deno.readTextFile(
  new URL("../upload-midia/index.ts", import.meta.url),
);
const empCredito = await Deno.readTextFile(
  new URL("./empresa_credito.ts", import.meta.url),
);

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

for (const [name, source] of [["chat", chat], ["job", job]] as const) {
  assert(
    source.includes("if (!data?.length || !name?.trim()) return null"),
    `${name}: empresa ausente deve falhar fechado`,
  );
  assert(
    source.includes('.select("id,company_id").eq("id", convId)'),
    `${name}: conversa deve carregar company_id`,
  );
  assert(
    source.includes('return json({ error: "conversation_company_mismatch" }, 409)'),
    `${name}: conversa cruzada deve ser recusada`,
  );
}

assert(
  !job.includes("Voce e o Gestor de Trafego IA da Legal e Viver"),
  "job: sintese nao pode fixar Legal e Viver",
);
assert(
  job.includes('p_company_id: companyId') &&
    job.includes('case "get_estrutura_conjuntos": return await t_estrutura_conjuntos(ctx.companyId, ctx.pedido)'),
  "job: estrutura deve ser escopada pela empresa",
);
assert(
  chat.includes("nenhuma_pasta_drive_configurada_para_esta_empresa") &&
    job.includes("nenhuma_pasta_drive_configurada_para_esta_empresa"),
  "Drive deve falhar fechado nos dois caminhos",
);
assert(
  chat.includes("company_id: companyId") &&
    job.includes("JSON.stringify({ company_id: companyId, legenda })"),
  "compliance deve receber company_id",
);

// v28.53: isolamento credito vs COHAPM
assert(empCredito.includes("empresaEhCredito"), "helper empresa_credito existe");
assert(
  !compliance.includes(
    "Guardião de Compliance de anúncios de crédito consignado (Legal é Viver)",
  ),
  "compliance-check nao pode hardcodar so Legal no prompt unico",
);
assert(
  compliance.includes("empresaEhCredito") && compliance.includes("filtrarRegrasPorEmpresa"),
  "compliance-check deve ramificar por empresa",
);
assert(
  !legendas.includes("LEV_COMPANY") && legendas.includes("company_id_obrigatorio"),
  "gerar-legendas nao pode defaultar LEV",
);
assert(
  chat.includes("MAX_PROPOSE_ANUNCIO_POR_SEGMENTO") &&
    chat.includes('verdAtual() === "atencao"'),
  "traffic-chat: atencao apto + limite propose por segmento",
);
assert(
  !chat.includes('norm(nomeAlvo) === "sem_molde"') &&
    !chat.includes("norm(nomeAlvo) === '_sem_molde'"),
  "traffic-chat nao pode comparar sem_molde via norm() (ela remove o underscore)",
);
assert(
  chat.includes("pedidoLoteCriativo") &&
    chat.includes("pareceNomeDePecaNaoMolde") &&
    chat.includes("ehSentinelaSemMolde") &&
    chat.includes("LINKS DE CONJUNTO DEFINIDOS NESTA CONVERSA") &&
    chat.includes("replyLoteComLegendas") &&
    chat.includes("LOTE DE 6 CRIATIVOS"),
  "traffic-chat deve lembrar conjunto N + link da conversa e auto-continuar lote",
);
assert(
  chat.includes("pergunta_nao_e_ato") &&
    chat.includes("ehPerguntaDeLeitura") &&
    chat.includes("PERGUNTA") &&
    // Versao pinada quebrava a prova a cada bump legitimo e escondia as regras reais
    // abaixo; o que importa e existir o carimbo de versao, nao qual numero ele tem.
    /const VERSAO = "chat-v\d+\.\d+"/.test(chat) &&
    chat.includes("sistema_ocular") &&
    chat.includes("instagram_nao_vinculado") &&
    chat.includes("nome_trocado_pelo_padrao_estruturado") &&
    chat.includes("recusaFalsaMoldeTrafego") &&
    chat.includes("orcamento_parece_centavos") &&
    /instagram vincul/i.test(chat),
  "traffic-chat: Instagram + molde + orcamento em reais + Sistema Ocular",
);
assert(
  chat.includes("empresaEhCredito(companyId)") &&
    !chat.includes('special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"]'),
  "criar_campanha nao forca FINANCIAL para todas as empresas",
);
assert(
  metaActions.includes("empresaEhCredito") && metaActions.includes("catsEspeciais"),
  "meta-actions cria campanha com cats por empresa",
);
assert(
  metaActions.includes("instagram_nao_vinculado") &&
    metaActions.includes("nome_fora_do_escopo_trafego") &&
    metaActions.includes("recusarSemIdentidadeNasPlataformas"),
  "meta-actions v5.46: fail-closed Instagram + nao sobrescreve nome de trafego",
);
assert(
  metaActions.includes("conferirOrcamentoReais") &&
    metaActions.includes("corrigir_orcamento_adsets") &&
    chat.includes("orcamentoEfetivo"),
  "meta-actions v5.49 + chat: orcamento em reais, nao centavos",
);
assert(
  metaActions.includes("alterar_categoria_especial_campanha") &&
    chat.includes("alterar_categoria_especial") &&
    chat.includes("t_alterar_categoria_especial"),
  "acao/tool de alterar categoria especial deve existir no chat e no executor",
);
assert(
  chat.includes("carregarMemoriaInstitucional") && job.includes("carregarMemoriaInstitucional"),
  "memoria institucional deve passar pelo filtro de isolamento em chat e job",
);
assert(
  !chat.includes("COHAPM e cooperativa habitacional, nao empresa de credito"),
  "prompt do chat nao pode hardcodar COHAPM no ramo nao-credito",
);
assert(
  !job.includes("cooperativa habitacional; doutrina, benchmarks e identidades da Legal e Viver"),
  "sintese do job nao pode hardcodar cooperativa vs Legal no perfil",
);
assert(
  job.includes("promptVideoNaoCredito") && job.includes("promptImgNaoCredito"),
  "job visao deve ramificar COHAPM",
);
assert(
  !job.includes("EXCLUSIVAMENTE de credito consignado CLT"),
  "job visao nao pode forcar CLT exclusivo",
);
assert(
  uploadMidia.includes("matchEmpresaPorRef") &&
    !uploadMidia.includes('ilike("name", `%${compRef}%`)'),
  "upload-midia nao pode resolver empresa por substring (COHAPM vs Cooperativa_ Cohapm)",
);

console.log("ok: _prova_isolamento_empresas");
