// supabase/functions/geo-preset-resolve/index.ts
// One-shot: resolve keys Meta do preset Jurídico Salvador–BA e grava cache.
// Auth: x-mcp-key / Bearer MCP. Não cria ad set.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chaveMcpDe, mcpKeyValida } from "../_shared/mcp_auth.ts";
import { tokenAdsPorCompanyId, COMPANY_COHAPM } from "../_shared/meta_company_tokens.ts";
import {
  BAIRROS_CANONICOS_JURIDICO_SALVADOR,
  carregarPresetGeoJuridico,
  resolverECachearKeysPreset,
} from "../_shared/geo_preset_juridico.ts";
import { buscarGeolocalizacoesMeta } from "../_shared/geo_targeting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type, x-mcp-key",
      },
    });
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await mcpKeyValida(supa, chaveMcpDe(req, "bearer-or-header"));
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceOk = !!SERVICE_ROLE && bearer === SERVICE_ROLE;
  if (!auth.ok && !serviceOk) return json({ error: "unauthorized", motivo: auth.ok ? null : auth.motivo }, 401);

  let body: any = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    body = {};
  }
  const forcar = body?.forcar === true;
  const debug = body?.debug === true;

  const tok = tokenAdsPorCompanyId(COMPANY_COHAPM);
  if (!tok) {
    return json({
      erro: "token_ads_ausente",
      detalhe: "META_ADS_TOKEN_COHAPM ausente no runtime desta edge.",
    }, 500);
  }

  if (debug) {
    const amostra = await buscarGeolocalizacoesMeta({
      token: tok.token,
      nomes: ["Liberdade", "Pituba", "Cajazeiras"],
      tipo: "neighborhood",
      country_code: "BR",
      cidade_contexto: "Salvador",
      regiao_contexto: "Bahia",
      exigir_salvador_ba: true,
      limit_por_query: 10,
    });
    const amostraLivre = await buscarGeolocalizacoesMeta({
      token: tok.token,
      nomes: ["Liberdade"],
      tipo: "neighborhood",
      country_code: "BR",
      limit_por_query: 10,
    });
    return json({
      debug: true,
      com_filtro_ssa: {
        resolvidos: amostra.resolvidos,
        nao_encontrados: amostra.nao_encontrados,
        rejeitados: amostra.rejeitados_fora_salvador_ba,
        erros: amostra.erros,
        ambiguos: amostra.ambiguos.slice(0, 2),
      },
      sem_filtro: {
        resolvidos: amostraLivre.resolvidos,
        nao_encontrados: amostraLivre.nao_encontrados,
        erros: amostraLivre.erros,
        ambiguos: amostraLivre.ambiguos.slice(0, 1).map((a) => ({
          query: a.query,
          escolhido: a.escolhido,
          encontrados: a.encontrados,
        })),
      },
    });
  }

  const carregado = await carregarPresetGeoJuridico(supa, COMPANY_COHAPM);
  if (!carregado.preset) {
    return json({ erro: carregado.erro, detalhe: carregado.detalhe }, 500);
  }

  const res = await resolverECachearKeysPreset({
    supa,
    token: tok.token,
    preset: carregado.preset,
    forcar,
  });

  return json({
    ok: res.ok,
    company_id: COMPANY_COHAPM,
    meio: "juridico",
    city: "Salvador",
    region: "Bahia",
    lista_canonica_ts: BAIRROS_CANONICOS_JURIDICO_SALVADOR.length,
    total_nomes: res.total_nomes,
    resolvidos_salvador_ba: res.resolvidos.length,
    falhas: res.falhas.length,
    falhas_amostra: res.falhas.slice(0, 40),
    resolvidos_amostra: res.resolvidos.slice(0, 15).map((r) => ({
      query: r.query,
      key: r.key,
      name: r.name,
      primary_city: r.primary_city,
      region: r.region,
    })),
    gravou: res.gravou,
    erro: res.erro ?? null,
    detalhe: res.detalhe ?? null,
    isolamento:
      "Preset exclusivo do meio Jurídico. La Felicità e Legal é Viver não herdam.",
  });
});
