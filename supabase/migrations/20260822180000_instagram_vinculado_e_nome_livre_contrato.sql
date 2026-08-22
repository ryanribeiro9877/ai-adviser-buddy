-- v28.62: identidade Instagram da COHAPM + doutrina (nome livre + IG vinculated).
-- Incidente 22/08/2026: cards de criativo nasceram sem Instagram e o AD03 do
-- conjunto 3 foi emitido como [COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26].

-- 1) Identidade Instagram oficial da Page COHAPM (105656372312257).
--    Id IBA observado em 20 linhas de creative_estado_graph desta Page.
update public.meta_execution_config
   set instagram_actor_id = '17841439127453101',
       instagram_identity_page_id = coalesce(nullif(instagram_identity_page_id, ''), page_id, '105656372312257'),
       instagram_identity_provenance = coalesce(
         nullif(instagram_identity_provenance, ''),
         'IBA 17841439127453101 observado em creative_estado_graph da Page 105656372312257 (20 pecas, 22/08/2026). Formato IBA => object_story_spec.instagram_user_id. Sem este id o anuncio nasce sem Instagram vinculated.'
       )
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and (instagram_actor_id is null or btrim(instagram_actor_id) = '');

-- 2) Doutrina universal: nome falado e contrato; Instagram sempre vinculated.
update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and vigente = true
   and (
     fato ilike 'NOME LIVRE JA FALADO%'
     or fato ilike 'INSTAGRAM VINCULATED%'
     or fato ilike '%identidade Instagram da config; nao reabra%'
   );

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  $fato$
NOME LIVRE JA FALADO E CONTRATO + INSTAGRAM VINCULATED (22/08/2026, v28.62).

Se o agente listou os nomes dos criativos nesta conversa (ex.: JUR_CONV_CONJ03_AD01_Emprestimo_Pessoal_LEVA02), ESSES nomes SAO o contrato. params.nome_novo deve ser o string EXATO. Alterar na emissao para [COHAPM][WA][LEADS][JURIDICO][NOVO][AGO26] (ou qualquer [MARCA][CANAL][OBJ]…) e perda de memoria — a emissao recusa com nome_trocado_pelo_padrao_estruturado.

Campanha OUTCOME_TRAFFIC / conjunto WEBSITE + LANDING_PAGE_VIEWS: wa.me fica no CRIATIVO. Isso NAO e familia mensagens. PROIBIDO carimbar canal WA ou objetivo LEADS no nome.

Todo card de criativo com Instagram (padrao facebook+instagram) nasce com a identidade JA vinculada (instagram_user_id da meta_execution_config). Sem id a emissao recusa instagram_nao_vinculado. O gestor nao vincula Instagram a mao no Gerenciador. Threads continua OFF.
$fato$,
  true,
  '2026-08-22',
  null
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'identidade',
  'COHAPM Instagram oficial da Page 105656372312257 = IBA 17841439127453101 (object_story_spec.instagram_user_id). Sem este id o criativo nasce sem Instagram vinculated. Threads OFF. Nao usar identidade da Legal.',
  true,
  '2026-08-22'
);
