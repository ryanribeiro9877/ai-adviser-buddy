-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806200726
-- name: contrato_criar_anuncio_derivado_do_meta_actions
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Cursor via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONTRATO criar_anuncio_a_partir_de · derivado do codigo atual de
-- supabase/functions/meta-actions/index.ts, funcao montarCriacao (bloco L522-L630)
-- e leitura de conta_destino no executor (L880-L881).
-- Idempotente: on conflict do nothing no unique (acao, campo, vigente).
-- url_tags NAO vai no nivel do anuncio (Graph 400 #100); vai no body do adcreative (L597, L620).

insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte) values
(
  'criar_anuncio_a_partir_de',
  'creative_id',
  true,
  'text',
  'id do adcreative do anuncio MOLDE; montarCriacao recusa sem ele',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L523 e L529-L530 (payload incompleto se ausente)'
),
(
  'criar_anuncio_a_partir_de',
  'conjunto_destino_external_id',
  true,
  'text',
  'external_id do adset que recebe o anuncio; vira adset_id no body do POST /ads',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L524 e L529-L530; body.adset_id em L590 e L612'
),
(
  'criar_anuncio_a_partir_de',
  'nome_novo',
  true,
  'text',
  'nome do anuncio que nasce; vira body.name no POST /ads',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L525 e L529-L530; body.name em L590 e L612'
),
(
  'criar_anuncio_a_partir_de',
  'conta_destino',
  true,
  'text',
  'formato act_<id>; executor bloqueia se vazia ou fora de contas_permitidas_criacao',
  'supabase/functions/meta-actions/index.ts · executor de criacao · L880-L881 (actId(payload.conta_destino))'
),
(
  'criar_anuncio_a_partir_de',
  'status_inicial',
  true,
  'text',
  'contrato operacional PAUSED: montarCriacao FORCA status=PAUSED no body (nao le o payload)',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L590 e L612 (status: \"PAUSED\" hardcoded)'
),
(
  'criar_anuncio_a_partir_de',
  'url_tags',
  false,
  'text',
  'UTM string. NAO vai no POST /ads; so no body do adcreative novo (url_tags). Sem object_story_spec, modo reusar_creative_id herda UTMs do molde',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L526 (leitura); L597 e L620 (criativo.body.url_tags); cabecalho L80-L84'
),
(
  'criar_anuncio_a_partir_de',
  'meta_video_id',
  false,
  'text',
  'se presente, ativa rota PECA NOVA (copia object_story_spec e troca video_id); sem ele e replicacao pura',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L527 e ramo if (videoNovo) L548-L607'
),
(
  'criar_anuncio_a_partir_de',
  'legenda',
  false,
  'text',
  'so usada na rota peca nova: substitui video_data.message quando nao vazia',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L528 e L585 (if legendaNova) novoVd.message'
),
(
  'criar_anuncio_a_partir_de',
  'thumbnail_url',
  false,
  'text',
  'opcional na rota peca nova; se ausente, escolherThumbnail resolve capa por peso no video novo',
  'supabase/functions/meta-actions/index.ts · montarCriacao · L577 (escolherThumbnail(videoNovo, p.thumbnail_url))'
)
on conflict do nothing;

comment on table public.contrato_de_execucao is
  'Campos que o executor (meta-actions) exige por acao. So entra por EVIDENCIA: payload de card que executou com sucesso, ou declaracao explicita de quem le o codigo do executor. Acao sem linhas aqui = contrato DESCONHECIDO, e pedido para ela deve ser RECUSADO, nao adivinhado. criar_anuncio_a_partir_de declarado em 06/08/2026 a partir de montarCriacao L522-L630.';
