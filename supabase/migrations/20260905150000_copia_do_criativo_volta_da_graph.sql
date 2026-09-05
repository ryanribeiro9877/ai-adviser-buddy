-- COPIA DO CRIATIVO VOLTA DA GRAPH PARA ads.body.
--
-- Medido 05/09/2026, inventário vivo: 97 ACTIVE, 31 criados pelo sistema com cópia
-- verificada, 14 de fora com cópia, 52 de fora SEM cópia. Os 52 têm creative_id;
-- 37 deles têm o asset em media_uploads (mídia subiu pelo sistema, legenda
-- digitada no Gerenciador e nunca voltou). Sem texto o portão não tem o que
-- avaliar — ausência não é conformidade.
--
-- O coletor que já lê o criativo é meta-campaign-status (GET /{id}?fields=... por
-- objeto, tokens META_ADS_TOKEN / META_ADS_TOKEN_COHAPM). Ele já pedia
-- object_story_spec e asset_feed_spec e usava só destino/molde. A v20 grava
-- body/title e carimba legenda_coletada_em. SOMENTE leitura na Meta.
--
-- A tarefa entra no registro. Devolver o número sem declarar a tarefa recria o
-- ponto cego do vigia de frescor: a coluna existe, ninguém pergunta se chegou.

alter table public.ads
  add column if not exists legenda_coletada_em timestamptz;

comment on column public.ads.legenda_coletada_em is
  'Instante em que a Graph devolveu os campos de copia do criativo (body/title/object_story_spec/asset_feed_spec). Nulo = a copia nunca foi lida nesta rota. Body nulo COM esta marca = a Meta respondeu e nao havia texto. Body nulo SEM a marca = cegueira, nao ausencia de legenda.';

insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo,
  timeout_ms, janela_dias, periodicidade, tolerancia_horas,
  tabela_destino, coluna_carimbo, natureza, tolerancia_frescor_horas, ativa, observacao
) values (
  'copia-dos-criativos',
  'Copia dos criativos vivos',
  'Qual e o texto que esta no ar em cada anuncio ACTIVE?',
  'http',
  'meta-campaign-status',
  'cron:meta-campaign-status-0910',
  'x-mcp-key',
  jsonb_build_object('modo', 'copia_criativos'),
  150000,
  null,
  'diaria',
  30,
  'ads',
  'legenda_coletada_em',
  'coleta',
  30,
  true,
  'Um GET Graph por criativo dos ACTIVE sem ads.body. Escreve body/title/legenda_coletada_em. '
  || 'Somente leitura na Meta: nao pausa, nao emite card, nao altera anuncio. Reusa o token Ads '
  || 'da empresa (META_ADS_TOKEN / META_ADS_TOKEN_COHAPM) e a mesma edge do espelho diario. '
  || 'A corrida completa tambem grava a copia quando ja leu o spec; esta tarefa e o backfill '
  || 'e o carimbo que o vigia de frescor consulta.'
)
on conflict (tarefa) do update set
  titulo                   = excluded.titulo,
  pergunta                 = excluded.pergunta,
  tipo                     = excluded.tipo,
  edge                     = excluded.edge,
  chave_chamador           = excluded.chave_chamador,
  modo_auth                = excluded.modo_auth,
  corpo                    = excluded.corpo,
  timeout_ms               = excluded.timeout_ms,
  periodicidade            = excluded.periodicidade,
  tolerancia_horas         = excluded.tolerancia_horas,
  tabela_destino           = excluded.tabela_destino,
  coluna_carimbo           = excluded.coluna_carimbo,
  natureza                 = excluded.natureza,
  tolerancia_frescor_horas = excluded.tolerancia_frescor_horas,
  ativa                    = true,
  observacao               = excluded.observacao;

-- 09:22 UTC (06:22 em Sao Paulo): depois de espelho-meta-diario (09:10), que ja
-- leu os specs, e 48 minutos antes de vigia-frescor-1010. So busca quem ainda
-- nao tem body, entao depois do primeiro preenchimento a corrida tende a 0 GET.
select cron.schedule(
  'meta-copia-criativos-0922',
  '22 9 * * *',
  $cron$select public.disparar_tarefa_http('copia-dos-criativos');$cron$);

-- Conta "Ronaldo Ribeiro": 9 campanhas, todas paused, 0 anuncios, 0 metricas.
-- estado_operacional=ativa fazia a coleta Graph gastar cota numa conta sem
-- entrega. Metadado honesto: parada ≠ ativa. Nada e desligado na Meta.
update public.integrations
   set estado_operacional = 'nao_operacional',
       estado_motivo = 'Medido 05/09/2026: 9 campanhas, todas paused, 0 anuncios no espelho, 0 linhas em ad_metric_snapshots. A conta responde na Graph e o coletor ainda a via como ativa, gastando cota Ads 80004 sem haver o que entregar. Parada operacional ≠ desligada na Meta: nenhum objeto foi pausado ou alterado por esta linha.'
 where provider = 'meta_ads'
   and account_name = 'Ronaldo Ribeiro'
   and estado_operacional = 'ativa';
