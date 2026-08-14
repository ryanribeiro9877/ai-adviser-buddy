import {
  assertAccountInCompany,
  isReadOnlyTool,
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
assert(!isReadOnlyTool("create_campaign"), "create_* bloqueado");
assert(!isReadOnlyTool("update_ad"), "update_* bloqueado");
assert(!isReadOnlyTool("delete_ad_creative"), "delete_* bloqueado");
assert(!isReadOnlyTool("upload_ad_image"), "upload_* bloqueado");
assert(!isReadOnlyTool("duplicate_campaign"), "duplicate_* bloqueado");
assert(!isReadOnlyTool("bulk_update_ads"), "bulk_update bloqueado");
assert(!isReadOnlyTool("add_users_to_audience"), "add_* bloqueado");
assert(!isReadOnlyTool("manage_account_slots"), "manage_* bloqueado");

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
