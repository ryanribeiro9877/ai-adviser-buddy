// deno run supabase/functions/_shared/_prova_memoria_conjunto.ts
import {
  escolherNomeCriativoTravado,
  ehFlagSemMolde,
  ehNomeCompostoEstruturado,
  ehSentinelaSemMolde,
  extrairNomesCriativoDaFala,
  extrairSlateDaFala,
  nomeCompostoForaDeEscopoTrafego,
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

console.log("ok: _prova_memoria_conjunto");
