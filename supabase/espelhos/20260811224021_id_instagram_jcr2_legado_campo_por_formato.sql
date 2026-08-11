-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811224021
-- name: id_instagram_jcr2_legado_campo_por_formato
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada via MCP apply_migration
-- espelho gerado pela RPC espelhos_de_migracao a partir de supabase_migrations.schema_migrations
-- NAO transcrito a mao

update public.meta_execution_config
   set instagram_actor_id = '1296945687078272',
       instagram_handle = '@jcr2_legaleviver',
       instagram_identity_page_id = '1095196357012756',
       instagram_identity_page_link_confirmed = false,
       instagram_identity_provenance =
         'Id 1296945687078272 informado pelo Ryan em 11/08/2026, lido por ele na tela Identidade '
         || 'do Gerenciador de Anuncios, para o handle oficial @jcr2_legaleviver. SUBSTITUI o '
         || 'estado anterior (handle gravado com instagram_actor_id NULL) e, antes dele, '
         || '@legaleviver_ / 17841423949227215 e 17841428674060566. Verificacao por leitura: GET '
         || '/1296945687078272 na Graph (sonda meta-identity-probe, request 630) responde erro '
         || '36106 "This legacy Instagram endpoint/object is deprecated" - objeto Instagram LEGADO '
         || 'que EXISTE, com endpoint de leitura descontinuado; distinto do id antigo '
         || '17841428674060566, que respondia 100/subcode 33 "does not exist". RESSALVAS HONESTAS: '
         || '(a) o username nao foi confirmado pela Graph; (b) o vinculo com a pagina '
         || '1095196357012756 nao foi confirmado porque o token nao tem pages_read_engagement e '
         || 'owned_instagram_accounts do Business 3109716642547310 volta vazio - limite de '
         || 'permissao, nao prova de ausencia; por isso instagram_identity_page_link_confirmed '
         || 'permanece false. CAMPO NO SPEC: por ser formato LEGADO (nao 1784...), o valor entra em '
         || 'object_story_spec.instagram_actor_id e nao em instagram_user_id - ver '
         || 'meta-actions.campoIdentidadeInstagramPorFormato (v5.16). Config continua prevalecendo '
         || 'sobre a identidade herdada do molde.'
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

delete from public.contrato_de_execucao
 where acao = 'criar_anuncio_a_partir_de'
   and campo in ('object_story_spec.instagram_actor_id', 'object_story_spec.instagram_user_id');

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('criar_anuncio_a_partir_de','object_story_spec.instagram_actor_id',false,'string',
   'Identidade Instagram LEGADA (id sem o prefixo 1784 de Instagram Business Account). O valor sai '
   || 'de meta_execution_config.instagram_actor_id (config prevalece sobre molde). Campo escolhido '
   || 'pelo FORMATO do id, nao por hardcode. Evidencia do nome do campo: Pipeboard tools/list '
   || '(request 620) mostra create_ad_creative expondo o parametro "instagram_actor_id" '
   || '(Instagram Actor Id). Hoje vale para @jcr2_legaleviver / 1296945687078272.',
   'meta-actions.campoIdentidadeInstagramPorFormato + aplicarIdentidadeInstagramNoSpec',
   true,true,null),
  ('criar_anuncio_a_partir_de','object_story_spec.instagram_user_id',false,'string',
   'Identidade Instagram por Instagram Business Account id (formato 1784 + 13 digitos). Usado '
   || 'automaticamente quando o id da config tiver esse formato. Evidencia do nome do campo: '
   || 'Pipeboard create_existing_post_ad_creative expoe "instagram_user_id" descrito como '
   || '"Instagram business account ID". Hoje NAO se aplica: o id oficial da empresa e legado.',
   'meta-actions.campoIdentidadeInstagramPorFormato + aplicarIdentidadeInstagramNoSpec',
   true,true,null);

update public.agent_context
   set vigente = false, atualizado = now()
 where vigente
   and fato ilike 'IDENTIDADE INSTAGRAM OFICIAL%';

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'IDENTIDADE INSTAGRAM OFICIAL = @jcr2_legaleviver, id 1296945687078272 (informado pelo Ryan em '
  || '11/08/2026, lido na Identidade do Gerenciador). Sempre selecione esta identidade quando '
  || 'Instagram for pedido. A config (meta_execution_config) PREVALECE sobre a identidade herdada '
  || 'do molde. CAMPO DO SPEC PELO FORMATO: id no formato 1784+13 digitos e Instagram Business '
  || 'Account e vai em object_story_spec.instagram_user_id; qualquer outro formato e ator LEGADO e '
  || 'vai em object_story_spec.instagram_actor_id. 1296945687078272 e LEGADO, entao vai em '
  || 'instagram_actor_id (Pipeboard create_ad_creative expoe exatamente esse parametro; '
  || 'create_existing_post_ad_creative expoe instagram_user_id como "Instagram business account '
  || 'ID"). RESSALVA a declarar ao gestor: identidade legada; o vinculo com a pagina '
  || '1095196357012756 nao foi confirmado por endpoint autenticado (token sem '
  || 'pages_read_engagement) e o GET direto responde 36106 (endpoint legado descontinuado) - se a '
  || 'Meta recusar a criacao por identidade, revalidar o id no Gerenciador. Threads segue '
  || 'DESABILITADO: identidade Instagram nao habilita Threads.',
  true,
  date '2026-08-11'
);
