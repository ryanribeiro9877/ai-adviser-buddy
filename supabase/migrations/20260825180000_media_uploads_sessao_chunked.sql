-- Sessao Graph de video em partes: a edge nao cabe 4 GB em um request.
-- status enviando + offsets permitem retomar no proximo upload_midia / escoar_videos.

alter table public.media_uploads drop constraint if exists media_uploads_status_check;
alter table public.media_uploads add constraint media_uploads_status_check
  check (status in ('planejado', 'enviando', 'enviado', 'erro'));

alter table public.media_uploads
  add column if not exists upload_session_id text,
  add column if not exists upload_video_id text,
  add column if not exists upload_start_offset bigint,
  add column if not exists upload_end_offset bigint;

comment on column public.media_uploads.upload_session_id is
  'Sessao Graph advideos (upload_phase). Persistida para retomar envio em partes apos o wall da edge.';
comment on column public.media_uploads.upload_video_id is
  'video_id devolvido no start da sessao, antes do finish.';
comment on column public.media_uploads.upload_start_offset is
  'Proximo start_offset (inclusivo) pedido pela Graph.';
comment on column public.media_uploads.upload_end_offset is
  'Proximo end_offset (exclusivo) pedido pela Graph.';
