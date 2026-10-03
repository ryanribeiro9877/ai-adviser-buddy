-- Miniatura de criativo vira arquivo nosso.
-- A URL da Meta expira; a grade mostra dezenas de capas ao mesmo tempo.
-- Espelho: supabase/espelhos/20261003170000_miniatura_de_criativo_no_storage.sql
--
-- thumbnail_url passa a guardar o caminho no bucket privado `criativos`
-- (empresa/creative_id.ext). miniatura_motivo explica a ausência.
-- meta_video_id liga o anúncio ao arquivo do Drive em media_uploads.

alter table public.ads add column if not exists miniatura_motivo text;
alter table public.ads add column if not exists miniatura_tentada_em timestamptz;
alter table public.ads add column if not exists meta_video_id text;

comment on column public.ads.thumbnail_url is
  'Caminho no bucket privado criativos: {company_id}/{creative_id}.{ext}. Nao e URL da Meta.';
comment on column public.ads.miniatura_motivo is
  'Por que nao ha arquivo. sem_imagem:{creative_id} nao tenta de novo ate o criativo mudar. tentar_de_novo: espera 6h.';
comment on column public.ads.miniatura_tentada_em is
  'Ultima tentativa de baixar a capa. A rotina em lotes nao martela o mesmo anuncio.';
comment on column public.ads.meta_video_id is
  'video_id do criativo. Junta com media_uploads.meta_video_id para abrir o arquivo no Drive.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'criativos',
  'criativos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists criativos_ler on storage.objects;
create policy criativos_ler on storage.objects
  for select to authenticated
  using (
    bucket_id = 'criativos'
    and coalesce((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_company_member(((storage.foldername(name))[1])::uuid, (select auth.uid()))
  );

-- Recuperacao em lotes. Reativa: quando nao ha o que baixar, silencio e o desfecho.
insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo,
  timeout_ms, periodicidade, tolerancia_horas, natureza, motivo_natureza, observacao, ativa
) values (
  'miniaturas-de-criativo',
  'Miniaturas dos criativos',
  'Os anúncios sem arquivo nosso já ganharam miniatura, ou ficou registrado por que não?',
  'http',
  'pipeboard-structure-sync',
  'cron:pipeboard-structure-ads-0922',
  'bearer',
  '{"recuperar_miniaturas":true,"lote":12}'::jsonb,
  120000,
  'frequente',
  1,
  'reativa',
  'Lotes historicos. Quando nao ha anuncio sem arquivo, a rodada nao grava carimbo e isso e o desfecho, nao falha de coleta.',
  'Baixa a capa para o bucket privado criativos. Nao guarda a URL assinada da Meta.',
  true
)
on conflict (tarefa) do update set
  corpo = excluded.corpo,
  edge = excluded.edge,
  chave_chamador = excluded.chave_chamador,
  modo_auth = excluded.modo_auth,
  ativa = true,
  natureza = excluded.natureza,
  motivo_natureza = excluded.motivo_natureza;

select cron.schedule(
  'miniaturas-de-criativo',
  '*/15 * * * *',
  $cmd$select public.disparar_tarefa_http('miniaturas-de-criativo', 'cron', true);$cmd$
);
