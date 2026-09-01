// deno run supabase/functions/_shared/_prova_memoria_conjunto.ts
import {
  escolherNomeCriativoTravado,
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehSentinelaSemMolde,
  extrairNomesCriativoDaFala,
  extrairSlateDaFala,
  nomeCompostoForaDeEscopoTrafego,
  pareceApprovalIdEmVezDeDrive,
  pecasDoConjunto,
  temSlateNoTexto,
} from "./memoria_conjunto.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const contrato = [
  "JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02",
  "JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02",
  "JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
];

const extraidos = extrairNomesCriativoDaFala(
  "1. JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02\n2. JUR_CONV_CONJ03_AD02_Emprestimo_Conta_Corrente_LEVA02\n3. JUR_CONV_CONJ03_AD03_Cartao_Armadilha_LEVA02",
);
assert(extraidos.join("|") === contrato.join("|"), "extrai os 3 nomes");

const recusa = escolherNomeCriativoTravado({
  nomePedido: "[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]",
  nomesContrato: contrato,
  conjuntoNumero: 3,
});
assert(!recusa.ok && recusa.erro === "nome_trocado_pelo_padrao_estruturado", "recusa composto");

const ad03 = escolherNomeCriativoTravado({
  nomePedido: "",
  nomesContrato: contrato,
  nomesJaUsados: contrato.slice(0, 2),
  conjuntoNumero: 3,
});
assert(ad03.ok && ad03.nome === contrato[2], "autofill AD03");

assert(ehNomeCompostoEstruturado("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]"), "composto");
assert(nomeCompostoForaDeEscopoTrafego("[COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26]"), "fora escopo");
assert(!nomeCompostoForaDeEscopoTrafego(contrato[2]), "livre ok");

const normChat = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-_\s]+/g, "");
assert(normChat("sem_molde") === "semmolde", "norm do chat remove underscore");
assert(normChat("sem_molde") !== "sem_molde", "comparar norm===sem_molde e sempre falso");
assert(ehSentinelaSemMolde("sem_molde"), "sentinela crua");
assert(ehSentinelaSemMolde("sem molde"), "sentinela com espaco");
assert(ehFlagSemMolde("true"), "flag string");
assert(!ehSentinelaSemMolde("JURIDICO_CONJ.01"), "nome real nao e sentinela");

const falaSlate = `Inventario: 34 videos
| Mes | Pasta | Arquivo | drive_file_id |
| Junho | Videos | 01. Chegando em casa.mp4 | \`1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn\` |

### CONJ.1 — descoberta e rotina
| Nº | Criativo | Pasta | drive_file_id | Motivação |
| 1 | 01. Chegando em casa.mp4 | Junho/Vídeos | \`1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn\` | Abre a comunicação pela sensação de chegada e pertencimento |
| 2 | 02. Família Gourmet.mp4 | Junho/Vídeos | \`1pRzXOOaI1ctoUwN-spXtOAse4KEXgjyP\` | Mostra convivência e uso coletivo do espaço |
| 8 | 07. Noite.mp4 | Julho/Reels | \`1GGX2-aveLWKo4l_PUXGA-f92M72XJisP\` | Amplia a percepção de uso para além do horário diurno |

**Ângulo de legenda:** descoberta, rotina e sensação de morar bem.
**CTA:** conhecer o La Felicità.

### CONJ.2 — lazer
| Nº | Criativo | Pasta | drive_file_id | Motivação |
| 1 | 06. Futebol.mp4 | Junho/Vídeos | \`1LKMMzydHkrC4_SvaZGPM6YEDFB1yiBIC\` | Mostra lazer esportivo |
`;

assert(temSlateNoTexto(falaSlate), "detecta slate no texto");
const slate = extrairSlateDaFala(falaSlate);
assert(slate.length === 4, `slate length=${slate.length}`);
const c1 = pecasDoConjunto(slate, 1);
assert(c1.length === 3, `conj1=${c1.length}`);
assert(c1.some((p) => p.drive_file_id === "1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn"), "id chegando");
assert(c1.some((p) => p.nome.includes("Gourmet")), "gourmet no conj1");
assert(c1.every((p) => /conhecer o La Felicit/i.test(String(p.cta ?? ""))), "cta conj1");
assert(pecasDoConjunto(slate, 2).length === 1, "conj2 um video");

// ===== approval_id entrando no lugar do drive_file_id (slate do VISTTA, 01/09/2026) =====
// Os 9 valores que de fato sujaram conversation_slate, todos cauda de um approval_id.
for (
  const lixo of [
    "19-4a55-b16f-45c3f2b89c2d",
    "161c4d-a485-41d5-8db9-3d767be56976",
    "17-0d0c-451b-ac6f-d0a9cfed777f",
    "1cf413-fd3e-4fc6-bd9c-ec9302e40407",
    "16619-8a44-4d57-a1f8-1b7896b63714",
    "10f6-0865-4d6f-ad16-227e42c023b3",
    "15-402a-9c1f-a8f3e1b5c9d2",
    "151a44-18d7-491c-bc61-1a4f3ef743f3",
    "18-76a7-4cf9-8c48-780cff8a7099",
  ]
) {
  assert(pareceApprovalIdEmVezDeDrive(lixo), `deixou passar approval_id: ${lixo}`);
}

// Os ids de Drive REAIS da mesma conversa — inclusive os que tem hifen, que uma regra
// ingenua de "tem hifen = invalido" derrubaria.
for (
  const bom of [
    "1lmOkIVH1LUck_sXyeR23HnPn70gD_2uV",
    "1ncp2yv-Jtwse150Lz2bGnrraCJs-JOoh",
    "1-i4AgqTDwcZw_W4Vw-iedv52NYNutPkU",
    "1OnXG-f9MNVYP5582hByWYb5bnquKvmOg",
    "1CWC-JwBm_aIiEfwf1RKHNoTcard0bMjX",
    "15THl76qsL__XJkEF0H1uyeiHLWmGGojt",
    "1WEyQ3PwF5i21Yx9WJVJSCI9Bo7cmsKuU",
    "1irTnZ7pGEHJCxnPC8BI9PMjDTfdAqEF4",
    "12VfWYmLfmdfLsBaZgax9PEqjKNa9Tfhs",
    "1gs0uF34wD3h4KRrknI5mcZ_Q32iod-tn",
  ]
) {
  assert(!pareceApprovalIdEmVezDeDrive(bom), `recusou id de Drive legitimo: ${bom}`);
}

// approval_id inteiro tambem cai — foi assim que o valor nasceu antes de ser truncado.
assert(
  pareceApprovalIdEmVezDeDrive("b7c8d92f-4e15-402a-9c1f-a8f3e1b5c9d2"),
  "deixou passar approval_id completo",
);

console.log("ok: _prova_memoria_conjunto");
