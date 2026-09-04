import { describe, expect, it } from "vitest";

// Paridade dos espelhos: `supabase/functions/_shared/x_y.ts` e `src/lib/x-y.ts` são a MESMA
// lógica escrita duas vezes, e até aqui nada conferia que continuavam iguais. É a mesma classe
// de defeito que produziu seis denominadores diferentes para o mesmo custo neste projeto:
// lógica duplicada sem guarda de paridade, divergindo em silêncio.
//
// POR QUE VIGIAR EM VEZ DE DEDUPLICAR
// A duplicação existe porque o `supabase functions deploy` empacota só o que está sob
// `supabase/functions` — a edge não alcança `src/`. O contrário funcionaria (o Vite alcança
// `supabase/`), então dava para transformar `src/lib/x-y.ts` num reexport e acabar com a cópia.
// Não foi feito por um acoplamento medido: o portão de cobertura recorta `include` em `src/**`
// com pisos ~1pp abaixo do medido (66/65 contra 67.74/66.62), e estes quatro módulos carregam
// 117 testes próprios muito cobertos. Tirá-los do denominador derrubaria o job `front`, que
// está verde, para consertar paridade — trade ruim. Se algum dia o `include` passar a cobrir
// `supabase/functions/_shared`, deduplicar volta à mesa e este arquivo perde a razão de existir.
//
// POR QUE COMPORTAMENTAL E NÃO TEXTUAL
// Comparar fonte normalizada acusa 15 dos 46 exports comuns como divergentes, e todos os 15 são
// cosméticos: a cópia do `src/` passa pelo prettier (`String(v ?? "")\n.trim()\n.toLowerCase()`,
// `return (\n A || B\n)`) e a do `_shared`, não. Guarda que grita por formatação é guarda que se
// aprende a ignorar. Então o que se afirma aqui é o que importa: MESMA ENTRADA, MESMA SAÍDA.

type Modulo = Record<string, unknown>;

// Dois globs estáticos — é assim que o Vite enxerga as duas árvores. As provas do `_shared`
// ficam fora: usam API do Deno e nada têm a ver com paridade.
const NO_DENO = import.meta.glob<Modulo>([
  "../../supabase/functions/_shared/*.ts",
  "!**/_prova_*.ts",
]);
const NO_LIB = import.meta.glob<Modulo>(["./*.ts", "!./*.test.ts"]);

const base = (p: string) => p.split("/").pop()!.replace(/\.ts$/, "");

// `_shared/memoria_conjunto.ts` <-> `src/lib/memoria-conjunto.ts`. A descoberta é automática de
// propósito: um quinto módulo duplicado amanhã entra aqui sozinho. Consertar caso a caso é
// exatamente como a divergência começou.
const PARES = Object.keys(NO_DENO)
  .map((deno) => {
    const alvo = base(deno).replace(/_/g, "-");
    const lib = Object.keys(NO_LIB).find((p) => base(p) === alvo);
    return lib ? { nome: alvo, deno, lib } : null;
  })
  .filter((p): p is NonNullable<typeof p> => p !== null);

// Entradas de domínio. Precisam ser realistas: corpus pobre faz todo predicado devolver false
// nos dois lados e a paridade passa sem provar nada (ver o teste de vacuidade no fim).
const FALAS = [
  "",
  "   ",
  "oi",
  "escolhe 6 criativos diferentes do conjunto 1 e gera as legendas",
  "separa mais 6 videos diferentes entre si com legendas",
  "emite os 3 cards do conjunto 2",
  "emite os N",
  "gera as legendas do CONJ.4 com 8 videos",
  "sobe os ultimos 3 pendentes",
  "qual o gasto de ontem?",
  "qual pasta do drive dos anuncios do CONJ.1",
  "as tres legendas do conjunto ficaram pendentes",
  "legendas pendentes, nao cobertos por falta de tempo",
  "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26",
  "JUR_CONV_CONJ03_AD01_JUROS",
  "AD_CONJ.2_APENAS_OCULOS_VISTTA",
  "JURIDICO_CONJ.02",
  "conjunto 3",
  "CONJ.01",
  "sem_molde",
  "_sem_molde",
  "composto",
  "nome_composto",
  "orcamento de 50 reais por dia",
  "orcamento diario de R$ 35,00",
  "coloca 5000 de orcamento diario",
  "https://wa.me/5531999999999",
  "o conjunto 2 usa o link wa.me/5531988887777 e o conjunto 3 o wa.me/5531977776666",
  "veredito: apto, drive_file_id 1AbC",
  "legenda 1: juros abusivos. legenda 2: contrato com taxa. drive_file_id 1XyZ",
  "DELETED",
  "ARCHIVED",
  "ACTIVE",
  "CAMPAIGN_PAUSED",
  "PAUSED",
  "true",
  "1",
  "0",
  "false",
  // Pedidos que separam intenção de ato (intencao-turno).
  "cria as legendas do conjunto 2, nao emite card ainda",
  "so as legendas, sem emitir nada",
  "emita os cards do conjunto 2",
  "sobe os videos para a biblioteca da meta",
  "suba os restantes para a biblioteca",
  "detalha a campanha JUR_CONV e mostra os conjuntos e anuncios",
  "consulta nao realizada nesta rodada",
  "nao posso usar o nome do video como molde nessa campanha de trafego",
  // Nome composto estruturado [MARCA][CANAL][OBJ] — o padrão que virou contrato proibido.
  "[COHAPM][WA][LEADS][JURIDICO]",
  "[COHAPM][WEBSITE][TRAFEGO][LAF][AGO26]",
  // approval_id (UUID) no lugar do drive_file_id.
  "b3f1c2a4-1d2e-4f3a-9b8c-7d6e5f4a3b2c",
  // drive_file_id de verdade: RE_DRIVE_ID exige "1" + 24..40 chars.
  "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "conjunto 2, video_juros_abusivos.mp4, drive 1AbCdEfGhIjKlMnOpQrStUvWxYz",
  ["CONJ.2 - https://wa.me/5531988887777", "CONJ.3 - https://wa.me/5531977776666"].join("\n"),
  // Pedido de legenda SEM verbo de ato (`emit*`/`card`/`suba` fazem a função recusar de saída).
  "cria as legendas do conjunto 2",
  "gera as legendas das 6 pecas",
  // Recusa falsa de molde: exige recusa E (pedido de molde OU desvio para engajamento).
  "nao consigo emitir sem o molde de trafego",
  "nao posso criar: crie em engajamento social e altere manualmente no gerenciador",
  "nao consigo emitir: bloqueio tecnico, sem dado obrigatorio",
  // Slate como ele chega de verdade: cabeçalho de conjunto + TABELA markdown.
  [
    "## CONJ.2",
    "**Angulo:** juros abusivos",
    "| 1 | `video_juros_abusivos.mp4` | Educacao financeira | 1AbCdEfGhIjKlMnOpQrStUvWxYz |",
    "| 2 | `video_contrato_taxa.mp4` | Caminho Triste | 1ZyXwVuTsRqPoNmLkJiHgFeDcBa |",
  ].join("\n"),
];

const OUTROS: unknown[] = [
  undefined,
  null,
  0,
  1,
  35,
  5000,
  true,
  false,
  {},
  { status: "ACTIVE", name: "CONJ.1" },
  { status: "DELETED", name: "CONJ.2" },
  [],
  [
    { status: "ACTIVE", name: "CONJ.1_LAF" },
    { status: "DELETED", name: "CONJ.2_LAF" },
  ],
  // Peça de slate (pecaChaveDoSlate).
  { conjunto: 2, nome: "video_juros_abusivos.mp4", drive_file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz" },
  { conjunto: 3, nome: "carrossel_capa", drive_file_id: "1ZyXwVuTsRqPoNmLkJiHgFeDcBa" },
  // Cruzamento de linha de produto: nome do destino contra sinais da peça.
  { estruturaNomes: ["JURIDICO_CONJ.02"], pecaSinais: ["CONJ.1_LAF_8CRIATIVOS"] },
  { estruturaNomes: ["CONJ.1_LAF_8CRIATIVOS"], pecaSinais: ["CONJ.1_LAF_8CRIATIVOS"] },
  { estruturaNomes: [], pecaSinais: [] },
];

const CORPUS: unknown[] = [...FALAS, ...OUTROS];
// Segundo argumento: corpus compacto, senão o produto cartesiano explode sem ganhar sinal.
const CORPUS2: unknown[] = [
  "",
  "conjunto 2",
  "CONJ.1_LAF_8CRIATIVOS_JUN/JUL26",
  1,
  2,
  null,
  undefined,
  // Pool de desempate (desempateDeConjunto / desempateDeAlvoDoCard).
  [
    { campaign_id: "120001", external_id: "23851" },
    { campaign_id: "120002", external_id: "23852" },
  ],
  // Sinais da peça (escolherConjuntos*).
  ["CONJ.1_LAF_8CRIATIVOS"],
];

/** Resultado observável de uma chamada — inclui a exceção, que também é comportamento. */
function observar(fn: (...a: unknown[]) => unknown, args: unknown[]): string {
  try {
    const r = fn(...args);
    if (r instanceof RegExp) return `re:${r.source}|${r.flags}`;
    if (r === undefined) return "ok:undefined";
    return `ok:${JSON.stringify(r)}`;
  } catch (e) {
    return `throw:${e instanceof Error ? e.name : typeof e}`;
  }
}

const chamadas = (aridade: number): unknown[][] =>
  aridade >= 3
    ? CORPUS.flatMap((a) => CORPUS2.flatMap((b) => CORPUS2.map((c) => [a, b, c])))
    : aridade === 2
      ? CORPUS.flatMap((a) => CORPUS2.map((b) => [a, b]))
      : CORPUS.map((a) => [a]);

describe("paridade dos espelhos src/lib <-> _shared", () => {
  it("encontra os pares espelhados (a descoberta não pode silenciar)", () => {
    // Sem isto, um glob quebrado zeraria PARES e a suíte inteira passaria vazia — falso verde
    // pior que nenhuma guarda.
    expect(PARES.map((p) => p.nome).sort()).toEqual([
      "intencao-turno",
      "lote-criativo",
      "memoria-conjunto",
      "orcamento-reais",
    ]);
  });

  describe.each(PARES)("$nome", ({ deno, lib }) => {
    it("mesma entrada, mesma saída em todo export comum", async () => {
      const [a, b] = [await NO_DENO[deno](), await NO_LIB[lib]()];
      const comuns = Object.keys(a).filter(
        (k) => typeof a[k] === "function" && typeof b[k] === "function",
      );
      expect(comuns.length).toBeGreaterThan(0);

      const divergencias: string[] = [];
      for (const nome of comuns) {
        const fnA = a[nome] as (...x: unknown[]) => unknown;
        const fnB = b[nome] as (...x: unknown[]) => unknown;
        for (const args of chamadas(Math.max(fnA.length, fnB.length))) {
          const [rA, rB] = [observar(fnA, args), observar(fnB, args)];
          if (rA !== rB) {
            divergencias.push(
              `${nome}(${args.map((x) => JSON.stringify(x)).join(", ")}): _shared=${rA} src/lib=${rB}`,
            );
          }
        }
      }
      // Todas as divergências de uma vez: descobrir uma por execução é o que fez uma prova
      // vermelha esconder outra por semanas neste mesmo repositório.
      expect(divergencias.slice(0, 20)).toEqual([]);
    });

    it("exports só de um lado são declarados, não acidentais", async () => {
      const [a, b] = [await NO_DENO[deno](), await NO_LIB[lib]()];
      const soNoDeno = Object.keys(a)
        .filter((k) => !(k in b))
        .sort();
      const soNoLib = Object.keys(b)
        .filter((k) => !(k in a))
        .sort();
      // `memoria_conjunto` tem cinco ajudantes que só a edge usa (desempate de card, conjunto
      // vivo para destino, recusa de alvo não operacional). Assimetria conhecida é aceitável;
      // assimetria NOVA é alguém que acrescentou num lado e esqueceu do outro — o defeito que
      // este arquivo existe para pegar.
      expect({ soNoDeno, soNoLib }).toEqual({
        soNoDeno:
          base(deno) === "memoria_conjunto"
            ? [
                "conjuntoVivoParaDestino",
                "desempateDeAlvoDoCard",
                "desempateDeConjunto",
                "pareceApprovalIdEmVezDeDrive",
                "recusaAlvoNaoOperacional",
              ]
            : [],
        soNoLib: [],
      });
    });

    it("o corpus exercita a lógica (paridade vazia não é paridade)", async () => {
      const a = await NO_DENO[deno]();
      const inertes = Object.keys(a)
        .filter((k) => typeof a[k] === "function")
        .filter((k) => {
          const fn = a[k] as (...x: unknown[]) => unknown;
          const vistos = new Set(chamadas(fn.length).map((args) => observar(fn, args)));
          return vistos.size < 2;
        });
      // Função que devolve a mesma coisa para todo o corpus não está sendo comparada de verdade:
      // a paridade dela passa por acidente. Se este teste cair, o conserto é enriquecer o
      // corpus acima, não afrouxar o limite.
      expect(inertes).toEqual([]);
    });
  });
});
