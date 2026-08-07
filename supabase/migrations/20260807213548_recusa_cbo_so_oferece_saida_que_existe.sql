-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807213548
-- name: recusa_cbo_so_oferece_saida_que_existe
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

update public.contrato_de_estado_execucao
set mensagem_de_recusa =
  'Nao emiti o card porque a campanha de destino ja tem orcamento PROPRIO (Otimizacao de '
  'Orcamento de Campanha, o CBO), e a Meta nao aceita orcamento na campanha e no conjunto ao '
  'mesmo tempo. Ou o dinheiro vive na CAMPANHA e ela distribui entre os conjuntos, ou vive em '
  'CADA CONJUNTO e a campanha fica sem. Para seguir: escolha uma campanha de destino SEM '
  'orcamento proprio, e ai o R$/dia deste conjunto vale. Criar conjunto SEM orcamento, herdando '
  'o da campanha, ainda NAO e suportado por este sistema - o orcamento diario e obrigatorio no '
  'pedido -, entao nao adianta pedir assim.'
where acao = 'criar_conjunto_a_partir_de'
  and recusa_nomeada = 'campanha_usa_orcamento_proprio_cbo'
  and vigente;

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'execucao',
  'CONJUNTO SEM ORCAMENTO NAO E SUPORTADO. Criar conjunto sem orcamento diario, para herdar o '
  'orcamento de uma campanha em CBO, NAO funciona hoje: orcamento_diario_reais e obrigatorio no '
  'contrato de criar_conjunto_a_partir_de e o executor recusa orcamento ausente ou zero. Quando a '
  'campanha de destino usa CBO, a UNICA saida que o sistema aceita e apontar o conjunto para outra '
  'campanha, sem orcamento proprio. Nunca oriente o gestor a "pedir o conjunto sem orcamento" - '
  'esse caminho termina numa segunda recusa.',
  true,
  '2026-08-07'
);
