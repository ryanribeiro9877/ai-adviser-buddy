-- ESPELHO DE MIGRACAO
-- version: 20260825180000
-- name: media_uploads_sessao_chunked
-- projeto: gzjwnjdpxpbmdhcyefvs

alter table public.media_uploads drop constraint if exists media_uploads_status_check;
alter table public.media_uploads add constraint media_uploads_status_check
  check (status in ('planejado', 'enviando', 'enviado', 'erro'));

alter table public.media_uploads
  add column if not exists upload_session_id text,
  add column if not exists upload_video_id text,
  add column if not exists upload_start_offset bigint,
  add column if not exists upload_end_offset bigint;
