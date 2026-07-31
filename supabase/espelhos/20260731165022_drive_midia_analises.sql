-- [JOB v2.2] Analise VISUAL das midias do Drive - persistida.
--
-- MOTIVO (31/07/2026): o gestor pediu classificacao arquivo a arquivo dos 67 criativos
-- (aproveitavel ou nao para campanha de consignado CLT) e o agente recusou corretamente:
-- a ferramenta do Drive devolve a MINIATURA COMO URL EM TEXTO - o modelo nunca ve os
-- pixels. A capacidade nova e um pipeline de VISAO no job: baixa a miniatura em alta
-- resolucao, entrega os pixels ao modelo em lotes e grava o veredito AQUI.
--
-- POR QUE TABELA (e nao so resposta): 67 analises visuais nao cabem garantidamente em um
-- worker. Persistindo por arquivo (chave drive_file_id + versao do arquivo), cada rodada
-- analisa SO o que falta ou o que mudou - segmentos e devolucoes convergem para 67/67 sem
-- reanalisar nada, e o resultado vira ativo consultavel (nao texto perdido num chat).

create table if not exists public.drive_midia_analises (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  drive_file_id text not null,
  drive_modified_time text,
  nome text not null,
  caminho text,
  formato_pasta text,
  eixo_pasta text,
  mime text,
  produto_detectado text,
  texto_visivel text,
  riscos_compliance text,
  aproveitavel text not null check (aproveitavel in ('sim','nao','incerto')),
  motivo text not null,
  base_da_analise text not null default 'thumbnail',
  modelo text,
  analisado_em timestamptz not null default now(),
  constraint uq_drive_analise unique nulls not distinct (drive_file_id, drive_modified_time)
);

alter table public.drive_midia_analises enable row level security;
create policy drive_midia_analises_select on public.drive_midia_analises
  for select using (public.is_company_member(company_id, auth.uid()));

comment on table public.drive_midia_analises is
  'Classificacao visual (pixels da miniatura em alta resolucao) de cada midia da pasta de criativos do Drive: produto aparente, texto visivel, riscos e veredito aproveitavel/nao/incerto. Chave por arquivo+versao: rodadas sucessivas so analisam o que falta ou mudou. base_da_analise declara o que foi visto (thumbnail, nunca o video interno).';
