-- F5.6 Infobip — endurecimento do dedup no nível do banco.
-- CONTEXTO: uq_infobip_message era UNIQUE (message_id, service_name) padrão
-- (NULLS DISTINCT): linha com service_name NULL nunca colide, então reimportação
-- duplicaria essas linhas. O parser do front já cai para '-' (fix do Code,
-- commit d8e6185), mas o banco ficava permissivo para qualquer escritor futuro
-- que não passe pelo parser (edge, script, SQL manual).
-- FIX: NULLS NOT DISTINCT (PG15+) — NULL colide com NULL. ON CONFLICT
-- (message_id, service_name) continua inferindo esta constraint normalmente.
-- Aplicado com a tabela vazia (0 linhas em 29/07) — zero risco de conflito.
ALTER TABLE public.infobip_dispatches DROP CONSTRAINT uq_infobip_message;
ALTER TABLE public.infobip_dispatches ADD CONSTRAINT uq_infobip_message
  UNIQUE NULLS NOT DISTINCT (message_id, service_name);
