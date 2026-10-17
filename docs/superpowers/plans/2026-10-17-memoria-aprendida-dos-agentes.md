# Memória aprendida dos agentes — plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo agente que redige, analisa ou decide consulta os aprendizados da empresa antes da tarefa, e os agentes do chat e do job gravam sozinhos o que aprenderam, com evidência conferida; um espelho somente-leitura leva tudo para um cofre do Obsidian.

**Architecture:**
- **Banco:** a tabela nova `agent_aprendizados` tem trava de isolamento por empresa e por linha. Duas RPCs fazem a busca textual (português sem acento + `pg_trgm`, combinadas por RRF) e o dedupe.
- **Regras:** um módulo puro (`_shared/aprendizados_regras.ts`) concentra as regras testáveis sem rede, e um módulo de banco (`_shared/aprendizados.ts`) expõe `consultarMemoria`, `registrarAprendizado` e `corrigirAprendizado`.
- **Edges:** importam esses dois módulos.
- **Espelho:** sai pelo `mcp-server` e é escrito no disco por um script local.

**Tech Stack:** Supabase Postgres (`pg_trgm`, `unaccent`, `pg_cron`), edges Deno, OpenRouter via `_shared/llm_roteador.ts`, Deno para o script local.

**Spec:** `docs/superpowers/specs/2026-10-17-memoria-aprendida-dos-agentes-design.md`. Ler antes de qualquer tarefa: as seções 7.0 (precedência) e 7.2 (ordem do handler) decidem casos que o plano não repete.

## Global Constraints

- Texto ao gestor em pt-BR. Descrição e doutrina de ferramenta seguem o estilo do registro: ASCII, sem acento, curtas.
- `company_id` vem sempre do turno ou do job, nunca de argumento do modelo.
- Precedência (copiar no cabeçalho do bloco, literal): `MEMÓRIA APRENDIDA (registrada pelos agentes desta casa; dado fresco, regra de conformidade e memória curada vencem esta — se contradizer, diga e corrija com corrigir_aprendizado):`
- Texto de falha da consulta (literal): `memória aprendida indisponível neste turno; não afirme que não há aprendizado`
- Tetos: fato com 20–600 chars; contexto com até 1.500; 3 registros por turno do chat ou por job; 30 por empresa por dia. No prompt: chat com 8 itens e 4.000 chars; demais superfícies com 5 itens e 2.500 chars; até 5 `preferencia_do_gestor` sempre presentes, contadas dentro do limite.
- O `compliance-check`, o guardião dos templates WABA e o subagente `compliance` do job **não** recebem nem gravam memória aprendida.
- O Ritmo e a correção de custo recebem toda a memória aprendida (`somenteConfirmadas: false`).
- Toda migração em `supabase/migrations/<timestamp>_<nome>.sql` tem cópia idêntica em `supabase/espelhos/` com o mesmo nome.
- Provas: `supabase/functions/_shared/_prova_*.ts`, rodadas com `deno run --no-code-cache --allow-read --allow-env <arquivo>`. Cada uma termina em `Deno.exit(1)` se houver falha e imprime `ok - …` se passar (padrão de `_prova_memoria_relevante.ts`).
- Prova SQL: rodar via `execute_sql` dentro de `begin; … rollback;`, nunca deixar linha de teste no banco.
- Antes de cada commit, rodar `git checkout -- deno.lock` (o `deno check` o reescreve). Commit e push direto na `main` ao fim de cada tarefa, sem `--force`. Se o push for rejeitado, usar `git fetch` + `git merge --no-edit origin/main`.
- Aplicar migração em produção: avisar o gestor no chat antes de cada `apply_migration`.
- Deploy de edge só com pedido explícito do gestor no chat. Conferir depois com `supabase functions list`.

## Review Focus

1. **Correção misturada com pergunta de leitura** ("o custo subiu? e a partir de agora me mostre custo por conversa antes do CPL"): o agente responde a leitura e registra a preferência. Se o modelo esquecer, a rede de segurança pega. Teste na Tarefa 2 (`sinalDeCorrecao`) e na Tarefa 4 (fonte da rede).
2. **Memória que contradiz dado fresco:** o cabeçalho com a precedência sai sempre, mesmo com um único item. Teste na Tarefa 2 (`formatarBlocoAprendizados`).
3. **Tarefa que cita duas linhas** ("La Felicità e Jurídico"): recebe os itens sem linha mais os das duas linhas, rotulados. Teste na Tarefa 2 (`linhasDaTarefa`) e na Tarefa 3 (`consultarMemoria` repassa `p_linhas`).
4. **Edge no ar com a migração ainda não aplicada, ou RPC com erro:** `consultarMemoria` nunca lança; devolve o texto de falha e `falhou: true`. Teste na Tarefa 3.
5. **Nome de arquivo hostil no Windows** (fato com `:` `/` `?` `"`, ou com 600 chars): o nome é sanitizado, curto e único pelo id. Teste na Tarefa 8.

---

### Task 1: Tabela, travas e funções de busca no banco

**Files:**
- Create: `supabase/migrations/20261017150000_memoria_aprendida_dos_agentes.sql`
- Create: `supabase/espelhos/20261017150000_memoria_aprendida_dos_agentes.sql` (cópia idêntica)
- Create: `supabase/functions/_shared/_prova_aprendizados.sql`

**Interfaces:**
- Produces:
  - `public.agent_aprendizados`, com as colunas da spec 7.1 exceto `embedding`, que só nasce na Tarefa 10.
  - `public.memoria_config (id boolean primary key default true check (id), consulta_ativa boolean not null default true, gravacao_ativa boolean not null default true)`, com uma linha.
  - `public.f_unaccent(text) returns text`, imutável.
  - `public.consultar_aprendizados(p_company_id uuid, p_linhas text[], p_texto text, p_limite int, p_max_preferencias int, p_somente_confirmadas boolean) returns table(id uuid, categoria text, fato text, linha text, agente_codigo text, confianca text, confirmacoes int, criado_em timestamptz, motivo text)`. `motivo` vale `'preferencia'` ou `'relevante'`.
  - `public.aprendizados_parecidos(p_company_id uuid, p_linha text, p_chave text, p_limiar real default 0.8) returns table(id uuid, similaridade real)`
  - `public.reforcar_aprendizado(p_id uuid, p_evidencia jsonb) returns void`
  - `public.marcar_uso_aprendizados(p_ids uuid[]) returns void`

- [ ] **Step 1: Escrever a prova SQL** em `_prova_aprendizados.sql`, que roda em `begin; … rollback;` e usa `raise exception` em cada falha. Casos:
  - insert na COHAPM (`57f755b9-c23d-4f58-a488-8173d697c010`) com o fato "o gestor prefere ver custo por conversa antes do CPL" passa;
  - insert na COHAPM com o fato "seguir o padrao da Legal e Viver" falha com `aprendizado_cita_outra_empresa`;
  - insert na Legal (`ded20b38-f42e-4c71-800c-31b97ea48bcf`) com o fato "copiar o tom da La Felicita" falha com `aprendizado_cita_outra_empresa`;
  - insert na "Cooperativa_ Cohapm" (`307849e6-78a7-4217-8112-3fb0a924f988`) com o fato "a cooperativa COHAPM atende servidores" passa;
  - insert com `act_` que não está em `meta_ad_accounts` da empresa falha com `aprendizado_cita_conta_alheia`;
  - insert com `linha = 'juridico'` e o fato "usar a mesma copy da La Felicita" falha com `aprendizado_cita_outra_linha`;
  - segundo insert vigente com a mesma `chave_normalizada` na mesma empresa falha por unicidade;
  - `consultar_aprendizados(..., p_linhas => array['la_felicita'], ...)` não devolve linha `juridico` e devolve linha nula;
  - `p_linhas => null` devolve todas;
  - `aprendizados_parecidos` com a chave de um fato reescrito com uma palavra trocada devolve similaridade ≥ 0.8;
  - `reforcar_aprendizado` leva `confirmacoes` a 2 e `jsonb_array_length(evidencias)` a 2.

- [ ] **Step 2: Rodar a prova antes da migração.** Rodar via `execute_sql`. Esperado: erro `relation "public.agent_aprendizados" does not exist`.

- [ ] **Step 3: Escrever a migração.**
  - Extensões `pg_trgm` e `unaccent`.
  - `f_unaccent` como wrapper `language sql immutable parallel safe` sobre `public.unaccent('public.unaccent', $1)`.
  - Tabela com os checks de tamanho e enums da spec 7.1.
  - `busca tsvector generated always as (to_tsvector('portuguese', f_unaccent(fato || ' ' || coalesce(contexto, '')))) stored`, índice GIN em `busca` e índice GIN trigram em `chave_normalizada`.
  - Índice único parcial `(company_id, chave_normalizada) where status = 'vigente'`.
  - Trigger `guard_agent_aprendizados_isolamento` antes de insert/update, com as regras de empresa por id, de linha e de `act_` contra `meta_ad_accounts.account_id`.
    - Legal recusa `cohapm|la felicit|lafelicita`.
    - COHAPM recusa `legal\s*(e|é)\s*viver|\mLEV\M|consignado\s*clt`.
    - Demais empresas recusam o padrão da Legal e `la felicit`.
    - Linha preenchida recusa texto que cite outra linha: `la felicit|lafelicita|\mlaf\M`, `juridic`, `vistta|sistema ocular|\moculos?\M`.
  - RLS ligada, só com policy de select `public.is_company_member(company_id, (select auth.uid()))`.
  - `consultar_aprendizados`:
    - entra só o que está `vigente` e com `valido_ate` nulo ou `>= current_date`;
    - linha nula sempre entra; com `p_linhas` não nulo, também entra `linha = any(p_linhas)`;
    - preferências: até `p_max_preferencias` `preferencia_do_gestor`, ordenadas por `confirmacoes desc, criado_em desc`;
    - relevantes: o restante até `p_limite`, por RRF (k = 60) de `ts_rank_cd(busca, q)` e `word_similarity(f_unaccent(p_texto), f_unaccent(fato))`, onde `q` é o `plainto_tsquery('portuguese', f_unaccent(p_texto))` com `&` trocado por `|`;
    - `p_somente_confirmadas` filtra `confianca = 'confirmada'`.
  - `aprendizados_parecidos` usa `similarity(chave_normalizada, p_chave)` entre os vigentes da empresa com `linha is not distinct from p_linha or linha is null`.
  - As quatro funções são `security definer set search_path = public`, com execute revogado de `anon` e `authenticated`.

- [ ] **Step 4: Copiar para `supabase/espelhos/` e aplicar.** Avisar o gestor, aplicar com `apply_migration` e rodar a prova SQL de novo. Esperado: termina sem exceção.

- [ ] **Step 5: Commit e push.**
```bash
git add supabase/migrations/20261017150000_memoria_aprendida_dos_agentes.sql supabase/espelhos/20261017150000_memoria_aprendida_dos_agentes.sql supabase/functions/_shared/_prova_aprendizados.sql
git commit -m "feat: tabela agent_aprendizados com trava de empresa e linha e busca textual"
```

---

### Task 2: Regras puras da memória aprendida

**Files:**
- Create: `supabase/functions/_shared/aprendizados_regras.ts`
- Create: `supabase/functions/_shared/_prova_aprendizados_regras.ts`
- Modify: `supabase/functions/_shared/memoria_conjunto.ts:462` (exportar `linhasProdutoNoTexto`, sem mudar o corpo)

**Interfaces:**
- Consumes: `linhasProdutoNoTexto`, `LinhaProdutoCohapm` (`memoria_conjunto.ts`); `inferirMeiosDoPedido` (`pedido_drive_criativos.ts`); `COMPANY_COHAPM`, `COMPANY_LEGAL` (`meta_company_tokens.ts`).
- Produces (todos exportados):
  - `type CategoriaAprendizado = "preferencia_do_gestor" | "correcao" | "fato_da_conta" | "armadilha" | "processo"`
  - `type Evidencia = { tipo: "fala_do_gestor" | "retorno_de_ferramenta" | "resultado_de_ato"; trecho: string; ferramenta?: string }`
  - `type PedidoRegistro = { fato: string; contexto: string; categoria: CategoriaAprendizado; evidencia: Evidencia; confianca: "confirmada" | "observada"; linha?: string | null; valido_ate?: string | null }`
  - `type TurnoAprendizado = { companyId: string; agente: string; superficie: "chat" | "job"; conversationId: string | null; jobId: string | null; falasDoGestor: string[]; retornos: { tool: string; retorno: unknown }[]; registrosNoTurno: number }`
  - `type AprendizadoLinha = { id: string; categoria: string; fato: string; linha: string | null; agente_codigo: string; confianca: string; confirmacoes: number; criado_em: string; motivo?: string }`
  - `type Veredito = { ok: true } | { ok: false; motivo: string }`
  - `normalizarTexto(s: string): string`: minúsculo, sem acento, sem pontuação, espaços colapsados.
  - `chaveNormalizada(fato: string): string`: `normalizarTexto` cortado em 300.
  - `idCurto(id: string): string`: os 6 primeiros hex do uuid.
  - `ehDadoVolatil(fato: string): boolean`
  - `conferirIsolamento(texto: string, companyId: string, contasDaEmpresa: string[]): Veredito`
  - `linhasDaEmpresa(companyId: string): string[]`: `["la_felicita","juridico","sistema_ocular"]` para a COHAPM, `[]` para as demais.
  - `rotuloLinha(linha: string | null): string`: `La Felicità`, `Jurídico`, `Sistema Ocular`, e `Geral` para nulo.
  - `resolverLinha(companyId: string, texto: string, linhaDoModelo?: string | null): { ok: true; linha: string | null } | { ok: false; motivo: string }`
  - `linhasDaTarefa(companyId: string, tarefa: string, linhaFixa?: string | null): string[] | null` (nulo = sem linha definida)
  - `conferirEvidencia(ev: Evidencia, confianca: string, turno: TurnoAprendizado): Veredito`
  - `validarPedidoRegistro(p: unknown): { ok: true; pedido: PedidoRegistro } | { ok: false; motivo: string }`
  - `sinalDeCorrecao(msg: string): boolean`
  - `formatarBlocoAprendizados(rows: AprendizadoLinha[], opts: { tetoChars: number; comLinha: boolean }): string`
  - `CABECALHO_APRENDIZADOS`, `AVISO_FALHA_APRENDIZADOS`: as duas cópias literais das Global Constraints.
  - `PREFIXO_REVISAO_CURADORIA = "pedido de revisao de curadoria: "`
  - Constantes: `TETO_REGISTROS_TURNO = 3`, `TETO_REGISTROS_DIA = 30`, `LIMITE_CHAT = 8`, `LIMITE_OUTROS = 5`, `TETO_CHARS_CHAT = 4000`, `TETO_CHARS_OUTROS = 2500`, `MAX_PREFERENCIAS = 5`.

- [ ] **Step 1: Escrever a prova** `_prova_aprendizados_regras.ts`, no padrão `assert(cond, msg)` com contador de falhas:
```ts
assert(ehDadoVolatil("CPL de ontem foi R$ 12"), "cpl de ontem e volatil");
assert(ehDadoVolatil("gasto dos ultimos 7 dias passou de R$ 900"), "janela e volatil");
assert(!ehDadoVolatil("o gestor prefere ver custo por conversa antes do CPL"), "preferencia nao e volatil");
assert(!ehDadoVolatil("a campanha COHAPM_JURIDICO_V2 e a continuacao da V1"), "fato da conta nao e volatil");
assert(!conferirIsolamento("seguir o padrao da Legal e Viver", COHAPM, []).ok, "cohapm nao cita legal");
assert(!conferirIsolamento("tom da La Felicita", LEGAL, []).ok, "legal nao cita la felicita");
assert(conferirIsolamento("a cooperativa COHAPM atende servidores", COOPERATIVA, []).ok, "cooperativa pode citar cohapm");
assert(!conferirIsolamento("conta act_999999999", COHAPM, ["act_111111111"]).ok, "act alheio recusado");
assert(eq(resolverLinha(COHAPM, "a copy do Juridico usa conta de luz", null), { ok: true, linha: "juridico" }), "linha do texto");
assert(!resolverLinha(COHAPM, "La Felicita e Juridico usam o mesmo CTA", null).ok, "duas linhas recusa");
assert(!resolverLinha(COHAPM, "a copy do Juridico usa conta de luz", "la_felicita").ok, "divergencia recusa");
assert(eq(resolverLinha(COHAPM, "o gestor prefere tabela", null), { ok: true, linha: null }), "sem linha vale empresa");
assert(eq(resolverLinha(LEGAL, "o gestor prefere tabela", "juridico"), { ok: true, linha: null }), "empresa sem linhas ignora");
assert(eq(linhasDaTarefa(COHAPM, "compare La Felicita e Juridico"), ["la_felicita", "juridico"]), "duas linhas na tarefa");
assert(linhasDaTarefa(COHAPM, "como esta a conta?") === null, "sem linha definida");
assert(eq(linhasDaTarefa(COHAPM, "qualquer", "sistema_ocular"), ["sistema_ocular"]), "linha fixa vence");
const turno = { /* falasDoGestor: ["A partir de agora, me mostre custo por conversa antes do CPL."], retornos: [{ tool: "get_funnel", retorno: { base: "conversas" } }] ... */ };
assert(conferirEvidencia({ tipo: "fala_do_gestor", trecho: "me mostre custo por conversa" }, "confirmada", turno).ok, "trecho literal aceito");
assert(!conferirEvidencia({ tipo: "fala_do_gestor", trecho: "prefiro sempre custo por conversa" }, "confirmada", turno).ok, "parafrase recusada");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "conversas", ferramenta: "get_overview" }, "observada", turno).ok, "ferramenta que nao rodou recusada");
assert(!conferirEvidencia({ tipo: "retorno_de_ferramenta", trecho: "conversas", ferramenta: "get_funnel" }, "confirmada", turno).ok, "confirmada exige fala do gestor");
assert(sinalDeCorrecao("o custo subiu? e a partir de agora me mostre custo por conversa"), "sinal no meio da leitura");
assert(sinalDeCorrecao("nao e assim, esse conjunto e do juridico"), "correcao");
assert(!sinalDeCorrecao("como esta o custo hoje?"), "leitura pura sem sinal");
const bloco = formatarBlocoAprendizados([umaLinha], { tetoChars: 2500, comLinha: true });
assert(bloco.startsWith(CABECALHO_APRENDIZADOS), "cabecalho com precedencia sempre");
assert(/\[#[0-9a-f]{6} \| preferencia_do_gestor \| Jurídico \| AG-00, \d{2}\/\d{2}\/\d{4}, confirmada 3x\]/.test(bloco), "formato do item");
assert(formatarBlocoAprendizados(muitas, { tetoChars: 2500, comLinha: true }).length <= 2500, "teto de chars");
assert(formatarBlocoAprendizados([], { tetoChars: 2500, comLinha: true }) === "", "vazio nao gera bloco");
assert(!validarPedidoRegistro({ fato: "curto", contexto: "x", categoria: "correcao", evidencia: { tipo: "fala_do_gestor", trecho: "a" }, confianca: "confirmada" }).ok, "fato < 20 chars");
```
  Formato do item: `- [#<idCurto> | <categoria> | <rotuloLinha> | <agente>, <dd/mm/aaaa em America/Sao_Paulo>, <confianca><" Nx" se confirmacoes > 1>] <fato>`. O segmento de linha só aparece com `comLinha: true`. No teto, corta item inteiro, nunca no meio.

- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_aprendizados_regras.ts`
Expected: erro de import (`aprendizados_regras.ts` não existe).

- [ ] **Step 3: Implementar `aprendizados_regras.ts`.**
  - `ehDadoVolatil`: verdadeiro quando o texto normalizado tem **ao mesmo tempo**:
    - um número (dígito, `R$` ou `%`);
    - uma referência de tempo (`hoje|ontem|anteontem|esta semana|semana passada|mes passado|neste mes|ultimos? \d+ dias|\d{2}/\d{2}`);
    - uma palavra de métrica (`cpl|cpm|ctr|cpc|custo|gasto|investimento|resultado|conversas?|formularios?|leads?|alcance|impressoes|cliques|frequencia|roas`).
  - `conferirIsolamento`: espelha as regras do trigger da Tarefa 1 e devolve os motivos `cita_outra_empresa` / `cita_conta_alheia`.
  - `resolverLinha`: segue a spec 7.2, passo 4, usando `linhasProdutoNoTexto`.
  - `linhasDaTarefa`: usa `inferirMeiosDoPedido` e só devolve linhas da empresa.
  - `conferirEvidencia`: compara com `normalizarTexto(trecho)` contido em `normalizarTexto(fala)`. Para retorno, compara com `normalizarTexto(JSON.stringify(retorno))` do retorno daquela ferramenta.
  - `sinalDeCorrecao`: uma regex sobre o texto normalizado (`nao e assim|esta errad|errou|errado|corrig|a partir de agora|daqui pra frente|sempre|nunca|prefiro|prefira|lembre|lembra|nao (use|faca|mande|coloque|mostre) mais`).

- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Esperado: `ok - regras de aprendizado`. Rodar também `_prova_linha_produto.ts`, `_prova_memoria_conjunto.ts` e `_prova_trava_linha_apos_limpeza.ts`: o resultado tem de ser igual ao de antes do export (`_prova_linha_produto` já falhava na linha de base).

- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/_shared/aprendizados_regras.ts supabase/functions/_shared/_prova_aprendizados_regras.ts supabase/functions/_shared/memoria_conjunto.ts
git commit -m "feat: regras puras da memoria aprendida (volatil, isolamento, linha, evidencia, bloco)"
```

---

### Task 3: Camada de banco — consultar, registrar, corrigir

**Files:**
- Create: `supabase/functions/_shared/aprendizados.ts`
- Create: `supabase/functions/_shared/_prova_aprendizados.ts`

**Interfaces:**
- Consumes: tudo da Tarefa 2; as RPCs e a tabela da Tarefa 1.
- Produces:
  - `type Db = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any }`
  - `type PapelConsulta = "chat" | "subagente" | "sintese" | "relatorio" | "ritmo" | "correcao_custo" | "reco" | "legendas" | "waba_redator"`
  - `type TelemetriaConsulta = { injetados: number; ids: string[]; chars: number; falhou: boolean; desligada: boolean }`
  - `consultarMemoria(a: { supa: Db; companyId: string; tarefa: string; papel: PapelConsulta; linhaFixa?: string | null; somenteConfirmadas?: boolean }): Promise<{ texto: string; ids: string[]; telemetria: TelemetriaConsulta }>`
  - `type ResultadoRegistro = { resultado: "gravado" | "ja_registrado" | "recusado"; id?: string; id_curto?: string; motivo?: string }`
  - `registrarAprendizado(supa: Db, args: unknown, turno: TurnoAprendizado): Promise<ResultadoRegistro>`, que também incrementa `turno.registrosNoTurno` quando grava.
  - `corrigirAprendizado(supa: Db, args: unknown, turno: TurnoAprendizado): Promise<ResultadoRegistro>`

- [ ] **Step 1: Escrever a prova** com um `Db` falso que grava as chamadas e responde por roteiro:
```ts
// consulta
assert((await consultarMemoria({ supa: dbComErroNaRpc, companyId: COHAPM, tarefa: "x", papel: "chat" })).texto.includes(AVISO_FALHA_APRENDIZADOS), "falha nunca lanca e avisa");
assert((await consultarMemoria({ supa: dbConfigDesligada, ... })).texto === "" , "chave desligada = como hoje");
assert((await consultarMemoria({ supa: dbVazio, ... })).texto === "", "tabela vazia = sem bloco");
const r = await consultarMemoria({ supa: dbCom3, companyId: COHAPM, tarefa: "compare La Felicita e Juridico", papel: "subagente" });
assert(eq(ultimaRpc("consultar_aprendizados").p_linhas, ["la_felicita", "juridico"]) && ultimaRpc("consultar_aprendizados").p_limite === 5, "linhas e limite do papel");
assert(chamou("marcar_uso_aprendizados"), "uso marcado");
assert((await consultarMemoria({ supa: dbCom3, companyId: COHAPM, tarefa: "x", papel: "chat" })).telemetria.chars <= 4000, "teto chat");
// registro
assert((await registrarAprendizado(dbVazio, pedidoOk, turno)).resultado === "gravado", "grava");
assert((await registrarAprendizado(dbComParecido, pedidoOk, turno)).resultado === "ja_registrado" && chamou("reforcar_aprendizado"), "dedupe reforca");
assert((await registrarAprendizado(dbVazio, { ...pedidoOk, fato: "CPL de ontem foi R$ 12 na campanha" }, turno)).motivo?.includes("dado, nao memoria"), "volatil recusado");
assert((await registrarAprendizado(dbVazio, pedidoOk, { ...turno, registrosNoTurno: 3 })).resultado === "recusado", "teto do turno");
assert((await registrarAprendizado(dbCom30Hoje, pedidoOk, turno)).resultado === "recusado", "teto do dia");
assert((await registrarAprendizado(dbGravacaoDesligada, pedidoOk, turno)).resultado === "recusado", "gravacao desligada");
assert(ultimoInsert().company_id === turno.companyId, "empresa do turno, nunca do argumento");
// correcao
assert((await corrigirAprendizado(dbOutraEmpresa, { id: "abc123", acao: "aposentar", motivo: "m", evidencia }, turno)).resultado === "recusado", "id de outra empresa");
assert((await corrigirAprendizado(dbDoisPrefixos, { id: "abc123", ... }, turno)).motivo?.includes("ambiguo"), "prefixo ambiguo");
const sub = await corrigirAprendizado(dbUm, { id: "abc123", acao: "substituir", motivo: "mudou", evidencia, novo_fato: "fato novo com mais de vinte chars", novo_contexto: "c" }, turno);
assert(sub.resultado === "gravado" && insertTem("substitui_id") && updateTem({ status: "substituida" }), "substituir guarda historico");
```

- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_aprendizados.ts`
Expected: erro de import.

- [ ] **Step 3: Implementar `aprendizados.ts`.**
  - `consultarMemoria`:
    - lê `memoria_config` (falha de leitura conta como ligada);
    - chama `consultar_aprendizados` com `p_linhas = linhasDaTarefa(...)`, o `p_limite` do papel (`LIMITE_CHAT` no chat, `LIMITE_OUTROS` nos demais), `p_max_preferencias = MAX_PREFERENCIAS` e `p_somente_confirmadas`;
    - formata com o teto do papel e `comLinha = linhasDaEmpresa(companyId).length > 0`;
    - dispara `marcar_uso_aprendizados` sem `await`, com `.catch(() => {})`;
    - qualquer exceção ou erro devolve `{ texto: AVISO_FALHA_APRENDIZADOS, falhou: true }`.
  - `registrarAprendizado`: segue a ordem da spec 7.2, passos 1 a 7. Contas da empresa vêm de `meta_ad_accounts`; o teto do dia conta `criado_em >= início do dia em America/Sao_Paulo`; o dedupe usa `aprendizados_parecidos` com o limiar 0.8. O erro do trigger vira `recusado` com a mensagem do banco.
  - `corrigirAprendizado`: resolve o id por prefixo dentro da empresa (`id::text like '<prefixo>%'`), e exige exatamente um vigente.

- [ ] **Step 4: Rodar e ver passar.** Esperado: `ok - aprendizados (consulta, registro, correcao)`.

- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/_shared/aprendizados.ts supabase/functions/_shared/_prova_aprendizados.ts
git commit -m "feat: consultarMemoria, registrarAprendizado e corrigirAprendizado"
```

---

### Task 4: Chat consulta, grava e tem rede de segurança

**Files:**
- Modify: `supabase/functions/_shared/ferramentas_base.ts`: entradas `registrar_aprendizado` e `corrigir_aprendizado`, depois de `registrar_peca_da_conversa`.
- Modify: `supabase/functions/traffic-chat/index.ts`:
  - `MAX_POR_FERRAMENTA` (≈ linha 1001): `registrar_aprendizado: 3`, `corrigir_aprendizado: 2`;
  - `ORDEM_TOOLS` (≈ 6230): acrescentar as duas;
  - `runTool` (≈ 6588): dois `case`;
  - `ctx` (≈ 7867): campo `aprendizado`;
  - injeção do bloco depois de `selecionarMemoria` (≈ 7811), em `cacheSystem` **depois** de `blocoAgentes`;
  - `diagnostico` (≈ 9053): `aprendizados`;
  - rede de segurança depois do insert da resposta (≈ 9104).
- Create: `supabase/functions/_shared/_prova_memoria_no_chat.ts` (prova por leitura de fonte, como as demais `--allow-read`)

**Interfaces:**
- Consumes: `consultarMemoria`, `registrarAprendizado`, `corrigirAprendizado` (Tarefa 3); `sinalDeCorrecao`, `validarPedidoRegistro`, `TurnoAprendizado` (Tarefa 2); `resolverChamadaLlm`, `bodyOpenRouter` (`_shared/llm_roteador.ts`).
- Produces:
  - entradas de `FERRAMENTAS_BASE` com `superficies: ["chat","job"]`, `efeito: "escrita"`, `setor: "Recepcao, voz e entrega"`;
  - `extrairAprendizadosDoTurno(a: { supa: Db; openRouterKey: string; msgGestor: string; resposta: string; turno: TurnoAprendizado }): Promise<ResultadoRegistro[]>`, exportada de `_shared/aprendizados.ts`.

- [ ] **Step 1: Escrever a prova de fonte**, que lê `traffic-chat/index.ts` e `ferramentas_base.ts`:
```ts
assert(/case "registrar_aprendizado":/.test(chat) && /case "corrigir_aprendizado":/.test(chat), "despacho das duas");
assert(!/systemPrompt\([^)]*aprendiz/i.test(chat), "bloco aprendido fora do systemPrompt cacheado");
assert(/cache_control[\s\S]{0,400}blocoAgentes[\s\S]{0,200}blocoAprendizados/.test(chat), "bloco depois do cacheado e do de agentes");
assert(/aprendizado:\s*\{[\s\S]{0,300}falasDoGestor[\s\S]{0,300}retornos:\s*toolResults/.test(chat), "ctx leva falas e retornos");
assert(/sinalDeCorrecao\(/.test(chat) && /waitUntil/.test(chat), "rede de seguranca em segundo plano");
assert(FERRAMENTAS_BASE.registrar_aprendizado.efeito === "escrita" && FERRAMENTAS_BASE.registrar_aprendizado.setor === "Recepcao, voz e entrega", "dono AG-00");
assert(FERRAMENTAS_BASE.registrar_aprendizado.descricao.length <= 600, "descricao curta");
```
  Na Tarefa 3, acrescentar à prova `_prova_aprendizados.ts`:
  - `extrairAprendizadosDoTurno` com o `fetch` do modelo falso devolvendo dois itens, um com trecho literal e outro com paráfrase: grava um e recusa o outro;
  - com o `fetch` lançando erro: devolve `[]` sem lançar.

- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_memoria_no_chat.ts`
Expected: as asserções "despacho das duas" e "dono AG-00" falham.

- [ ] **Step 3: Implementar.**
  - **Descrição de `registrar_aprendizado`** (ASCII, curta). Dizer quando registrar:
    - o gestor corrigiu, ou declarou preferência ou regra;
    - um retorno de ferramenta revelou algo duradouro desta conta que não está na memória;
    - um ato falhou por motivo que vai se repetir.

    Dizer o que não registrar: número do período, palpite, ou o que já está na memória ou na base.

    Exigências: citar a fala exata em `evidencia.trecho`. Quando o gestor contradiz memória curada, `categoria=correcao` e fato começando com `pedido de revisao de curadoria: `.
  - **Parâmetros:** o schema da spec 7.2, com `linha` restrita a `la_felicita|juridico|sistema_ocular`. Os de `corrigir_aprendizado` seguem a spec 7.3.
  - **`ctx.aprendizado`:**
    - `companyId`: `company.id`;
    - `agente`: o primeiro agente do turno fora do núcleo, ou `"AG-00"`;
    - `superficie`: `"chat"`;
    - `conversationId`: `convId`;
    - `jobId`: `null`;
    - `falasDoGestor`: as mensagens `user` de `cronologico` mais `msgText`;
    - `retornos`: a própria referência de `toolResults`;
    - `registrosNoTurno`: `0`.
  - **Bloco:** guardar o texto de `consultarMemoria({ papel: "chat", tarefa: objetivoOriginal })` na variável `blocoAprendizados`. Ela vira `{ type: "text", text: blocoAprendizados }` em `cacheSystem` só quando não está vazia. A consulta corre em paralelo com o que já é aguardado antes de `cacheSystem`.
  - **Rede:** se `sinalDeCorrecao(msgText)` e `toolsUsed` não tem `registrar_aprendizado`, então `EdgeRuntime.waitUntil(extrairAprendizadosDoTurno(...))`. Sem `EdgeRuntime`, não roda.
  - **Extração:** usa `resolverChamadaLlm` com o tipo e o tier mais baratos que o roteador oferece (decisão de quem constrói, registrada no comentário). Pede JSON `{ aprendizados: PedidoRegistro[] }` com no máximo 2 itens e `evidencia.tipo = "fala_do_gestor"`. Cada item passa por `registrarAprendizado`.
  - **Telemetria:** `diagnostico.aprendizados = { consulta: telemetria, registro: [...], rede: { disparou, gravou } }`. O registro sai do `ctx`; o resultado da rede não entra, porque ela termina depois.

- [ ] **Step 4: Rodar e ver passar.** Rodar a prova nova e depois `deno check supabase/functions/traffic-chat/index.ts`. Esperado: `ok - memoria no chat` e nenhum erro de tipo novo.

- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/_shared/ferramentas_base.ts supabase/functions/traffic-chat/index.ts supabase/functions/_shared/aprendizados.ts supabase/functions/_shared/_prova_memoria_no_chat.ts supabase/functions/_shared/_prova_aprendizados.ts
git commit -m "feat: chat consulta e grava memoria aprendida, com rede de seguranca para correcao do gestor"
```

---

### Task 5: Job — subagentes gravam; síntese, relatório, Ritmo e correção de custo consultam

**Files:**
- Modify: `supabase/functions/traffic-agent-job/index.ts`:
  - `SUBAGENTES` (≈ 2785): as duas ferramentas em todos os subagentes, exceto `compliance`, com `maxPorTool` 1 cada e `maxToolsTotal` + 1;
  - `runTool` (≈ 2505): dois `case` e o tipo do `ctx` com `aprendizado?: TurnoAprendizado`;
  - `rodarSubagente` (≈ 3372): consulta `papel: "subagente"` concatenada ao `sys` (≈ 3409), e os retornos do laço empurrados em `ctx.aprendizado.retornos`;
  - os dois chamadores de `montarSysSintese` (≈ 3861 e 3933): bloco `papel: "sintese"` depois do `sys`;
  - o relatório autônomo (≈ 6479): `papel: "relatorio"`;
  - `sintetizarPlanoRitmo` (≈ 6781), via `extraSys` no chamador: `papel: "ritmo"`;
  - telemetria `tel.aprendizados`.
- Modify: `supabase/functions/_shared/correcao_custo_passe.ts:375`: `redigir(..., memoria = "")` concatenado ao system prompt; o chamador (≈ 606) passa `papel: "correcao_custo"`.
- Create: `supabase/functions/_shared/_prova_memoria_no_job.ts` (prova de fonte)

**Interfaces:**
- Consumes: Tarefas 2 e 3.
- Produces: um único `TurnoAprendizado` por job, criado em `processarJob` com:
  - `superficie: "job"`, `jobId`, `conversationId`;
  - `falasDoGestor: [pergunta]`;
  - `retornos: []`;
  - `registrosNoTurno: 0`.

  Ele é compartilhado por todos os subagentes, então o teto de 3 vale para o job inteiro. Cada subagente passa uma cópia rasa com `agente` = código de `agenteDoSubagente`, ou o nome da unidade quando não houver agente, e devolve o contador.

- [ ] **Step 1: Escrever a prova de fonte:**
```ts
for (const [nome, cfg] of Object.entries(SUBAGENTES_DO_FONTE)) {
  const tem = cfg.tools.includes("registrar_aprendizado");
  assert(nome === "compliance" ? !tem : tem, `subagente ${nome}`);
}
assert(/case "registrar_aprendizado":/.test(job) && /case "corrigir_aprendizado":/.test(job), "despacho no job");
assert((job.match(/consultarMemoria\(/g) ?? []).length >= 5, "subagente, sintese x2, relatorio, ritmo");
assert(/nome\s*[!=]==\s*"compliance"[\s\S]{0,200}consultarMemoria\(|consultarMemoria\([\s\S]{0,200}nome\s*[!=]==\s*"compliance"/.test(job), "subagente compliance nao consulta");
assert(/papel:\s*"ritmo"/.test(job) && !/papel:\s*"ritmo"[^}]*somenteConfirmadas:\s*true/.test(job), "ritmo recebe tudo");
assert(/memoria\s*=\s*""/.test(passe) && /papel:\s*"correcao_custo"/.test(passe), "correcao de custo consulta e repassa");
```
  `SUBAGENTES_DO_FONTE` sai de uma extração por regex de `const SUBAGENTES` no texto da fonte (chave → lista `tools`).

- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_memoria_no_job.ts`
Expected: falha em "subagente desempenho_campanhas".

- [ ] **Step 3: Implementar** nos pontos listados em **Files**.
  - Em `rodarSubagente`, pular a consulta quando `nome === "compliance"`.
  - A síntese não ganha ferramenta.
  - A consulta da correção de custo fica no chamador de `redigir`, dentro de `correcao_custo_passe.ts`.

- [ ] **Step 4: Rodar e ver passar.** Rodar a prova nova, depois `_prova_ritmo_executar.ts`, `_prova_correcao_custo.ts` e `_prova_doutrina_agentes.ts`, e por fim `deno check supabase/functions/traffic-agent-job/index.ts`. Esperado: `ok`, as três provas antigas como na linha de base e nenhum erro de tipo novo.

- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/traffic-agent-job/index.ts supabase/functions/_shared/correcao_custo_passe.ts supabase/functions/_shared/_prova_memoria_no_job.ts
git commit -m "feat: job consulta memoria aprendida em subagentes, sintese, relatorio, Ritmo e correcao de custo"
```

---

### Task 6: Edges de passe único consultam; os portões não

**Files:**
- Modify: `supabase/functions/traffic-reco-job/index.ts`: `redigirComLlm`, `sys` antes da ≈ linha 181, com `papel: "reco"`. O `companyId` é o do candidato.
- Modify: `supabase/functions/gerar-legendas/index.ts`: `sys` ≈ 281, com `papel: "legendas"` e `linhaFixa: meio`.
- Modify: `supabase/functions/waba-template-create/index.ts` e `waba-template-replicate/index.ts`: só o `sys` do **redator** (≈ 221 / 224), com `papel: "waba_redator"`. Nada no guardião.
- Create: `supabase/functions/_shared/_prova_memoria_passe_unico.ts` (prova de fonte)

**Interfaces:**
- Consumes: `consultarMemoria` (Tarefa 3).

- [ ] **Step 1: Escrever a prova de fonte:**
```ts
for (const f of ["traffic-reco-job", "gerar-legendas", "waba-template-create", "waba-template-replicate"]) {
  assert(/consultarMemoria\(/.test(fonte(f)), `${f} consulta`);
}
assert(/linhaFixa:\s*meio/.test(fonte("gerar-legendas")), "legendas recorta pela marca");
assert(!/consultarMemoria|aprendizados/.test(fonte("compliance-check")), "compliance-check fora");
for (const f of ["waba-template-create", "waba-template-replicate"]) {
  const guardiao = fonte(f).slice(fonte(f).indexOf("GUARDIÃO A"));
  assert(!/consultarMemoria|blocoAprendizados/.test(guardiao), `${f}: guardiao fora`);
}
```

- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_memoria_passe_unico.ts`
Expected: falha em "traffic-reco-job consulta".

- [ ] **Step 3: Implementar.** Uma consulta por chamada ao modelo, guardada na variável `blocoAprendizados` e concatenada ao fim do `sys`. Com bloco vazio, o `sys` fica idêntico ao de hoje.

- [ ] **Step 4: Rodar e ver passar.** Rodar a prova e `deno check` nas quatro edges. Esperado: `ok - memoria nas edges de passe unico`.

- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/traffic-reco-job/index.ts supabase/functions/gerar-legendas/index.ts supabase/functions/waba-template-create/index.ts supabase/functions/waba-template-replicate/index.ts supabase/functions/_shared/_prova_memoria_passe_unico.ts
git commit -m "feat: reco, legendas e redator WABA consultam memoria aprendida; portoes de conformidade ficam fora"
```

---

### Task 7: Manutenção semanal

**Files:**
- Create: `supabase/migrations/20261017160000_manutencao_da_memoria_aprendida.sql` + espelho
- Modify: `supabase/functions/_shared/_prova_aprendizados.sql` (casos novos)

**Interfaces:**
- Produces: `public.manter_aprendizados() returns jsonb` (`{vencidas, aposentadas_sem_uso, novos_na_semana_por_empresa}`); tarefa `manutencao-da-memoria-aprendida` em `tarefas_agendadas` no mesmo formato da `validade-do-conhecimento` (tipo `sql`, natureza `reativa`, periodicidade `semanal`); `cron.schedule('manutencao-da-memoria-aprendida', '40 10 * * 1', $$select public.rodar_tarefa_sql('manutencao-da-memoria-aprendida')$$)`.

- [ ] **Step 1: Casos na prova SQL:**
  - `valido_ate` de ontem vira `vencida` com `motivo_status` preenchido;
  - um aprendizado com 1 confirmação e `ultimo_uso` (ou `criado_em`) de 181 dias atrás vira `aposentada`, com o motivo "sem uso";
  - outro com 2 confirmações e a mesma idade continua `vigente`;
  - empresa com mais de 10 novos na semana ganha um alerta "Memoria aprendida para revisar", sem duplicar se já houver um aberto nos últimos 6 dias.
- [ ] **Step 2: Rodar via `execute_sql` e ver falhar** com `function public.manter_aprendizados() does not exist`.
- [ ] **Step 3: Escrever a migração.** Nada é apagado.
- [ ] **Step 4: Avisar o gestor, aplicar e rodar a prova.** Esperado: termina sem exceção. Conferir que `select jobname from cron.job where jobname = 'manutencao-da-memoria-aprendida'` devolve uma linha.
- [ ] **Step 5: Commit e push.**
```bash
git add supabase/migrations/20261017160000_manutencao_da_memoria_aprendida.sql supabase/espelhos/20261017160000_manutencao_da_memoria_aprendida.sql supabase/functions/_shared/_prova_aprendizados.sql
git commit -m "feat: manutencao semanal da memoria aprendida (vencidas, sem uso, alerta de revisao)"
```

---

### Task 8: Espelho no Obsidian

**Files:**
- Modify: `supabase/functions/mcp-server/index.ts`: entrada `exportar_memoria` em `TOOLS` (≈ 107) e `case` em `callTool` (≈ 150)
- Create: `supabase/functions/_shared/espelho_obsidian.ts`
- Create: `supabase/functions/_shared/_prova_espelho_obsidian.ts`
- Create: `scripts/espelho_obsidian.ts`
- Create: `docs/espelho-obsidian.md` (como configurar e rodar, com os dois comandos)
- Modify: `.gitignore` (+ `.env.obsidian`)

**Interfaces:**
- Produces:
  - `type ExportMemoria = { gerado_em: string; agentes: { codigo: string; nome: string; setor: string }[]; empresas: { id: string; nome: string; linhas: string[]; aprendizados: Record<string, unknown>[]; memoria_curada: { categoria: string; fato: string; desde: string | null }[] }[]; universal: { categoria: string; fato: string; desde: string | null }[]; conhecimento: { tema: string; descricao: string; conteudo: string; fonte: string; verificado_em: string | null; revalidar_ate: string | null }[] }`. É o retorno de `exportar_memoria({ company_id?: string })`, que respeita o escopo de empresa da chave, se houver.
  - `type ArquivoCofre = { caminho: string; conteudo: string }`
  - `montarCofre(d: ExportMemoria): ArquivoCofre[]`
  - `nomeDeArquivoSeguro(base: string, id: string): string`
  - `arquivosParaRemover(existentes: ArquivoCofre[], novos: ArquivoCofre[]): string[]`
  - Script: `deno run --allow-read --allow-write --allow-net --allow-env scripts/espelho_obsidian.ts [--destino <pasta>]`. Lê `MEMORIA_MCP_URL`, `MEMORIA_MCP_KEY` e `MEMORIA_COFRE` do ambiente ou de `.env.obsidian` na raiz. O destino padrão é `C:\Users\Infosol\Documents\Memoria dos Agentes`.

- [ ] **Step 1: Escrever a prova:**
```ts
const arqs = montarCofre(exportDeExemplo);
assert(arqs.some((a) => a.caminho === "Empresas/COHAPM/Aprendizados/Jurídico/correcao/ab12cd usar conta de luz no hook.md"), "caminho por linha e categoria");
assert(arqs.some((a) => a.caminho.startsWith("Empresas/COHAPM/Aprendizados/Geral/")), "sem linha vai para Geral");
const nota = arqs.find((a) => a.caminho.includes("ab12cd"))!.conteudo;
assert(/^---\n[\s\S]*gerado_por: espelho[\s\S]*\n---\n/.test(nota), "frontmatter marcado");
assert(nota.includes("[[AG-02 Analista]]") && nota.includes("[[correcao]]"), "links para agente e categoria");
assert(/edicao aqui se perde/i.test(nota) && nota.includes("#ab12cd"), "aviso e id para corrigir pelo chat");
assert(arqs.some((a) => a.caminho === "Empresas/COHAPM/Pedidos de revisao de curadoria.md"), "nota de pedidos");
const hostil = nomeDeArquivoSeguro('custo: "alto"? / teste' + "x".repeat(600), "ffee11aa-0000-0000-0000-000000000000");
assert(!/[<>:"/\\|?*]/.test(hostil) && hostil.length <= 90 && hostil.startsWith("ffee11 "), "nome seguro no Windows");
assert(eq(arquivosParaRemover([{ caminho: "x.md", conteudo: "---\ngerado_por: espelho\n---\n" }, { caminho: "minha.md", conteudo: "nota do gestor" }], []), ["x.md"]), "so remove o que gerou");
assert(arqs.some((a) => a.caminho === "_Indice.md") && arqs.some((a) => a.caminho === "Conhecimento/gestor_trafego_meta.md"), "indice e conhecimento");
```
- [ ] **Step 2: Rodar e ver falhar.**
Run: `deno run --no-code-cache --allow-read --allow-env supabase/functions/_shared/_prova_espelho_obsidian.ts`
Expected: erro de import.
- [ ] **Step 3: Implementar.**
  - `montarCofre` gera a estrutura da spec 7.8 mais `Agentes/<codigo> <nome>.md`.
  - O script chama o `mcp-server` no mesmo protocolo que as automações da casa já usam (conferir o roteamento no topo de `mcp-server/index.ts`), escreve o cofre e remove só o que `arquivosParaRemover` apontar.
  - `docs/espelho-obsidian.md` traz:
    - o conteúdo do `.env.obsidian`, com a URL e a chave tirada de `mcp_api_keys`, sem colar valor nenhum no documento;
    - o comando manual;
    - o comando do Agendador de Tarefas do Windows, de hora em hora.
- [ ] **Step 4: Rodar e ver passar.** Esperado: `ok - espelho obsidian`. Depois, `deno check scripts/espelho_obsidian.ts supabase/functions/mcp-server/index.ts`.
- [ ] **Step 5: Commit e push.**
```bash
git checkout -- deno.lock
git add supabase/functions/mcp-server/index.ts supabase/functions/_shared/espelho_obsidian.ts supabase/functions/_shared/_prova_espelho_obsidian.ts scripts/espelho_obsidian.ts docs/espelho-obsidian.md .gitignore
git commit -m "feat: espelho somente-leitura da memoria num cofre do Obsidian"
```

---

### Task 9: Ligar em produção (deploy + registro das ferramentas)

A ordem importa: se o registro entrar antes do deploy, o chat no ar oferece ao modelo ferramentas que ele ainda não sabe executar.

**Files:**
- Create: `supabase/migrations/20261017170000_registra_ferramentas_de_aprendizado.sql` + espelho

**Interfaces:**
- Produces:
  - linhas em `agent_ferramentas` para `registrar_aprendizado` e `corrigir_aprendizado`, com descrição, parâmetros e doutrina iguais aos de `ferramentas_base.ts`, `superficies = array['chat','job']`, `efeito = 'escrita'` e `setor = 'Recepcao, voz e entrega'`;
  - linhas em `agent_unidades` com `('AG-00', 'ferramenta', '<chave>', '<descricao curta>')`, no formato de `20260903170000_ferramentas_por_agente.sql`.

- [ ] **Step 1: Rodar a bateria inteira.** Rodar cada `_shared/_prova_*.ts` com as flags. Esperado: nenhuma falha nova em relação à linha de base de 16/10/2026: 69 ok e 5 falhas antigas (`linha_produto`, `nivel_do_alvo`, `orcamento_reais`, `ritmo_job_sem_card`, `verificacao_pos_resposta`), mais as provas novas passando. Se algo diferir, parar e investigar.
- [ ] **Step 2: Pedir ao gestor o deploy**, com os comandos um por bloco: `traffic-chat`, `traffic-agent-job`, `traffic-reco-job`, `gerar-legendas`, `waba-template-create`, `waba-template-replicate`, `mcp-server`, todos com `--project-ref gzjwnjdpxpbmdhcyefvs`. Só rodar com o "pode rodar" dele e conferir com `supabase functions list`.
- [ ] **Step 3: Escrever a migração de registro e aplicar** (avisando o gestor). Depois rodar `select public.conferir_registro_de_ferramentas()`. Esperado: `"ok": true` e `escrita_com_dono_de_outro_setor` vazio.
- [ ] **Step 4: Teste de fumaça no chat**, numa conversa de teste da COHAPM:
  1. "a partir de agora, me mostre custo por conversa antes do CPL";
  2. conferir uma linha nova em `agent_aprendizados` com `confianca = 'confirmada'`, a fala na evidência e `diagnostico.aprendizados.registro[0].resultado = 'gravado'`;
  3. abrir uma conversa nova, perguntar "como está o custo do Jurídico?" e conferir `diagnostico.aprendizados.consulta.injetados >= 1`;
  4. pedir "esquece o aprendizado #<id>" e conferir `status = 'aposentada'`;
  5. limpar as linhas de teste com `status = 'aposentada'` e o motivo "teste de fumaca".
- [ ] **Step 5: Commit e push** da migração e do espelho.
```bash
git add supabase/migrations/20261017170000_registra_ferramentas_de_aprendizado.sql supabase/espelhos/20261017170000_registra_ferramentas_de_aprendizado.sql
git commit -m "feat: registra registrar_aprendizado e corrigir_aprendizado no AG-00"
```

---

### Task 10 (opcional, depois da Tarefa 9): Busca semântica

Só começa se o gestor autorizar o deploy de uma edge de sonda.

- [ ] **Step 1: Sonda.**
  - Criar `supabase/functions/tmp-sonda-embedding/index.ts`, que roda `new Supabase.ai.Session("gte-small")` com `{ mean_pool: true, normalize: true }` sobre 6 pares de frases em pt-BR, 3 de mesmo sentido e 3 de sentido diferente, e devolve as similaridades.
  - Aceitar a sonda se o menor par de mesmo sentido for maior que o maior par de sentido diferente.
- [ ] **Step 2: Se a sonda for aceita:**
  - migração com `vector`, coluna `embedding vector(384)` e índice HNSW por cosseno;
  - `consultar_aprendizados` ganha `p_embedding vector(384) default null` como terceira perna do RRF;
  - `registrarAprendizado` calcula o embedding de `fato + contexto`, e se falhar grava nulo;
  - `consultarMemoria` calcula o embedding da tarefa, e se falhar segue só com a busca textual;
  - provas: o embedding falhando não muda o resultado das provas da Tarefa 3.
- [ ] **Step 3: Se a sonda for recusada:** registrar o resultado em `docs/superpowers/specs/2026-10-17-memoria-aprendida-dos-agentes-design.md` (seção 7.5) e apagar a edge de sonda. A v1 fica só com a busca textual.
- [ ] **Step 4: Commit e push.**
