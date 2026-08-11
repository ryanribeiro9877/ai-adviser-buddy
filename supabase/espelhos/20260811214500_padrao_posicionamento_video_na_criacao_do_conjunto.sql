-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811212533
-- name: padrao_posicionamento_video_na_criacao_do_conjunto
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- PADRAO OBRIGATORIO DE POSICIONAMENTO DE VIDEO NA CRIACAO DO CONJUNTO.
-- Decisao do Ryan (11/08/2026) + auditoria read-only dos 3 conjuntos de video ACTIVE, que provaram
-- o MESMO targeting manual: publisher_platforms=["facebook"] e 8 facebook_positions, SEM
-- right_hand_column. A exclusao da Coluna da direita deixa de ser apenas corretiva e passa a ser
-- padrao na origem, SOMENTE para video. Imagem nao exclui; formato ausente nao recebe a regra no
-- escuro. A execucao vive em meta-actions.montarCriacao (aplicarPadraoPosicionamentoVideo, v5.14).

delete from public.contrato_de_execucao
 where acao = 'criar_conjunto_a_partir_de' and campo = 'formato_midia_previsto';

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('criar_conjunto_a_partir_de','formato_midia_previsto',false,'enum',
   'Formato do anuncio que o conjunto vai receber. video => nasce com posicionamento manual '
   || 'facebook-only (8 facebook_positions, sem right_hand_column), replicando os 3 conjuntos de '
   || 'video ACTIVE. imagem => Coluna da direita permanece elegivel. Ausente => targeting do molde '
   || 'preservado e o card avisa; a regra de video NAO e aplicada no escuro.',
   'meta-actions.montarCriacao (aplicarPadraoPosicionamentoVideo) + traffic-chat.t_propose_criacao',
   true,true,array['video','imagem']);

update public.agent_context
   set vigente = false, atualizado = now()
 where fato ilike 'POSICIONAMENTOS POR FORMATO (decisao Ryan, 11/08/2026)%' and vigente;

insert into public.agent_context (categoria,fato,vigente,desde)
values (
  'doutrina',
  'POSICIONAMENTO DE VIDEO POR FORMATO (decisao Ryan 11/08/2026 + auditoria dos 3 conjuntos de '
  || 'video ACTIVE). PADRAO OBRIGATORIO NA CRIACAO: conjunto criado por criar_conjunto_a_partir_de '
  || 'com formato_midia_previsto=video nasce ja com posicionamento manual replicando o padrao '
  || 'observado nos 3 conjuntos ativos - publisher_platforms=[facebook] e facebook_positions=[feed, '
  || 'instream_video, marketplace, story, search, facebook_reels, facebook_reels_overlay, '
  || 'profile_feed], SEM facebook.right_hand_column (a Coluna da direita nao veicula video; trocar '
  || 'tamanho/proporcao do video NAO resolve). IMAGEM: a exclusao NAO se aplica (a Coluna aceita '
  || 'imagem). Formato NAO declarado: o targeting do molde e preservado e o card AVISA que a regra '
  || 'de video nao foi aplicada - nao se adivinha formato. O card de criacao declara: "Conjunto de '
  || 'video: posicionamentos manuais aplicados conforme padrao observado nos 3 conjuntos ativos; '
  || 'Coluna da direita excluida por incompatibilidade de formato." ACAO CORRETIVA para conjuntos '
  || 'antigos/de teste ja criados em automatico: ajustar_posicionamentos_do_conjunto (flag propria, '
  || 'dry_run, teto horario, card, audit_log, espelhar, reconciliacao). Ela aplica EXATAMENTE o '
  || 'mesmo padrao facebook-only para video e nao exclui nada para imagem; nunca escreve sem card '
  || 'aprovado. Driver Pipeboard comprovado por tools/list request 610 (update_adset aceita '
  || 'targeting; idempotentHint=true, destructiveHint=false); Graph tambem suporta POST '
  || '/{adset_id} targeting. targeting_automation.advantage_audience=1 e Advantage+ AUDIENCE, nao '
  || 'posicionamento automatico, e e preservado. A flag do corretivo nasceu false globalmente e foi '
  || 'ligada so para Legal e Viver por autorizacao expressa do Ryan; aprovacao humana continua '
  || 'obrigatoria.',
  true,
  date '2026-08-11'
);
