-- Paridade das RPCs de conteudo de criativos: as versoes 2-arg e 4-arg (usadas pelos
-- caminhos "listar ativos" de traffic-chat e traffic-agent-job) so devolviam tem_imagem
-- (boolean) e NAO traziam object_type nem destino_url. Isso fez o agente concluir
-- "todos imagem" (quando eram VIDEO) e "numero de WhatsApp nao confirmado" a partir de
-- item sem os campos. Trazemos essas versoes a paridade com a de 5-arg: object_type,
-- destino_url, destino (whatsapp/site/desconhecido), external_id e creative_id.
-- A legenda continua INTEGRAL aqui (o dedupe de compliance na edge depende dela).

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean, p_company_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa. Passe o id da empresa da conversa.')
  else (
    select jsonb_build_object(
      'total', count(*),
      'empresa', (select name from public.companies where id = p_company_id),
      'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA, formato e destino) da empresa selecionada. object_type diz o formato (VIDEO/IMAGE/etc); destino_url e o link do CTA e destino=whatsapp (wa.me/<numero>) prova que a peca manda para o WhatsApp. Use junto com check_compliance.',
      'criativos', coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name,
          'external_id', a.external_id,
          'creative_id', a.creative_id,
          'campanha', c.name,
          'campanha_ativa', (c.status = 'active'),
          'status_anuncio', a.status,
          'object_type', a.object_type,
          'titulo', a.title,
          'legenda', a.body,
          'cta', a.call_to_action_type,
          'destino_url', a.destination_url,
          'destino', case
            when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
            when a.destination_url ~* '^https?://' then 'site'
            else 'desconhecido'
          end,
          'tem_imagem', (a.image_url is not null or a.thumbnail_url is not null),
          'gasto_acumulado', round(coalesce(a.spend,0)::numeric,2),
          'formularios', a.form_leads
        ) order by coalesce(a.spend,0) desc), '[]'::jsonb)
    )
    from public.ads a
    left join public.campaigns c on c.id = a.campaign_id
    where a.company_id = p_company_id
      and (not p_somente_ativas or c.status = 'active')
      and a.body is not null
  )
end;
$function$;

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean, p_company_id uuid, p_offset integer, p_limit integer)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa.')
  else (
    with base as (
      select a.name as anuncio, a.external_id, a.creative_id, a.object_type,
             c.name as campanha, (c.status = 'active') as campanha_ativa,
             a.status as status_anuncio, a.title as titulo, a.body as legenda,
             a.call_to_action_type as cta,
             a.destination_url as destino_url,
             case
               when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
               when a.destination_url ~* '^https?://' then 'site'
               else 'desconhecido'
             end as destino,
             (a.image_url is not null or a.thumbnail_url is not null) as tem_imagem,
             round(coalesce(a.spend,0)::numeric,2) as gasto_acumulado, a.form_leads as formularios
      from public.ads a
      left join public.campaigns c on c.id = a.campaign_id
      where a.company_id = p_company_id
        and (not p_somente_ativas or c.status = 'active')
        and a.body is not null
      order by coalesce(a.spend,0) desc, a.name
    ),
    tot as (select count(*) as n from base),
    pag as (select * from base offset greatest(coalesce(p_offset,0),0) limit coalesce(nullif(p_limit,0), 2147483647))
    select jsonb_build_object(
      'total', (select n from tot),
      'exibidos', (select count(*) from pag),
      'offset', greatest(coalesce(p_offset,0),0),
      'restantes', greatest((select n from tot) - greatest(coalesce(p_offset,0),0) - (select count(*) from pag), 0),
      'empresa', (select name from public.companies where id = p_company_id),
      'nota', 'Pagina de criativos ordenada por gasto (maior primeiro). object_type=formato, destino_url=link do CTA, destino=whatsapp/site. Se restantes > 0, chame de novo com offset = offset + exibidos.',
      'criativos', coalesce((select jsonb_agg(to_jsonb(p)) from pag p), '[]'::jsonb)
    )
  )
end;
$function$;

grant execute on function public.get_criativos_conteudo(boolean, uuid) to anon, authenticated, service_role;
grant execute on function public.get_criativos_conteudo(boolean, uuid, integer, integer) to anon, authenticated, service_role;
