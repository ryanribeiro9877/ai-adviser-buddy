# Chat Operação v2 — textarea auto-grow + transcrição em tempo real

**Data:** 2026-07-23 · **100% front** sobre o commit 47b7c6b. Sem mudança de backend.
Referência de UX: a caixa de mensagens do Claude (cresce com o texto; mic com ondas
e texto aparecendo enquanto fala).

## Task 1 — Textarea auto-grow

- `autoGrow(el)`: `height='auto'` → `height=min(scrollHeight, 200)px`; `overflowY` =
  `auto` acima de 200px, senão `hidden` (sem scrollbar até o teto ~8 linhas).
- Disparo via `useEffect(…, [input])` — cobre digitação e preenchimento por voz;
  reseta ao enviar/limpar (input="").
- Enter envia / Shift+Enter quebra; botões alinhados pelo fundo (`items-end`).
- Scrollbar fina/discreta (dark) via `.chat-scroll` no `styles.css`
  (`scrollbar-width: thin` + `::-webkit-scrollbar` 6px).

## Task 2 — Transcrição em tempo real

Novo hook `src/hooks/use-dictation.ts`: `{ state, elapsedMs, analyser, start(baseText),
stop(), cancel() }`, `state ∈ idle|listening|transcribing`.

- **Ondas** (ambas engines): `getUserMedia` próprio + `AudioContext` +
  `AnalyserNode(fftSize=64)`; expõe o `AnalyserNode`. Componente `<MicWaveform>` roda
  `rAF` lendo `getByteFrequencyData` e ajusta ~6 barras **mutando o DOM** (sem re-render).
- **Engine principal — Web Speech API** (`SpeechRecognition ?? webkitSpeechRecognition`,
  pt-BR, `continuous`, `interimResults`): `onresult` compõe `base + final + interim` e
  chama `onText(full)` (texto aparece enquanto fala). **Auto-restart** no `onend`
  (flag `userStopped`), consolidando `final`. `not-allowed` → toast permissão;
  `no-speech`/`aborted` → ignora (auto-restart cobre).
- **Fallback** (`!SpeechRecognition`): MediaRecorder → `transcribe-audio` → preenche ao
  parar (fluxo atual **absorvido** no hook; `use-audio-recorder.ts` removido).
- **Parar** → texto fica editável. **Cancelar** → restaura `baseText`. **10min** → para
  + toast. Fecha AudioContext e libera tracks ao encerrar.
- **Nunca envia sozinho.**

## Componente

`operacao-chat.tsx`: usa `useDictation` (passa `transcribe` = chamada `transcribe-audio`
que já existe, e `onText` = `setInput`). Barra de gravação = `<MicWaveform>` + timer +
Parar + lixeira. autoGrow via `useEffect([input])`.

## Decisões

1. Fallback absorvido no `use-dictation`; `use-audio-recorder.ts` removido (fluxo preservado).
2. Sem hot-swap SR→MediaRecorder por erro de rede (Chrome/Edge usa SR; Firefox usa
   fallback puro). Erros de SR → toast/parada graciosa.

## Guardrails

Não envia sozinho · fluxo MediaRecorder/transcribe-audio preservado (fallback) · sem tocar em edges.

## Aceite (tela)

1. 5+ linhas: cresce sem scrollbar até ~8 linhas; depois scrollbar fina.
2. Mic + fala: ondas animam e o texto aparece (parciais atualizando).
3. Pausa ~5s e volta: continua (auto-restart invisível).
4. Parar: texto fica/enviável. Cancelar: input volta ao que era.
5. Texto pré-existente preservado (anexa ao final).
6. Firefox: cai no fallback sem quebrar.
