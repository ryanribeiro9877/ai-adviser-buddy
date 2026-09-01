-- renomear_campanha e pipeboard-only POR CONTRATO, nao por acaso: resolver_driver define
-- v_permitidos = array['pipeboard'] para essa acao, e escreverUpdate recusa com
-- renomear_campanha_exige_pipeboard antes de tocar a Meta. A COHAPM esta em
-- driver_escrita=graph, entao sem override por acao o RPC pode_executar_acao barra a acao
-- ANTES de emitir card, com driver_nao_suporta_renomear_campanha. Foi o bloqueio de
-- 01/09/2026 ao pedir a troca de AGO26 por SET26 em COHAPM_VISTTA_CONV_WA_AGO26.
--
-- O resto da corrente ja estava liberado — action_flags.renomear_campanha=true,
-- master_enabled=true, dry_run=false: faltava so o transporte.
--
-- criar_conjunto_a_partir_de=pipeboard entrou hoje direto no banco, durante a correcao do
-- CTWA (conjunto 120249829825270182), e nunca virou migration. Vai junto para o
-- repositorio voltar a descrever o estado real da conta.
--
-- O merge com || preserva o que ja existe na coluna, inclusive
-- vincular_instagram_dos_anuncios=graph, que e graph-only pelo mesmo resolver_driver.

update public.meta_execution_config
set driver_por_acao = coalesce(driver_por_acao, '{}'::jsonb)
  || jsonb_build_object(
       'renomear_campanha', 'pipeboard',
       'criar_conjunto_a_partir_de', 'pipeboard'
     )
where company_id = '57f755b9-c23d-4f58-a488-8173d697c010';
