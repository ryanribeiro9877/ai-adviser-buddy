-- [FIX ISOLAMENTO] get_criativos_conteudo vazava criativos ENTRE EMPRESAS.
--
-- BUG (achado na auditoria de 30/07/2026 da resposta do agente ao gestor): a funcao varria
-- public.ads inteira sem filtro de company_id. Consequencia real: as "31 legendas do
-- portfolio" incluiam 1 peca da COHAPM (Residencial La Felicita, imobiliaria) tratada como
-- peca do portfolio de CREDITO da Legal e Viver. O agente ate desconfiou ("contaminacao
-- entre contas") mas nao tinha como saber - a ferramenta entregava o dado ja misturado.
--
-- CORRECAO EM DUAS CAMADAS (a assinatura antiga e chamada pela edge, que nao pode quebrar):
--  (1) NOVA assinatura com p_company_id OBRIGATORIO (null => erro) - a edge migra p/ ela.
--  (2) LEGADA recriada com o MESMO contrato (default true preservado), mas cada criativo
--      agora carrega o campo 'empresa' e a resposta abre com AVISO de que a listagem nao
--      esta filtrada - contaminacao silenciosa vira dado rotulado que o modelo separa
--      sozinho ate a edge migrar.
-- PROVA (30/07): nova versao - Legal 67 criativos SEM La Felicita, COHAPM 35, null => erro;
-- legada - aviso presente e os 35 da COHAPM rotulados com o campo empresa.

drop function if exists public.get_criativos_conteudo(boolean);

create or replace function public.get_criativos_conteudo(p_somente_ativas boolean, p_company_id uuid)
returns jsonb
language sql
stable
as $$
select case
  when p_company_id is null then
    jsonb_build_object('erro', 'p_company_id e obrigatorio: criativos sao sempre de UMA empresa. Passe o id da empresa da conversa.')
  else (
    select jsonb_build_object(
      'total', count(*),
      'empresa', (select name from public.companies where id = p_company_id),
      'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA) da empresa selecionada. Use junto com check_compliance para auditar as pecas em operacao.',
      'criativos', coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name,
          'campanha', c.name,
          'campanha_ativa', (c.status = 'active'),
          'status_anuncio', a.status,
          'titulo', a.title,
          'legenda', a.body,
          'cta', a.call_to_action_type,
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
$$;

create function public.get_criativos_conteudo(p_somente_ativas boolean default true)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'total', count(*),
  'AVISO_IMPORTANTE', 'Esta listagem NAO esta filtrada por empresa: contem criativos de TODAS as empresas do sistema. Cada item traz o campo empresa - IGNORE os que nao forem da empresa da conversa e diga que fez esse filtro. A versao correta desta ferramenta recebe a empresa como parametro.',
  'nota', 'Conteudo real dos anuncios (legenda, titulo, CTA) ja coletado pelo sync. Use junto com check_compliance para auditar as pecas em operacao sem pedir texto ao usuario.',
  'criativos', coalesce(jsonb_agg(jsonb_build_object(
      'empresa', (select name from public.companies co where co.id = a.company_id),
      'anuncio', a.name,
      'campanha', c.name,
      'campanha_ativa', (c.status = 'active'),
      'status_anuncio', a.status,
      'titulo', a.title,
      'legenda', a.body,
      'cta', a.call_to_action_type,
      'tem_imagem', (a.image_url is not null or a.thumbnail_url is not null),
      'gasto_acumulado', round(coalesce(a.spend,0)::numeric,2),
      'formularios', a.form_leads
    ) order by coalesce(a.spend,0) desc), '[]'::jsonb)
)
from public.ads a
left join public.campaigns c on c.id = a.campaign_id
where (not p_somente_ativas or c.status = 'active') and a.body is not null;
$$;

comment on function public.get_criativos_conteudo(boolean, uuid) is
  'Criativos (legenda/titulo/CTA) de UMA empresa - p_company_id obrigatorio. Versao correta; a edge deve migrar para esta.';
comment on function public.get_criativos_conteudo(boolean) is
  'LEGADA - nao filtra por empresa. Mantida so por compatibilidade com a edge atual; cada item carrega o campo empresa e a resposta abre com aviso. Migrar a edge para a versao com p_company_id e aposentar esta.';
