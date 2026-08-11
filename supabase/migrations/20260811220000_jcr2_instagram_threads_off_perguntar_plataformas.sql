-- Decisoes Ryan 11/08/2026 (jcr2 + Threads off + perguntar redes).
--
-- A) Instagram oficial = @jcr2_legaleviver. O id anterior 17841423949227215 (@legaleviver_)
--    deixou de existir na Graph (no resolve erro 100/33) e Pipeboard get_instagram_accounts
--    (readOnlyHint) devolveu accounts=[] / total=0 em act_3302001729967572, act_946388181625874
--    e act_2189110068331130. Owned do Business 3109716642547310 tambem veio vazio. NAO inventamos
--    id: handle oficial gravado; instagram_actor_id fica NULL ate o id ser comprovado (relink no
--    Gerenciador ou id informado pelo Ryan). Config continua prevalecendo sobre molde.
-- B) Threads desabilitado por padrao (empresa sem cadastro).
-- C) Agente sempre pergunta plataformas_publicacao.

update public.meta_execution_config
   set instagram_actor_id = null,
       instagram_handle = '@jcr2_legaleviver',
       instagram_identity_page_id = '1095196357012756',
       instagram_identity_page_link_confirmed = false,
       instagram_identity_provenance =
         'Decisao de Ryan em 11/08/2026: o Instagram oficial passa a ser @jcr2_legaleviver '
         || '(unico restante apos exclusao do perfil intruso). SUBSTITUI @legaleviver_ / '
         || '17841423949227215, que a Graph deixou de resolver (erro 100/subcode 33) e que saiu '
         || 'de owned_instagram_accounts do Business 3109716642547310 (lista vazia na sonda '
         || 'meta-identity-probe request 614 e meta-actions ler_contas_instagram/ler_instagram_via_pipeboard '
         || 'requests 616/621/623). Pipeboard get_instagram_accounts (readOnlyHint=true) tambem '
         || 'retornou total=0 na conta principal. Por isso instagram_actor_id fica NULL: o handle '
         || 'oficial esta definido, mas o Instagram Business Account id so entra quando for '
         || 'comprovado (conta relinkada ao ad account ou id informado pelo Ryan). Config segue '
         || 'prevalecendo sobre molde; nenhum id e inventado.'
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

-- Contrato: plataformas_publicacao no criar_conjunto
delete from public.contrato_de_execucao
 where acao = 'criar_conjunto_a_partir_de'
   and campo in ('plataformas_publicacao', 'formato_midia_previsto');

insert into public.contrato_de_execucao
  (acao,campo,obrigatorio,tipo,observacao,fonte,vigente,suportado,valores_aceitos)
values
  ('criar_conjunto_a_partir_de','plataformas_publicacao',true,'array',
   'Lista de redes escolhida pelo gestor APOS o agente perguntar. Suportadas: facebook, '
   || 'instagram, audience_network, messenger. Threads NUNCA: empresa sem cadastro '
   || '(recusa threads_desabilitado_empresa_sem_cadastro). Facebook+video aplica os 8 '
   || 'facebook_positions observados sem right_hand_column.',
   'meta-actions.aplicarPosicionamentoPorPlataformas + traffic-chat.t_propose_criacao',
   true,true,array['facebook','instagram','audience_network','messenger']),
  ('criar_conjunto_a_partir_de','formato_midia_previsto',false,'enum',
   'Obrigatorio quando facebook esta em plataformas_publicacao. video => exclui Coluna da '
   || 'direita automaticamente. imagem => Coluna elegivel. Ausente com Facebook => recusa '
   || 'formato_de_midia_obrigatorio_quando_facebook_selecionado.',
   'meta-actions.montarCriacao + traffic-chat.t_propose_criacao',
   true,true,array['video','imagem']);

-- Doutrina: supersede as versoes anteriores de posicionamento/identidade desta frente
update public.agent_context
   set vigente = false, atualizado = now()
 where vigente
   and (
     fato ilike 'POSICIONAMENTO DE VIDEO POR FORMATO%'
     or fato ilike 'POSICIONAMENTOS POR FORMATO%'
     or fato ilike 'IDENTIDADE INSTAGRAM OFICIAL%'
   );

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'IDENTIDADE INSTAGRAM OFICIAL = @jcr2_legaleviver (decisao Ryan 11/08/2026). Unico Instagram '
  || 'restante apos exclusao do perfil intruso. Sempre selecione este handle quando identidade '
  || 'Instagram for pedida. A config (meta_execution_config) PREVALECE sobre molde. O '
  || 'instagram_actor_id numerico so e gravado quando comprovado (Pipeboard get_instagram_accounts '
  || 'ou Graph); em 11/08 a conta de anuncios devolveu zero contas Instagram apos a exclusao — '
  || 'enquanto o id estiver NULL, o sistema NAO inventa id e o criativo pode nascer sem '
  || 'instagram_user_id (aviso honesto). SUBSTITUI @legaleviver_ / 17841423949227215.',
  true,
  date '2026-08-11'
),
(
  'doutrina',
  'THREADS DESABILITADO POR PADRAO (decisao Ryan 11/08/2026): a empresa NAO possui cadastro/'
  || 'perfil no Threads. Nunca selecione Threads em publisher_platforms nem threads_positions. '
  || 'Se o gestor pedir Threads, recuse por nome (threads_desabilitado_empresa_sem_cadastro). '
  || 'Nao prometa resolver o aviso de Threads por identidade Instagram — Instagram vale; Threads '
  || 'nao. Se a previa ainda mostrar Threads por Advantage+, o remedia e excluir Threads nos '
  || 'posicionamentos manuais (acao corretiva ou criacao com plataformas sem threads).',
  true,
  date '2026-08-11'
),
(
  'doutrina',
  'PLATAFORMAS DE PUBLICACAO — PERGUNTAR SEMPRE (decisao Ryan 11/08/2026): antes de criar '
  || 'conjunto/anuncio, o agente PERGUNTA em quais redes publicar, abrangendo facebook, '
  || 'instagram, audience_network e messenger (o que o contrato permite). Nao assumir em '
  || 'silencio. Params: plataformas_publicacao (array). Quando Facebook for ativado em conjunto '
  || 'de VIDEO, aplicar AUTOMATICAMENTE o padrao manual dos 3 conjuntos ACTIVE (8 '
  || 'facebook_positions, sem right_hand_column) — isso nao e pergunta, e regra. Quando Instagram '
  || 'for selecionado, usar identidade @jcr2_legaleviver. Threads nunca. Acao corretiva '
  || 'ajustar_posicionamentos_do_conjunto continua para conjuntos antigos.',
  true,
  date '2026-08-11'
);
