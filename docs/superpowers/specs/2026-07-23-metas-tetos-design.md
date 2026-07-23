# Metas & Tetos — UI de edição de targets (F1.3)

**Data:** 2026-07-23 · **Projeto Supabase:** `gzjwnjdpxpbmdhcyefvs`
**Regra de ouro:** banco/tela valida, relatório não.

## Objetivo

Tela para admins visualizarem e editarem os tetos de custo por empresa
(`public.targets`, nível empresa: `campaign_id is null`). Editar a meta
`custo_por_lead_dashboard` recalibra o alerta de CPL na próxima avaliação
(cron 06:15 UTC) — a meta é a interface; `alert_rules` permanece oculto.

## Escopo do backend (pronto, NÃO alterar)

- Tabela `public.targets`: `id`, `company_id`, `metric`, `valor` (numeric R$),
  `campaign_id` (null = teto da empresa), `fonte`
  (`derivado_meta_p75_diario` | `comando` | `manual`), `memoria` (jsonb,
  trilha de auditoria), `active`, `created_at`, `updated_at`.
- RLS: `targets_admin_all` (admin tudo) + `targets_select` (membros leem).
  UPDATE de não-admin falha → tratar com toast amigável.
- `evaluate_alerts()` → `integer` (nº de alertas ativos). Lê `targets.valor`
  em tempo real para a regra de CPL.

## Decisões de UX (aprovadas)

- **Local:** rota própria `/metas` ("Metas & Tetos"), novo item no menu lateral
  (ícone `Goal`), logo após "Alertas".
- **Edição:** inline por linha (não modal).
- **Auditoria:** além da `memoria`, gravar `logAudit({ action: "target.update" })`
  para aparecer em "Histórico e auditoria".

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/routes/_authenticated/metas.tsx` | criar — rota + página |
| `src/components/targets-table.tsx` | criar — tabela + edição inline |
| `src/components/app-shell.tsx` | editar — novo item de menu `/metas` |
| `src/integrations/supabase/types.ts` | editar — adicionar tipo da tabela `targets` (cirúrgico) |
| `src/routeTree.gen.ts` | regenerar via router-plugin (build/dev) |

## Comportamento

### Leitura
`useQuery(["targets", companyId])` →
`from("targets").select("*").eq("company_id", id).is("campaign_id", null).eq("active", true)`.
Tabela visível a todos os membros (RLS `targets_select`); controles de edição só
para `isAdmin`. Respeita a empresa do header (`selectedCompanyId`); ignora filtros
de período.

### Colunas
- **Métrica** — label amigável + tooltip (glossário). `custo_por_lead_dashboard`
  recebe badge **"usado nos alertas de CPL"**.
  - `custo_por_lead_dashboard` → "Custo por Lead (dashboard)" — spend ÷ leads.
  - `custo_por_formulario` → "Custo por Formulário" (form_leads).
  - `custo_por_lead_lp` → "Custo por Lead na LP" (link_clicks).
  - `custo_por_conversa` → "Custo por Conversa WhatsApp" (messaging_started).
- **Valor** — R$ (`Intl.NumberFormat pt-BR`), editável.
- **Fonte** — badge: `derivado_meta_p75_diario`→"Derivado dos dados (p75)";
  `comando`→"Comando do gestor"; `manual`→"Editado manualmente".
- **Atualizado em** — `updated_at` formatado pt-BR (`date-fns`).

### Edição inline (save)
1. Valida: aceita `2,50` ou `2.50`; `valor > 0`; 2 casas; vazio/≤0/NaN → erro
   inline, não grava.
2. Relê a linha (`valor`, `memoria`) antes de gravar.
3. UPDATE único: `valor` novo, `fonte='manual'`, `updated_at=now()`,
   `memoria = { ...antiga, [edicao_N]: { anterior, novo, em: ISO, via: "ui" } }`.
   `edicao_N` = chave incremental (nº de chaves `edicao_*` + 1) para preservar
   histórico de edições.
4. Sucesso: `toast.success("Meta atualizada — alertas recalibram na próxima avaliação (06:15)")` + refetch + `logAudit`.
5. Erro RLS/permissão: `toast.error("Sem permissão para editar metas (apenas administradores).")`.

### Botão "Reavaliar alertas agora" (admin, opcional)
`supabase.rpc("evaluate_alerts")` → exibe `"{n} alertas ativos"`. Erro de
permissão → esconde o botão (estado `rpcForbidden`).

## Guardrails (NÃO fazer)

1. NÃO criar/alterar tabelas, policies ou funções.
2. NÃO expor edição de `alert_rules`.
3. NÃO incluir targets de campanha (`campaign_id is not null`).
4. NÃO permitir valor ≤ 0 ou vazio.

## Aceite (banco em 22/07/2026)

| Empresa | Métrica | Valor |
|---|---|---|
| Legal é Viver | custo_por_lead_dashboard | R$ 2,40 |
| Legal é Viver | custo_por_formulario | R$ 2,30 |
| Legal é Viver | custo_por_conversa | R$ 1,55 |
| Legal é Viver | custo_por_lead_lp | R$ 1,50 |
| COHAPM | custo_por_lead_lp | R$ 6,85 |
| COHAPM | custo_por_conversa | R$ 21,80 |
| COHAPM | custo_por_lead_dashboard | R$ 21,80 |

**Teste de edição (fazer e desfazer):** Legal `custo_por_lead_dashboard`
2,40 → 2,50 → verificar `fonte='manual'` e `memoria` com `edicao_N` → voltar 2,40.
