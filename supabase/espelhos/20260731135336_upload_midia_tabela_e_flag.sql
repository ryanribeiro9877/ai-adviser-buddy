-- [UPLOAD_MIDIA v1] Registro de midias enviadas do Drive para a Meta + flag propria.
--
-- MOTIVO (investigacao de 31/07/2026): "criar campanha com os criativos da pasta" era
-- estruturalmente impossivel - criar_anuncio_a_partir_de REPLICA molde existente e nao
-- havia caminho para um arquivo do Drive virar asset na conta de anuncios. Esta e a ponte:
-- baixar do Drive (service account, somente leitura) -> subir para a biblioteca de midia da
-- conta (adimages/advideos) -> registrar hash/id para o anuncio novo referenciar.
--
-- SEGURANCA (padrao da casa): subir midia NAO gasta dinheiro nem publica nada - cria asset
-- na biblioteca - mas E escrita na conta, entao: flag propria 'upload_midia' em
-- action_flags (nasce OFF nas 2 empresas), respeita master_enabled e dry_run, conta de
-- destino precisa estar em contas_permitidas_criacao, e ha teto proprio por hora.

create table if not exists public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_external_id text not null,
  drive_file_id text not null,
  nome text not null,
  caminho_drive text,
  mime text,
  tamanho_bytes bigint,
  tipo text not null check (tipo in ('imagem','video')),
  status text not null default 'planejado' check (status in ('planejado','enviado','erro')),
  meta_image_hash text,
  meta_video_id text,
  erro text,
  dry_run boolean not null default true,
  criado_por text,
  created_at timestamptz not null default now(),
  enviado_em timestamptz,
  constraint uq_media_upload unique nulls not distinct (drive_file_id, account_external_id)
);

alter table public.media_uploads enable row level security;
create policy media_uploads_select on public.media_uploads
  for select using (public.is_company_member(company_id, auth.uid()));

comment on table public.media_uploads is
  'Midias enviadas do Google Drive para a biblioteca da conta Meta (adimages/advideos). Dedup por (drive_file_id, account): reenvio devolve o hash existente. Escrita so por edge (service_role); leitura por membro da empresa.';

update public.meta_execution_config
   set action_flags = action_flags || jsonb_build_object('upload_midia', false),
       updated_at = now()
 where not (action_flags ? 'upload_midia');
