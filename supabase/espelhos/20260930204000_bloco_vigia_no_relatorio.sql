-- Bloco do relatorio das 08:30. Fica em post_daily_report, nao em montar_corpo_digest:
-- o e-mail consome o digest e esta entrega nao manda e-mail.

create or replace function public.bloco_vigia_de_regua(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_planos text;
  v_vereditos text;
begin
  select coalesce(string_agg(
           '- ' || alvo_nome || ' (' || nivel || '): custo ' || coalesce(custo_observado::text, 'indefinido')
           || ' contra regua ' || regua_valor::text
           || coalesce(' · ' || alavanca, ' · sem alavanca')
           || ' · ' || status,
           e'\n' order by custo_observado desc nulls last),
         '- nenhum plano novo hoje')
    into v_planos
    from public.planos_de_ajuste_de_custo
   where company_id = p_company_id
     and (criado_em::date = current_date or atualizado_em::date = current_date);

  select coalesce(string_agg(
           '- ' || alvo_nome || ': ' || status
           || coalesce(' (custo na leitura ' || custo_na_verificacao::text || ')', '')
           || coalesce(' — ' || veredito_nota, ''),
           e'\n' order by verificado_em desc),
         '- nenhuma verificacao hoje')
    into v_vereditos
    from public.planos_de_ajuste_de_custo
   where company_id = p_company_id
     and verificado_em::date = current_date;

  return '## Custo por conversa acima da régua' || e'\n\n'
    || '**Planos do dia**' || e'\n' || v_planos || e'\n\n'
    || '**O que a leitura de prazo concluiu**' || e'\n' || v_vereditos;
end;
$function$;

revoke all on function public.bloco_vigia_de_regua(uuid) from public, anon, authenticated;
grant execute on function public.bloco_vigia_de_regua(uuid) to service_role;

do $patch$
declare
  v_def text;
  v_alvo constant text := 'corpo := public.montar_corpo_digest(emp.id, current_date - 1);';
  v_troca text;
begin
  select pg_get_functiondef('public.post_daily_report()'::regprocedure) into v_def;
  if v_def like '%bloco_vigia_de_regua%' then
    raise notice 'post_daily_report ja inclui o vigia';
    return;
  end if;
  if position(v_alvo in v_def) = 0 then
    raise exception 'ancora do post_daily_report nao encontrada; o bloco do vigia nao foi encaixado';
  end if;
  v_troca := 'corpo := public.montar_corpo_digest(emp.id, current_date - 1) || chr(10) || chr(10) || coalesce(public.bloco_vigia_de_regua(emp.id), '''');';
  execute replace(v_def, v_alvo, v_troca);
end;
$patch$;
