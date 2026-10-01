// Prova das travas do vigia de regua. Offline. O CI (job edges) roda todo _prova_*.ts.
import { escolherEscada, validarPlanoDeCorrecao } from "./correcao_custo.ts";

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) {
    falhas += 1;
    console.error("FALHOU:", msg);
  } else {
    console.log("OK", msg);
  }
}

const base = {
  veredito: "agir",
  alavanca: "pausar_criativo",
  evidencia: "custo R$ 12 na janela de 7 dias, regua R$ 7",
  mecanismo: "a peca cara puxa o custo do conjunto",
  criterio_de_sucesso: "custo por conversa dentro da regua",
  prazo_de_leitura: "2026-10-07",
  reversa: "reativar o anuncio se o custo voltar",
  risco: "o conjunto fica com menos peca por alguns dias",
  hoje: "2026-09-30",
  anuncios_entregando_no_conjunto: 4,
  pode_executar: true,
  peca_acervo_ok: true,
  atos_propostos: [
    { action: "pausar_criativo", target_external_id: "1203", target_name: "AD_X", payload: {} },
  ],
};

const proibida = validarPlanoDeCorrecao({
  ...base,
  alavanca: "alterar_orcamento",
  atos_propostos: [{ action: "alterar_orcamento", target_external_id: "1", payload: {} }],
});
ok(!proibida.ok && proibida.motivo?.startsWith("alavanca_proibida:alterar_orcamento"), "alavanca proibida recusada");

const escalar = validarPlanoDeCorrecao({
  ...base,
  alavanca: "escalar_criativo",
  atos_propostos: [{ action: "escalar_criativo", target_external_id: "1", payload: {} }],
});
ok(!escalar.ok && escalar.motivo === "alavanca_proibida:escalar_criativo", "escalar_criativo recusado");

const ultimo = validarPlanoDeCorrecao({
  ...base,
  anuncios_entregando_no_conjunto: 1,
});
ok(!ultimo.ok && ultimo.motivo === "ultimo_anuncio_que_entrega", "pausar o ultimo anuncio que entrega e recusado");

const semReversa = validarPlanoDeCorrecao({ ...base, reversa: "  " });
ok(!semReversa.ok && semReversa.motivo === "sem_reversa", "plano sem reversa e recusado");

const carencia = validarPlanoDeCorrecao({
  ...base,
  ultima_intervencao_em: "2026-09-28",
});
ok(!carencia.ok && carencia.motivo === "carencia_3_dias", "carencia de 3 dias e respeitada");

const foraDaCarencia = validarPlanoDeCorrecao({
  ...base,
  ultima_intervencao_em: "2026-09-26",
});
ok(foraDaCarencia.ok && foraDaCarencia.veredito === "agir", "depois de 3 dias o plano pode seguir");

const escadaUltimo = escolherEscada({
  anuncios_entregando: 1,
  peca_ok: true,
  pode_pausar_por_custo: true,
});
ok(
  escadaUltimo.alavanca === "criar_anuncio_a_partir_de" && !escadaUltimo.atos.includes("pausar_criativo"),
  "escada nao pausa o ultimo anuncio",
);

const escadaCarencia = escolherEscada({ carencia: true, anuncios_entregando: 5, peca_ok: true });
ok(escadaCarencia.motivo === "carencia_3_dias" && escadaCarencia.atos.length === 0, "escada respeita carencia");

if (falhas) {
  console.error(`${falhas} falha(s)`);
  Deno.exit(1);
}
console.log("OK travas de correcao de custo");
