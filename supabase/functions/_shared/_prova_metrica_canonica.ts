// Prova do calculo canonico de metrica. Rode: deno run supabase/functions/_shared/_prova_metrica_canonica.ts
//
// O caso central desta prova e o CENARIO DA DIVERGENCIA medido no repositorio em 03/09/2026:
// gasto R$ 300, 5 formularios, 10 conversas, 20 cliques no link. Hoje quatro pedacos do
// sistema respondem R$ 20,00 / R$ 60,00 / R$ 30,00 / R$ 15,00 para a pergunta "qual o CPL",
// todos se chamando "custo por lead". A prova nao afirma que uma das quatro e certa — afirma
// que as quatro sao valores DIFERENTES de indicadores DIFERENTES, e que o nome tem que dizer
// qual e qual.

import {
  agregar,
  arredondar,
  baseDoObjetivo,
  centavosParaReais,
  type ContadoresDoDia,
  custoPorResultado,
  rotuloDaBase,
} from "./metrica_canonica.ts";

let falhas = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  FALHOU: ${msg}`);
    falhas++;
  }
}

function dia(p: Partial<ContadoresDoDia>): ContadoresDoDia {
  return {
    snapshot_date: p.snapshot_date ?? "2026-09-01",
    spend: p.spend ?? 0,
    impressions: p.impressions ?? 0,
    clicks: p.clicks ?? 0,
    link_clicks: p.link_clicks ?? 0,
    form_leads: p.form_leads ?? 0,
    messaging_started: p.messaging_started ?? 0,
    reach: p.reach ?? 0,
    frequency: p.frequency ?? 0,
  };
}

// ============================================================================
// O CENARIO DA DIVERGENCIA
// ============================================================================
{
  const m = agregar([dia({ spend: 300, form_leads: 5, messaging_started: 10, link_clicks: 20, impressions: 10_000, clicks: 50 })]);

  const porForm = custoPorResultado(m, "formularios");
  const porConversa = custoPorResultado(m, "conversas");
  const porAmbos = custoPorResultado(m, "formularios_e_conversas");
  const porClique = custoPorResultado(m, "cliques_no_link");

  assert(porForm.valor === 60, `custo por formulario deveria ser 60,00; veio ${porForm.valor}`);
  assert(porConversa.valor === 30, `custo por conversa deveria ser 30,00; veio ${porConversa.valor}`);
  assert(porAmbos.valor === 20, `custo por resultado agregado deveria ser 20,00; veio ${porAmbos.valor}`);
  assert(porClique.valor === 15, `custo por clique no link deveria ser 15,00; veio ${porClique.valor}`);

  // A base viaja com o numero. Numero sem base e o que permitiu quatro CPLs coexistirem.
  assert(porForm.base === "formularios" && porForm.resultados === 5, "base e denominador declarados");
  assert(porConversa.resultados === 10, "denominador de conversa");
  assert(porAmbos.resultados === 15, "denominador agregado");

  // Os quatro sao distintos: se algum dia dois coincidirem por mudanca de formula, a prova cai.
  const vals = [porForm.valor, porConversa.valor, porAmbos.valor, porClique.valor];
  assert(new Set(vals).size === 4, "as quatro bases tem que produzir quatro valores distintos");
}

// ============================================================================
// NUMERADOR — a segunda divergencia medida (get_funnel filtra, get_campaign_detail nao)
// ============================================================================
{
  // R$ 1.000 gastos, R$ 400 em campanha de engajamento sem formulario, 10 formularios.
  const m = agregar([dia({ spend: 1000, form_leads: 10 })]);
  const total = custoPorResultado(m, "formularios");
  const filtrado = custoPorResultado(m, "formularios", { gastoDosObjetosComResultado: 600 });

  assert(total.valor === 100, `gasto total / forms = 100,00; veio ${total.valor}`);
  assert(filtrado.valor === 60, `gasto filtrado / forms = 60,00; veio ${filtrado.valor}`);
  assert(total.numerador === "gasto_total", "numerador total declarado");
  assert(filtrado.numerador === "gasto_dos_objetos_com_resultado", "numerador filtrado declarado");
}

// ============================================================================
// ZERO RESULTADO NAO E CUSTO ZERO
// ============================================================================
{
  const m = agregar([dia({ spend: 500, form_leads: 0 })]);
  const c = custoPorResultado(m, "formularios");
  assert(c.valor === null, "custo com zero resultado tem que ser null, nunca 0");
  assert(c.indefinido_porque !== null, "motivo do indefinido tem que estar declarado");
  assert(c.gasto === 500, "o gasto continua visivel mesmo com custo indefinido");
}

// ============================================================================
// CTR / CPC — as duas bases coexistem, nunca sob o mesmo nome
// ============================================================================
{
  const m = agregar([dia({ spend: 200, impressions: 1000, clicks: 50, link_clicks: 10 })]);
  assert(m.ctr_todos_pct === 5, `ctr_todos 5,00%; veio ${m.ctr_todos_pct}`);
  assert(m.ctr_link_pct === 1, `ctr_link 1,00%; veio ${m.ctr_link_pct}`);
  assert(m.cpc_todos === 4, `cpc_todos 4,00; veio ${m.cpc_todos}`);
  assert(m.cpc_link === 20, `cpc_link 20,00; veio ${m.cpc_link}`);
  assert(m.cpm === 200, `cpm 200,00; veio ${m.cpm}`);
}

// ============================================================================
// ALCANCE E FREQUENCIA — o que NAO soma
// ============================================================================
{
  const dois = agregar([
    dia({ snapshot_date: "2026-09-01", reach: 1000, impressions: 1500, frequency: 1.5 }),
    dia({ snapshot_date: "2026-09-02", reach: 1000, impressions: 1500, frequency: 1.5 }),
  ]);
  // A soma continua exposta porque e o unico dado que existe sem chamar a Meta ao vivo — mas
  // o NOME declara que nao e alcance unico do periodo.
  assert(dois.alcance_soma_diaria_nao_deduplicada === 2000, "soma diaria de alcance");
  assert(dois.frequencia_do_dia === null, "frequencia de periodo multi-dia tem que ser null");

  const um = agregar([dia({ reach: 1000, impressions: 1500, frequency: 1.5 })]);
  assert(um.frequencia_do_dia === 1.5, "frequencia de um dia unico vem da Meta");
}

// ============================================================================
// BASE PELO OBJETIVO — substitui o `forms || convs` que trocava de base em silencio
// ============================================================================
assert(baseDoObjetivo("mensagem") === "conversas", "campanha de mensagem mede por conversa");
assert(baseDoObjetivo("leadgen") === "formularios", "campanha de lead mede por formulario");
assert(baseDoObjetivo(null) === "formularios", "sem categoria, padrao formulario");
{
  // Campanha de formulario com ZERO formularios e 40 conversas: o custo fica INDEFINIDO na
  // base dela. Nao troca para conversa so porque a conversa tem numero — trocar produzia um
  // valor comparavel com os das outras campanhas quando nao e.
  const m = agregar([dia({ spend: 400, form_leads: 0, messaging_started: 40 })]);
  const c = custoPorResultado(m, baseDoObjetivo("leadgen"));
  assert(c.valor === null, "campanha de form sem form nao pode cair para base de conversa");
}

// ============================================================================
// ROTULO E ORCAMENTO
// ============================================================================
assert(rotuloDaBase("formularios") === "por formulario enviado", "rotulo formulario");
assert(rotuloDaBase("cliques_no_link") === "por clique no link", "rotulo clique");
assert(centavosParaReais(3000) === 30, "3000 centavos = R$ 30,00");
assert(centavosParaReais(7200) === 72, "7200 centavos = R$ 72,00");
assert(centavosParaReais(null) === null, "centavos ausente nao vira zero");
assert(arredondar(null, 2) === null, "arredondar null");

// Arredondamento: a prova trava o comportamento REAL do IEEE-754, nao o intuitivo.
// 2.135 e 2.13499999999999978 em float64, entao 2.13 e a resposta correta DESTE caminho.
// O Postgres, com numeric decimal exato, devolve 2.14 para a mesma entrada (conferido em
// 03/09/2026). Travar o valor aqui e o que faz a divergencia aparecer numa prova em vez de
// aparecer como um centavo de diferenca entre a resposta do agente e o painel.
assert(arredondar(2.135, 2) === 2.13, `IEEE-754: esperado 2.13, veio ${arredondar(2.135, 2)}`);
assert(arredondar(2.145, 2) === 2.15, `2.145 nao sofre o mesmo desvio; veio ${arredondar(2.145, 2)}`);
assert(arredondar(1.005, 2) === 1, `1.005 -> 1.00 em float64; veio ${arredondar(1.005, 2)}`);
// O que importa de verdade e a ESTABILIDADE: mil repeticoes, mesmo valor.
{
  const primeiro = arredondar(2.135, 2);
  let estavel = true;
  for (let i = 0; i < 1000; i++) if (arredondar(2.135, 2) !== primeiro) estavel = false;
  assert(estavel, "arredondamento tem que ser estavel entre repeticoes");
}

// ============================================================================
// AGREGACAO VAZIA
// ============================================================================
{
  const m = agregar([]);
  assert(m.gasto === 0 && m.dias === 0, "serie vazia agrega zerada");
  assert(m.ctr_todos_pct === null && m.cpm === null, "sem impressao nao ha CTR nem CPM");
  assert(m.frequencia_do_dia === null, "serie vazia nao tem frequencia");
}

// ============================================================================
// ORDEM DOS DIAS NAO MUDA O TOTAL (requisito de reprodutibilidade)
// ============================================================================
{
  const a = dia({ snapshot_date: "2026-09-01", spend: 10.11, impressions: 7, clicks: 3, link_clicks: 1, form_leads: 1 });
  const b = dia({ snapshot_date: "2026-09-02", spend: 20.22, impressions: 11, clicks: 5, link_clicks: 2, form_leads: 2 });
  const c = dia({ snapshot_date: "2026-09-03", spend: 30.33, impressions: 13, clicks: 7, link_clicks: 4, form_leads: 3 });
  const x = JSON.stringify(agregar([a, b, c]));
  const y = JSON.stringify(agregar([c, a, b]));
  assert(x === y, "ordem dos dias nao pode mudar o agregado");
}

if (falhas) {
  console.error(`\nFALHOU: _prova_metrica_canonica (${falhas} erro(s))`);
  Deno.exit(1);
}
console.log("ok: _prova_metrica_canonica");
