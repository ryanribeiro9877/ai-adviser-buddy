-- Busca de anuncio tambem casa o nome do conjunto.
-- "CONJ.4_LAF" nao e substring de WA_LAF_C4_*, mas "CONJ.4" e substring
-- de LAF_WA_CONJ.4_*. Sem o conjunto na busca, o card de pausa nao acha alvo.

create or replace function public.get_criativos_conteudo(
  p_somente_ativas boolean,
  p_company_id uuid,
  p_offset integer,
  p_limit integer,
  p_busca_nome text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with base as (
  select a.name as anuncio, a.external_id, a.creative_id, a.object_type, a.status,
         a.body as legenda, a.title as titulo, a.call_to_action_type as cta,
         a.destination_url as destino_url,
         case
           when a.destination_url ~* 'wa\.me|api\.whatsapp|whatsapp\.com' then 'whatsapp'
           when a.destination_url ~* '^https?://' then 'site'
           else 'desconhecido'
         end as destino,
         round(coalesce(a.spend,0)::numeric,2) as gasto, a.form_leads as formularios,
         c.name as campanha,
         s.name as conjunto,
         (c.status = 'ACTIVE') as campanha_ativa
    from public.ads a
    left join public.campaigns c on c.id = a.campaign_id
    left join public.ad_sets s on s.external_id = a.adset_external_id
   where coalesce(a.company_id, c.company_id) = p_company_id
     and (not p_somente_ativas or a.status = 'ACTIVE')
     and (
       p_busca_nome is null
       or a.name ilike '%' || p_busca_nome || '%'
       or s.name ilike '%' || p_busca_nome || '%'
     )
     and public.status_objeto_operacional(a.status)
     and public.status_objeto_operacional(c.status)
), pag as (
  select * from base order by gasto desc, anuncio limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'busca_por_nome', p_busca_nome,
  'total_que_casam_com_a_busca', (select count(*) from base),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from base) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'anuncios', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'como_usar', 'Para ACHAR um anuncio especifico, passe parte do nome em busca_nome em vez de folhear a lista inteira. CONJ.N tambem casa o nome do conjunto. DELETED/ARCHIVED nao casam: zero aqui pode ser peca exclusa, nao peca que nunca existiu.',
  'nota', 'legenda e o corpo do anuncio; titulo e cta vem do criativo. destino_url e o link do CTA: destino=whatsapp (wa.me/<numero>) prova que a peca manda para o WhatsApp; destino=site aponta para pagina. DELETED/ARCHIVED ficam de fora.'
);
$function$;
