-- ============================================================================
-- ESPELHO: GT-13 — a leitura visual do Drive expõe o identificador da peça
-- Projeto: gestão_marketing (gzjwnjdpxpbmdhcyefvs) · Aplicada: 05/08/2026
-- Migração: 20260805113550_gt13_get_drive_analises_expoe_id_e_biblioteca
-- md5 do conteúdo aplicado: 969c925a4245ca58fcfcf2a974ed584e
-- ATENÇÃO: espelho para git. NÃO re-executar.
--
-- POR QUE EXISTE: o agente sabia dizer "o vídeo tal é o melhor" e NÃO sabia dizer
--   qual arquivo era — o drive_file_id era lido do Drive e descartado antes de
--   chegar a ele. Sem identificador, peça do acervo não vira anúncio.
-- ja_enviada_para_meta vem de media_uploads (19 arquivos com meta_video_id), não
--   de palpite. Sem esse campo o agente proporia peça que não subiu, e o card
--   morreria na execução — depois da aprovação humana, que é o ato que gasta.
-- CUIDADO AO EDITAR: o campo é remontado FORA do jsonb_strip_nulls de propósito.
--   Dentro dele, `false` não seria removido (strip_nulls só tira null), mas a
--   montagem explícita deixa a intenção no código: false TEM de aparecer, senão
--   ausência viraria indistinguível de "não verificado".
-- Verificado após aplicar: 134 itens, 134 com drive_file_id, 134 com a flag,
--   38 com true (19 arquivos × 2 bases de leitura), 96 com false visível.
-- ============================================================================
-- (corpo idêntico ao aplicado, extraído do banco)
create or replace function public.get_drive_analises(p_company_id uuid)
 returns jsonb
 language sql
 stable
as $function$
select case when p_company_id is null then
  jsonb_build_object('erro', 'p_company_id e obrigatorio')
else (
  with a as (
    select d.drive_file_id,
           (coalesce(d.caminho,'') || '/' || d.nome) as arquivo,
           d.produto_detectado as produto,
           upper(left(d.aproveitavel,1)) as v,
           case when not d.aprovado_pelo_gestor then true end as sem_aprovacao,
           case when d.aprovado_pelo_gestor and d.aproveitavel = 'nao' then true end as div,
           case when d.aproveitavel in ('sim','incerto') then left(d.motivo, 70) end as motivo,
           nullif(left(coalesce(d.riscos_compliance,''), 55), '') as risco,
           -- NAO usa jsonb_strip_nulls para este campo: false tem de aparecer. Se ele desaparecesse
           -- quando falso, ausencia viraria indistinguivel de "nao verificado".
           exists (select 1 from public.media_uploads m
                    where m.drive_file_id = d.drive_file_id and m.meta_video_id is not null)
             as ja_enviada_para_meta,
           d.aprovado_pelo_gestor as g_calc, d.aproveitavel as ap_calc
    from public.drive_midia_analises d
    where d.company_id = p_company_id
    order by case d.aproveitavel when 'sim' then 1 when 'incerto' then 2 else 3 end, d.caminho, d.nome
  )
  select jsonb_build_object(
    'total_analisados', (select count(*) from a),
    'resumo', jsonb_build_object(
       'aprovados_pelo_gestor', (select count(*) from a where g_calc),
       'visual_sim', (select count(*) from a where v='S'),
       'visual_nao', (select count(*) from a where v='N'),
       'visual_incerto', (select count(*) from a where v='I'),
       'divergencias', (select count(*) from a where div),
       'ja_na_biblioteca_da_conta', (select count(*) from a where ja_enviada_para_meta)),
    'nota', 'DUAS CAMADAS. (1) OPERACIONAL: por decisao do gestor (audio 31/07 - acervo inteiro avaliado por copy e gestor de trafego, ordem de usar todos), TODA peca listada esta APROVADA para uso, salvo as marcadas sem_aprovacao=true (pecas novas ainda sem decisao humana). Ao operar, cite a decisao e a data. (2) VISUAL (informacao, nunca veto): v S/N/I = o que os pixels mostram. div=true significa: liberada MAS o visual aparenta OUTRO produto - DECLARE isso como nota ao recomendar, nunca esconda nem recuse. Universo criativo da marca: credito CLT + educacao financeira + dicas de seguranca. Texto visivel por peca existe no banco. PARA CRIAR ANUNCIO: use drive_file_id, nao o nome. ja_enviada_para_meta=false significa que a peca ainda NAO esta na biblioteca da conta - ela nao pode ser publicada assim, e propor anuncio com ela faria o card falhar depois de aprovado.',
    'itens', (select coalesce(jsonb_agg(
                jsonb_strip_nulls(to_jsonb(x) - 'g_calc' - 'ap_calc' - 'ja_enviada_para_meta')
                || jsonb_build_object('ja_enviada_para_meta', x.ja_enviada_para_meta)
              ), '[]'::jsonb) from a x)
  )
)
end;
$function$;
