-- CONTRATO 15/08/2026 (parte 2): campanha/conjunto nascem ACTIVE + ativar_*.
-- Espelha o padrao ja aplicado em anuncio (ativar_criativo / criar ACTIVE).

update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente = true
   and fato ilike 'CONTRATO DE ATIVACAO VIGENTE DESDE 15/08/2026 — ANUNCIO NASCE ACTIVE%';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  null,
  'doutrina',
  'CONTRATO DE ATIVACAO VIGENTE DESDE 15/08/2026 — CAMPANHA, CONJUNTO E ANUNCIO NASCEM ACTIVE. (1) Aprovar criar_campanha / criar_conjunto_a_partir_de / criar_anuncio_a_partir_de / escalar_duplicar CRIA o objeto ACTIVE: a aprovacao do card JA autoriza entrega. (2) Existem ativar_campanha, ativar_conjunto e ativar_criativo para religar objeto ja PAUSED (card + aprovacao). (3) pausar_campanha, pausar_conjunto e pausar_criativo desligam. Texto antigo dizendo que nasce PAUSED ou que ativacao e so no Gerenciador esta VENCIDO. Continua sem caminho para gastar/pausar/ativar sem card aprovado.',
  true,
  '2026-08-15'
);

update public.contrato_de_execucao
   set observacao = 'ACTIVE forcado pelo executor (meta-actions v5.26 / 15/08/2026). Aprovar o card = criar ACTIVE.',
       obrigatorio = false
 where acao in ('criar_campanha', 'criar_conjunto_a_partir_de', 'escalar_duplicar', 'criar_anuncio_a_partir_de')
   and campo = 'status_inicial';

-- Liga flags de ativacao onde a pausa correspondente ja esta ligada.
update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb)
     || case when coalesce((action_flags->>'pausar_campanha')::boolean, false)
             then jsonb_build_object('ativar_campanha', true) else '{}'::jsonb end
     || case when coalesce((action_flags->>'pausar_conjunto')::boolean, false)
             then jsonb_build_object('ativar_conjunto', true) else '{}'::jsonb end
     || case when coalesce((action_flags->>'pausar_criativo')::boolean, false)
             then jsonb_build_object('ativar_criativo', true) else '{}'::jsonb end;
