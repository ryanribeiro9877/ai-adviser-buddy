# Voz (mic→texto) + Anexos + Ordenar alertas (F3.1b)

**Data:** 2026-07-23 · **Front only.** Não tocar em edges/tools/banco.

## Backend pronto (deployado)

- Edge `transcribe-audio`: `invoke('transcribe-audio', { body: { audio_base64, mime } })`
  → `{ ok, text }`. Erros: 413 (>15MB), 502 (`detail`, formato).
- Edge `traffic-chat` v6: body ganhou `attachments?: [{ name, mime, data_base64 }]`
  (máx 4, ~8MB cada). Imagens/PDF → visão; csv → texto (400 linhas); xlsx fallback.
  Persiste metadados em `chat_messages.attachments` (jsonb `[{ name, mime, kb, tipo }]`);
  binário NÃO é persistido.

## Regra de ouro

A transcrição **NUNCA** envia sozinha — preenche o input editável; o usuário revisa e envia.

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/hooks/use-audio-recorder.ts` | criar — MediaRecorder, timer, limite 10min, start/stop/cancel |
| `src/lib/attachments.ts` | criar — validação, file→base64, xlsx→CSV (import dinâmico) |
| `src/components/operacao-chat.tsx` | editar — botões mic/clipe, chips, envio com attachments, render |
| `src/routes/_authenticated/alertas.tsx` | editar — ordenar por severidade |
| `src/integrations/supabase/types.ts` | editar — `attachments` em `chat_messages` |
| `package.json` | editar — `xlsx` |

## Task A — Microfone

Botão `Mic` no input. Estados: **idle** → clique pede `getUserMedia({audio:true})`;
**gravando** → mic pulsando vermelho + timer MM:SS + parar + lixeira (cancelar);
**transcrevendo** → spinner, input desabilitado ("Transcrevendo áudio…"). Mime:
`audio/webm;codecs=opus` → fallback `audio/mp4` (`MediaRecorder.isTypeSupported`).
Limite **10:00** → para sozinho + toast e transcreve. Chunks→Blob→base64 (FileReader,
strip do prefixo `data:`). `invoke('transcribe-audio', { audio_base64, mime })` →
coloca `text` no input (anexa ao texto existente com espaço), foca, **NÃO envia**.
Erro → toast + mantém o input; 502 de formato → "formato de áudio não suportado neste
navegador". Libera tracks (`getTracks().forEach(t=>t.stop())`) ao parar/cancelar.

## Task B — Anexos

Botão `Paperclip` → picker (`accept` png/jpg/webp/gif/pdf/csv/xlsx/xls/txt, múltiplo).
Chips acima do input: nome + tamanho + X (miniatura p/ imagem). Máx 4; >8MB → recusa.
**xlsx/xls → CSV no browser** (`XLSX.read` → `sheet_to_csv` por aba, header
`--- aba: NOME ---`), enviado como `text/csv`; demais vão como base64 puro. No envio,
inclui `attachments` no `traffic-chat` (permite anexo sem texto). Limpa anexos após enviar.
NÃO persiste binário. Render: msgs do usuário com `attachments` (jsonb) mostram chips
(ícone por tipo + nome + kb) — `attachments` entra na query e no `types.ts`.

## Task C — Ordenar alertas

Em `alertas.tsx`, sort client-side: `critical → high → medium → low`, depois `created_at desc`.

## Guardrails

Transcrição nunca envia sozinha · não persistir binário/estado global de anexo ·
não tocar em edges/tools/banco · não importar SheetJS na edge.

## Aceite

1. Gravar 5s → texto no input editável → editar e enviar → resposta usa o conteúdo.
2. Timer corta em 10:00 e ainda transcreve.
3. PNG anexado + pergunta → resposta cita números do print + cruza com o banco.
4. .xlsx real → convertido a CSV no browser → resposta cruza com dados reais.
5. Recarregar conversa → chips de anexo persistem (via `chat_messages.attachments`).
6. Alertas com critical no topo.
