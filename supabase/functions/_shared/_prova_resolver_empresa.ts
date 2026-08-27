// deno run --allow-read supabase/functions/_shared/_prova_resolver_empresa.ts
import {
  COMPANY_COHAPM,
  COMPANY_LEGAL,
  matchEmpresaPorRef,
  normNomeEmpresa,
} from "./meta_company_tokens.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const empresas = [
  { id: COMPANY_COHAPM, name: "COHAPM" },
  { id: "307849e6-78a7-4217-8112-3fb0a924f988", name: "Cooperativa_ Cohapm" },
  { id: COMPANY_LEGAL, name: "Legal é Viver" },
];

const substring = empresas.filter((e) =>
  e.name.toLowerCase().includes("cohapm")
);
assert(substring.length === 2, "ilike %COHAPM% casa COHAPM e Cooperativa_ Cohapm");

const porNome = matchEmpresaPorRef("COHAPM", empresas);
assert(porNome.ok && porNome.id === COMPANY_COHAPM, "COHAPM nome vai para a empresa operacional");

const porUuid = matchEmpresaPorRef(COMPANY_COHAPM, empresas);
assert(porUuid.ok && porUuid.id === COMPANY_COHAPM, "UUID COHAPM");

const coop = matchEmpresaPorRef("Cooperativa_ Cohapm", empresas);
assert(coop.ok && coop.id === "307849e6-78a7-4217-8112-3fb0a924f988", "cooperativa so por nome exato");

const legal = matchEmpresaPorRef("Legal é Viver", empresas);
assert(legal.ok && legal.id === COMPANY_LEGAL, "Legal por nome com acento");

const legalSlug = matchEmpresaPorRef("LEGAL", empresas);
assert(legalSlug.ok && legalSlug.id === COMPANY_LEGAL, "slug LEGAL");

const ausente = matchEmpresaPorRef("Inexistente", empresas);
assert(!ausente.ok && ausente.motivo === "ausente", "nome desconhecido");

assert(normNomeEmpresa("Cooperativa_ Cohapm") === "cooperativa cohapm", "underscore vira espaco");
assert(normNomeEmpresa("COHAPM") === "cohapm", "slug cohapm");

console.log("ok: _prova_resolver_empresa");
