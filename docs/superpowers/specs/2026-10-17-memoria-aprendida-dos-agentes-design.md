# Memória aprendida dos agentes — desenho

Data: 17/10/2026. Status: rascunho para aprovação.

## 1. Intenção

Pedido do gestor: todo agente consulta uma memória comum antes de executar uma tarefa e, quando aprende algo novo e útil que ainda não está lá, grava sozinho o que aprendeu e o contexto do aprendizado, para a memória se manter atualizada.

Por quê (palpite meu, o gestor não descreveu o caso): evitar que ele precise repetir correções e preferências, e que um agente erre de novo algo que outro agente já descobriu na mesma conta.

Decidido com o gestor:
- O motor da memória fica no banco atual (Supabase). Nada de plataforma externa: os dados não saem do Supabase e o isolamento entre empresas continua garantido pelo banco.
- O Obsidian entra como espelho de leitura: o banco é a fonte e uma rotina exporta tudo para um cofre de notas `.md` que o gestor abre no Obsidian.
- Quem grava são os próprios agentes, sem aprovação prévia.
- Dentro de uma empresa com várias linhas de negócio (hoje a COHAPM: La Felicità, Jurídico, Sistema Ocular), o aprendizado é separado por linha. O que não é de linha nenhuma vale para a empresa toda (ver 7.6).
- O Ritmo, que executa atos na Meta sem card, recebe toda a memória aprendida, e não só o que o gestor confirmou.

## 2. Situação de hoje (levantada no código e no banco em 17/10/2026)

| Fonte | O que é | Quem grava | Quem lê |
|---|---|---|---|
| `agent_knowledge` (28 temas) | Método técnico com validade | Só migração | Índice no prompt do chat; conteúdo via `get_conhecimento`; recortes por papel via `_shared/doutrina_agentes.ts` em chat, job, reco, compliance, legendas |
| `agent_context` (162 fatos vigentes, ~124 mil chars) | Memória institucional curada, por empresa ou universal | Só migração | Chat (turno) e síntese do `traffic-agent-job`, estreitada por `_shared/memoria_relevante.ts` |
| `agent_style` (14 regras) | Forma de escrever | Só migração | Chat e job |

Nenhuma edge grava em `agent_context` ou `agent_knowledge`. Os subagentes do job (desempenho, criativos, estrutura, compliance, WhatsApp, sentinela), o `traffic-reco-job`, o `compliance-check`, o `gerar-legendas` e os dois `waba-template-*` não recebem `agent_context`.

Extensões disponíveis no Postgres do projeto e ainda não instaladas: `vector` 0.8.2, `pg_trgm` 1.6, `unaccent` 1.1. `pg_cron` e `pg_net` já estão ativas.

## 3. Objetivos

1. **Consultar antes de agir.** Toda edge que chama o modelo para redigir, analisar ou decidir recebe, antes da tarefa, os aprendizados relevantes para aquela tarefa e aquela empresa: `traffic-chat` (cada turno), `traffic-agent-job` (síntese, cada subagente, relatório, os modos `ritmo_analise` e `ritmo_replano` — incluindo `sintetizarPlanoRitmo`, que decide os atos — e o passe de correção de custo em `_shared/correcao_custo_passe.ts`), `traffic-reco-job`, `gerar-legendas` e o redator de `waba-template-create`/`waba-template-replicate`. Ficam de fora os portões de conformidade: o `compliance-check` e o guardião dos templates WABA (ver 7.0).
2. **Gravar sozinho.** As superfícies com laço de ferramentas (chat e job) ganham duas ferramentas: `registrar_aprendizado` e `corrigir_aprendizado`.
3. **Contexto completo do aprendizado.** Cada registro guarda o que foi aprendido, por que importa, a evidência (fala do gestor ou retorno de ferramenta, com trecho), o agente, a conversa, a empresa e a data.
4. **Memória que se corrige.** Fato repetido reforça o existente em vez de duplicar. Fato que mudou substitui o antigo, e o histórico fica guardado. Quando o gestor diz que algo está errado, o agente aposenta o registro.
5. **Espelho no Obsidian.** Um cofre de notas geradas a partir do banco, com links entre aprendizado, agente, categoria e empresa.

## 4. Não-objetivos

- Não substituir `agent_knowledge` (doutrina técnica curada) nem `agent_style`.
- Não mexer em como `agent_context` é escolhida e injetada hoje (`memoria_relevante.ts` foi medida e ajustada; ver o cabeçalho do módulo).
- Não guardar número de desempenho do período (CPL de ontem, gasto de hoje). Isso é dado, e dado se lê fresco.
- Não editar a memória pelo Obsidian na v1. O espelho é só de leitura.
- Não criar tela de memória no front na v1.
- O agente não promove sozinho um aprendizado para `agent_context`. Promover continua sendo curadoria humana por migração.

## 5. Anti-objetivos (fracasso mesmo que funcione)

- Um fato de uma empresa aparecer para outra.
- Um palpite do modelo, sem dado nem fala do gestor por trás, virar memória permanente.
- A memória inchar o prompt e levar o chat ao limite de 150 s (já vimos 504 nesse limite).
- Uma falha na memória derrubar ou atrasar o turno.
- Um registro por turno: memória cheia de ruído e vazia de valor.
- A memória aprendida contradizer um dado fresco e vencer. O dado fresco sempre vence.

## 6. Restrições do projeto

- Supabase Postgres + edges Deno; textos ao gestor em pt-BR.
- Isolamento por empresa: `company_id` vem sempre do turno, nunca de argumento do modelo; trava no banco no mesmo padrão de `guard_agent_context_global_empresa`; filtro no código no padrão de `filtrarMemoriaPorEmpresa` (`_shared/agent_memory.ts`).
- Prompt caching do chat: o bloco com `cache_control` precisa ser idêntico entre turnos. A memória aprendida muda a cada pergunta, então entra fora do bloco cacheado, junto do bloco de agentes.
- Registro de ferramentas: `public.agent_ferramentas` + fallback `_shared/ferramentas_base.ts` (descrição curta, parâmetros, doutrina, `efeito`, `setor`). As duas ferramentas novas são `efeito: "escrita"`, com dono e setor do AG-00 (ver 7.2).
- Migração em `supabase/migrations` com espelho em `supabase/espelhos`.
- Provas no padrão `_shared/_prova_*.ts`, rodadas com `deno run --no-code-cache --allow-read --allow-env`.
- Deploy de edge só quando o gestor pedir explicitamente.

## 7. Desenho

### 7.0 Precedência (vale para todo bloco, prompt e handler)

Ordem de quem vence, da mais forte para a mais fraca:

1. Dado fresco do turno (retorno de ferramenta, leitura da Meta).
2. Regras de conformidade e travas: `compliance_rules`, `promessas_proibidas`, tetos, `meta_execution_config` e as travas do código.
3. Memória curada: `agent_context` e `agent_knowledge`.
4. Memória aprendida: `agent_aprendizados`.

Consequências:
- A memória aprendida nunca afrouxa um portão. Por isso o `compliance-check` e o guardião dos templates WABA não a recebem.
- Quando o gestor contradiz um fato curado ou uma regra de conformidade, o agente diz que aquilo é curado e que a mudança passa por curadoria, e registra o aprendizado com categoria `correcao` e o texto "pedido de revisão de curadoria: …". Esse registro não substitui o curado no prompt: o cabeçalho do bloco diz que a memória curada vence. O espelho do Obsidian lista esses pedidos numa nota própria, para o gestor levar à curadoria.

### 7.1 Onde mora: tabela nova `public.agent_aprendizados`

Fica separada de `agent_context` porque o ciclo de vida é outro (reforço, substituição, uso) e para não perturbar a injeção curada que já foi medida.

`consultarMemoria` (7.5) cobre só `agent_aprendizados`. A memória curada continua chegando como hoje (chat e síntese do job, via `carregarMemoriaInstitucional` + `selecionarMemoria`), e na v1 não é estendida às edges que hoje não a recebem. Os dois blocos convivem no mesmo prompt, cada um com seu cabeçalho. Levar a memória curada a todas as edges é trabalho separado, porque exige uma seleção com teto que `selecionarMemoria` não tem (quando falha, ela injeta tudo).

Colunas:

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid pk | |
| `company_id` | uuid not null → `companies` | Aprendizado é sempre de uma empresa (ver 7.6) |
| `linha` | text null | Linha de negócio dentro da empresa (`la_felicita`, `juridico`, `sistema_ocular`); nulo = vale para a empresa toda (ver 7.6) |
| `categoria` | text check | `preferencia_do_gestor`, `correcao`, `fato_da_conta`, `armadilha`, `processo` |
| `fato` | text, 20–600 chars | O aprendizado em uma frase autossuficiente |
| `contexto` | text, até 1.500 chars | Situação em que foi aprendido e por que importa |
| `evidencias` | jsonb array, ≥ 1 item | `{tipo: "fala_do_gestor" \| "retorno_de_ferramenta" \| "resultado_de_ato", ferramenta?, trecho, mensagem_id?, job_id?, em}` |
| `agente_codigo` | text | AG-00…AG-08, ou papel do job |
| `superficie` | text check | `chat`, `job`, `curadoria` |
| `conversation_id` | uuid null | |
| `confianca` | text check | `confirmada` (o gestor afirmou), `observada` (veio de dado) |
| `status` | text check | `vigente`, `substituida`, `aposentada`, `vencida` |
| `substitui_id` / `substituida_por` | uuid null → self | Histórico de mudança |
| `motivo_status` | text null | Obrigatório quando sai de `vigente` |
| `confirmacoes` | int default 1 | Sobe quando o mesmo fato é registrado de novo |
| `usos`, `ultimo_uso` | int, timestamptz | Sobe quando entra num prompt |
| `valido_ate` | date null | Para fato com prazo |
| `chave_normalizada` | text | Fato normalizado (minúsculo, sem acento, sem pontuação) para dedupe exato; unique parcial por `company_id` entre vigentes |
| `busca` | tsvector | Busca textual em português sobre `fato + contexto` |
| `embedding` | vector(384) null | Busca semântica (ver 7.5) |
| `criado_em`, `atualizado_em` | timestamptz | |

Trava no banco (trigger, no padrão de `guard_agent_context_global_empresa`): recusa fato ou contexto que cite `act_` de conta que não é da empresa, ou marca de outra empresa (os mesmos padrões de `MARCA_LEGAL`/`MARCA_COHAPM` de `agent_memory.ts`). Recusa também registro com `linha` preenchida cujo fato ou contexto cite outra linha da mesma empresa. RLS: leitura para membros da empresa, escrita só via service role (as edges).

### 7.2 Gravar: `registrar_aprendizado`

Parâmetros que o modelo envia: `fato`, `contexto`, `categoria`, `evidencia {tipo, trecho, ferramenta?}`, `confianca`, `valido_ate?`. A empresa, o agente, a superfície, a conversa e o job vêm do turno.

O handler (módulo novo `_shared/aprendizados.ts`, usado por chat e job) faz nesta ordem:

1. **Forma e evidência conferida:** tamanhos, categoria válida e evidência com trecho não vazio. O trecho é conferido contra o texto real:
   - `fala_do_gestor`: o trecho, normalizado (minúsculo, sem acento, espaços colapsados), precisa aparecer dentro de uma mensagem `role: "user"` desta conversa. No job, vale a pergunta do pedido. A descrição da ferramenta manda citar literalmente; paráfrase é recusada com o motivo "cite a fala exata".
   - `retorno_de_ferramenta` / `resultado_de_ato`: a ferramenta citada precisa ter rodado neste turno ou job, e o trecho normalizado precisa aparecer no retorno serializado dela.
   - `confianca: "confirmada"` só com `fala_do_gestor` conferida. O resto é `observada`.

   O handler recebe do chamador as mensagens do gestor e os retornos de ferramenta do turno.
2. **Não é dado volátil:** recusa fato que é número de desempenho do período (custo, CPL, CTR, gasto, resultado acompanhado de "hoje", "ontem", "esta semana", data, ou janela). A recusa responde ao modelo: "isso é dado, não memória".
3. **Isolamento:** o mesmo teste do trigger, rodado antes para devolver um motivo legível. O trigger é a rede final.
4. **Linha:** o servidor classifica `fato + contexto` com o classificador de linha que já existe (`linhasProdutoNoTexto` / `classificarLinhaProdutoCohapm` em `_shared/memoria_conjunto.ts`).
   - Uma linha encontrada: o registro fica com essa linha. Se o modelo mandou outra no parâmetro opcional `linha`, recusa por divergência.
   - Mais de uma: recusa com o motivo "registre um aprendizado por linha".
   - Nenhuma: vale o parâmetro `linha` do modelo, que é a linha da conversa ou vazio quando o aprendizado vale para a empresa toda, validado contra a lista de linhas da empresa.
   - Empresa sem linhas cadastradas: `linha` fica sempre nula.
5. **Já sabia?** Busca entre os vigentes da empresa: mesma `chave_normalizada` ou similaridade alta (limiar a calibrar nas provas). Se achar, soma 1 em `confirmacoes`, anexa a evidência e responde `ja_registrado` com o id. Não cria linha nova.
6. **Teto:** no máximo 3 registros por turno do chat ou por job, e 30 por empresa por dia. Passou do teto, recusa com motivo.
7. **Grava** como `vigente` e devolve o id curto.

**Onde as ferramentas aparecem.**
- **Chat:** `registrar_aprendizado` e `corrigir_aprendizado` têm o AG-00 como dono e o setor do AG-00, e não o AG-08. Assim entram em todo turno pelo `NUCLEO_SEMPRE`, inclusive quando o gestor corrige uma análise do AG-02 ou um card do AG-06, e passam pela conferência `escrita_com_dono_de_outro_setor` sem exceção.
- **Job:** entram na lista de ferramentas de cada subagente em `SUBAGENTES`, com `maxPorTool` 1 para cada uma e `maxToolsTotal` + 1, para não comer o orçamento de leitura. A síntese não chama ferramenta e não grava.

O que entra na descrição da ferramenta (curta): registre quando o gestor corrigir você ou declarar preferência ou regra; quando um retorno de ferramenta revelar algo duradouro desta conta que não está na memória; quando um ato falhar por um motivo que vai se repetir. Não registre número do período, palpite, nem o que já está na memória ou na base técnica.

### 7.3 Corrigir: `corrigir_aprendizado`

Parâmetros: `id`, `acao: "substituir" | "aposentar"`, `motivo`, `evidencia`, e `novo_fato`/`novo_contexto` quando for substituir. Substituir cria a linha nova com `substitui_id` e marca a antiga como `substituida`. Aposentar marca como `aposentada`. O id só é aceito se o registro for da empresa do turno.

Caso principal: o gestor diz "isso não vale mais" ou "esquece o #ab12" e o agente aposenta o registro.

### 7.4 Rede de segurança no chat

Na v1, o modelo depende de lembrar de chamar a ferramenta. Para a correção do gestor não se perder: se a mensagem do gestor tiver sinal de correção ou preferência ("não é assim", "errado", "sempre", "nunca", "prefiro", "a partir de agora", "lembre") e o turno terminar sem `registrar_aprendizado`, roda depois da resposta (`EdgeRuntime.waitUntil`, sem segurar o turno) uma extração curta com modelo barato. Ela lê a mensagem do gestor e a resposta e passa pelo mesmo handler de 7.2 (as mesmas checagens e o mesmo teto). A lista de sinais e o modelo ficam a critério de quem constrói, e a telemetria mede quantas vezes a rede pegou o que o modelo deixou passar.

### 7.5 Consultar: `consultarMemoria`

Uma função em `_shared/aprendizados.ts`, chamada por toda edge da lista do objetivo 1 antes de montar o prompt:

`consultarMemoria({ supa, companyId, tarefa, papel, limite }) → { texto, ids, telemetria }`

- **Recorte por linha:** a tarefa com linha definida (inferida com `inferirMeiosDoPedido` / `classificarLinhaProdutoCohapm`, ou dada pela própria edge, como a marca escolhida no `gerar-legendas`) recebe os aprendizados sem linha mais os daquela linha. A tarefa sem linha definida (por exemplo, "como está a conta?") recebe todos, cada item com o rótulo da linha.
- **Busca:** híbrida, com a busca textual em português e a semântica (quando houver embedding) combinadas por posição (RRF). Leva no máximo `limite` itens (chat 8, subagente 5, edges de passe único 5).
- **Sempre presentes:** as até 5 `preferencia_do_gestor` vigentes da empresa com mais confirmações, contadas dentro do limite.
- **Teto de caracteres:** cerca de 4.000 chars no chat e 2.500 nos demais.
- **Formato:**
  ```
  MEMÓRIA APRENDIDA (registrada pelos agentes desta casa; dado fresco, regra de conformidade e memória curada vencem esta — se contradizer, diga e corrija com corrigir_aprendizado):
  - [#ab12 | preferencia_do_gestor | Jurídico | AG-00, 12/10/2026, confirmada 3x] fato…
  ```
- **Uso:** atualiza `usos` e `ultimo_uso` em segundo plano, sem esperar.
- **Falha:** se a consulta falhar, o turno segue sem o bloco e o prompt recebe "memória aprendida indisponível neste turno; não afirme que não há aprendizado". A telemetria registra `consulta_falhou`.
- **Onde entra:** no chat, fora do bloco cacheado; no job, em `montarSysSintese`, no prompt de cada subagente e no relatório; nas edges de passe único, no system prompt.

Embedding: a primeira tarefa do plano verifica se `Supabase.ai.Session("gte-small")` (384 dimensões) roda nas edges deste projeto e se a qualidade em português é aceitável, com uma prova com pares de frases. Se não servir, a v1 sai só com a busca textual (`tsvector` português + `pg_trgm`), que basta para centenas de registros, e a coluna `embedding` fica nula. Quem constrói decide com base nessa prova.

### 7.6 Escopo: aprendizado é sempre de uma empresa, e de uma linha quando houver

O agente só grava com o `company_id` do turno. Dentro da empresa, a separação por linha segue 7.2 (passo 4) e 7.5 (recorte por linha). As linhas de cada empresa vêm de uma lista no código: na v1, só a COHAPM tem linhas. Aprendizado universal (vale para todas as empresas) continua sendo curadoria humana em `agent_context`. Motivo: o que vale para a Legal é Viver (crédito) muitas vezes não vale para a COHAPM, e o modelo não tem como saber isso de dentro de um turno. "Universal" aqui quer dizer "comum a todos os agentes", não "comum a todas as empresas".

### 7.7 Manutenção semanal (pg_cron, padrão `rodar_tarefa_sql` + `tarefas_agendadas`)

- `valido_ate` vencido → `vencida`.
- Vigente sem uso há 180 dias e com 1 confirmação → `aposentada`, motivo "sem uso". Não apaga nada.
- Conta por empresa e grava em `alerts` só quando houver algo para o gestor olhar (por exemplo, mais de 10 aprendizados novos na semana, para revisão no Obsidian).

### 7.8 Espelho no Obsidian

- **Saída de dados:** uma ferramenta nova no `mcp-server`, `exportar_memoria`, autenticada pela `x-mcp-key` que já existe. Devolve, por empresa: `agent_aprendizados` (todos os status), `agent_context` vigente e o índice e conteúdo de `agent_knowledge`.
- **Script local:** `scripts/espelho_obsidian.ts` (Deno). Lê a URL e a chave de um arquivo local fora do git e grava o cofre numa pasta configurável fora do repositório (padrão: `C:\Users\Infosol\Documents\Memoria dos Agentes`). O conteúdo tem dado de empresa e o repositório vai para o GitHub.
- **Estrutura do cofre:**
  - `Empresas/<Empresa>/Aprendizados/<Linha ou "Geral">/<categoria>/<id-curto> <início do fato>.md`, com frontmatter (id, empresa, categoria, agente, status, confiança, confirmações, criado_em, conversa) e corpo com fato, contexto, evidências e links `[[...]]` para o agente, a categoria e o registro que ele substituiu ou que o substituiu.
  - `Empresas/<Empresa>/Memoria curada/<categoria>.md`
  - `Universal/Memoria curada/<categoria>.md`
  - `Empresas/<Empresa>/Pedidos de revisao de curadoria.md` (ver 7.0)
  - `Conhecimento/<tema>.md`
  - `Agentes/AG-0x <Nome>.md` (os backlinks mostram o que cada agente aprendeu)
  - `_Indice.md`
- O script só mexe em arquivos que ele mesmo gerou (marcados no frontmatter `gerado_por: espelho`). Nota que o gestor criar no cofre não é tocada. Cada nota gerada avisa no topo que edição ali se perde e que correção se faz pelo chat ("esquece o aprendizado #ab12").
- **Execução:** manual (`deno run …`) ou pelo Agendador de Tarefas do Windows, de hora em hora. O documento de entrega traz os dois comandos.

### 7.9 Telemetria

- `tel.aprendizados.consulta = { injetados, ids, chars, falhou }`
- `tel.aprendizados.registro = [{ resultado: "gravado" | "ja_registrado" | "recusado", motivo? }]`
- `tel.aprendizados.rede = { disparou, gravou }`

Isso vai no `diagnostico` que o chat e o job já gravam.

### 7.10 Desligar

Uma chave global (tabela de configuração existente ou nova, a critério de quem constrói) desliga consulta e gravação sem deploy. Desligada, as edges se comportam exatamente como hoje.

## 8. Provas mínimas (bateria Deno)

- Isolamento: fato com `act_` de outra empresa recusado; fato com marca da outra empresa recusado; id de outra empresa recusado em `corrigir_aprendizado`.
- Linha: fato do Jurídico gravado com `linha = juridico`; fato que cita La Felicità e Jurídico recusado; o pedido de legenda da La Felicità não recebe aprendizado do Jurídico; "como está a conta?" recebe todos, rotulados.
- Evidência: `fala_do_gestor` com trecho que não está em nenhuma mensagem do gestor recusada; retorno de ferramenta que não rodou no turno recusado.
- Portões: o `compliance-check` e o guardião WABA não recebem o bloco.
- Volátil: "CPL de ontem foi R$ 12" recusado; "o gestor prefere ver custo por conversa antes do CPL" aceito.
- Dedupe: o mesmo fato duas vezes vira uma linha com `confirmacoes = 2` e duas evidências.
- Teto: o quarto registro do turno é recusado.
- Consulta: falha do banco devolve o aviso e o turno segue; o teto de caracteres é respeitado; as preferências sempre entram.
- Chat: o bloco cacheado continua idêntico entre dois turnos com perguntas diferentes.
- Espelho: a função pura de linhas para arquivos gera os caminhos, o frontmatter e os links esperados, e não toca arquivo sem `gerado_por: espelho`.

## 9. Fica a critério de quem constrói

- Nomes internos, a lista exata de sinais da rede de segurança e o modelo barato da extração.
- O limiar de similaridade do dedupe (calibrado nas provas).
- O formato exato das notas e do índice do cofre.
- Onde fica a chave de desligar.
- A ordem de entrega, desde que a consulta (com a tabela vazia) entre antes da gravação.

## 10. Decisões tomadas por quem escreveu (o gestor não decidiu)

Revisar estas na leitura:

1. A memória aprendida mora numa tabela nova (`agent_aprendizados`) e não em `agent_context`.
2. `consultarMemoria` cobre só a memória aprendida. A memória curada não é levada às edges que hoje não a recebem.
3. Precedência: dado fresco > conformidade e travas > memória curada > memória aprendida. Por isso o `compliance-check` e o guardião WABA não recebem o bloco.
4. Os agentes só gravam aprendizado da empresa do turno. Aprendizado que vale para todas as empresas continua sendo curadoria humana.
5. A evidência é conferida contra o texto real, e paráfrase da fala do gestor é recusada.
6. Tetos: 3 registros por turno ou job, 30 por empresa por dia. No prompt: cerca de 4.000 chars no chat e 2.500 nas demais edges.
7. Rede de segurança no chat: uma extração barata depois da resposta, só quando o gestor deu sinal de correção ou preferência e o modelo não registrou.
8. Ferramentas do chat com dono AG-00, para estarem em todo turno.
9. Manutenção: o que ficar 180 dias sem uso, com uma confirmação só, é aposentado sem ser apagado.
10. O espelho do Obsidian é só de leitura e fica fora do repositório (padrão `C:\Users\Infosol\Documents\Memoria dos Agentes`), alimentado por uma ferramenta nova no `mcp-server` com a `x-mcp-key`.
11. A correção de custo (`correcao_custo_passe.ts`) entra junto com o Ritmo, seguindo a mesma resposta do gestor ("tudo").
