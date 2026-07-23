# F3.3 — ActionCards de aprovação no chat Operação

**Data:** 2026-07-23 · **100% front.** Backend pronto (traffic-chat v8 + f33). Sem edge/SQL.

## Backend

- Resposta do `traffic-chat` v8 ganha `action_cards[]`. A mensagem assistant carrega
  marcador em `chat_messages.attachments`: `[{ tipo:'action_card', approval_id, summary, status }]`.
- `approval_requests` (RLS: membros leem): id, company_id, requested_by, entity_type,
  entity_id, action, summary, payload (jsonb → justificativa, target_name,
  novo_orcamento_diario_reais?), status (pending|approved|rejected), reviewed_by,
  reviewed_at, review_note, created_at, **conversation_id** (novo).
- RPC `decide_approval(p_id uuid, p_decision text, p_reason text) → jsonb`. Backend impõe:
  só admin; só de `pending`; 2ª decisão erra; grava `audit_log`. O front só reflete.

Ações: `pausar_criativo`, `escalar_criativo`, `pausar_campanha`, `alterar_orcamento`.

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/components/action-card.tsx` | criar — `<ActionCard>` + `decideApproval()` + metadados |
| `src/components/approvals-queue.tsx` | criar — fila (Task B) |
| `src/components/operacao-chat.tsx` | editar — query approvals por conversation_id + cards na thread + decide |
| `src/routes/_authenticated/recomendacoes.tsx` | editar — 3ª aba "Aprovações" |
| `src/integrations/supabase/types.ts` | editar — `conversation_id` em approval_requests + `decide_approval` |

## Task A — Card na thread

- `useQuery(["approvals","conv", activeId])` → `approval_requests where conversation_id=:id`
  → mapa por id.
- `MessageBubble` (assistant): dos `attachments` filtra `tipo==='action_card'`, pega
  `approval_id`, busca a linha no mapa e renderiza `<ActionCard>` com o **status atual**
  do banco. Recarregar → cards reaparecem com status vigente.
- Decidir (admin + pending): Rejeitar abre input de motivo opcional. Clique → otimista
  (atualiza cache) → `rpc('decide_approval')` → erro: reverte + toast com a msg da RPC;
  ok: invalida + toast. `approved` mostra nota "aplicar manualmente no Gerenciador".
- Após enviar mensagem que gera card: invalida `["approvals"]` (nasce ao vivo).

## Task B — Fila "Aprovações" (3ª aba na Operação)

- `useQuery(["approvals","company", companyId])` → pending primeiro + data desc (sort client).
- Reusa `<ActionCard>` com quem pediu/decidiu e quando (nomes via `profiles`). Mesma decisão.

## Badges

`pending` âmbar "Aguardando aprovação" · `approved` verde "Aprovada — aplicar no Gerenciador"
· `rejected` vermelho "Rejeitada".

## Guardrails

Não chama Meta/Windsor · não cria pedido pelo front · não esconde erro da RPC no toast.

## Aceite

Conversa `23e2e969` → card `cf9343ba` pending → Aprovar → verde + nota manual. Nova ação
→ card ao vivo → Rejeitar com motivo.
