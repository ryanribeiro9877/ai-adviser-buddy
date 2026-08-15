-- ESPELHO 20260815130000_purge_jcr2_instagram_legaleviver_underscore
-- Purge operacional de handle Instagram banido; padrao @legaleviver_.
-- (Aplicada via MCP apply_migration no projeto gzjwnjdpxpbmdhcyefvs)

UPDATE public.meta_execution_config
SET
  instagram_actor_id = '17841428674060566',
  instagram_handle = '@legaleviver_',
  instagram_identity_page_id = '1095196357012756',
  instagram_identity_page_link_confirmed = false,
  instagram_identity_provenance =
    'Identidade oficial Legal e Viver: @legaleviver_ / 17841428674060566 '
    || '(Instagram Business Account → object_story_spec.instagram_user_id). '
    || 'Pagina 1095196357012756. Fonte: moldes ativos em creative_estado_graph '
    || '(986920170834987, 1592433379256099). Unico handle aceito em peca nova.',
  updated_at = now()
WHERE company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

DELETE FROM public.agent_context
WHERE fato ILIKE '%jcr2%'
   OR fato ILIKE '%1296945687078272%';

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'criacao',
  $f$
IDENTIDADE INSTAGRAM OFICIAL — LEGAL E VIVER (15/08/2026).
Handle UNICO aceito: @legaleviver_. Id: 17841428674060566 (IBA → object_story_spec.instagram_user_id).
Pagina: 1095196357012756.
Ordem: (1) meta_execution_config; (2) molde creative_estado_graph so se config vazia; (3) sem ambas, nasce SEM identidade — nao inventar.
NUNCA ofereca, sugira, confirme ou use qualquer outro handle Instagram desta empresa. Se o gestor citar outro perfil, recuse e diga que o padrao e @legaleviver_.
$f$,
  true,
  '2026-08-15',
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);
