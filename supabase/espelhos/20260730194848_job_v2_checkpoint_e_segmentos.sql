-- [JOB v2] Suporte a SEGMENTOS ENCADEADOS no traffic-agent-job.
--
-- MOTIVO: o worker de background tem teto de parede (~400s; orcamento interno 330s). O laco
-- de devolucao coordenador->subagente (validar relatorio, devolver com parecer, re-executar)
-- nao cabe garantidamente em um worker so. Em vez de "burlar" o teto, o job passa a viver em
-- ate 3 SEGMENTOS: ao se aproximar do limite, grava um CHECKPOINT (relatorios ja validados
-- congelados + fila de devolucoes pendentes) e reinvoca a propria edge, que retoma DO PONTO
-- EXATO - nada re-pensado, nada re-coletado. Estado vive no banco, nao na memoria do worker.
alter table public.chat_jobs
  add column if not exists checkpoint jsonb,
  add column if not exists segmento int not null default 1;

comment on column public.chat_jobs.checkpoint is
  'Estado serializado entre segmentos do job v2: pergunta, plano, relatorios validados (congelados), devolucoes pendentes com parecer da coordenacao, rodada atual. NULL = job de segmento unico ou concluido.';
comment on column public.chat_jobs.segmento is
  'Segmento atual do worker (1..3). Cada segmento e uma invocacao nova da edge com orcamento de tempo zerado.';
