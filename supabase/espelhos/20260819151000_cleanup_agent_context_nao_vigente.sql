-- Safe cleanup: agent_context rows with vigente=false are historical supersessions.
-- Evidence at apply time: 43 rows, all non-current. No UI/edge reads vigente=false
-- as active context (get_contexto / prompts filter vigente=true).

delete from public.agent_context
where vigente = false;
