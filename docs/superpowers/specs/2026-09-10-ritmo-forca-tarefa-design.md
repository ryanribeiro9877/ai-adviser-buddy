# Ritmo — força-tarefa autônoma de campanha

**Data:** 2026-09-10
**Regra de ouro:** banco/tela valida, relatório não. Número sem período, nível e janela de atribuição não entra no plano.

## Objetivo

Dar ao gestor uma aba para **ditar o ritmo** de uma campanha ativa: dissertar o que quer (conversas, cliques no link, alcance, etc.), opcionalmente um número-sonho, definir prazo e um extra de investimento. Os agentes analisam com a doutrina já existente, emitem plano + projeções honestas (3, 7, 15, 30 dias) e, depois de **uma** autorização, executam sozinhos nesta campanha — **sem card por ato** — até o prazo, o sonho, o teto ou o encerramento humano.

Fora desta missão, o restante do produto continua com card. Esta é uma **exceção nomeada**, não um interruptor escondido.

## Por que existe

O chat Operação já analisa e o card já executa. Faltava um **rito**: missão com prazo, métrica, envelope de dinheiro e autonomia concedida de uma vez. Pedir “aumenta as conversas dessa campanha” no chat hoje ou vira conversa ou vira dezenas de cards. A força-tarefa é o objeto que segura esse contrato.

## Decisões aprovadas (2026-09-10)

1. Aba própria **Ritmo** (não é quarta aba de Operação, nem botão em Campanhas).
2. Missão viva no prazo, não um plano de uso único.
3. Autonomia: os atos da missão **não** passam por `approval_requests`. A autorização humana é o clique **Autorizar missão**.
4. Envelope: extra além do ritmo atual de gasto da campanha. Extra omitido = R$ 0 (otimiza sem gastar mais que o ritmo).
5. Uma campanha por missão. Uma missão `em_execucao` por campanha.
6. Dois tempos: análise (nada na Meta) → um autorizar → execução.
7. Métrica por seletor + dissertação obrigatória + sonho opcional na métrica escolhida.
8. Fim: prazo, sonho atingido, teto da janela ou Encerrar agora. O que mudou **fica**.
9. Visualizador lê. Só administrador cria, autoriza e encerra.

## Doutrina que NÃO se suspende

A missão não fura:

- compliance / ramo / linha de produto
- conta em quarentena, não operacional, ou de outra empresa
- `master_enabled` desligado
- dry-run (ato corre em simulação e a UI declara; não escreve de verdade)
- rate limit e flags por tipo de ação da empresa
- dado honesto (lacuna declarada, sem média de mercado inventada)
- exclusão de objeto na Meta
- comentário de post como ato de anúncio
- CRM / esteira / outra plataforma de mídia

O que se suspende, **somente** com concessão válida: a exigência de card por ato.

Não existe flag genérica `skip_approval` em query string. A escrita sem card só passa se uma RPC de concessão (`pode_executar_ato_ritmo`) autenticar: missão `em_execucao`, empresa e campanha do ato iguais às da missão, agora dentro do prazo, teto não estourado, trava da casa ok.

## Ciclo de vida

```
em_analise → plano_pronto → em_execucao → encerrada
                 ↘ analise_falhou (retry de análise)
plano_pronto → encerrada (descartada, nunca autorizada)
```

Motivos de `encerrada`: `prazo` | `sonho` | `teto` | `humano` | `trava` | `descartada`.

- Enviar o formulário cria a missão em `em_analise` e dispara o job fundo.
- Plano pronto: leitura, possibilidades, plano, projeções. Meta intacta.
- Autorizar (admin): grava quem/quando, congela baseline e teto já calculados na análise, dispara o primeiro passe na hora. Recusa se o prazo já acabou, se já existe outra `em_execucao` na mesma campanha, se `master_enabled` está desligado, ou se a campanha não está entregando de verdade.
- Encerrar agora = mesmo efeito de bater o prazo: para de executar, mudanças ficam.
- Início futuro: status `em_execucao` só no primeiro tique em que a data local (`America/Sao_Paulo`) ≥ `periodo_inicio`. Até lá, concessão existe mas o executor não escreve.

## Formulário (nova força-tarefa)

| Campo | Obrigatório | Regra |
|---|---|---|
| Campanha | sim | Uma, da lista de ativas da empresa. Status **real** de entrega (`effective_status`), não só o espelho. Lista ao vivo via Pipeboard; se falhar, espelho local **e** a UI declara a fonte. |
| Prazo | sim | `periodo_inicio` e `periodo_fim` (datas civis Brasília). Mínimo 1 dia, máximo 90. Início padrão = hoje. |
| Métrica-alvo | sim | Seletor (abaixo). |
| Dissertação | sim | Texto livre. Os agentes interpretam o “como/porquê”; a métrica do seletor é a base das projeções. |
| Número-sonho | não | Número > 0 na unidade da métrica (quantidade inteira ou % no CTR). O campo mostra a unidade. Sempre exibido no plano se preenchido, nunca como previsão. |
| Extra de investimento | não | R$ ≥ 0. Vazio = 0. Soma-se ao ritmo atual para formar o teto da janela. |

### Métricas do seletor

Só o que o produto já mede, sem misturar bases e sem “clique” sem adjetivo:

- `conversas` — `messaging_started`
- `cliques_no_link` — `link_clicks`
- `formularios` — `form_leads`
- `alcance` — reach
- `impressoes` — impressions
- `ctr` — cliques (todos) / impressões
- `ctr_link` — cliques no link / impressões

Não entra “leads” genérico nem formulários+conversas somados.

### Como o sonho encerra a missão

- Volume (`conversas`, `cliques_no_link`, `formularios`, `alcance`, `impressoes`): acumulado desde a data civil Brasília de `max(periodo_inicio, data da concessão)` ≥ sonho.
- Taxa (`ctr`, `ctr_link`): valor nos **últimos 3 dias com entrega** ≥ sonho. Sem 3 dias com entrega, não declara “bateu o sonho”.

## Envelope de dinheiro

**Ritmo atual (baseline), congelado na análise:**

média do gasto diário da campanha nos últimos 7 dias civis com gasto > 0, imediatamente antes de `periodo_inicio` (se o início for hoje/futuro) ou antes da data da análise (se o início já passou). Fórmula visível no plano: dias usados, soma, média.

- < 3 dias com gasto: `confianca = baixa`. Análise segue; autorizar continua permitido, com o aviso no plano.
- 0 dias com gasto: baseline = 0; teto = extra. A análise declara que não há ritmo para projetar.

**Teto da janela:**

`teto = baseline_diario × n_dias_do_prazo + extra`

`n_dias_do_prazo` = inclusive (`periodo_fim - periodo_inicio + 1`).

**Gasto que consome o teto:** spend da **campanha escolhida** com `date` em `[periodo_inicio, periodo_fim]` (série diária já coletada). Não mistura outras campanhas. Não usa “orçamento configurado” como proxy de gasto.

Ato que aumentaria gasto projetado além do teto **não sai**. Teto atingido encerra com motivo `teto`.

Escala de orçamento é gradual: o plano não despeja o extra no dia 1. O executor recusa um salto que a doutrina de learning vetaria mesmo com teto sobrando (edição significativa agrupada; espera janela de leitura).

## Entregável da análise

Job fundo, mesmos especialistas de hoje (Analista, Estúdio, Guardião, Mensageiro, Sentinela, Bibliotecário). O job profundo **continua sem** `propose_action` — o Executor só **desenha** atos no JSON do plano. Prova existente que o job é somente leitura permanece.

Três blocos na tela:

1. **Leitura** — status real, gasto, métrica-alvo, funil que a produz, learning, criativos, tetos da empresa, compliance do ramo. Cada cifra com período, nível (campanha/conjunto/anúncio) e janela de atribuição. Buraco = lacuna, não zero.
2. **Possibilidades** — sempre três séries nos horizontes 3, 7, 15, 30 dias:
   - se nada mudar
   - se executar o plano (premissas declaradas)
   - máximo que o envelope permite (teto de volume, não de qualidade)
   
   Sonho, se houver, é quarta série rotulada **“sonho (não é previsão)”**. Se o sonho > máximo honesto no horizonte do prazo, o plano diz isso em destaque. Amostra pequena → intervalo largo ou `nao_projetavel`, nunca decimal fingido. Sem média de mercado.
3. **Plano** — atos ordenados, cada um com evidência, mecanismo, mudança, métrica de sucesso, janela de leitura, reversa. Uma alavanca por leitura, salvo entrega parada (status/rejeição). Guardião barra copy/peça antes do ato existir no plano. Recusas e lacunas listadas.

Horizontes 15 e 30 aparecem mesmo se o prazo for menor, com rótulo **“se o ritmo novo se manter depois do prazo”**.

Contrato JSON do plano (campos estáveis; a UI não parseia prosa):

```json
{
  "leitura": {},
  "baseline": {
    "gasto_diario": 0,
    "janela": "7d_com_gasto",
    "dias_usados": 0,
    "confianca": "alta"
  },
  "teto_janela": 0,
  "possibilidades": {
    "nada_muda": { "d3": null, "d7": null, "d15": null, "d30": null },
    "plano": { "d3": null, "d7": null, "d15": null, "d30": null },
    "maximo_envelope": { "d3": null, "d7": null, "d15": null, "d30": null }
  },
  "sonho": { "valor": null, "atingivel_no_prazo": null, "nota": null },
  "atos": [],
  "recusas": [],
  "lacunas": [],
  "premissas": []
}
```

Cada ato em `atos[]` leva `acao` do catálogo já usado em `propose_action` / `meta-actions` (pausar_conjunto, alterar orçamento, criar_anuncio, etc.), `alvo` com `external_id` da Meta, e os campos de justificativa. Sem ID da Meta, o ato não é executável.

## Execução autônoma

Concessão = linha da missão em `em_execucao` + `autonomia_concedida_em` not null.

**Pode (nessa campanha, sem card):** pausar/ativar conjunto ou anúncio; alterar orçamento de campanha ou conjunto (CBO vs ABO no nível certo); criar anúncio a partir do acervo; duplicar para escala; geo e posicionamentos; upload de mídia pré-requisito; vincular Instagram oficial da linha.

**Não pode:** outra campanha; criar campanha nova; outra empresa; apagar objeto; furar Guardião; estourar teto.

### Loop

Um cron único do sistema (não um cron por missão), no catálogo de Tarefas, no mesmo padrão dos relatórios autônomos.

| Tique | Quando | O que faz |
|---|---|---|
| Primeiro passe | Imediato ao autorizar | Executa só os atos com `quando=imediato`. No máximo **uma** edição significativa (a que reseta learning) neste passe; o resto espera o tique fundo. |
| Leve | Cron frequente (~2 h) | Entrega real, gasto vs teto, métrica vs sonho, rejeição. Encerra se bateu condição. Não inventa ato novo. Retry de ato reexecutável falho. |
| Fundo | 1× ao dia | Relê (job profundo, ainda sem `propose_action`), compara com projeção, avança o plano ou grava **replano** (novo JSON + atos pendentes). Desvio só com evidência nova, ainda preso à dissertação, métrica e envelope. |

Falha na Meta: visível no histórico da missão (`ritmo_atos`). Retry só se o executor já classifica como reexecutável. Rejeição de política: aquele ato morre; o resto segue ou o tique fundo replaneja. Não insiste no mesmo criativo.

## Dados

Três tabelas, RLS por empresa (membro lê; admin cria/autoriza/encerra via RPC; edge `service_role` atualiza plano e atos). Espelho em `supabase/espelhos/` na mesma entrega. Realtime em `ritmo_missoes` e `ritmo_atos` para a UI acompanhar.

**`ritmo_missoes`** — um pedido/plano/concessão. Campos mínimos: `company_id`, `campaign_id` (ID Meta), `campaign_name`, `ad_account_id`, `status`, `periodo_inicio`, `periodo_fim`, `metrica`, `dissertacao`, `sonho` (numeric null), `extra_investimento` (numeric ≥ 0), `baseline_gasto_diario`, `baseline_json`, `teto_gasto_janela`, `plano_json`, `leitura_json`, `projecoes_json`, `confianca_baseline`, `fonte_campanhas` (`ao_vivo`|`espelho`), `autonomia_concedida_em/por`, `encerrada_em/por/motivo`, `job_id`, `criado_por`, timestamps.

Índice único parcial: uma `em_execucao` por `(company_id, campaign_id)`.

**`ritmo_atos`** — cada tentativa de escrita (e cada bloqueio). `missao_id`, `company_id`, `tique` (`primeiro_passe`|`leve`|`fundo`), `acao`, `alvo_external_id`, `payload`, justificativa (evidência/mecanismo/sucesso/janela/reversa), `resultado` (`pendente`|`executando`|`ok`|`bloqueado`|`falhou`|`simulado`), resposta Meta, `replano` boolean. **Sem** `approval_request_id`.

Duas tabelas só. Tique leve sem ato (encerrou por sonho/teto, nada a escrever) vira um `ritmo_atos` de resultado `ok` com `acao = verificar_parada` — não uma terceira tabela.

RPCs (nomes estáveis, `search_path` fixo, grants no padrão dos relatórios):

- `enfileirar_ritmo_analise(...)` — admin, cria missão `em_analise`
- `autorizar_ritmo_missao(id)` — admin, transita `plano_pronto` → `em_execucao` ou recusa com motivo
- `encerrar_ritmo_missao(id, motivo)` — admin ou executor (service) nos motivos automáticos
- `pode_executar_ato_ritmo(missao_id, company_id, campaign_id, acao)` — service_role; é o portão da escrita sem card
- `claim` do tique / listar missões devidas ao cron

`logAudit` em: criar, autorizar, encerrar, cada ato ok/falhou/bloqueado (`ritmo.analise`, `ritmo.autorizar`, `ritmo.encerrar`, `ritmo.ato`).

A fila de Aprovações **não** lista esses atos. O sino agrega: plano pronto, teto ≥ 80%, falha Meta, missão encerrada. Estender `get_notificacoes_pendentes` (não criar um sino paralelo).

## Tela

Rota `/ritmo`, item de menu **Ritmo** imediatamente após **Campanhas** (ícone `Gauge`). Empresa = seletor do topo.

**Lista:** missões da empresa, mais recentes primeiro. Colunas: status, campanha, métrica, prazo, extra, sonho vs realizado (se houver sonho), gasto da janela vs teto. CTA **Nova força-tarefa**. Falha de carga ≠ lista vazia.

**Nova:** formulário acima. Enviar → vai ao detalhe em `em_analise` (progresso, mesmo espírito do job profundo no chat).

**Detalhe:** os três blocos da análise; tabela 3/7/15/30; histórico de atos (o que tentou, o que a Meta disse); botões Autorizar / Encerrar / Tentar análise de novo conforme o estado. Realizado vs projeção atualiza com a série diária já coletada — a tela não chama Graph.

Testes de rota no padrão das outras telas autenticadas (`createFileRoute` mockado). `app-shell.test.tsx` passa a exigir o rótulo **Ritmo** na lista do menu.

## Edges e reuso

- **Análise e tique fundo:** estender `traffic-agent-job` com modos `ritmo_analise` e `ritmo_replano` (igual `relatorio_dispatcher`). Não copiar o job. Continua sem `propose_action`.
- **Tique leve + escrita:** edge nova `ritmo-executar`. O cron e o clique Autorizar chamam só ela. Ela lê a concessão via RPC e dispara `meta-actions` com `origem=ritmo`. Não há segundo jeito de furar o card.
- **`meta-actions`:** novo caminho de entrada `origem=ritmo` + `ritmo_ato_id`. Portão = `pode_executar_ato_ritmo`. Falha fechada se a RPC negar. Não cria `approval_requests`. Dry-run e flags da empresa permanecem.
- Lista ao vivo de campanhas: reusar o caminho Pipeboard já usado em Relatórios.

Catalogo de agentes / prompt do Executor: a frase “sempre via card” ganha exceção explícita **missão Ritmo com concessão válida**. Fora isso, card. Atualizar `docs/visao-do-produto.md` (nova seção 5.x, hierarquia, mapa de telas) na mesma entrega de código.

## O que não entra nesta entrega

- Várias campanhas numa missão
- Reverter mudanças ao encerrar
- Autonomia em qualquer outra tela ou auto-aprovar a fila antiga
- Google Ads / CRM / apagar objeto
- Número-sonho obrigatório
- Teto como orçamento diário da Meta (a conta é gasto da janela)
- Companion/chat embutido na aba (o detalhe é o plano, não o fio)

## Ordem de construção

A implementação (plano seguinte) parte em dois blocos, um spec só:

1. **Superfície + análise** — tabelas, aba, formulário, job `ritmo_analise`, plano e projeções na tela. Zero escrita na Meta. Dá para usar e recusar o plano.
2. **Concessão + executor** — autorizar, RPC do portão, `meta-actions` origem ritmo, cron leve/fundo, paradas, sino, prompt do Executor, visao-do-produto.

O bloco 2 não começa sem as provas do portão (abaixo) verdes.

## Provas (aceite)

Determinístico (lib + SQL + `_prova` de edge), não número congelado de produção:

1. `teto = baseline × dias + extra` com fixture de série diária (dias zerados não entram na média).
2. < 3 dias com gasto → `confianca` baixa; 0 dias → baseline 0, teto = extra.
3. Ato com `campaign_id` diferente da missão → RPC nega; `meta-actions` não escreve.
4. Missão não `em_execucao` / prazo vencido / teto já atingido → RPC nega.
5. `propose_action` continua ausente do job profundo; análise de ritmo **não** insere em `approval_requests`.
6. Autorizar + ato ok **não** cria linha em `approval_requests`.
7. Guardião recusando copy → ato de criar anúncio não fica executável no plano.
8. Visualizador: SELECT ok; `autorizar` / `enfileirar` falham.
9. Isolamento: missão da empresa A invisível na B.
10. Sonho de volume: acumulado da janela de execução ≥ sonho encerra `sonho`. CTR: sem 3 dias com entrega, não encerra.
11. Extra 0: ato de subir orçamento que aumentaria gasto acima do ritmo projetado é bloqueado.
12. Paridade migration/espelho no teste que já existe.

## Fora de escopo de teste de UI no browser desta spec

A spec não substitui o plano de implementação. A entrega de código do bloco 2 verifica no painel: criar missão, ver plano, autorizar (conta de staging / dry-run), ver ato no histórico **sem** aparecer em Aprovações, encerrar.
