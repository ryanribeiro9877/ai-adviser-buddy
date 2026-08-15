-- CONTRATO 15/08/2026: aprovar criar_anuncio = cria ACTIVE.
-- Campanha/conjunto continuam PAUSED. Religar criativo pausado = ativar_criativo.

-- Aposenta fatos conflitantes (03/08 "nasce PAUSED" e 31/07 "aprovar=ativar" ambos vigentes).
update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente = true
   and (
     fato ilike 'CONTRATO DE ATIVACAO VIGENTE DESDE 03/08/2026%'
     or fato ilike 'CONTRATO DE ATIVACAO VIGENTE DESDE 31/07/2026%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  null,
  'doutrina',
  'CONTRATO DE ATIVACAO VIGENTE DESDE 15/08/2026 — ANUNCIO NASCE ACTIVE. (1) Aprovar criar_anuncio_a_partir_de CRIA o anuncio ACTIVE: a aprovacao do card JA autoriza entrega do criativo (se campanha/conjunto estiverem ativos). (2) Campanha e conjunto novos continuam nascendo PAUSADOS para revisao estrutural no Gerenciador. (3) Existe a acao sancionada ativar_criativo para religar anuncio ja PAUSED (card + aprovacao). Texto antigo dizendo que anuncio tambem nasce PAUSED ou que ativacao de criativo e so no Gerenciador esta VENCIDO. Continua sem caminho para gastar/pausar/ativar sem card aprovado.',
  true,
  '2026-08-15'
);

update public.contrato_de_execucao
   set observacao = 'ACTIVE forcado pelo executor (meta-actions v4.4 / 15/08/2026). Aprovar o card = criar ACTIVE. Campanha/conjunto seguem PAUSED.',
       obrigatorio = false
 where acao = 'criar_anuncio_a_partir_de'
   and campo = 'status_inicial'
   and vigente is distinct from false;

-- Liga a flag ativar_criativo em todas as configs que ja tem pausar_criativo.
update public.meta_execution_config
   set action_flags = coalesce(action_flags, '{}'::jsonb) || jsonb_build_object('ativar_criativo', true)
 where coalesce((action_flags->>'pausar_criativo')::boolean, false) = true;
