import {
  assertAccountInCompany,
  classificarCatalogoPipeboard,
  classificarFerramentaPipeboard,
  isReadOnlyTool,
  type PipeboardToolDef,
  sanitizeReadArgs,
  scopeArgsToCompany,
  truncatePipeboardPayload,
} from "./pipeboard_read.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isReadOnlyTool("get_campaigns"), "get_campaigns deve ser leitura");
assert(isReadOnlyTool("list_meta_connections"), "list_* deve ser leitura");
assert(isReadOnlyTool("search_interests"), "search_* deve ser leitura");
assert(isReadOnlyTool("bulk_get_insights"), "bulk_get_* deve ser leitura");
assert(isReadOnlyTool("fetch"), "fetch deve ser leitura");
assert(isReadOnlyTool("estimate_audience_size"), "estimate_* deve ser leitura");
assert(isReadOnlyTool("bulk_search_interests"), "bulk_search_* deve ser leitura");
assert(!isReadOnlyTool("create_campaign"), "create_* bloqueado");
assert(!isReadOnlyTool("update_ad"), "update_* bloqueado");
assert(!isReadOnlyTool("delete_ad_creative"), "delete_* bloqueado");
assert(!isReadOnlyTool("upload_ad_image"), "upload_* bloqueado");
assert(!isReadOnlyTool("duplicate_campaign"), "duplicate_* bloqueado");
assert(!isReadOnlyTool("bulk_update_ads"), "bulk_update bloqueado");
assert(!isReadOnlyTool("add_users_to_audience"), "add_* bloqueado");
assert(!isReadOnlyTool("manage_account_slots"), "manage_* bloqueado");
assert(!isReadOnlyTool("publish_instagram_media"), "publish_* bloqueado");
assert(!isReadOnlyTool("remove_users_from_audience"), "remove_* bloqueado");
assert(!isReadOnlyTool("submit_feedback"), "submit_* bloqueado");
// `search` e leitura pelo readOnlyHint do conector e continua recusado por ISOLAMENTO: ele
// varre contas, paginas e businesses e nao tem account_id no schema, entao scopeArgsToCompany
// nao consegue prende-lo a empresa da conversa.
assert(!isReadOnlyTool("search"), "search recusado por nao ser escopavel por empresa");

// ===== Segunda camada: o que o servidor declara =====
// O nome sozinho nao distingue get_campaigns de um futuro get_or_create_campaign. Estes casos
// existem para que a camada de anotacao nao possa ser removida sem quebrar a prova.
const soNome = classificarFerramentaPipeboard("get_campaigns", {});
assert(soNome.leitura && soNome.motivo === "ok", "sem anotacao, decide pelo nome");

const mentiroso = classificarFerramentaPipeboard("get_or_create_campaign", { readOnlyHint: false });
assert(
  !mentiroso.leitura && mentiroso.motivo === "servidor_declara_nao_leitura" && mentiroso.nome_passa,
  "nome de leitura + readOnlyHint=false deve ser recusado, e o nome_passa registra a divergencia",
);

const destrutivo = classificarFerramentaPipeboard("get_purge_everything", { destructiveHint: true });
assert(
  !destrutivo.leitura && destrutivo.motivo === "servidor_declara_destrutiva",
  "destructiveHint=true recusa mesmo com nome de leitura",
);

// destructiveHint=false NAO absolve: update_adset do Pipeboard declara exatamente isso e
// escreve (tools/list request 610, 11/08/2026).
const escritaNaoDestrutiva = classificarFerramentaPipeboard("update_adset", { destructiveHint: false });
assert(!escritaNaoDestrutiva.leitura, "destructiveHint=false nao pode liberar update_*");

// Anotacao ausente nao recusa: o protocolo MCP nao obriga annotations, e tratar ausencia como
// "declara escrita" recusaria o catalogo inteiro de um servidor que simplesmente nao anota.
const semAnotacaoNenhuma = classificarFerramentaPipeboard("list_ad_images", null);
assert(semAnotacaoNenhuma.leitura, "annotations ausente nao pode recusar leitura");

// ===== O quadrante que precisa ficar vazio =====
// Enumeracao de 03/09/2026: 121 ferramentas no conector, 58 leitura, 61 escrita declarada,
// 2 leituras recusadas por nome/isolamento, e ZERO no quadrante (nome de leitura + servidor
// declarando escrita). Este caso prova que o classificador ACHA esse quadrante quando ele
// existe — do contrario "divergentes: []" no relatorio de auditoria nao significaria nada.
const catalogoFicticio: PipeboardToolDef[] = [
  { name: "get_campaigns", annotations: { readOnlyHint: true } },
  { name: "create_campaign", annotations: { readOnlyHint: false } },
  { name: "get_and_bump_counter", annotations: { readOnlyHint: false } },
];
const c = classificarCatalogoPipeboard(catalogoFicticio);
assert(c.total === 3, "classificou as tres");
assert(c.leitura.length === 1 && c.leitura[0].name === "get_campaigns", "so get_campaigns passa");
assert(c.recusadas.length === 2, "duas recusadas");
assert(
  c.divergentes.length === 1 && c.divergentes[0].name === "get_and_bump_counter",
  "o divergente e o nome de leitura que o servidor desmente",
);

const stripped = sanitizeReadArgs({
  account_id: "act_1",
  access_token: "SECRET",
  token: "SECRET2",
  limit: 10,
});
assert(stripped.account_id === "act_1", "account_id preservado");
assert(!("access_token" in stripped), "access_token removido");
assert(!("token" in stripped), "token removido");

const ok = assertAccountInCompany("act_1622612945584817", ["1622612945584817"]);
assert(ok.ok && ok.account_id === "1622612945584817", "conta da empresa aceita");
const bad = assertAccountInCompany("999", ["1622612945584817"]);
assert(!bad.ok && bad.erro === "account_fora_da_empresa", "conta de outra empresa rejeitada");

const scoped = scopeArgsToCompany(
  "get_campaigns",
  {},
  ["1622612945584817"],
  { account_id: {} },
);
assert(scoped.ok === true && scoped.args.account_id === "act_1622612945584817", "injeta unica conta");

const blocked = scopeArgsToCompany(
  "get_campaigns",
  { account_id: "act_outra" },
  ["1622612945584817"],
  { account_id: {} },
);
assert(blocked.ok === false, "bloqueia account_id fora da empresa");

const multi = scopeArgsToCompany(
  "get_campaigns",
  {},
  ["111", "222"],
  { account_id: {} },
);
assert(multi.ok === false && multi.erro === "informe_account_id_das_contas_da_empresa", "exige account quando ha varias");

const writeCall = scopeArgsToCompany("create_campaign", {}, ["1622612945584817"], {});
// scopeArgsToCompany nao checa read-only; isReadOnlyTool e a guarda primaria.
assert(!isReadOnlyTool("create_campaign"), "guarda primaria de escrita");

const big = {
  data: Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, name: `Nome longo ${i}`.repeat(20) })),
};
const cut = truncatePipeboardPayload(big, 5000);
assert(cut.truncado === true, "payload grande deve truncar");
assert((cut.data as { omitidos?: number }).omitidos! > 0, "deve declarar omitidos");

console.log("ok: _prova_pipeboard_read");
