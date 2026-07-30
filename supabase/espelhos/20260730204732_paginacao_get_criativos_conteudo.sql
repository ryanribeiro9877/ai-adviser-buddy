-- [JOB v2.1] Paginacao em get_criativos_conteudo - fecha a lacuna "dado truncado".
--
-- PROBLEMA (achado no teste real de 30/07 com a pergunta integral do gestor): a funcao
-- devolve TODOS os criativos num JSON so; a edge corta o payload da ferramenta em ~14000
-- chars para proteger o contexto, e o aviso de corte manda "pedir um recorte mais estreito"
-- - mas NENHUM parametro de recorte existia. 26 de 30 legendas ficaram invisiveis sem
-- caminho de recuperacao: o aviso apontava para uma porta que nao existe.
--
-- FIX: overload com p_offset/p_limit (ordenacao deterministica por gasto desc, empate por
-- nome) + campos total/exibidos/offset/restantes no retorno, para o subagente saber que ha
-- proxima pagina e pedi-la. A versao de 2 argumentos continua valendo (equivale a pagina
-- unica com tudo), preservando o traffic-chat v28 sem mudanca.
-- PROVA (na aplicacao): p1(20) + restantes = total; p2 sem sobreposicao.

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean, p_company_id uuid, p_offset int, p_limit int)
returns jsonb
language sql
stable
as $$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa.')
  else (
    with base as (
      select a.name as anuncio, c.name as campanha, (c.status = 'active') as campanha_ativa,
             a.status as status_anuncio, a.title as titulo, a.body as legenda,
             a.call_to_action_type as cta,
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
      'nota', 'Pagina de criativos ordenada por gasto (maior primeiro). Se restantes > 0, chame de novo com offset = offset + exibidos para a proxima pagina - a lista NAO termina nesta resposta.',
      'criativos', coalesce((select jsonb_agg(to_jsonb(p)) from pag p), '[]'::jsonb)
    )
  )
end;
$$;

comment on function public.get_criativos_conteudo(boolean, uuid, int, int) is
  'Criativos de UMA empresa com PAGINACAO deterministica (gasto desc, nome). Campos total/exibidos/offset/restantes permitem ao agente cobrir a lista inteira em paginas. Usada pelo traffic-agent-job v2.1.';
