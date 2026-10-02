// O ultimo elo de driverParaAcao e pipeboard. Graph explicito continua graph.
// Roda com: deno run supabase/functions/_shared/_prova_driver_padrao.ts

import { driverDe, driverParaAcao } from "./pipeboard.ts";

function ok(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    Deno.exit(1);
  }
}

ok(driverParaAcao(undefined, "criar_campanha") === "pipeboard", "config ausente cai em pipeboard");
ok(driverParaAcao({}, "pausar_campanha") === "pipeboard", "sem driver_escrita cai em pipeboard");
ok(driverDe(null) === "pipeboard", "driverDe ausente cai em pipeboard");
ok(driverDe({}) === "pipeboard", "driverDe vazio cai em pipeboard");

ok(
  driverParaAcao({ driver_escrita: "graph" }, "criar_campanha") === "graph",
  "graph explicito da empresa permanece graph",
);
ok(driverDe({ driver_escrita: "graph" }) === "graph", "driverDe graph explicito");

ok(
  driverParaAcao({ driver_escrita: "pipeboard" }, "criar_conjunto") === "pipeboard",
  "empresa pipeboard",
);
ok(driverDe({ driver_escrita: "pipeboard" }) === "pipeboard", "driverDe pipeboard");

{
  const cfg = {
    driver_escrita: "pipeboard",
    driver_por_acao: { vincular_instagram_dos_anuncios: "graph" },
  };
  ok(
    driverParaAcao(cfg, "vincular_instagram_dos_anuncios") === "graph",
    "override de instagram manda mais que a empresa",
  );
  ok(
    driverParaAcao(cfg, "criar_campanha") === "pipeboard",
    "override de instagram vazou para outra acao",
  );
}

console.log("ok: _prova_driver_padrao");
