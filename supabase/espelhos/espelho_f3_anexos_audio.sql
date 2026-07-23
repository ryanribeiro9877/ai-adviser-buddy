-- =============================================================================
-- ESPELHO (já aplicado em produção — NÃO re-executar; commit no git p/ histórico)
-- Migração: chat_messages.attachments — F3 anexos multimodais + transcrição
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · 23/07/2026
-- =============================================================================
-- Contexto:
--  * traffic-chat v6: body.attachments [{name,mime,data_base64}] (máx 4 × ~8MB).
--    Imagem/PDF vão DIRETO ao modelo (Sonnet 5 multimodal); csv/xlsx viram texto
--    (xlsx via import LAZY do SheetJS — import no topo estourava o boot da edge:
--    WORKER_RESOURCE_LIMIT). Metadados persistem; binário NÃO.
--  * transcribe-audio v1: {audio_base64,mime} → google/gemini-2.5-flash via
--    OpenRouter → {text} para o front preencher o input EDITÁVEL (nunca envia só).
--    Env OPENROUTER_AUDIO_MODEL sobrescreve o modelo se necessário.
-- Provas E2E (net._http_response ids 45/46/47):
--  * 45 imagem: leu R$414÷120=R$3,45 do print e comparou com teto 2,30 (get_targets).
--  * 46 csv:    cruzou com get_funnel 3× (20-22/07) em tabela CSV vs Banco.
--  * 47 áudio:  mp3 falado transcrito fiel: "Qual foi o gasto de ontem e o custo
--               por formulário?"
-- =============================================================================

alter table public.chat_messages add column if not exists attachments jsonb;

comment on column public.chat_messages.attachments is
  'Metadados dos anexos da mensagem (nome, mime, tamanho, resumo de extração). O binário NÃO é persistido — o modelo analisa no envio.';
