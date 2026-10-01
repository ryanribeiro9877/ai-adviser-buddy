-- SEG-02: sete SECURITY DEFINER nasciam com EXECUTE para PUBLIC, e o anon herda PUBLIC.
-- has_function_privilege('anon', ...) era true em 30/09/2026. Revogar so de anon nao
-- tira o que vem de PUBLIC (licao de 20260813161344).
--
-- definir_regua_de_marca GRAVA. A guarda antiga
--   if auth.uid() is not null and not is_company_member(...)
-- deixava o anon passar, porque o uid dele e nulo. Agora a ausencia de membro recusa,
-- e so administrador escreve.

create or replace function public.definir_regua_de_marca(
  p_company_id uuid,
  p_metric text,
  p_marca text,
  p_valor numeric,
  p_decidido_por text,
  p_citacao text,
  p_provisoria boolean default false,
  p_revisar_em date default null,
  p_denominador text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_den text;
  v_anterior numeric;
begin
  if p_company_id is null or p_metric is null then
    raise exception 'definir_regua_de_marca exige empresa e metrica';
  end if;
  if not public.is_company_member(p_company_id, auth.uid()) then
    raise exception 'sem permissao nesta empresa';
  end if;
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'somente administrador altera a regua de marca';
  end if;
  if p_marca is not null and not exists (
       select 1 from public.brand_identity b
        where b.company_id = p_company_id and b.vigente and b.marca_nome = p_marca) then
    raise exception 'marca "%" nao esta cadastrada e vigente em brand_identity para esta empresa. A regua tem de casar exatamente com o nome que linha_de_produto_do_nome() devolve, senao ela nunca sera encontrada.', p_marca;
  end if;
  if p_valor is not null and p_valor <= 0 then
    raise exception 'regua tem de ser maior que zero (recebido: %)', p_valor;
  end if;
  if p_valor is not null and coalesce(btrim(p_decidido_por),'') = '' then
    raise exception 'definir_regua_de_marca exige p_decidido_por: regua sem autor nao da para auditar depois';
  end if;

  v_den := coalesce(p_denominador, case p_metric
    when 'custo_por_conversa'    then 'messaging_started'
    when 'custo_por_formulario'  then 'form_leads'
    when 'custo_por_clique_link' then 'link_clicks'
    else null end);

  if p_valor is not null and v_den is null then
    raise exception 'metrica "%" nao tem denominador conhecido: passe p_denominador explicitamente. Foi a ausencia de denominador declarado que produziu o custo_por_lead_lp que media clique no link.', p_metric;
  end if;

  select valor into v_anterior from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
     and marca is not distinct from p_marca;

  update public.metas_de_negocio
     set vigente = false
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
     and marca is not distinct from p_marca;

  if p_valor is not null then
    insert into public.metas_de_negocio
      (company_id, metric, marca, denominador, valor, tipo, provisoria, revisar_em,
       decidido_por, decidido_em, citacao_da_decisao, memoria)
    values
      (p_company_id, p_metric, p_marca, v_den, p_valor, 'gate',
       coalesce(p_provisoria, false), p_revisar_em,
       p_decidido_por, current_date,
       coalesce(nullif(btrim(p_citacao),''), 'sem citacao registrada'),
       jsonb_build_object('valor_anterior', v_anterior, 'trocado_em', now(),
                          'via', 'definir_regua_de_marca'));
  end if;

  return public.teto_vigente_da_marca(p_company_id, p_metric, p_marca)
         || jsonb_build_object('valor_anterior', v_anterior);
end;
$function$;

comment on function public.definir_regua_de_marca(uuid, text, text, numeric, text, text, boolean, date, text) is
  'Cria ou troca a regua de negocio de uma marca. Exige membro da empresa E administrador. p_valor nulo retira a regua. A versao anterior fica vigente=false.';

revoke execute on function public.definir_regua_de_marca(uuid, text, text, numeric, text, text, boolean, date, text) from public, anon;
revoke execute on function public.get_waba_phones(uuid, text) from public, anon;
revoke execute on function public.videos_com_audio_pendente(integer) from public, anon;
revoke execute on function public.contar_videos_com_audio_pendente() from public, anon;
revoke execute on function public.vigiar_portao_de_compliance() from public, anon;
revoke execute on function public.ramos_da_empresa(uuid) from public, anon;
revoke execute on function public.ultimo_carimbo_no_destino(text, text, uuid, text, text) from public, anon;

grant execute on function public.definir_regua_de_marca(uuid, text, text, numeric, text, text, boolean, date, text) to authenticated, service_role;
grant execute on function public.get_waba_phones(uuid, text) to service_role;
grant execute on function public.videos_com_audio_pendente(integer) to service_role;
grant execute on function public.contar_videos_com_audio_pendente() to service_role;
grant execute on function public.vigiar_portao_de_compliance() to service_role;
grant execute on function public.ramos_da_empresa(uuid) to service_role;
grant execute on function public.ultimo_carimbo_no_destino(text, text, uuid, text, text) to service_role;
