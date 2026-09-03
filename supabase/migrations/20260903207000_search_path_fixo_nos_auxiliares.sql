-- Fixa search_path nos tres auxiliares do registro de tarefas e fecha o grant de PUBLIC.
--
-- Motivo: o get_advisors apontou "function_search_path_mutable" nestas tres. Funcao
-- SECURITY DEFINER (ou chamada por uma) sem search_path fixo resolve nome de objeto pelo
-- search_path de QUEM chama, entao um schema plantado na frente do public pode
-- sequestrar a resolucao. As outras funcoes da entrega ja nasceram com
-- `set search_path to 'public'`; estas tres passaram porque sao auxiliares puras e o
-- descuido nao aparece em teste funcional -- so no catalogo.
--
-- Segunda parte: revoga de PUBLIC, nao so de anon/authenticated. Licao registrada em
-- 20260813161344 -- revogar de um papel nao remove o que ele herda do pseudo-papel
-- PUBLIC, e o catalogo (has_function_privilege) e a unica prova que vale.
--
-- Aplicada no remoto como 20260903203558_search_path_fixo_nos_auxiliares.

create or replace function public.janela_de_frescor(p_periodicidade text)
returns timestamp with time zone
language sql
stable
set search_path to 'public'
as $function$
  select case p_periodicidade
           when 'frequente' then now() - interval '15 minutes'
           when 'horaria'   then now() - interval '90 minutes'
           when 'diaria'    then date_trunc('day', now())
           when 'semanal'   then now() - interval '8 days'
           else now() - interval '1 day'
         end
$function$;

create or replace function public.rotulo_severidade(p_sev alert_severity)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_sev
           when 'critical' then 'Critico'
           when 'high'     then 'Alto'
           when 'medium'   then 'Medio'
           when 'low'      then 'Baixo'
         end
$function$;

create or replace function public.url_functions()
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/'
$function$;

revoke all on function public.janela_de_frescor(text)           from public, anon, authenticated;
revoke all on function public.rotulo_severidade(alert_severity)  from public, anon, authenticated;
revoke all on function public.url_functions()                    from public, anon, authenticated;
grant execute on function public.janela_de_frescor(text)           to service_role;
grant execute on function public.rotulo_severidade(alert_severity) to service_role;
grant execute on function public.url_functions()                   to service_role;
