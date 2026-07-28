-- 20260728142936_prepara_acoes_de_criacao_meta.sql
-- Espelho da migracao aplicada em producao (projeto gzjwnjdpxpbmdhcyefvs).
-- Extraido de supabase_migrations.schema_migrations - e o SQL EXATO que rodou.
-- NAO re-executar: ja esta aplicado.

-- =====================================================================================
-- PREPARACAO PARA AS ACOES DE CRIACAO (campanha / conjunto / anuncio)
-- Sete decisoes do Ryan travadas: nasce PAUSED, CREDIT forcado, compliance bloqueante,
-- UTM gerada pelo codigo, orcamento obrigatorio pedido ao gestor, so admin aprova,
-- card expira em 24h (ja implementado em add_expiracao_24h_approval_requests).
--
-- RISCO QUE ESTA MIGRACAO ENDERECA: existem 20 contas meta_ads em integrations. As acoes
-- atuais sao seguras por acidente - usam o external_id do objeto, que ja pertence a conta
-- certa. Na CRIACAO, sem conta explicita e validada, o objeto pode nascer na conta errada,
-- e isso nao tem reversa simples. Por isso a conta operavel passa a ser declarada em
-- configuracao, e o executor deve recusar criar em qualquer conta fora dessa lista.
-- =====================================================================================

-- 1) Tipo de entidade para conjunto (nao existia no enum).
alter type approval_entity add value if not exists 'adset';

-- 2) Flags das novas acoes, todas OFF (mesma politica das existentes).
update meta_execution_config
   set action_flags = action_flags
       || jsonb_build_object(
            'criar_campanha', false,
            'criar_conjunto_a_partir_de', false,
            'criar_anuncio_a_partir_de', false),
       updated_at = now()
 where id = 1;

-- 3) Lista branca de contas onde a criacao e permitida.
alter table meta_execution_config
  add column if not exists contas_permitidas_criacao text[] not null default '{}';

update meta_execution_config
   set contas_permitidas_criacao = array['act_3302001729967572']
 where id = 1;

comment on column meta_execution_config.contas_permitidas_criacao is
  'Lista branca de contas de anuncio onde acoes de CRIACAO podem executar. Existem 20 contas meta_ads em integrations; criar na conta errada nao tem reversa simples. O executor deve recusar qualquer criacao cuja conta de destino nao esteja aqui. Vazio = criacao bloqueada.';

-- 4) Teto de orcamento: por decisao do Ryan NAO existe valor fixo - o gestor informa a cada
-- pedido. Guardamos apenas um teto de sanidade, alto, para barrar erro de digitacao
-- (ex.: centavos trocados por reais). Nao e regra de negocio, e cinto de seguranca.
alter table meta_execution_config
  add column if not exists teto_sanidade_orcamento_diario numeric not null default 5000;

comment on column meta_execution_config.teto_sanidade_orcamento_diario is
  'Teto de SANIDADE (nao de negocio) para orcamento diario em criacao/alteracao, em reais. O valor de cada pedido e informado pelo gestor; este limite existe apenas para barrar erro de digitacao. Ajustar se a operacao passar a trabalhar com verbas maiores.';
