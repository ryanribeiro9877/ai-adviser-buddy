-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807221241
-- name: criar_campanha_regime_orcamento_abo_real
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ABO REAL PELO PIPEBOARD (07/08/2026). O gestor decidiu o regime: ABO - campanha SEM orcamento,
-- dinheiro em cada conjunto. Descoberto por sonda tools/list do Pipeboard + teste descartavel
-- controlado ([TESTE-ABO-DESCARTAR-01/02], apagadas): create_campaign tem um parametro DEDICADO,
-- use_adset_level_budgets (boolean, default false). Com false e sem orcamento no corpo, o conector
-- INJETA daily_budget=1000 (a NOVA-01 nasceu assim). Com true, a campanha nasce sem orcamento.
-- O conserto do executor esta em meta-actions v5.5; este lado fecha o VALIDADOR para nunca haver
-- validador=aceita com executor=recusa (invariante da PO-17).

-- 1) Novo eixo de contrato: VALOR de campo aceito. Ate aqui o contrato so falava de presenca
--    (obrigatorio) e de suporte (suportado). regime_orcamento precisa de um terceiro: quando
--    presente, o valor tem de estar na lista. null = qualquer valor (comportamento de antes).
alter table public.contrato_de_execucao
  add column if not exists valores_aceitos text[];
comment on column public.contrato_de_execucao.valores_aceitos is
  'Quando preenchido, o campo (se presente no pedido) so e aceito com valor nesta lista (case-insensitive). Existe para que regime_orcamento=abo seja recusado no validador com o MESMO criterio do executor montarCriacao (so ABO), preservando a PO-17: nunca validador=aceita com executor=recusa. null = qualquer valor.';

-- 2) regime_orcamento no contrato de criar_campanha. Opcional (ausente = abo no executor); unico
--    valor aceito hoje = abo. Fonte: o proprio executor v5.5 + a sonda/teste do Pipeboard.
insert into public.contrato_de_execucao (acao, campo, obrigatorio, tipo, observacao, fonte, valores_aceitos)
select 'criar_campanha','regime_orcamento',false,'text',
  'Regime de orcamento da campanha. abo (default e unico suportado) = campanha SEM orcamento, dinheiro em cada conjunto; montarCriacao manda use_adset_level_budgets=true ao Pipeboard. Ausente assume abo. CBO (orcamento na campanha) nao e suportado - o conjunto so entra em campanha sem orcamento proprio.',
  'meta-actions montarCriacao v5.5 (criar_campanha) + sonda tools/list Pipeboard + teste descartavel controlado 07/08/2026',
  array['abo']
where not exists (select 1 from public.contrato_de_execucao
  where acao='criar_campanha' and campo='regime_orcamento' and vigente);

-- 3) O validador de campo passa a checar valores_aceitos, alem de obrigatorio e suportado.
create or replace function public.validar_pedido_contra_contrato_sem_estado_destino(p_acao text, p_pedido jsonb)
 returns jsonb
 language plpgsql
 stable
as $function$
declare
  v_n int;
  v_faltando text[];
  v_extras text[];
  v_nao_suportados text[];
  v_valores_invalidos text[];
  v_recusa text;
  v_msg_recusa text;
begin
  select count(*) into v_n from public.contrato_de_execucao where acao = p_acao and vigente;

  if v_n = 0 then
    return jsonb_build_object(
      'valido', false,
      'motivo','contrato_desconhecido',
      'acao', p_acao,
      'mensagem','NAO existe contrato declarado para a acao "' || p_acao || '". Isso significa que ninguem registrou quais campos o executor exige - e nao que o pedido esta errado. '
        || 'Montar o card assim seria adivinhar, e adivinhar esta lista ja falhou tres vezes neste projeto. '
        || 'Quem resolve: quem le o codigo do meta-actions declara os campos, ou um card desta acao executa com sucesso e o payload dele vira a evidencia.',
      'como_registrar','insert into contrato_de_execucao (acao, campo, obrigatorio, tipo, fonte) values (...)');
  end if;

  select array_agg(c.campo order by c.campo) into v_faltando
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.obrigatorio
     and not public.campo_presente_no_pedido(p_pedido, c.campo);

  select array_agg(c.campo order by c.campo) into v_nao_suportados
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo);

  -- v5.5: valor fora da lista aceita. So conta com o campo PRESENTE (ausencia e obrigatoriedade,
  -- nao valor) e com valores_aceitos declarado. Espelha montarCriacao, que so aceita regime abo.
  select array_agg(c.campo order by c.campo) into v_valores_invalidos
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and c.valores_aceitos is not null
     and public.campo_presente_no_pedido(p_pedido, c.campo)
     and not (lower(p_pedido->>c.campo) = any (select lower(x) from unnest(c.valores_aceitos) as x));

  select c.recusa_nomeada, c.mensagem_de_recusa into v_recusa, v_msg_recusa
    from public.contrato_de_execucao c
   where c.acao = p_acao and c.vigente and not c.suportado
     and public.campo_presente_no_pedido(p_pedido, c.campo)
   order by c.campo
   limit 1;

  select array_agg(k order by k) into v_extras
    from jsonb_object_keys(coalesce(p_pedido,'{}'::jsonb)) k
   where not exists (select 1 from public.contrato_de_execucao c
                      where c.acao = p_acao and c.vigente and c.campo = k);

  return jsonb_build_object(
    'valido', (v_faltando is null and v_nao_suportados is null and v_valores_invalidos is null),
    'acao', p_acao,
    'campos_exigidos', v_n,
    'faltando', coalesce(to_jsonb(v_faltando), '[]'::jsonb),
    'nao_suportados', coalesce(to_jsonb(v_nao_suportados), '[]'::jsonb),
    'valores_invalidos', coalesce(to_jsonb(v_valores_invalidos), '[]'::jsonb),
    'recusa', coalesce(v_recusa, case when v_valores_invalidos is not null then 'valor_de_campo_nao_aceito' end),
    'nao_previstos_no_contrato', coalesce(to_jsonb(v_extras), '[]'::jsonb),
    'nota_sobre_os_extras','Campo DESCONHECIDO do contrato nao invalida o pedido: pode ser narrativa (justificativa, risco, reversa) ou campo que o executor aceita e ninguem registrou. Isso NAO vale para campo suportado=false nem para valor fora de valores_aceitos: esses invalidam, porque o executor nao tem caminho para eles e segui-los publicaria/criaria outra coisa.',
    'mensagem', case
      when v_nao_suportados is not null then
        coalesce(v_msg_recusa, 'Pedido usa campo que o executor nao suporta: ' || array_to_string(v_nao_suportados, ', ') || '.')
        || ' O card NAO deve ser emitido.'
      when v_valores_invalidos is not null then
        'Pedido traz valor nao aceito em: ' || array_to_string(v_valores_invalidos, ', ')
        || '. O card NAO deve ser emitido - o executor recusaria depois de gastar uma aprovacao.'
      when v_faltando is not null then
        'Faltam campos obrigatorios: ' || array_to_string(v_faltando, ', ') || '. O card NAO deve ser emitido - ele falharia na execucao depois de gastar uma aprovacao.'
      else 'Pedido tem todos os campos obrigatorios declarados para esta acao e nenhum campo nao suportado.' end);
end;
$function$;

-- 4) PO-17 v5: a matriz ganha o eixo de VALOR (regime de orcamento) em criar_campanha, mantendo a
--    invariante. v4 vira registro do criterio anterior.
update public.perguntas_ouro set vigente=false where conjunto='v2' and codigo='PO-17' and versao=4 and vigente;
insert into public.perguntas_ouro(conjunto,codigo,versao,dimensao,pergunta,expectativa_verificavel,como_verificar,fonte_da_verdade,protege_regra,vigente) values (
 'v2','PO-17',5,'caminho_de_execucao',
 'Os validadores continuam fechando os eixos de campo, de estado e agora de VALOR, sem nunca aprovar o que o executor recusa? Em particular: criar_campanha aceita declarar regime_orcamento, cria ABO de verdade (campanha sem orcamento) e recusa CBO pelo mesmo criterio nos dois lados?',
 'MATRIZ COMPLETA, booleanos apenas. (A) criar_anuncio_a_partir_de: tudo da v4 vale - 4 obrigatorios nas duas rotas, carrossel/foto recusando pelo mesmo nome dos dois lados, peca em revisao mantendo so a assimetria segura completo=false/valido=true, destino is_dynamic_creative recusando e estado desconhecido fechado. (B) criar_conjunto_a_partir_de, eixo de campo: 6 obrigatorios presentes aceita; removendo cada um, recusa. (C) criar_conjunto_a_partir_de, eixo de estado CBO: pedido com orcamento_diario_reais para campanha COM orcamento proprio conhecido devolve valido=false (campanha_usa_orcamento_proprio_cbo); para campanha SEM orcamento conhecido, valido=true; para campanha sem coleta (config_coletada_em nulo), valido=false fechado. (D) mesma campanha CBO com pedido SEM orcamento_diario_reais nao dispara a regra de CBO. (E) criar_campanha, eixo de VALOR (novo): com os 5 obrigatorios presentes e regime_orcamento ausente OU igual a abo, valido=true; com regime_orcamento diferente de abo (ex.: cbo), valido=false - o MESMO conjunto que montarCriacao recusa com regime_orcamento_nao_suportado. (F) PROIBIDO SEMPRE, falha imediata: validador aceita (valido=true ou completo=true) pedido que o executor recusa por nome. Nenhum caso pode violar.',
 'Para (E): rode validar_pedido_contra_contrato_sem_estado_destino(''criar_campanha'', pedido) sobre um pedido com nome_novo/objetivo/conta_destino/special_ad_categories/status_inicial, variando regime_orcamento entre ausente, ''abo'' e ''cbo'', e confronte com montarCriacao do meta-actions (abo/ausente cria ABO com use_adset_level_budgets=true; cbo retorna erro regime_orcamento_nao_suportado). Repita as baterias (A)-(D) da v4. Classifique validador=aceita com executor=recusa como falha imediata; compare so booleanos.',
 'validar_pedido_contra_contrato(_sem_estado_destino) + pedido_de_anuncio_completo + avaliar_estado_destino_execucao + contrato_de_execucao(valores_aceitos) + meta-actions montarCriacao v5.5 + _shared/pipeboard.argsCampanhaDeGraph(use_adset_level_budgets)',
 '{13}',true);

-- 5) Contexto do agente: NOVA-01 orfa aguardando o Ryan, e o achado do ABO. Nao apagar NOVA-01
--    nem o card b5e2f338.
insert into public.agent_context (categoria, fato, vigente, desde, company_id) values (
  'execucao',
  'CAMPANHA NOVA-01 (external_id 120254323578040191, [LEV][LP][LEADS][CLT][NOVA-01][AGO26]) esta ORFA e aguarda decisao do Ryan. Ela nasceu CBO com daily_budget=1000 (R$ 10/dia) que o conector Pipeboard injetou - ninguem pediu orcamento de campanha -, e o gestor optou por ABO. NAO apagar automaticamente: o Ryan decide entre apagar ou reaproveitar convertendo o regime (update_campaign para tirar o orcamento exige que os conjuntos ja tenham orcamento proprio). Deixar PAUSED. O card de origem b5e2f338 tambem NAO deve ser apagado - e a evidencia da falha.',
  true, '2026-08-07', 'ded20b38-f42e-4c71-800c-31b97ea48bcf');

insert into public.agent_context (categoria, fato, vigente, desde) values (
  'execucao',
  'ABO PELO PIPEBOARD JA FUNCIONA (07/08/2026). Campanha sem orcamento proprio (regime ABO) e criada de verdade pelo driver Pipeboard enviando use_adset_level_budgets=true no create_campaign - parametro dedicado do conector (default false). Sem esse flag o Pipeboard injeta daily_budget=1000 e a campanha nasce CBO. Provado por teste descartavel controlado (mesmo caminho, so o flag mudando): flag true -> Graph sem daily_budget; flag false -> daily_budget=1000. O executor (criar_campanha) manda o flag automaticamente em ABO, que e o default e o unico regime suportado; CBO e recusado por nome nos dois lados.',
  true, '2026-08-07');

-- 6) Verificacao dentro da propria migracao.
do $$
declare v_sem jsonb; v_abo jsonb; v_cbo jsonb;
  base jsonb := jsonb_build_object(
    'nome_novo','[TESTE][MATRIZ]','objetivo','OUTCOME_LEADS','conta_destino','act_3302001729967572',
    'special_ad_categories', jsonb_build_array('FINANCIAL_PRODUCTS_SERVICES'),'status_inicial','PAUSED');
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_de_execucao' and column_name='valores_aceitos') then
    raise exception 'coluna valores_aceitos nao criada';
  end if;
  if not exists (select 1 from public.contrato_de_execucao where acao='criar_campanha' and campo='regime_orcamento' and vigente and valores_aceitos = array['abo']) then
    raise exception 'regime_orcamento nao ficou no contrato com valores_aceitos=[abo]';
  end if;
  v_sem := public.validar_pedido_contra_contrato_sem_estado_destino('criar_campanha', base);
  if coalesce((v_sem->>'valido')::boolean,false) is not true then raise exception 'ABO (regime ausente) deveria ser valido: %', v_sem; end if;
  v_abo := public.validar_pedido_contra_contrato_sem_estado_destino('criar_campanha', base || jsonb_build_object('regime_orcamento','abo'));
  if coalesce((v_abo->>'valido')::boolean,false) is not true then raise exception 'regime abo deveria ser valido: %', v_abo; end if;
  v_cbo := public.validar_pedido_contra_contrato_sem_estado_destino('criar_campanha', base || jsonb_build_object('regime_orcamento','cbo'));
  if coalesce((v_cbo->>'valido')::boolean,true) is not false then raise exception 'regime cbo deveria ser invalido: %', v_cbo; end if;
  if not exists (select 1 from public.perguntas_ouro where conjunto='v2' and codigo='PO-17' and versao=5 and vigente) then raise exception 'PO-17 v5 nao vigente'; end if;
end $$;