-- [F5.6 hardening] Furo de dedup achado pelo Code na revisão do front (29/07):
-- service_name é parte da unique (message_id, service_name) e era NULLABLE. Em Postgres,
-- NULL não colide com NULL em constraint única — linha sem Service Name seria REINSERIDA
-- a cada importação, com o índice "existindo". O parser do front já normaliza vazio -> '-';
-- esta migração fecha o furo NO BANCO para qualquer escritor futuro (defesa em profundidade).

update public.infobip_dispatches set service_name = '-' where service_name is null;

alter table public.infobip_dispatches
  alter column service_name set default '-',
  alter column service_name set not null;

comment on column public.infobip_dispatches.service_name is
  'Canal da linha no export Infobip (WhatsApp Outbound/Inbound/Monthly Active User). NOT NULL com default ''-'': participa da unique de dedup e NULL nao colide com NULL em Postgres (furo achado em 29/07 antes de qualquer dado real).';
