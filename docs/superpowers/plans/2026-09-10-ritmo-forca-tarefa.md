# Ritmo (força-tarefa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba `/ritmo` em que o gestor pede uma força-tarefa numa campanha, os agentes emitem plano + projeções honestas, e um único Autorizar missão passa a escrever na Meta sem card até o prazo, o sonho, o teto ou Encerrar.

**Architecture:** Matemática e portão determinísticos em `src/lib/ritmo.ts` espelhado em `_shared/ritmo.ts`. Missão e atos no Postgres (RLS + RPCs). Análise reusa `traffic-agent-job` (`modo: ritmo_analise` / `ritmo_replano`) sem `propose_action`. Escrita só pela edge `ritmo-executar` → `meta-actions` com `origem=ritmo`, autenticada por `pode_executar_ato_ritmo`. Nenhum `skip_approval` genérico.

**Tech Stack:** React / TanStack Router / TanStack Query / Vitest no front. Supabase Postgres + RLS + Realtime. Edge Deno (`traffic-agent-job`, `meta-actions`, nova `ritmo-executar`). Série diária em `metric_snapshots`. Pipeboard para status real da campanha.

**Spec:** `docs/superpowers/specs/2026-09-10-ritmo-forca-tarefa-design.md`

## Global Constraints

- UI em português. Datas civis em `America/Sao_Paulo`. Extra omitido = R$ 0.
- Uma campanha por missão. Uma missão `em_execucao` por `(company_id, campaign_id)`.
- Job profundo continua **sem** `propose_action`. Análise de ritmo **não** insere em `approval_requests`.
- Escrita sem card só com RPC `pode_executar_ato_ritmo` verdadeira. Sem flag `skip_approval` em query string.
- Travas que permanecem: compliance, linha, quarentena, `master_enabled`, dry-run (simula, não escreve), rate limit, flags por ação, isolamento de empresa.
- Proibido nesta missão: `criar_campanha`, `pausar_campanha`, `ativar_campanha`, `alterar_categoria_especial_campanha`, `renomear_*`, apagar objeto.
- Duas tabelas: `ritmo_missoes` e `ritmo_atos`. Tique sem escrita = ato `verificar_parada`.
- Visualizador lê. Só admin cria, autoriza, encerra.
- Bloco 2 (escrita Meta) **não começa** enquanto as provas do portão (Tasks 1 e 8) não estiverem verdes.
- Migration sempre com espelho idêntico em `supabase/espelhos/`. `src/lib/ritmo.ts` e `_shared/ritmo.ts` byte-a-byte equivalentes nas funções exportadas (guarda `paridade-espelhos.test.ts`).
- Commit no `main` ao fechar cada task. Push. Edges: `supabase functions deploy`. Migration: aplicar no remoto na task SQL.

## File map

| Arquivo | Papel |
|---|---|
| `src/lib/ritmo.ts` | Catálogo, envelope, sonho, parada, portão, parse do plano |
| `src/lib/ritmo.test.ts` | Provas 1, 2, 10, 11 da spec |
| `supabase/functions/_shared/ritmo.ts` | Cópia da edge (paridade) |
| `src/lib/paridade-espelhos.test.ts` | Inclui o par `ritmo` + corpus |
| `supabase/migrations/20260910210000_ritmo_forca_tarefa.sql` | Tabelas, RLS, RPCs, realtime (cron na Task 11) |
| `supabase/espelhos/20260910210000_ritmo_forca_tarefa.sql` | Espelho byte-igual |
| `src/integrations/supabase/types.ts` | Tabelas + RPCs |
| `src/components/app-shell.tsx` | Item **Ritmo** após Campanhas |
| `src/components/app-shell.test.tsx` | Rótulo na lista |
| `src/routes/_authenticated/ritmo.tsx` | Lista + nova + detalhe |
| `src/routes/_authenticated/ritmo.test.tsx` | Empresa vazia, lista vazia, falha visível |
| `src/components/ritmo/formulario-missao.tsx` | Formulário |
| `src/components/ritmo/detalhe-missao.tsx` | Plano, projeções, atos, botões |
| `src/routeTree.gen.ts` | Rota `/ritmo` |
| `supabase/functions/traffic-agent-job/index.ts` | `ritmo_analise` e `ritmo_replano` |
| `supabase/functions/_shared/_prova_ritmo_job_sem_card.ts` | Análise não emite card |
| `supabase/functions/_shared/_prova_ritmo_portao.ts` | SQL do portão fail-closed |
| `supabase/functions/ritmo-executar/index.ts` | Tiques + primeiro passe |
| `supabase/config.toml` | `verify_jwt = false` na nova edge |
| `supabase/functions/meta-actions/index.ts` | `origem=ritmo` + `ritmo_ato_id` |
| `src/lib/notificacoes.ts` + teste | Tipo `ritmo` e destino `/ritmo` |
| `supabase/functions/_shared/agentes.ts` | Exceção nomeada no Executor |
| `docs/visao-do-produto.md` | Seção 5.x + mapa de telas |

---

## Bloco 1 — superfície + análise (zero escrita na Meta)

### Task 1: Núcleo determinístico

**Files:**
- Create: `src/lib/ritmo.ts`
- Create: `src/lib/ritmo.test.ts`
- Não mexa em `paridade-espelhos.test.ts` nesta task (o par só existe na Task 2).

**Interfaces:**
- Produces: `METRICAS_RITMO`, `ACOES_PERMITIDAS_RITMO`, `calcularBaseline`, `calcularTeto`, `nDiasPrazo`, `gastoNaJanela`, `sonhoAtingido`, `motivoParada`, `validarPedidoMissao`, `parsePlanoRitmo`, `extrairJsonRitmo`, `atosDoPrimeiroPasse`, `decidirPortaoAto`, `unidadeSonho`, `rotuloMetrica`, `ehMetricaVolume`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ritmo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  calcularBaseline,
  calcularTeto,
  nDiasPrazo,
  gastoNaJanela,
  sonhoAtingido,
  motivoParada,
  validarPedidoMissao,
  parsePlanoRitmo,
  atosDoPrimeiroPasse,
  decidirPortaoAto,
  unidadeSonho,
  extrairJsonRitmo,
} from "./ritmo";

const serie = [
  { date: "2026-09-01", spend: 100 },
  { date: "2026-09-02", spend: 0 },
  { date: "2026-09-03", spend: 50 },
  { date: "2026-09-04", spend: 50 },
  { date: "2026-09-05", spend: 0 },
];

describe("nDiasPrazo", () => {
  it("conta inclusive", () => {
    expect(nDiasPrazo("2026-09-10", "2026-09-19")).toBe(10);
    expect(nDiasPrazo("2026-09-10", "2026-09-10")).toBe(1);
  });
});

describe("calcularBaseline", () => {
  it("ignora dias com gasto 0 e usa os 7 civis imediatamente antes do início", () => {
    const b = calcularBaseline(serie, "2026-09-06", "2026-09-06");
    expect(b.dias_usados).toBe(3);
    expect(b.gasto_diario).toBeCloseTo(200 / 3);
    expect(b.confianca).toBe("alta");
  });

  it("menos de 3 dias com gasto → confiança baixa", () => {
    const b = calcularBaseline(
      [{ date: "2026-09-04", spend: 80 }, { date: "2026-09-05", spend: 0 }],
      "2026-09-06",
      "2026-09-06",
    );
    expect(b.dias_usados).toBe(1);
    expect(b.confianca).toBe("baixa");
  });

  it("zero dias com gasto → baseline 0", () => {
    const b = calcularBaseline([{ date: "2026-09-05", spend: 0 }], "2026-09-06", "2026-09-06");
    expect(b.gasto_diario).toBe(0);
    expect(b.dias_usados).toBe(0);
    expect(b.confianca).toBe("baixa");
  });
});

describe("calcularTeto", () => {
  it("teto = baseline × dias + extra", () => {
    expect(calcularTeto(10, 7, 100)).toBe(170);
    expect(calcularTeto(0, 10, 50)).toBe(50);
    expect(calcularTeto(10, 7, 0)).toBe(70);
  });
});

describe("gastoNaJanela", () => {
  it("soma só a campanha na janela civil (fixture já é da campanha)", () => {
    expect(gastoNaJanela(serie, "2026-09-01", "2026-09-03")).toBe(150);
  });
});

describe("sonhoAtingido", () => {
  it("volume: acumulado desde max(início, concessão) ≥ sonho", () => {
    const dias = [
      { date: "2026-09-10", valor: 10 },
      { date: "2026-09-11", valor: 40 },
    ];
    expect(sonhoAtingido("conversas", 50, dias, "2026-09-10", "2026-09-10")).toBe(true);
    expect(sonhoAtingido("conversas", 51, dias, "2026-09-10", "2026-09-10")).toBe(false);
  });

  it("CTR: sem 3 dias com entrega não declara sonho", () => {
    const dias = [
      { date: "2026-09-10", valor: 2, impressoes: 100, cliques: 2 },
      { date: "2026-09-11", valor: 3, impressoes: 100, cliques: 3 },
    ];
    expect(sonhoAtingido("ctr", 2, dias, "2026-09-10", "2026-09-10")).toBe(false);
  });
});

describe("motivoParada", () => {
  it("prazo, teto, sonho e humano, nesta leitura pontual", () => {
    expect(
      motivoParada({
        hojeYmd: "2026-09-20",
        periodoFim: "2026-09-19",
        gastoJanela: 10,
        teto: 100,
        sonhoBateu: false,
        encerrarHumano: false,
        masterLigado: true,
      }),
    ).toBe("prazo");
    expect(
      motivoParada({
        hojeYmd: "2026-09-10",
        periodoFim: "2026-09-19",
        gastoJanela: 100,
        teto: 100,
        sonhoBateu: false,
        encerrarHumano: false,
        masterLigado: true,
      }),
    ).toBe("teto");
  });
});

describe("validarPedidoMissao", () => {
  it("recusa dissertação vazia, prazo > 90 dias e métrica desconhecida", () => {
    expect(
      validarPedidoMissao({
        campaignId: "1",
        periodoInicio: "2026-09-10",
        periodoFim: "2026-12-20",
        metrica: "conversas",
        dissertacao: "subir conversas",
      }).ok,
    ).toBe(false);
    expect(
      validarPedidoMissao({
        campaignId: "1",
        periodoInicio: "2026-09-10",
        periodoFim: "2026-09-12",
        metrica: "leads",
        dissertacao: "x",
      }).ok,
    ).toBe(false);
  });
});

describe("atosDoPrimeiroPasse", () => {
  it("só quando=imediato e no máximo uma ação significativa", () => {
    const atos = [
      { acao: "pausar_criativo", quando: "imediato", alvo_external_id: "a1" },
      { acao: "alterar_orcamento", quando: "imediato", alvo_external_id: "c1" },
      { acao: "criar_anuncio_a_partir_de", quando: "imediato", alvo_external_id: "x" },
      { acao: "pausar_conjunto", quando: "apos_janela", alvo_external_id: "s1" },
    ];
    const out = atosDoPrimeiroPasse(atos);
    expect(out.map((a) => a.acao)).toEqual(["pausar_criativo", "alterar_orcamento"]);
  });
});

describe("decidirPortaoAto", () => {
  const base = {
    status: "em_execucao" as const,
    companyIdMissao: "emp-a",
    companyIdAto: "emp-a",
    campaignIdMissao: "camp-1",
    campaignIdAto: "camp-1",
    hojeYmd: "2026-09-12",
    periodoInicio: "2026-09-10",
    periodoFim: "2026-09-20",
    gastoJanela: 50,
    teto: 200,
    masterLigado: true,
    concessaoEm: "2026-09-10T15:00:00Z",
    acao: "pausar_criativo",
  };
  it("nega campanha diferente, status errado, prazo vencido, teto, criar_campanha", () => {
    expect(decidirPortaoAto({ ...base, campaignIdAto: "outra" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, status: "plano_pronto" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, hojeYmd: "2026-09-21" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, gastoJanela: 200, acao: "alterar_orcamento" }).ok).toBe(false);
    expect(decidirPortaoAto({ ...base, acao: "criar_campanha" }).ok).toBe(false);
  });
  it("libera pausa na campanha da missão dentro do prazo", () => {
    expect(decidirPortaoAto(base).ok).toBe(true);
  });
});

describe("parsePlanoRitmo", () => {
  it("ato sem external_id não é executável; recusa do Guardião derruba criar_anuncio", () => {
    const p = parsePlanoRitmo({
      baseline: { gasto_diario: 10, janela: "7d_com_gasto", dias_usados: 7, confianca: "alta" },
      teto_janela: 100,
      possibilidades: {
        nada_muda: { d3: 1, d7: 2, d15: 3, d30: 4 },
        plano: { d3: 2, d7: 4, d15: 6, d30: 8 },
        maximo_envelope: { d3: 3, d7: 6, d15: 9, d30: 12 },
      },
      atos: [
        { acao: "criar_anuncio_a_partir_de", alvo_external_id: "ad1", quando: "imediato" },
        { acao: "pausar_criativo", quando: "imediato" },
      ],
      recusas: ["Guardião recusou a copy da peça ad1"],
    });
    expect(p).not.toBeNull();
    expect(p!.atos[0].executavel).toBe(false);
    expect(p!.atos[1].executavel).toBe(false);
  });
});

describe("unidadeSonho", () => {
  it("CTR é percentual", () => {
    expect(unidadeSonho("ctr")).toBe("pct");
    expect(unidadeSonho("conversas")).toBe("qtd");
  });
});

describe("extrairJsonRitmo", () => {
  it("tira o json do meio da prosa", () => {
    expect(extrairJsonRitmo('foo {"a":1} bar')).toEqual({ a: 1 });
    expect(extrairJsonRitmo("sem json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/lib/ritmo.test.ts`

Expected: FAIL — `Cannot find module './ritmo'`

- [ ] **Step 3: Write `src/lib/ritmo.ts`**

Implement every export the test imports. Funções **não lançam**: entrada lixo devolve valor neutro (a paridade chama com corpus aleatório).

Regras fechadas:

- `nDiasPrazo`: `(Date.UTC(fim) - Date.UTC(ini)) / 864e5 + 1`, mínimo 1 se datas válidas `YYYY-MM-DD`, senão 0.
- `calcularBaseline(series, periodoInicio, hojeAnalise)`: âncora = `periodoInicio` se `hojeAnalise <= periodoInicio`, senão `hojeAnalise`. Janela = 7 civis imediatamente **antes** da âncora. Média só de `spend > 0`. `confianca = dias_usados >= 3 ? "alta" : "baixa"`.
- `calcularTeto`: `baselineDiario * nDias + extra`, nunca negativo; NaN → 0.
- `sonhoAtingido`: volume soma `valor` em `date >= max(periodoInicio, concessaoYmd)`. Taxa: últimos 3 dias com `impressoes > 0`; CTR = 100 * cliques/impressões (`ctr` usa `cliques`, `ctr_link` usa `cliques_link`). Sem 3 dias → false.
- `motivoParada`: ordem `humano`, `trava` (master desligado), `prazo` (`hojeYmd > periodoFim`), `sonho`, `teto` (`gastoJanela >= teto` quando teto não-nulo), senão `null`.
- `ACOES_PERMITIDAS_RITMO`: `pausar_criativo`, `ativar_criativo`, `escalar_criativo`, `pausar_conjunto`, `ativar_conjunto`, `alterar_orcamento`, `ajustar_posicionamentos_do_conjunto`, `alterar_geo_do_conjunto`, `vincular_instagram_dos_anuncios`, `criar_conjunto_a_partir_de`, `criar_anuncio_a_partir_de`, `escalar_duplicar`.
- `ACOES_SIGNIFICATIVAS_RITMO`: `alterar_orcamento`, `escalar_criativo`, `criar_conjunto_a_partir_de`, `criar_anuncio_a_partir_de`, `escalar_duplicar`, `alterar_geo_do_conjunto`, `ajustar_posicionamentos_do_conjunto`.
- `atosDoPrimeiroPasse`: filtra `quando === "imediato"`; inclui todas as não-significativas; para no **primeiro** significativa.
- `decidirPortaoAto`: `ok` só se status `em_execucao`, concessão presente, empresas iguais, campanhas iguais, hoje em `[periodoInicio, periodoFim]`, master ligado, ação permitida, e se a ação é significativa de gasto (`alterar_orcamento`, `escalar_*`, `criar_*`) então `gastoJanela < teto`.
- `parsePlanoRitmo`: `executavel` exige `alvo_external_id` não vazio, ação permitida, e se `acao` começa com `criar_` então `recusas` vazio (Guardião falou).
- `validarPedidoMissao`: campaignId não vazio, dissertação trim > 0, métrica no catálogo, `1 ≤ nDias ≤ 90`, sonho omitido ou `> 0`, extra omitido ou `≥ 0`.
- `METRICAS_RITMO`: `conversas`, `cliques_no_link`, `formularios`, `alcance`, `impressoes`, `ctr`, `ctr_link`.
- `extrairJsonRitmo(texto: unknown): unknown | null` — se não for string, null; senão fatia do primeiro `{` ao último `}` e `JSON.parse`; parse erro → null.
- Extra 0: teto = só o ritmo (`calcularTeto(10, 7, 0) === 70`); `decidirPortaoAto` bloqueia `alterar_orcamento` quando `gastoJanela >= teto`.

Copie os tipos do contrato JSON da spec (`PlanoRitmo`, `Horizontes`, `AtoPlano`).

- [ ] **Step 4: Run tests**

Run: `bun run test src/lib/ritmo.test.ts`

Expected: PASS. Não rode a suíte inteira ainda: o par `_shared/ritmo.ts` nasce na Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ritmo.ts src/lib/ritmo.test.ts
git commit -m "feat: núcleo determinístico do Ritmo (envelope, sonho e portão)."
git push -u origin main
```

---

### Task 2: Espelho `_shared/ritmo.ts`

**Files:**
- Create: `supabase/functions/_shared/ritmo.ts` (cópia de `src/lib/ritmo.ts`; se o front importar de `./relatorios`, a edge importa de `./relatorios.ts` — **não importe**. Mantenha o módulo autocontido para a paridade não divergir.)

**Interfaces:**
- Consumes: exports da Task 1
- Produces: os mesmos nomes no Deno

- [ ] **Step 1: Copy the file**

```bash
cp src/lib/ritmo.ts supabase/functions/_shared/ritmo.ts
```

No Windows PowerShell: `Copy-Item src/lib/ritmo.ts supabase/functions/_shared/ritmo.ts`

O arquivo não importa nada de `src/`.

- [ ] **Step 2: Update paridade list + corpus**

In `src/lib/paridade-espelhos.test.ts`, add `"ritmo"` à lista ordenada de pares. Em `OUTROS`, acrescente:

```ts
  [{ date: "2026-09-01", spend: 100 }, { date: "2026-09-02", spend: 0 }, { date: "2026-09-03", spend: 50 }],
  "2026-09-06",
  "conversas",
  "ctr",
  "ctr_link",
  {
    status: "em_execucao",
    companyIdMissao: "emp-a",
    companyIdAto: "emp-a",
    campaignIdMissao: "camp-1",
    campaignIdAto: "camp-1",
    hojeYmd: "2026-09-12",
    periodoInicio: "2026-09-10",
    periodoFim: "2026-09-20",
    gastoJanela: 50,
    teto: 200,
    masterLigado: true,
    concessaoEm: "2026-09-10T15:00:00Z",
    acao: "pausar_criativo",
  },
```

- [ ] **Step 3: Run paridade**

Run: `bun run test src/lib/paridade-espelhos.test.ts`

Expected: PASS, lista inclui `ritmo`. Se `inertes` apontar função, enriqueça o corpus — não afrouxe o teste.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/ritmo.ts src/lib/paridade-espelhos.test.ts
git commit -m "feat: espelho Deno do núcleo Ritmo para o job e o executor."
git push -u origin main
```

---

### Task 3: Migration + espelho + types

**Files:**
- Create: `supabase/migrations/20260910210000_ritmo_forca_tarefa.sql`
- Create: `supabase/espelhos/20260910210000_ritmo_forca_tarefa.sql` (mesmo conteúdo)
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces RPCs: `enfileirar_ritmo_analise`, `reenviar_ritmo_analise`, `autorizar_ritmo_missao`, `encerrar_ritmo_missao`, `pode_executar_ato_ritmo`, `claim_ritmo_missao_analise`, `gravar_plano_ritmo`, `listar_ritmo_tiques_devidos`

O cron HTTP entra na Task 11. Nesta migration: tabelas, RLS, RPCs, realtime. `tarefas_agendadas` + `cron.schedule` na Task 11 para não disparar edge inexistente.

- [ ] **Step 1: Write the SQL** (mesmo byte nos dois caminhos)

Cabeçalho: por quê (força-tarefa com uma autorização; escrita Meta só via RPC de concessão).

Tabelas:

```sql
create table public.ritmo_missoes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campaign_id text not null,
  campaign_name text not null default '',
  ad_account_id text,
  status text not null default 'em_analise'
    check (status in ('em_analise','plano_pronto','analise_falhou','em_execucao','encerrada')),
  periodo_inicio date not null,
  periodo_fim date not null,
  metrica text not null
    check (metrica in ('conversas','cliques_no_link','formularios','alcance','impressoes','ctr','ctr_link')),
  dissertacao text not null,
  sonho numeric,
  extra_investimento numeric not null default 0 check (extra_investimento >= 0),
  baseline_gasto_diario numeric,
  baseline_json jsonb not null default '{}'::jsonb,
  teto_gasto_janela numeric,
  plano_json jsonb,
  leitura_json jsonb,
  projecoes_json jsonb,
  confianca_baseline text check (confianca_baseline is null or confianca_baseline in ('alta','baixa')),
  fonte_campanhas text check (fonte_campanhas is null or fonte_campanhas in ('ao_vivo','espelho')),
  autonomia_concedida_em timestamptz,
  autonomia_concedida_por uuid,
  encerrada_em timestamptz,
  encerrada_por uuid,
  encerrada_motivo text
    check (encerrada_motivo is null or encerrada_motivo in
      ('prazo','sonho','teto','humano','trava','descartada')),
  erro_analise text,
  job_id uuid,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ritmo_missoes_prazo check (periodo_fim >= periodo_inicio),
  constraint ritmo_missoes_dissertacao check (length(btrim(dissertacao)) > 0),
  constraint ritmo_missoes_sonho check (sonho is null or sonho > 0)
);

create unique index ritmo_missoes_uma_execucao
  on public.ritmo_missoes (company_id, campaign_id)
  where status = 'em_execucao';

create index ritmo_missoes_company_idx
  on public.ritmo_missoes (company_id, criado_em desc);

create table public.ritmo_atos (
  id uuid primary key default gen_random_uuid(),
  missao_id uuid not null references public.ritmo_missoes(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  tique text not null check (tique in ('primeiro_passe','leve','fundo')),
  acao text not null,
  alvo_external_id text,
  payload jsonb not null default '{}'::jsonb,
  evidencia text,
  mecanismo text,
  metrica_sucesso text,
  janela_leitura text,
  reversa text,
  resultado text not null default 'pendente'
    check (resultado in ('pendente','executando','ok','bloqueado','falhou','simulado')),
  resposta_meta jsonb,
  replano boolean not null default false,
  criado_em timestamptz not null default now()
);

create index ritmo_atos_missao_idx on public.ritmo_atos (missao_id, criado_em desc);
```

RLS: membro `SELECT`; insert/update via RPC definer (revogar insert direto de `authenticated` em `ritmo_missoes` e `ritmo_atos`, igual `relatorio_gerados`). Grant `SELECT` authenticated. Service role full.

RPCs (todas `search_path to 'public'`, `security definer` onde escrevem):

1. `enfileirar_ritmo_analise(p_company_id, p_campaign_id, p_campaign_name, p_ad_account_id, p_periodo_inicio, p_periodo_fim, p_metrica, p_dissertacao, p_sonho, p_extra, p_fonte_campanhas)`  
   - Recusa se não admin+membro. Recusa se `periodo_fim - periodo_inicio > 89`. Recusa dissertação vazia. Status `em_analise`. Returns `uuid`.

2. `claim_ritmo_missao_analise(p_id uuid)` — `em_analise` → continua `em_analise`, devolve jsonb da linha (serviço). Idempotente para o job.

3. `gravar_plano_ritmo(...)` — service_role; seta `plano_json`, `leitura_json`, `projecoes_json`, baseline, teto, `status = plano_pronto` ou `analise_falhou` + `erro_analise`.

4. `autorizar_ritmo_missao(p_id uuid)` — admin+membro; só de `plano_pronto`; recusa se `periodo_fim < current_date at time zone America/Sao_Paulo`; recusa se `meta_execution_config.master_enabled is not true` da empresa; recusa se `campaigns.status` da empresa/id não é active/ACTIVE (espelho); update `em_execucao` + `autonomia_concedida_em/por`. Unique index pega corrida. Returns jsonb `{ok, motivo?}`.

5. `encerrar_ritmo_missao(p_id uuid, p_motivo text)` — admin+membro **ou** `auth.uid() is null` (service). Só de `em_execucao` ou `plano_pronto` (descartada). Motivo no check.

6. `pode_executar_ato_ritmo(p_missao_id, p_company_id, p_campaign_id, p_acao)` — **service_role only**. Replica `decidirPortaoAto`: lê missão, soma `metric_snapshots.spend` da campanha em `[periodo_inicio, periodo_fim]`, lê `master_enabled`. Returns jsonb `{ok:bool, motivo:text, dry_run:bool}`. `dry_run` vem da config (não libera escrita; quem simula é a edge). Motivos estáveis: `missao_ausente`, `status`, `empresa`, `campanha`, `sem_concessao`, `fora_do_prazo`, `antes_do_inicio`, `master_desligado`, `acao_proibida`, `teto`.

7. `listar_ritmo_tiques_devidos(p_tique text, p_limite int)` — service: missões `em_execucao` com `periodo_inicio <= hoje SP`.

8. `reenviar_ritmo_analise(p_id uuid)` — admin+membro; só `analise_falhou` → `em_analise`, `erro_analise = null`. Returns uuid.

Helper SQL para gasto da janela:

```sql
coalesce((
  select sum(spend) from public.metric_snapshots s
   where s.company_id = m.company_id
     and s.campaign_id = m.campaign_id
     and s.snapshot_date >= m.periodo_inicio
     and s.snapshot_date <= m.periodo_fim
), 0)
```

Realtime: `alter publication supabase_realtime add table ritmo_missoes, ritmo_atos`.

Comments em cada tabela/RPC (por quê, não o quê).

- [ ] **Step 2: types.ts**

Em `Tables`, após `relatorio_gerados`, adicione `ritmo_atos` e `ritmo_missoes` com Row/Insert/Update (campos acima; `Relationships: []`).

Em `Functions`, adicione as 8 RPCs com `Args` e `Returns` (`string` para uuid).

- [ ] **Step 3: Apply remotely**

Aplique o SQL no projeto `gzjwnjdpxpbmdhcyefvs` via MCP `apply_migration` (nome `ritmo_forca_tarefa`) com o conteúdo do arquivo. Depois:

```sql
select to_regclass('public.ritmo_missoes'), to_regclass('public.ritmo_atos');
```

Esperado: os dois nomes, não null.

- [ ] **Step 4: Paridade migration/espelho**

Os dois arquivos SQL desta task têm de ser idênticos:

```powershell
fc /b supabase\migrations\20260910210000_ritmo_forca_tarefa.sql supabase\espelhos\20260910210000_ritmo_forca_tarefa.sql
```

Expected: `FC: no differences encountered`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910210000_ritmo_forca_tarefa.sql supabase/espelhos/20260910210000_ritmo_forca_tarefa.sql src/integrations/supabase/types.ts
git commit -m "feat: tabelas e RPCs da força-tarefa Ritmo, com portão SQL."
git push -u origin main
```

---

### Task 4: Menu + rota oca

**Files:**
- Modify: `src/components/app-shell.tsx` (array `nav`, após `{ to: "/campanhas", ... }` inserir `{ to: "/ritmo", label: "Ritmo", icon: Gauge }`; import `Gauge` de `lucide-react`)
- Modify: `src/components/app-shell.test.tsx` — na lista de rótulos, `"Ritmo"` imediatamente depois de `"Campanhas"`
- Create: `src/routes/_authenticated/ritmo.tsx`
- Create: `src/routes/_authenticated/ritmo.test.tsx`
- Modify: `src/routeTree.gen.ts` — clone o bloco de `/relatorios` trocando nomes/paths para `ritmo`

**Interfaces:**
- Produces: rota `/ritmo` autenticada

- [ ] **Step 1: Failing shell test**

Add `"Ritmo"` to the expected labels in `app-shell.test.tsx` **depois** de `"Campanhas"`.

Run: `bun run test src/components/app-shell.test.tsx`

Expected: FAIL missing text Ritmo

- [ ] **Step 2: Add nav item**

- [ ] **Step 3: Route file (skeleton)**

`ritmo.tsx` no padrão de `relatorios.tsx`: `createFileRoute("/_authenticated/ritmo")`, `head` title `Ritmo`. Se `!selectedCompany` → `<EmptyCompany />`. Senão um `h1` "Ritmo" e um parágrafo "Força-tarefa da campanha, com uma autorização."

Teste da rota (clone `relatorios.test.tsx`):

- empresa vazia → `empty-company`
- com empresa → texto "Ritmo"

Mocks iguais: `createFileRoute`, `useApp`, supabase `from`/`rpc`.

- [ ] **Step 4: routeTree.gen.ts**

Espelhe `AuthenticatedRelatoriosRoute` → `AuthenticatedRitmoRoute` (`id: '/ritmo'`, `path: '/ritmo'`, `fullPath: '/ritmo'`). Inclua nos unions de paths.

- [ ] **Step 5: Run**

```
bun run test src/components/app-shell.test.tsx src/routes/_authenticated/ritmo.test.tsx
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell.tsx src/components/app-shell.test.tsx src/routes/_authenticated/ritmo.tsx src/routes/_authenticated/ritmo.test.tsx src/routeTree.gen.ts
git commit -m "feat: aba Ritmo no menu, ainda sem o fluxo da missão."
git push -u origin main
```

---

### Task 5: Formulário + lista

**Files:**
- Create: `src/components/ritmo/formulario-missao.tsx`
- Modify: `src/routes/_authenticated/ritmo.tsx`
- Modify: `src/routes/_authenticated/ritmo.test.tsx`

**Interfaces:**
- Consumes: `METRICAS_RITMO`, `validarPedidoMissao`, `unidadeSonho`, `rotuloMetrica` de `@/lib/ritmo`
- Consumes: `mergeCampanhasRelatorio`, `flattenCampanhasPipeboard`, `campanhaEstaAtiva` de `@/lib/relatorios` (já usados em Relatórios)
- Consumes RPC `listar_campanhas_para_relatorio` + `pipeboard-read` `modo: listar_campanhas` (copie o `useQuery` de `relatorios.tsx` linhas 160–196)
- Produces: `FormMissaoRitmo` `{ campaignId, campaignName, adAccountId, periodoInicio, periodoFim, metrica, dissertacao, sonho: string, extra: string }`

- [ ] **Step 1: Extend route test**

Com empresa e `from("ritmo_missoes")` devolvendo `[]`: aparece "Nenhuma força-tarefa nesta empresa" e o botão "Nova força-tarefa".

Com uma missão `analise_falhou` e `erro_analise: "timeout"`: o texto do erro aparece (falha ≠ silêncio).

- [ ] **Step 2: Run — FAIL** (ainda não há o botão)

- [ ] **Step 3: Implement list + form**

Lista: `useQuery(["ritmo-missoes", companyId])` → `from("ritmo_missoes").select("*").eq("company_id", id).order("criado_em", { ascending: false })`. `FalhaDeCarga` se `error`. Realtime channel `ritmo-{companyId}` nas duas tabelas.

Estados visíveis: Em análise / Plano pronto / Análise falhou / Em execução / Encerrada.

Colunas: status, campanha, métrica (rótulo), prazo, extra (BRL), sonho (ou —), gasto vs teto se `teto_gasto_janela` não nulo.

Formulário (admin): select de campanhas **ativas** (`campanhaEstaAtiva`); se fonte `espelho`, aviso igual Relatórios; datas início (default hoje Brasília via `hojeYmdBrasilia(new Date())` de `@/lib/relatorios`) e fim; select métrica; input sonho opcional com sufixo `unid.` ou `%` conforme `unidadeSonho`; extra R$ opcional; textarea dissertação. Submit chama RPC na Task 6 — **nesta task o submit só valida no cliente** e `toast.error` se `validarPedidoMissao` falhar. Visualizador: formulário read-only / botão oculto.

Não chame Graph no front além do `pipeboard-read` já usado em Relatórios.

- [ ] **Step 4: Tests PASS + commit**

```bash
git add src/components/ritmo/formulario-missao.tsx src/routes/_authenticated/ritmo.tsx src/routes/_authenticated/ritmo.test.tsx
git commit -m "feat: lista e formulário da força-tarefa Ritmo."
git push -u origin main
```

---

### Task 6: Job `ritmo_analise` (ainda sem UI de plano rico)

**Files:**
- Modify: `supabase/functions/traffic-agent-job/index.ts`
- Create: `supabase/functions/_shared/_prova_ritmo_job_sem_card.ts`

**Interfaces:**
- Consumes: `claim_ritmo_missao_analise`, `gravar_plano_ritmo`, `_shared/ritmo.ts` (`calcularBaseline`, `calcularTeto`, `nDiasPrazo`, `parsePlanoRitmo`)
- Body: `{ modo: "ritmo_analise", missao_id: uuid }`
- Produces: missão `plano_pronto` ou `analise_falhou`

- [ ] **Step 1: Prova que o modo não introduz propose_action**

`_prova_ritmo_job_sem_card.ts`:

```ts
const job = await Deno.readTextFile(new URL("../traffic-agent-job/index.ts", import.meta.url));
const ritmo = job.includes('modoRel === "ritmo_analise"') || job.includes('modo === "ritmo_analise"');
if (!ritmo) { console.error("FALHOU: dispatcher ritmo_analise ausente"); Deno.exit(1); }
// O job inteiro continua sem registrar propose_action nas tools do tier profundo.
const blocoTools = job.includes("propose_action");
// propose_action pode aparecer em comentários; o que não pode é estar no array de tools do job.
const toolsJob = job.match(/tools:\s*\[([\s\S]*?)\]/g) ?? [];
for (const t of toolsJob) {
  if (t.includes("propose_action")) {
    console.error("FALHOU: tools do job incluem propose_action");
    Deno.exit(1);
  }
}
console.log("OK ritmo_analise sem card");
```

Rode: `deno run --allow-read supabase/functions/_shared/_prova_ritmo_job_sem_card.ts`

Expected: FAIL dispatcher ausente

- [ ] **Step 2: Implement `processarRitmoAnalise`**

No dispatcher, ao lado de `relatorio`:

```ts
if (modoRel === "ritmo_analise") {
  const missaoId = String(body?.missao_id ?? "").trim();
  if (!missaoId) return json({ error: "ritmo_analise exige missao_id" }, 400);
  if (userId) {
    const { data: alvo } = await supa.from("ritmo_missoes").select("company_id").eq("id", missaoId).maybeSingle();
    if (!alvo) return json({ error: "missao nao encontrada" }, 404);
    const { data: membro } = await supa.rpc("is_company_member", { _company_id: alvo.company_id, _user_id: userId });
    if (!membro) return json({ error: "nao_e_membro_da_empresa" }, 403);
  }
  emBackground(processarRitmoAnalise(missaoId, String(cfg?.api_key ?? "")));
  return json({ ok: true, async: true, modo: "ritmo_analise", missao_id: missaoId }, 202);
}
```

`processarRitmoAnalise` (espelho de `processarRelatorio`, recorte **uma** campanha):

1. `claim_ritmo_missao_analise`.
2. Lê série `metric_snapshots` da campanha nos 14 dias antes de `periodo_inicio` (gasto + métrica-alvo).
3. `calcularBaseline` + `calcularTeto` + `nDiasPrazo` — grava números **antes** do LLM (não deixa o modelo inventar o envelope).
4. Colheita: mesmos especialistas de relatório (`desempenho_campanhas`, `estrutura_conta`, `criativos`, `compliance` se crédito, `whatsapp_waba` se métrica conversas, `alertas_recomendacoes`, `conhecimento`). Pergunta-contrato:

```
FORCA-TAREFA RITMO (nao e conversa, NAO emita card, NAO chame propose_action).
Empresa: {nome}. Campanha UNICA: {nome} ({id}).
Prazo: {ini} a {fim} America/Sao_Paulo.
Metrica-alvo: {metrica}. Dissertacao do gestor: {texto}.
Sonho (opcional, NAO e previsao): {sonho ou "nao declarado"}.
Baseline de gasto ja calculado: R$ {x}/dia em {n} dias com gasto; confianca {alta|baixa}.
Teto da janela: R$ {teto} (= baseline × {dias} + extra {extra}).
Devolva UM json com chaves: leitura, possibilidades {nada_muda, plano, maximo_envelope cada um d3,d7,d15,d30}, sonho {valor, atingivel_no_prazo, nota}, atos[], recusas[], lacunas[], premissas[].
Cada ato: acao do catalogo Meta, alvo_external_id, quando imediato|apos_janela, evidencia, mecanismo, metrica_sucesso, janela_leitura, reversa.
Horizontes 15 e 30 mesmo se o prazo for menor: rotule na premissa "se o ritmo novo se manter depois do prazo".
Nao invente media de mercado. Amostra pequena: null no horizonte, nunca decimal fingido.
```

5. Síntese: extraia JSON com `extrairJsonRitmo` (primeiro `{` até o último `}`; se falhar, `analise_falhou` com lacuna "plano nao veio em json"). `parsePlanoRitmo`. Sobrescreva `baseline` e `teto_janela` pelos valores calculados no passo 3 — o modelo não manda no envelope.
6. `gravar_plano_ritmo`. Erro → `analise_falhou` com mensagem. Não inserir `approval_requests`. Não `from("approval_requests")`.

- [ ] **Step 3: Deploy job**

```bash
npx supabase functions deploy traffic-agent-job --project-ref gzjwnjdpxpbmdhcyefvs
```

- [ ] **Step 4: Prova PASS + commit**

```bash
deno run --allow-read supabase/functions/_shared/_prova_ritmo_job_sem_card.ts
```

Expected: OK

```bash
git add supabase/functions/traffic-agent-job/index.ts supabase/functions/_shared/_prova_ritmo_job_sem_card.ts
git commit -m "feat: job ritmo_analise emite plano sem card e sem escrever na Meta."
git push -u origin main
```

---

### Task 7: Enfileirar análise + detalhe do plano

**Files:**
- Create: `src/components/ritmo/detalhe-missao.tsx`
- Modify: `src/routes/_authenticated/ritmo.tsx` (submit → RPC + invoke job)
- Modify: `src/routes/_authenticated/ritmo.test.tsx`

**Interfaces:**
- Consumes: `enfileirar_ritmo_analise`, `traffic-agent-job` `{ modo: "ritmo_analise", missao_id }`
- Produces: tela com leitura / possibilidades / plano / tabela 3-7-15-30

- [ ] **Step 1: Teste — botão Nova dispara rpc** (mock `rpcMock` a resolver um uuid; `functions.invoke` mock)

Ao submeter formulário válido, `rpc` foi chamado com `enfileirar_ritmo_analise` e `functions.invoke` com `modo: "ritmo_analise"`.

Missão `plano_pronto` com `plano_json.possibilidades.plano.d3 = 12`: a tela mostra `12` e o rótulo "sonho (não é previsão)" se `sonho` preenchido.

- [ ] **Step 2: Implement detalhe**

Três blocos da spec. Tabela horizontes: linhas `Se nada mudar` / `Se executar o plano` / `Máximo do envelope` / `Sonho (não é previsão)` se houver. Colunas 3 / 7 / 15 / 30 dias. Se `nDiasPrazo < 15`, nota sob 15 e 30: "se o ritmo novo se manter depois do prazo". Lacunas em lista. Atos em ol com evidência. Status `em_analise`: "Os agentes estão lendo a campanha…". `analise_falhou`: `erro_analise` + botão admin "Tentar análise de novo" (`reenviar_ritmo_analise` + invoke `ritmo_analise`).

`logAudit` `ritmo.analise` no submit.

Realizado vs projeção: some `metric_snapshots` da campanha desde `max(periodo_inicio, data da concessão)` na métrica escolhida e mostre uma linha **Realizado até agora** ao lado da projeção do horizonte já vencido. Sem Graph.

Autorizar **ainda não** (botão visível só em `plano_pronto` para admin, `disabled` com título "Próxima entrega"). Encerrar em `plano_pronto` chama `encerrar_ritmo_missao` motivo `descartada`.

- [ ] **Step 3: Tests PASS, commit, push**

---

## Bloco 2 — concessão + executor (só com portão verde)

### Task 8: Prova do portão (SQL + TS) — GATE

**Files:**
- Create: `supabase/functions/_shared/_prova_ritmo_portao.ts`

Não toque `meta-actions` ainda.

- [ ] **Step 1: Write the prova**

A prova lê só `supabase/migrations/20260910210000_ritmo_forca_tarefa.sql` e exige que `pode_executar_ato_ritmo` contenha os motivos `campanha`, `status`, `teto`, `master_desligado`, `acao_proibida`, `fora_do_prazo`, `sem_concessao`. Exige `revoke all ... pode_executar_ato_ritmo` de `authenticated` e `anon`. Exige que o corpo **não** contenha `skip_approval`. Exige `criar_campanha` no ramo que nega.

Rode: `deno run --allow-read supabase/functions/_shared/_prova_ritmo_portao.ts`

- [ ] **Step 2: Confirm Task 1 portão tests still PASS**

`bun run test src/lib/ritmo.test.ts`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/_prova_ritmo_portao.ts
git commit -m "test: portão Ritmo fail-closed no SQL, sem skip_approval."
git push -u origin main
```

**STOP:** se esta prova ou `decidirPortaoAto` estiver vermelha, não abra Tasks 9–14.

---

### Task 9: `meta-actions` origem ritmo

**Files:**
- Modify: `supabase/functions/meta-actions/index.ts` (logo após parse do `body`, **antes** do loop por `approval_id`)
- Create: `supabase/functions/_shared/_prova_ritmo_meta_actions.ts`

**Interfaces:**
- Body: `{ origem: "ritmo", ritmo_ato_id: uuid }`
- Consumes: `pode_executar_ato_ritmo`
- Produces: executa a mesma função interna que o card aprovado já chama; **não** `insert` em `approval_requests`

- [ ] **Step 1: Prova de fonte**

`_prova_ritmo_meta_actions.ts`: o `index.ts` de meta-actions contém `origem === "ritmo"` (ou `origem=ritmo`) **e** `pode_executar_ato_ritmo` **e** se `ok !== true` retorna 403 **antes** de qualquer `g(`/`. Se `from("approval_requests").insert` aparecer no ramo ritmo, falha.

Expected first run: FAIL (ramo ausente)

- [ ] **Step 2: Implement the branch**

```ts
if (String(body?.origem ?? "") === "ritmo") {
  const atoId = String(body?.ritmo_ato_id ?? "").trim();
  if (!atoId) return json({ error: "ritmo_ato_id obrigatorio" }, 400);
  const { data: ato, error: ate } = await supa.from("ritmo_atos").select("*").eq("id", atoId).maybeSingle();
  if (ate || !ato) return json({ error: "ato_ritmo_nao_encontrado" }, 404);
  const { data: missao } = await supa.from("ritmo_missoes").select("*").eq("id", ato.missao_id).maybeSingle();
  if (!missao) return json({ error: "missao_nao_encontrada" }, 404);
  const { data: porta } = await supa.rpc("pode_executar_ato_ritmo", {
    p_missao_id: ato.missao_id,
    p_company_id: ato.company_id,
    p_campaign_id: missao.campaign_id,
    p_acao: ato.acao,
  });
  const ok = porta && (porta as { ok?: boolean }).ok === true;
  if (!ok) {
    await supa.from("ritmo_atos").update({
      resultado: "bloqueado",
      resposta_meta: porta ?? { motivo: "portao_negou" },
    }).eq("id", atoId);
    return json({ error: "portao_ritmo", porta }, 403);
  }
  const dry = (porta as { dry_run?: boolean }).dry_run === true;
  // Reuse the existing per-action executor used by approved cards, passing
  // company_id, action_type=ato.acao, payload=ato.payload, dry_run=dry.
  // On success: resultado ok | simulado. On Meta failure: falhou.
  // NEVER insert approval_requests.
}
```

Fatore o loop que hoje processa pedido `approved` (~linha 4100+) numa função `executarUmPedido(pedido, { dryRun })`. O ramo ritmo monta um pedido sintético em memória (`action_type`, `payload`, `company_id`) e chama essa função. **Não** insere `approval_requests`.

- [ ] **Step 3: Deploy meta-actions + prova PASS + commit**

```bash
npx supabase functions deploy meta-actions --project-ref gzjwnjdpxpbmdhcyefvs
```

---

### Task 10: Edge `ritmo-executar`

**Files:**
- Create: `supabase/functions/ritmo-executar/index.ts`
- Modify: `supabase/config.toml` — bloco:

```toml
[functions.ritmo-executar]
verify_jwt = false
```

Auth: `mcpKeyValida` header-only, igual `meta-actions`.

**Interfaces:**
- Body: `{ modo: "primeiro_passe"|"leve"|"fundo"|"dispatcher_leve"|"dispatcher_fundo", missao_id?: uuid }`
- Cron leve chama `dispatcher_leve`; fundo `dispatcher_fundo`. Autorizar chama `primeiro_passe` + `missao_id`.

- [ ] **Step 1: Implement**

`mcpKeyValida`. `dispatcher_*`: `listar_ritmo_tiques_devidos` e `emBackground` por missão.

`primeiro_passe`: lê `plano_json`, `atosDoPrimeiroPasse`, para cada ato executável insere `ritmo_atos` (`pendente`, tique `primeiro_passe`) e POSTa `meta-actions` `{ origem:"ritmo", ritmo_ato_id }` com a mcp key do chamador `cron:ritmo-executar` (criada na Task 11). Se `periodo_inicio > hoje SP`, não escreve (concessão existe, espera).

`leve`: calcula `motivoParada` com snapshots + `sonhoAtingido`. Se motivo → `encerrar_ritmo_missao` + insere ato `verificar_parada` resultado `ok`. Senão: retry de atos `falhou` reexecutáveis (a classificação já existe em meta-actions / `reexecutar_aprovacao` — reusar o mesmo critério de erro); não inventa ato novo.

`fundo`: invoke `traffic-agent-job` `{ modo: "ritmo_replano", missao_id }` (Task 12) e depois executa atos `quando=imediato` novos do replano, no máximo uma significativa.

Nunca chame Graph direto. Nunca `approval_requests`.

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy ritmo-executar --project-ref gzjwnjdpxpbmdhcyefvs
```

- [ ] **Step 3: Commit + push**

---

### Task 11: Autorizar na UI + cron

**Files:**
- Modify: `src/components/ritmo/detalhe-missao.tsx` — botão Autorizar chama `autorizar_ritmo_missao` e `functions.invoke("ritmo-executar", { body: { modo: "primeiro_passe", missao_id } })`. Encerrar agora: `encerrar_ritmo_missao` motivo `humano`.
- Modify: `src/routes/_authenticated/ritmo.test.tsx` — admin vê Autorizar em `plano_pronto`; visualizador não.
- Modify: migration nova `20260910220000_ritmo_cron.sql` + espelho: `mcp_api_keys` chamador `cron:ritmo-executar`; `tarefas_agendadas` duas linhas (`ritmo-tique-leve` periódica frequente, corpo `{"modo":"dispatcher_leve"}`, edge `ritmo-executar`; `ritmo-tique-fundo` diária). `cron.schedule` leve `20 */2 * * *`, fundo `15 8 * * *` (Brasília ~5h e 8h UTC-ish — use o mesmo padrão `disparar_tarefa_http` dos relatórios). Timeout 120000.

**Interfaces:**
- Consumes: RPCs já existentes

- [ ] **Step 1: Teste visualizador não autoriza** — `isAdmin: false`, queryByRole Autorizar not in document.

- [ ] **Step 2: Wire buttons + logAudit `ritmo.autorizar` / `ritmo.encerrar`**

- [ ] **Step 3: Apply cron migration remotely**

- [ ] **Step 4: Commit + push**

---

### Task 12: Tique fundo `ritmo_replano`

**Files:**
- Modify: `supabase/functions/traffic-agent-job/index.ts` — `modo === "ritmo_replano"` (mesmo `processarRitmoAnalise` com prompt extra: "isto e REPLANO de missao em execucao; compare realizado vs projecao; so desvie com evidencia nova; dissertacao e metrica e teto permanecem"). Marca atos novos `replano: true`. Continua sem `propose_action`.
- Modify: `_prova_ritmo_job_sem_card.ts` para exigir também `ritmo_replano`.

- [ ] Deploy `traffic-agent-job`. Commit.

---

### Task 13: Sino + Executor + visão do produto

**Files:**
- Modify: `get_notificacoes_pendentes` (nova migration `20260910230000_ritmo_notificacoes.sql` + espelho) — union de:
  - missão `plano_pronto` (tipo `ritmo`, urgencia `medium`, titulo `Plano da força-tarefa pronto`)
  - missão `em_execucao` com gasto ≥ 0.8 * teto (`teto`)
  - último `ritmo_atos.resultado = falhou` não seguido de `ok` na mesma ação
  - missão `encerrada` nas últimas 24h (`low`)
- Modify: `src/lib/notificacoes.ts` — `TipoNotif` inclui `"ritmo"`; `destinoNotificacao` → `{ pathname: "/ritmo", search: { item: id } }`
- Modify: `src/lib/notificacoes.test.ts` — caso ritmo
- Modify: `src/routes/_authenticated/ritmo.tsx` — se `?item=` destaca a missão
- Modify: `supabase/functions/_shared/agentes.ts` FALLBACK do AG-06: acrescente em `limites` ou `delegar_quando`: "Excecao: missao Ritmo com concessao valida escreve via ritmo-executar, sem card. Fora disso, card."
- Migration de prompt: `update public.agents set papel = ...` o parágrafo do Executor com a mesma exceção (não silencie o card no chat).
- Modify: `docs/visao-do-produto.md` — nova **5.15 Ritmo**; mapa de telas `/ritmo`; hierarquia: autonomia da força-tarefa é concessão nomeada, não interruptor global. Frase da seção 12 ("Não é robô que liga campanha sozinho") ganha ressalva: "exceto missão Ritmo autorizada, ainda presa a teto, prazo e travas da casa".

- [ ] Tests notificacoes PASS. Apply migration. Commit. Push. Deploy nenhuma edge extra salvo se o prompt viver só no banco.

---

### Task 14: Verificação de entrega

**Files:** nenhum código novo se as provas já cobrem. Conferir no painel (dry-run ligado):

1. Abrir `/ritmo`, criar missão numa campanha ativa, dissertação + métrica conversas, extra 0, sonho vazio.
2. Esperar plano (ou `analise_falhou` visível, não spinner eterno).
3. Autorizar em empresa com `dry_run=true`: atos `simulado`, **zero** linha nova em Aprovações.
4. Encerrar agora: status encerrada, mudanças (se houvesse) ficam — em dry-run nada mudou na Meta.
5. Trocar de empresa: missão some (isolamento).

Se dry-run não estiver ligado na empresa de staging, **não** autorize em produção nesta task sem o gestor na frente.

Rode `bun run verify` (ou pelo menos `bun run test` + `deno run` nas três provas `_prova_ritmo_*`).

Commit só se houver ajuste fino de copy. Senão feche o plano.

---

## Coverage vs spec

| Spec | Task |
|---|---|
| Aba / menu / lista / form | 4, 5 |
| Envelope baseline×dias+extra, confiança | 1 |
| Sonho volume vs CTR | 1 |
| Plano + projeções 3/7/15/30 | 6, 7 |
| Job sem propose_action | 6, 8, 12 |
| Autorizar uma vez | 11 |
| Portão SQL + TS | 1, 3, 8 |
| meta-actions origem ritmo | 9 |
| Loop leve/fundo/primeiro passe | 10, 11, 12 |
| Uma significativa no primeiro passe | 1, 10 |
| Não cria approval_requests | 6, 9, 10 |
| Sino | 13 |
| Visão do produto + Executor | 13 |
| Visualizador | 5, 11 |
| Paridade lib/espelho SQL | 2, 3 |
| Extra 0 bloqueia orçamento acima do ritmo | 1 (`teto` sem extra) |

Fora de escopo (não criar task): multi-campanha, revert, autonomia global, CRM, sonho obrigatório.
