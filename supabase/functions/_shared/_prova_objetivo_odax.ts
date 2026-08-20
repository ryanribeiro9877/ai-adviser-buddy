// Prova local do helper objetivo_odax. Rode: deno run supabase/functions/_shared/_prova_objetivo_odax.ts
import {
  resolverObjetivoOdax,
  familiaDeObjetivo,
  ehFamiliaSocialTopo,
  defaultsConjuntoSocialTopo,
  targetingPadraoSocialTopo,
  mensagemObjetivoNaoSuportado,
  normalizarObjetivoOdax,
} from "./objetivo_odax.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizarObjetivoOdax("ENGAJAMENTO") === "OUTCOME_ENGAGEMENT", "ENGAJAMENTO");
assert(normalizarObjetivoOdax("POST_ENGAGEMENT") === "OUTCOME_ENGAGEMENT", "POST_ENGAGEMENT");
assert(normalizarObjetivoOdax("RECONHECIMENTO") === "OUTCOME_AWARENESS", "RECONHECIMENTO");
assert(normalizarObjetivoOdax("AWARENESS") === "OUTCOME_AWARENESS", "AWARENESS");
assert(normalizarObjetivoOdax("LEADS") === "OUTCOME_LEADS", "LEADS");

const viaTag = resolverObjetivoOdax({ objetivo_tag: "ENGAJAMENTO" });
assert(viaTag.ok && viaTag.objetivo === "OUTCOME_ENGAGEMENT", "tag ENGAJAMENTO");

const viaObj = resolverObjetivoOdax({ objetivo: "OUTCOME_ENGAGEMENT", objetivo_tag: "LEADS" });
assert(viaObj.ok && viaObj.objetivo === "OUTCOME_ENGAGEMENT", "objetivo prevalece");

const defaultLeads = resolverObjetivoOdax({});
assert(defaultLeads.ok && defaultLeads.objetivo === "OUTCOME_LEADS", "default casa");

const ruim = resolverObjetivoOdax({ objetivo: "FOO_BAR" });
assert(!ruim.ok, "invalido");
assert(mensagemObjetivoNaoSuportado("FOO_BAR").erro === "objetivo_nao_suportado", "nome recusa");

assert(familiaDeObjetivo("OUTCOME_ENGAGEMENT") === "engajamento", "familia eng");
assert(ehFamiliaSocialTopo("ENGAJAMENTO") === true, "social tag");
assert(ehFamiliaSocialTopo("LEADS") === false, "leads nao social");

const defs = defaultsConjuntoSocialTopo("engajamento", "1095196357012756");
assert(!("erro" in defs), "defs ok");
if (!("erro" in defs)) {
  assert(defs.optimization_goal === "POST_ENGAGEMENT", "opt default");
  assert(defs.destination_type === "ON_POST", "dest ON_POST");
  assert(defs.billing_event === "IMPRESSIONS", "billing");
  assert(defs.promoted_object.page_id === "1095196357012756", "page");
}

const likes = defaultsConjuntoSocialTopo("engajamento", "1095196357012756", "PAGE_LIKES");
assert(!("erro" in likes) && likes.destination_type === "ON_PAGE", "ON_PAGE");

const reachEmEng = defaultsConjuntoSocialTopo("engajamento", "1095196357012756", "REACH");
assert("erro" in reachEmEng && reachEmEng.erro === "optimization_goal_nao_suportado_para_engajamento", "REACH bloqueado em eng");

const reach = defaultsConjuntoSocialTopo("reconhecimento", "1095196357012756", "REACH");
assert(!("erro" in reach) && reach.optimization_goal === "REACH", "reach");
assert(!("erro" in reach) && reach.destination_type === null, "awareness sem dest");

const semPage = defaultsConjuntoSocialTopo("engajamento", "");
assert("erro" in semPage && semPage.erro === "page_id_obrigatorio_para_engajamento", "page obrig");

const tgt = targetingPadraoSocialTopo();
assert((tgt.geo_locations as any)?.countries?.[0] === "BR", "geo BR");
assert((tgt.targeting_automation as any)?.advantage_audience === 1, "advantage");

console.log("ok: _prova_objetivo_odax");
