-- ESPELHO 20260815123000_instagram_oficial_volta_legaleviver
-- Corrige config Legal: @legaleviver / 17841428674060566 (moldes vivos).
-- jcr2 rejeitado pela Meta em 15/08 no card 07864d27.

UPDATE public.meta_execution_config
SET
  instagram_actor_id = '17841428674060566',
  instagram_handle = '@legaleviver',
  instagram_identity_page_id = '1095196357012756',
  instagram_identity_page_link_confirmed = false,
  instagram_identity_provenance =
    'Corrigido 15/08/2026 apos incidente card 07864d27: create_ad_creative com @jcr2_legaleviver '
    || '(1296945687078272) foi recusado pela Meta (Instagram account not authorized for advertising). '
    || 'Identidade oficial = @legaleviver / 17841428674060566, observada HOJE em creative_estado_graph '
    || 'nos moldes de video 986920170834987 e 1592433379256099 (pagina 1095196357012756). '
    || 'Formato IBA (1784...) => object_story_spec.instagram_user_id. '
    || 'O id jcr2 (decisao Ryan 11/08) permanece documentado como tentativa rejeitada pela Meta em publicidade.',
  updated_at = now()
WHERE company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

UPDATE public.agent_context
SET vigente = false, atualizado = now()
WHERE vigente
  AND (
    (company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf' AND (
      fato ILIKE 'IDENTIDADE INSTAGRAM NA CRIACAO%'
      OR fato ILIKE 'IDENTIDADE INSTAGRAM OFICIAL%'
    ))
    OR (company_id IS NULL AND fato ILIKE 'IDENTIDADE INSTAGRAM OFICIAL%')
  );

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'criacao',
  $f$
IDENTIDADE INSTAGRAM OFICIAL — LEGAL E VIVER (corrigido 15/08/2026).
Handle: @legaleviver. Id: 17841428674060566 (Instagram Business Account → object_story_spec.instagram_user_id).
Pagina: 1095196357012756. Evidencia: creative_estado_graph nos moldes 986920170834987 e 1592433379256099 (observado 15/08).
Ordem na criacao: (1) meta_execution_config da empresa; (2) se sem config, molde em creative_estado_graph; (3) sem ambas, nasce SEM identidade (nao inventar).
NAO usar @jcr2_legaleviver / 1296945687078272 em peca nova: em 15/08 a Meta recusou com "Instagram account not authorized for advertising" (card 07864d27).
Se o gestor pedir outra identidade, atualize meta_execution_config ANTES de emitir card — nao pergunte id no chat se a config ja esta certa.
$f$,
  true,
  '2026-08-15',
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'armadilha',
  $f2$
ARMADILHA 15/08 — INSTAGRAM ERRADO NO CARD.
O agente citou @legaleviver no chat (doutrina velha) mas o executor usou @jcr2 da meta_execution_config.
Resultado: card aprovado, create_ad_creative FALHOU (conta IG nao autorizada para ads). Nada foi ao ar.
Regra: a identidade que sobe e SEMPRE a da config; o chat deve LER a config (ler_brand_identity / meta_execution_config) e declarar o handle REAL do card ANTES da aprovacao, sem oferecer id divergente.
$f2$,
  true,
  '2026-08-15',
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);
