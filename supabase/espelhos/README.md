# Espelhos SQL

Cópias **fiéis, versionadas em git** de migrações/objetos já aplicados no banco
Supabase do projeto `gestão_marketing` (`gzjwnjdpxpbmdhcyefvs`), aplicadas via
`apply_migration` (MCP) e que não têm arquivo correspondente em
[`../migrations/`](../migrations).

> **Não são migrações a rodar.** Todos os arquivos começam com o aviso
> "espelho para git — NÃO re-executar" (os objetos já existem em produção).
> A CLI do Supabase só lê `supabase/migrations/`, então nada aqui é aplicado
> por `supabase db push`. Servem como registro histórico e de auditoria: o
> cabeçalho de cada arquivo conta a decisão, a validação e o contexto.

Há dois tipos de arquivo aqui:

- **`<timestamp>_<nome>.sql`** — o SQL **exato** que rodou, extraído de
  `supabase_migrations.schema_migrations`. O nome corresponde à versão
  registrada no banco.
- **`espelho_*.sql`** — espelho escrito à mão, consolidando uma ou mais
  migrações com o contexto da decisão. Fiel ao efeito, não necessariamente
  caractere a caractere.

> ⚠️ **Esta pasta não é uma história reconstruível.** `../migrations/` só tem as
> três migrações de 20/07; tudo depois disso foi aplicado via `apply_migration`
> e existe apenas aqui. Como os espelhos pressupõem objetos criados por
> migrações ausentes, **não dá para recriar o banco do zero** a partir deste
> repositório — nem movendo estes arquivos para `../migrations/` (a cadeia
> quebraria: p.ex. `20260728144316` altera `agent_context`, que nenhum arquivo
> versionado cria). Para reconstruir, a fonte é o histórico de migrações do
> próprio Supabase.

| Arquivo | Fase | Conteúdo |
|---|---|---|
| `espelho_proposals_ciclo_f1.sql` | F1 | `v_custo_proposta` v2 (métrica oficial vs. rateio) + `security_invoker` + dormência das tabelas de propostas (decisão de escopo). |
| `espelho_targets_f13.sql` | F1.3 | Tabela `targets` (metas & tetos), índices, RLS e seed vigente. |
| `espelho_evaluate_alerts_v2_f13.sql` | F1.3 | `evaluate_alerts` v2 — R1 (CPL) passa a ler o teto vivo de `targets`. |
| `espelho_sec_revoke_anon_f13.sql` | F1.3 | Hardening: revoga `execute` de funções SECURITY DEFINER de escrita para `anon`/`public`. |
| `espelho_regra_3_dias_f2.sql` | F2 | Regra dos 3 dias (recomendação de pausa por criativo) — `evaluate_alerts` v3 + seed da regra. |
| `espelho_winners_f22.sql` | F2.2 | Detector de criativos vencedores — `evaluate_winners` (grava em `ai_recommendations`) + cron. |
| `espelho_r6_r7_f23.sql` | F2.3 | Regras R6 (queda de entrega) e R7 (orçamento) — `evaluate_alerts` v4 + seeds. |
| `espelho_chat_tables_f31.sql` | F3.1 | Tabelas do chat "Operação" (`chat_conversations`, `chat_messages`) + RLS. |
| `espelho_f3_anexos_audio.sql` | F3 | Coluna `chat_messages.attachments` (metadados de anexos multimodais + transcrição de áudio). |
| `espelho_f33_actioncards.sql` | F3.3 | ActionCards — aditivo em `approval_requests` (conversation_id), `audit_log` imutável e função `decide_approval`. |
| `espelho_f4_execucao_meta.sql` | F4.1/F4.2 | Execução real na Meta — `meta_execution_config` (flags 3 camadas + dry_run), `set_meta_execution_config`, colunas `executed_at`/`execution_result` + campanha cobaia de teste. |
| `espelho_f43_f44_compliance_bm.sql` | F4.3/F4.4 | Tabela `compliance_rules` versionada (16 regras FIN/CRI/LGL) + RLS; contexto das edges `compliance-check` e `bm-monitor`. Seed resumido — enunciados completos só na migração do Supabase. |
| `espelho_migracoes_27-07-2026.sql` | 27/07 | Telemetria do turno (`chat_messages.diagnostico`), Realtime em `chat_messages`, watchdog de frescor (`check_data_freshness`, SQL puro sem edge) + cron 09:45. |
| `20260728133731_limpa_agent_context_e_cria_agent_style.sql` | 28/07 | Neutraliza números de estado na memória (causa raiz da alucinação de 27/07), remove jargão interno e cria `agent_style` — formatação fora do prompt, editável sem redeploy. |
| `20260728140410_add_conhecimento_breakdown_effect_e_gates.sql` | 28/07 | Memória institucional: breakdown effect, triagem antes de interpretar número, fase de aprendizado, formato obrigatório de recomendação e sazonalidade do consignado. |
| `20260728141940_add_expiracao_24h_approval_requests.sql` | 28/07 | Expiração de aprovações em 24h — `expires_at` + `expire_stale_approvals` (vencido vira `rejected` com nota, para não mudar front/executor) + cron horário. |
| `20260728142936_prepara_acoes_de_criacao_meta.sql` | 28/07 | Preparação das ações de criação — enum `adset`, flags novas (OFF), lista branca `contas_permitidas_criacao` e teto de sanidade de orçamento. |
| `20260728144316_isola_agent_context_por_empresa.sql` | 28/07 | Isola a memória institucional por empresa — `agent_context.company_id` (NULL = fato universal) + reclassificação dos fatos existentes. |
| `20260728151211_cria_agent_knowledge_com_temas_criticos.sql` | 28/07 | Cria `agent_knowledge` (base consultável, progressive disclosure via `get_conhecimento`) com os temas `otimizacao` e `unidade_economica`. |
| `20260728172944_isola_execution_config_por_empresa_e_valida_conhecimento.sql` | 28/07 | `meta_execution_config` deixa de ser singleton (config por empresa — bloqueante antes de ligar flags) + prazos de revalidação e `check_conhecimento_validade` semanal. |
| `20260728180208_remove_espelho_crm_dash_fora_de_escopo.sql` | 28/07 | **CRM sai do escopo:** derruba `lev_leads`/`lev_propostas`/`lev_sync_state` (LGPD — minimização), `get_funil_credito` vira stub de escopo, fatos de CRM desativados. Sem CAC por contrato pago daqui em diante. |
| `20260728194745_f55_alertas_tier_quality_waba.sql` | F5.5 | Monitor de tier/qualidade dos números WhatsApp — `evaluate_waba_tier_alerts` (SQL puro) + dedup. **Superado pelo fix `…194905`.** |
| `20260728194905_f55_fix_cast_alert_severity.sql` | F5.5 | Fix: `alerts.severity` é enum — cast `::alert_severity` no INSERT. Versão vigente de `evaluate_waba_tier_alerts`. |
| `20260728195029_f54_f55_relatorio_diario_secao_waba.sql` | F5.4/F5.5 | Seção WhatsApp no relatório diário (08:30 BRT) — `post_daily_report` com números por tier/qualidade e cobertura declarada. **Superado pelo fix `…195151`.** |
| `20260728195151_f54_fix_relatorio_waba_cobertura_e_nome_template.sql` | F5.4 | Fix: exclui `phone_external_id = ''` da contagem de cobertura (ausência de dado ≠ zero) e busca o nome do template via join. Versão vigente de `post_daily_report`. |
| `20260728210046_chat_jobs_select_policy_e_realtime.sql` | Subagentes | Pré-requisito do front: policy de SELECT em `chat_jobs` (`is_company_member`, escrita segue exclusiva do `service_role`) + `chat_jobs` no Realtime. |
| `20260729122851_f56_tabela_infobip_dispatches.sql` | F5.6 | Cria `infobip_dispatches` — ingestão dos exports Excel da Infobip (grão = linha; `service_name` distingue Outbound/Inbound/MAU), RLS + dedup por `(message_id, service_name)`. `price_raw` gravado como vem, sem converter. |
| `20260729122954_rpc_get_weekly_report_data.sql` | 29/07 | `get_weekly_report_data` — métricas do relatório semanal (investimento, formulários, custos, CTR, conversão, quebra por campanha). Declara no retorno o que **não** é coletado (demografia) em vez de omitir. |
| `20260729125229_infobip_dedup_nulls_not_distinct.sql` | F5.6 | Dedup no banco: unique passa a `NULLS NOT DISTINCT` (PG15+), então NULL colide com NULL. Aplicado com a tabela vazia. |
| `20260729130350_f56_hardening_service_name_not_null.sql` | F5.6 | Segunda camada do mesmo furo: `service_name` vira NOT NULL com default `'-'`. Complementa o `NULLS NOT DISTINCT` acima (defesa em profundidade). |
| `20260729142700_f53_flag_criar_template.sql` | F5.3 | Flag `criar_template` nasce **OFF** nas duas empresas, antes da edge existir — evita o default-aberto de sempre. |
| `20260729143155_f53_tabela_waba_template_creations.sql` | F5.3 | Cria `waba_template_creations` — fluxo rascunho (redator LLM + guardião fail-closed, nunca submete) → submit (3 camadas + rate limit) → watch. Escrita exclusiva da edge. |
| `20260729193223_m07_historico_config_campanhas.sql` | M-07 | `campaign_config_snapshots` + `snapshot_campaign_config` (cron 09:25) + `get_alteracoes_config` — torna executável a doutrina "você não é o único ator". Foto 1x/dia: mudança feita e revertida no mesmo dia é invisível, e a leitura devolve essa limitação junto do resultado. |
| `20260729134405_rpc_get_report_export_data.sql` | 29/07 | `get_report_export_data` — fonte única da exportação rica do relatório (série diária, campanhas, top 15 anúncios, tetos vigentes). `security invoker`, complementa `get_weekly_report_data`. |
| `20260729202134_g02_g03_g05_estado_operacional_contas_e_wabas.sql` | G-02/03/05 | Estado operacional por conta (`integrations.estado_operacional`: ativa/nao_operacional/**quarentena**, que vence flag de empresa) e por WABA (`wabas.estado_local`: ativa/legada) + gate `conta_elegivel_para_acao` (deny por padrão). |
| `20260730115819_notificacoes_realtime_e_rpc_pendencias.sql` | 30/07 | Realtime + `replica identity full` em `approval_requests`/`alerts` e `get_notificacoes_pendentes` (fonte única do sino; notificação é projeção de estado, não entidade). **Superado pelo fix `…132744`** — esta versão filtrava `status::text = 'pendente'` e zerava as aprovações em silêncio. |
| `20260730132744_fix_get_notificacoes_pendentes_rotulo_enum.sql` | 30/07 | Fix: comparação passa a ser **tipada** (`status = 'pending'::approval_status`) em vez de `::text` — rótulo errado agora falha alto na criação da função em vez de devolver zero. Versão vigente de `get_notificacoes_pendentes`. |
| `20260730175943_fix_get_criativos_conteudo_isolamento_empresa.sql` | 30/07 | **Vazamento entre empresas:** `get_criativos_conteudo` varria `ads` sem filtro de `company_id` (peça da COHAPM entrava no portfólio de crédito da Legal). Nova assinatura com `p_company_id` obrigatório + legada mantida com aviso e campo `empresa` por item. A edge migrou no `traffic-chat` v28 (verificado em produção em 30/07: nenhuma chamada à legada; Legal 67 criativos, COHAPM 35, zero contaminação) — a legada segue viva só por compatibilidade e pode ser aposentada. |
| `20260730194848_job_v2_checkpoint_e_segmentos.sql` | Job v2 | `chat_jobs.checkpoint` + `segmento` — o worker respeita o teto de parede (~400s) vivendo em até 3 segmentos: grava checkpoint e reinvoca a edge, retomando do ponto exato. Estado no banco, não na memória do worker. |
| `20260730204732_paginacao_get_criativos_conteudo.sql` | Job v2.1 | Overload com `p_offset`/`p_limit` (ordem determinística: gasto desc, nome) + `total`/`exibidos`/`offset`/`restantes`. Fecha a lacuna em que o aviso de corte mandava "pedir um recorte mais estreito" sem que existisse parâmetro de recorte — 26 de 30 legendas ficavam invisíveis sem caminho de recuperação. |

| `20260731135336_upload_midia_tabela_e_flag.sql` | Upload mídia v1 | `media_uploads` (Drive → biblioteca da conta Meta, dedup por `(drive_file_id, account)` com `nulls not distinct`) + flag `upload_midia` nascendo **OFF** nas duas empresas. Subir mídia não gasta nem publica, mas é escrita na conta: respeita master, dry_run, lista branca de contas e teto por hora. |

| `20260731165022_drive_midia_analises.sql` | Job v2.2 | `drive_midia_analises` — veredito visual por mídia do Drive (produto aparente, texto visível, riscos, aproveitável sim/não/incerto). Chave por arquivo **+ versão**, então cada rodada analisa só o que falta ou mudou. `base_da_analise` declara o que foi visto (miniatura, nunca o vídeo interno). |

| `20260803121910_fix_integrations_status_nao_nasce_conectada.sql` | 03/08 | **"Conectada" falsa vinha do schema:** `status` DEFAULT `'connected'` + `connected_at` DEFAULT `now()` faziam toda linha nascer conectada sem nenhuma chamada à Graph (22 de 22 `connected` desde sempre, 2 sem `external_id`). Defaults passam a `nao_verificada`/`quarentena`, `connected_at` sem default, CHECK de vocabulário e **trava estrutural** `status <> 'connected' OR external_id preenchido` — o banco recusa a mentira em vez de depender do front. |

| `20260803141646_gt05_gt27_escopo_fatos_e_contrato_ativacao.sql` | GT-05/GT-27 | Escopa a memória por empresa (globais vigentes 20 → 12; nenhum global cita mais consignado/INSS/CLT/teto) e reescreve dois fatos: categoria especial agora é gravada **por construção** pela `meta-actions` v4.1, e o contrato de ativação passa a dizer que **aprovar card é o ato de executar** — não existe mais "o card fica pendente". ⚠️ **Espelho resumido:** descreve os 4 blocos, mas o SQL exato vive só em `schema_migrations.statements[1]`. |

| `20260804153429_gt06_mensagem_declara_estado_da_flag.sql` | GT-06 | `pode_executar_acao` passa o estado da flag para o **texto** da mensagem: o dado existia só em campo estruturado que o chat não repassava — informação que vive num lugar só, que ninguém lê, não existe. Flag ligada em ação que a executora não executa ganha aviso próprio. |
| `20260804164810_gt09_campos_de_config_e_unidade_em_centavos.sql` | GT-09 | Coleta de configuração vai pelo `meta-campaign-status` (lê a lista da Graph, enxerga campanha pausada); Windsor descartado por só devolver campanha **com entrega** — cobriria 2 de 29. Princípio: configuração é estado, não métrica. |
| `20260804172753_gt10_semente_do_publico_declarada.sql` | GT-10 | Semente dos públicos semelhantes declarada pelo gestor: os "Leads Convertidos" que semearam a família LAL 1/2/3/5% são **CLT apenas** — quatro percentuais da mesma semente. |
| `20260804174302_gt44_tres_flags_decisao.sql` | GT-44 | Decide as três flags que não executavam nada. `replicar_template` **removida**: o `audit_log` prova replicação aprovada pela Meta com a flag em `false`, ou seja, ninguém a lia. Manter seria fingir um controle que não existe — pior que não ter controle. |
| `20260804175120_drive_pastas_monitoradas_e_plano_de_varredura.sql` | Drive | Pastas monitoradas viram **dado**, não segredo: o sistema lia um único id vindo de `DRIVE_CRIATIVOS_FOLDER_ID`, então acrescentar pasta exigia deploy. Acesso amplo não é cobertura. |
| `20260804180552_cron_drive_watch_0845.sql` | Drive | Cron 08:45, registrado **depois** de provado (200, 5,6s, zero LLM). Antes do `windsor-sync` das 09:00 de propósito: peça nova entra no espelho antes da coleta de métrica. |
| `20260804185957_drive_chave_inclui_base_da_analise.sql` | Drive | Chave única passa a incluir `base_da_analise`. Sem isso a reanálise autorizada (áudio + vários quadros) era impossível: o arquivo não muda, então o incremental que economiza custo virava trava — 89% dos vídeos tinham ficado "indeterminado" olhando **um quadro**. |
| `20260804192159_drive_convencao_de_base_evidencia_e_criterio.sql` | Drive | Convenção de nome da base inclui a versão do critério. As 67 análises foram feitas 2h11 **antes** do deploy que acrescentou "educação financeira" e "segurança" à lista de produto — e a distribuição confirma: zero peças nesses dois temas. |
| `20260804193832_drive_liberacao_e_do_arquivo_nao_da_analise.sql` | Drive | A liberação do gestor é atributo **da peça**, não da linha de análise — senão quem consultar a base nova vê veredito de máquina sem camada humana. |
| `20260804193925_drive_sincroniza_liberacao_contra_a_fonte.sql` | Drive (fix) | Conserto: o UPDATE filtrava `IS NULL`, mas as linhas nasciam `FALSE` pelo default — cinco peças **afirmavam** que o gestor não liberou o que ele liberou, e a conferência procurava NULL e reportava zero. Sincronizar derivada compara com a **fonte** (`IS DISTINCT FROM`), nunca procura um valor suposto. Default removido: NULL = sem decisão, FALSE = recusa. |
| `20260804194310_drive_liberacao_derivada_tambem_no_update.sql` | Drive (fix) | Conserto: o gatilho de herança cobria só INSERT, mas o pipeline grava com `ON CONFLICT DO UPDATE` — no caminho de UPDATE ele não disparava. Coluna derivada tem de ser derivada nos dois caminhos, senão "derivada" é só intenção. |
| `20260804202255_teto_sanidade_3000_e_aviso_de_orcamento.sql` | 04/08 | Teto de sanidade cai de R$ 5.000 para **R$ 3.000**/dia + função que traduz o orçamento pedido no que ele realmente permite: a Meta declara que diário é **média**, com folga de ~75% num dia isolado e garantia só no semanal (R$ 60/dia → até R$ 105 no dia, R$ 420 na semana). |

**Sobre as três assinaturas de `get_criativos_conteudo`** (todas vivas no banco): `(boolean)` é a legada sem filtro de empresa, mantida só por compatibilidade e sem consumidor desde o `traffic-chat` v28; `(boolean, uuid)` é a que a edge do chat usa; `(boolean, uuid, int, int)` é a paginada, usada pelo `traffic-agent-job` v2.1.
