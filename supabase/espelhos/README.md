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
| `20260728140410_add_conhecimento_breakdown_effect_e_gates.sql` | 28/07 | Memória institucional: breakdown effect, triagem antes de interpretar número, fase de aprendizado, formato obrigatório de recomendação e sazonalidade do consignado. |
| `20260728142936_prepara_acoes_de_criacao_meta.sql` | 28/07 | Preparação das ações de criação — enum `adset`, flags novas (OFF), lista branca `contas_permitidas_criacao` e teto de sanidade de orçamento. |
| `20260728144316_isola_agent_context_por_empresa.sql` | 28/07 | Isola a memória institucional por empresa — `agent_context.company_id` (NULL = fato universal) + reclassificação dos fatos existentes. |
| `20260728194745_f55_alertas_tier_quality_waba.sql` | F5.5 | Monitor de tier/qualidade dos números WhatsApp — `evaluate_waba_tier_alerts` (SQL puro) + dedup. **Superado pelo fix `…194905`.** |
| `20260728194905_f55_fix_cast_alert_severity.sql` | F5.5 | Fix: `alerts.severity` é enum — cast `::alert_severity` no INSERT. Versão vigente de `evaluate_waba_tier_alerts`. |
| `20260728195029_f54_f55_relatorio_diario_secao_waba.sql` | F5.4/F5.5 | Seção WhatsApp no relatório diário (08:30 BRT) — `post_daily_report` com números por tier/qualidade e cobertura declarada. **Superado pelo fix `…195151`.** |
| `20260728195151_f54_fix_relatorio_waba_cobertura_e_nome_template.sql` | F5.4 | Fix: exclui `phone_external_id = ''` da contagem de cobertura (ausência de dado ≠ zero) e busca o nome do template via join. Versão vigente de `post_daily_report`. |
| `20260728_chat_jobs_select_policy_e_realtime.sql` | Subagentes | Pré-requisito do front: policy de SELECT em `chat_jobs` (`is_company_member`, escrita segue exclusiva do `service_role`) + `chat_jobs` no Realtime. |
