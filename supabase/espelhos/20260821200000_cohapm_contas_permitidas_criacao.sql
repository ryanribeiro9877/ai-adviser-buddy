-- COHAPM: libera act_1622612945584817 em contas_permitidas_criacao.
-- Causa raiz do bloqueio "nenhuma conta desta empresa esta habilitada para criacao":
-- commit 1e762b9 ligou master/flags/dry_run, mas a lista branca ficou '{}'.
-- traffic-chat t_propose_criacao e meta-actions recusam se a lista estiver vazia
-- ou se a conta da empresa (integrations.meta_ads) nao cruzar com a lista.
-- Padrao Legal: contas_permitidas_criacao = array['act_3302001729967572'].

update public.meta_execution_config
   set contas_permitidas_criacao = array['act_1622612945584817']::text[],
       updated_at = now()
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

-- Doutrina: declara a conta habilitada (complementa o fato de escrita do portfolio).
update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente = true
   and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and categoria = 'execucao'
   and (
     fato ilike '%nenhuma conta%habilitada%'
     or fato ilike '%contas_permitidas_criacao%vazia%'
     or fato ilike '%conta%nao%habilitada%criacao%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'execucao',
  'CONTA HABILITADA PARA CRIACAO — COHAPM (21/08/2026). meta_execution_config.contas_permitidas_criacao = {act_1622612945584817} (Conta de Anuncio - COHAPM). Isolamento de portfolio: so essa conta da empresa pode receber criar_campanha / criar_conjunto / criar_anuncio. Contas irmas COHAPM (826410941689508 Roberto Ribeiro, 867035708984559 Read-Only) permanecem FORA da lista. Mesmo padrao da Legal com act_3302001729967572. Sem esta lista branca o chat recusa card com "nenhuma conta desta empresa esta habilitada para criacao" mesmo com master_enabled e criar_campanha ligados.',
  true,
  '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where vigente = true
    and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and fato ilike 'CONTA HABILITADA PARA CRIACAO — COHAPM (21/08/2026%'
);
