// Prova das acoes de renomear nos tres niveis. O caso real: 01/09/2026, dois anuncios do
// CONJ.2_VISTTA nasceram com o nome do conjunto e a unica saida oferecida ao gestor foi
// renomear na mao no Gerenciador, porque so existia renomear_campanha.
// Roda com: deno run supabase/functions/_shared/_prova_renomear_niveis.ts

import { camposDeReconciliacao, driverParaAcao, nivelDaAcao } from "./pipeboard.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

// 1) Cada renomear cai no seu nivel. Nivel errado aqui derruba a leitura de conferencia com
//    OAuthException #100, porque a lista de campos e derivada dele.
{
  ok(nivelDaAcao("renomear_campanha") === "campanha", "renomear_campanha fora do nivel campanha");
  ok(nivelDaAcao("renomear_conjunto") === "conjunto", "renomear_conjunto fora do nivel conjunto");
  ok(nivelDaAcao("renomear_criativo") === "anuncio", "renomear_criativo fora do nivel anuncio");
}

// 2) A conferencia pos-escrita precisa ler `name` nos tres niveis — sem isso o espelho grava o
//    nome pedido sem nunca ter olhado o que a Meta aceitou.
{
  for (const nivel of ["campanha", "conjunto", "anuncio"] as const) {
    ok(
      camposDeReconciliacao(nivel).split(",").includes("name"),
      `campos de reconciliacao do nivel ${nivel} nao pedem name`,
    );
  }
}

// 3) Nivel do anuncio NAO pode pedir daily_budget: foi assim que a leitura inteira morreu com
//    #100 em pausar_criativo (v5.3). renomear_criativo usa a mesma lista.
{
  ok(
    !camposDeReconciliacao("anuncio").includes("daily_budget"),
    "nivel anuncio voltou a pedir daily_budget",
  );
}

// 4) Renomear segue o driver da empresa, sem exigencia propria. A COHAPM escreve pela graph e
//    em 01/09 levou driver_nao_suporta_acao ao pedir rename de campanha.
{
  const cohapm = { driver_escrita: "graph", driver_por_acao: {} };
  for (const acao of ["renomear_campanha", "renomear_conjunto", "renomear_criativo"]) {
    ok(driverParaAcao(cohapm, acao) === "graph", `${acao} nao respeitou o driver graph da empresa`);
  }
}

// 5) Override por acao continua mandando mais que o padrao da empresa.
{
  const comOverride = {
    driver_escrita: "graph",
    driver_por_acao: { renomear_criativo: "pipeboard" },
  };
  ok(
    driverParaAcao(comOverride, "renomear_criativo") === "pipeboard",
    "override por acao deixou de valer",
  );
  ok(
    driverParaAcao(comOverride, "renomear_conjunto") === "graph",
    "override vazou para outra acao",
  );
}

// 6) Empresa que escreve por pipeboard renomeia por pipeboard nos tres niveis.
{
  const legal = { driver_escrita: "pipeboard", driver_por_acao: {} };
  for (const acao of ["renomear_campanha", "renomear_conjunto", "renomear_criativo"]) {
    ok(driverParaAcao(legal, acao) === "pipeboard", `${acao} nao seguiu o driver pipeboard`);
  }
}

console.log("ok: _prova_renomear_niveis");
