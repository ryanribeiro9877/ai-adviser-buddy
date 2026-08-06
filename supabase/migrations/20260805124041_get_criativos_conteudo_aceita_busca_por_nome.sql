-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805124041
-- name: get_criativos_conteudo_aceita_busca_por_nome
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 05/08/2026 - O AGENTE NAO CONSEGUIA PROCURAR ANUNCIO POR NOME, so folhear.
--
-- CASO QUE EXPOS: pedi ao agente para herdar a legenda de "AD_LPV2_A2_Reel04". O anuncio EXISTE
-- (creative_id 1481348239583700, 13 formularios, object_type VIDEO, legenda de CLT). Ele nao
-- achou: as tres assinaturas de get_criativos_conteudo aceitam apenas somente_ativas, empresa e
-- paginacao - nenhum filtro por nome. Com 67 anuncios em paginas de 20 e o corte de payload
-- adiante, ele viu um subconjunto e declarou honestamente que o anuncio "pode existir e nao ter
-- sido devolvido" (R3b aplicada corretamente, truncamento nao e inexistencia). Mas o pedido travou
-- por falta de um filtro, nao por falta de dado.
--
-- MESMO DEFEITO ESTRUTURAL do drive_file_id consertado em 04/08: o agente sabe o NOME do objeto e
-- nao tem como APONTAR para ele. Folhear nao substitui procurar - com 67 itens ainda da, com 300
-- nao da, e o custo de payload cresce enquanto a chance de achar cai.
--
-- Sobrecarga NOVA com busca. As tres antigas ficam - remover quebraria chamada existente, e a
-- licao de ontem foi que acrescentar parametro com default cria sobrecarga em vez de substituir.
CREATE OR REPLACE FUNCTION public.get_criativos_conteudo(
  p_somente_ativas boolean,
  p_company_id uuid,
  p_offset integer,
  p_limit integer,
  p_busca_nome text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
with base as (
  select a.name as anuncio, a.external_id, a.creative_id, a.object_type, a.status,
         a.body as legenda, a.title as titulo, a.call_to_action_type as cta,
         round(coalesce(a.spend,0)::numeric,2) as gasto, a.form_leads as formularios,
         c.name as campanha
    from public.ads a
    left join public.campaigns c on c.id = a.campaign_id
   where coalesce(a.company_id, c.company_id) = p_company_id
     and (not p_somente_ativas or a.status = 'ACTIVE')
     and (p_busca_nome is null or a.name ilike '%' || p_busca_nome || '%')
), pag as (
  select * from base order by gasto desc, anuncio limit greatest(p_limit,1) offset greatest(p_offset,0)
)
select jsonb_build_object(
  'busca_por_nome', p_busca_nome,
  'total_que_casam_com_a_busca', (select count(*) from base),
  'nesta_pagina', (select count(*) from pag),
  'restantes', greatest((select count(*) from base) - greatest(p_offset,0) - (select count(*) from pag), 0),
  'anuncios', coalesce((select jsonb_agg(to_jsonb(pag) order by pag.gasto desc) from pag), '[]'::jsonb),
  'como_usar', 'Para ACHAR um anuncio especifico, passe parte do nome em busca_nome em vez de folhear a lista inteira - com 67 anuncios a lista e cortada no payload e o que voce procura pode nao vir. Se total_que_casam_com_a_busca for ZERO, o anuncio realmente nao existe com esse nome nesta empresa; se for maior que zero e restantes tambem, PAGINE. Nunca conclua ausencia a partir de uma pagina.',
  'nota', 'legenda e o texto do corpo do anuncio; titulo e cta vem do criativo conforme coletado. Anuncio com object_type SHARE e criativo flexivel (Advantage+) e NAO expoe estrutura para copiar.'
);
$$;

REVOKE ALL ON FUNCTION public.get_criativos_conteudo(boolean, uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_criativos_conteudo(boolean, uuid, integer, integer, text) TO authenticated, service_role;