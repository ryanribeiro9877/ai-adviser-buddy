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

| Arquivo | Fase | Conteúdo |
|---|---|---|
| `espelho_proposals_ciclo_f1.sql` | F1 | `v_custo_proposta` v2 (métrica oficial vs. rateio) + `security_invoker` + dormência das tabelas de propostas (decisão de escopo). |
| `espelho_targets_f13.sql` | F1.3 | Tabela `targets` (metas & tetos), índices, RLS e seed vigente. |
| `espelho_evaluate_alerts_v2_f13.sql` | F1.3 | `evaluate_alerts` v2 — R1 (CPL) passa a ler o teto vivo de `targets`. |
| `espelho_sec_revoke_anon_f13.sql` | F1.3 | Hardening: revoga `execute` de funções SECURITY DEFINER de escrita para `anon`/`public`. |
| `espelho_regra_3_dias_f2.sql` | F2 | Regra dos 3 dias (recomendação de pausa por criativo) — `evaluate_alerts` v3 + seed da regra. |
