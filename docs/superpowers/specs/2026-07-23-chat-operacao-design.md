# Chat "Operação" (F3.1)

**Data:** 2026-07-23 · **Supabase:** `gzjwnjdpxpbmdhcyefvs`
**Regra de ouro:** banco/tela valida, relatório não.

## Objetivo

Substituir o placeholder da aba "Chat do gestor" (dentro de `/recomendacoes`,
menu "Operação") por um chat real ligado à edge `traffic-chat`. A aba
"Recomendações da IA" continua ao lado, intacta.

## Backend (pronto, NÃO alterar)

- Edge `traffic-chat` (ACTIVE): `supabase.functions.invoke('traffic-chat', { body })`.
  - Body: `{ message: string, conversation_id?: uuid, company?: string }` — `company`
    = NOME da empresa do header.
  - Resposta: `{ ok, conversation_id, reply (markdown), tools_used: string[], tokens_in, tokens_out }`.
  - Erro: `{ error }` com status ≠ 200. Latência 10–40s.
- Tabelas (RLS: membros leem por empresa; escrita só pela edge):
  - `chat_conversations` (id, company_id, title, kind 'chat'|'daily_report', created_by, created_at, updated_at).
  - `chat_messages` (id, conversation_id, company_id, role 'user'|'assistant', content,
    tool_calls jsonb, model, tokens_in/out, user_id, created_at).
  - `chat_messages.tool_calls` no histórico = array `[{ tool, args }]`; a edge ao vivo
    retorna `tools_used: string[]` — normalizar ambos p/ os chips.

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/components/operacao-chat.tsx` | criar — chat (lista + thread + input + envio) |
| `src/components/markdown.tsx` | criar — `<Markdown>` (react-markdown + remark-gfm) |
| `src/routes/_authenticated/recomendacoes.tsx` | editar — troca `ChatPlaceholder` por `<OperacaoChat />` |
| `src/integrations/supabase/types.ts` | editar — adiciona `chat_conversations` + `chat_messages` |
| `package.json` | editar — `react-markdown` + `remark-gfm` |

## Layout (aba "Chat do gestor")

Duas colunas. Esquerda ~260px: "+ Nova conversa" + lista rolável de conversas
(título + `updated_at`, ativa destacada). Direita: thread rolável + input fixo
embaixo. Em <md a lista vira dropdown acima da thread.

## Comportamento

- Conversas: `useQuery(["chat-conversations", companyId])` → `chat_conversations`
  (`company_id`, `kind='chat'`, order `updated_at` desc).
- Mensagens: `useQuery(["chat-messages", conversationId])` (enabled c/ conversa) →
  `chat_messages` (order `created_at` asc).
- Estado `activeConversationId` (null = nova). "+ Nova conversa" → null + thread vazia.
- **Envio otimista:** mostra a msg do usuário na hora + bolha "Analisando os dados…";
  desabilita SÓ o input da conversa ativa. Chama a edge com `conversation_id` (ou sem,
  p/ criar). OK → se nova, guarda `reply.conversation_id`, vira ativa, invalida a lista;
  refetch das mensagens (canônicas, gravadas pela edge). Erro → toast amigável (extrai a
  msg do corpo se possível), tira o loader, mantém a msg do usuário.
- **Metadados** na msg do assistente: chips das tools (normaliza histórico/ao vivo) + `model`.
- **Empresa:** keyed por `companyId`; trocar reseta a conversa ativa e envia `company` (nome).
- **Markdown:** `reply` via `<Markdown>` (tabelas via GFM).

## Guardrails (NÃO fazer)

1. NÃO chamar OpenRouter direto do front — sempre via edge.
2. NÃO criar tabelas/policies.
3. NÃO implementar aprovações/ActionCards (F3.3).
4. NÃO travar a UI toda durante a resposta (só o input da conversa ativa).

## Aceite (banco 23/07/2026)

- Lista mostra as ~10 conversas (kind='chat') da Legal é Viver (títulos = a pergunta).
- Abrir uma → 1 msg user + 1 msg assistant (md).
- "Quais são as metas vigentes?" em conversa nova → cita R$ 2,40 / 2,30 / 1,55 / 1,50
  e chip `get_targets`.
- Pergunta de ação ("pause a campanha X") → explica o plano; execução automática só na
  fase de ações (esperado).
