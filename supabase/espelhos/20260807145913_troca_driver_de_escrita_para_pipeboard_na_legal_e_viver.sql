-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807145913
-- name: troca_driver_de_escrita_para_pipeboard_na_legal_e_viver
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Legal e Viver passa a escrever pelo PIPEBOARD. dry_run permanece LIGADO.
--
-- POR QUE AGORA, e a observacao e do Ryan: a decisao de escrever pelo Pipeboard foi tomada em
-- 06/08, o driver foi construido no meta-actions, e ninguem nunca trocou a chave - as tres
-- empresas seguiam em 'graph'. A tentativa de 06/08 que a Meta recusou com OAuthException 1885183
-- saiu pelo GRAPH, usando o NOSSO app, que esta em modo de desenvolvimento.
--
-- A HIPOTESE QUE ISTO TESTA: o Pipeboard escreve pelo app DELES, nao pelo nosso. E um produto
-- comercial cuja funcao e criar anuncios para clientes, entao o app deles precisa estar publicado
-- com acesso avancado - do contrario o produto nao existiria. Se for assim, o bloqueio de ontem
-- nao se aplica por esse caminho.
-- NAO E GARANTIA: ninguem verificou o status do app do Pipeboard. E hipotese com boa base, e o
-- teste e barato.
--
-- dry_run FICA LIGADO de proposito. O criterio de aceite do briefing do driver diz: primeiro
-- provar que o caminho chega ao conector com simulacao, depois soltar. Trocar driver E soltar
-- escrita no mesmo ato tiraria a capacidade de saber qual dos dois causou o que aparecer.
--
-- COHAPM e Cooperativa NAO mudam: COHAPM nao tem conexao no Pipeboard (medido em 06/08 -
-- act_1622612945584817 nao esta entre as 25 contas mapeadas), entao trocar la seria apontar para
-- um caminho que nao existe.
--
-- REVERSIVEL EM UMA LINHA: update meta_execution_config set driver_escrita='graph' where ...

update public.meta_execution_config
   set driver_escrita = 'pipeboard'
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values ('execucao',
'ESCRITA DA LEGAL E VIVER PASSOU A SAIR PELO PIPEBOARD (07/08/2026). driver_escrita = pipeboard, '
|| 'dry_run CONTINUA LIGADO. O caminho e o mesmo de sempre - todas as travas, o compliance, o card e '
|| 'a aprovacao acontecem antes e sem mudanca. So o ULTIMO passo muda de destino. '
|| 'MOTIVO: em 06/08 a Meta recusou a criacao de criativo pelo Graph com o nosso app em modo de '
|| 'desenvolvimento. O Pipeboard escreve pelo app deles. '
|| 'AO FALAR DISSO COM O GESTOR: nao prometa que o Pipeboard resolve - isso ainda nao foi provado. '
|| 'Diga que o caminho mudou e que o teste esta em andamento. '
|| 'COHAPM segue em graph porque nao tem conexao no Pipeboard.',
true, '2026-08-07', 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

-- ---------------------------------------------------------------------------
-- MIGRACAO INTERMEDIARIA - so espelho. NAO versionar em migrations/.
--
-- JA ESTA EM VIGOR e NAO PODE ser re-executada por acidente: muda
-- meta_execution_config.driver_escrita da Legal e Viver para pipeboard e
-- faz INSERT sem guarda em agent_context (replay duplicaria o fato).
--
-- O efeito (driver=pipeboard) e pre-condicao assumida por migracoes
-- posteriores - em especial 20260807193503_retrata_fato_dry_run_ligado_legal_e_viver,
-- que ABORTA se driver_escrita <> pipeboard, e pelas que documentam o estado
-- (ex. 20260810224818). Nenhuma delas re-aplica o UPDATE; por isso o rastro
-- fiel fica aqui, e o replay da trilha versionada nao toca de novo no driver.
-- ---------------------------------------------------------------------------
