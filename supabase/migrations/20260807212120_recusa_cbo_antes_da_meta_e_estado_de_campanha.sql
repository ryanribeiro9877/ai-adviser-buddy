-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807212120
-- name: recusa_cbo_antes_da_meta_e_estado_de_campanha
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONSERTO 4 (07/08/2026): CBO x ABO RECUSA ANTES DE CHAMAR A META.
-- Mesmo padrao da recusa conjunto_destino_criativo_dinamico (v5.2/v36): ler o estado do objeto
-- PAI antes de escrever, e recusar por nome.
--
-- DE ONDE VEIO O CBO (medido, nao suposto). O corpo enviado ao Pipeboard em create_campaign foi
-- {name,status:PAUSED,objective:OUTCOME_LEADS,buying_type:AUCTION,special_ad_categories,
--  is_adset_budget_sharing_enabled:"false"} - SEM daily_budget e SEM bid_strategy.
-- A Graph hoje devolve, para 120254323578040191: daily_budget=1000 (R$ 10,00/dia),
-- lifetime_budget ausente, is_adset_budget_sharing_enabled=false, bid_strategy=
-- LOWEST_COST_WITHOUT_CAP. EXPERIMENTO CONTROLADO ja disponivel na propria base: as campanhas
-- TESTE-A/B/C (03/08) foram criadas com O MESMO corpo, incluindo is_adset_budget_sharing_enabled
-- "false", porem pelo driver GRAPH - e estao com daily_budget NULO e bid_strategy NULO na Graph.
-- A unica variavel que mudou foi o DRIVER. Conclusao: o conector Pipeboard INJETA daily_budget=1000
-- e bid_strategy quando create_campaign nao traz orcamento; is_adset_budget_sharing_enabled nao e
-- a causa (esta presente nos quatro casos). O erro do Pipeboard estava CORRETO - a campanha e CBO
-- de verdade. O defeito e a criacao de campanha produzir um objeto DIFERENTE do pedido.
--
-- POR ISSO ESTE CONSERTO TEM DOIS LADOS:
--  (a) o gate de estado abaixo, que impede o card de nascer e o executor de escrever;
--  (b) a reconciliacao de campanha passa a conferir orcamento (no meta-actions), para que uma
--      injecao do conector vire divergencia declarada em vez de descoberta tres dias depois.

-- Uma regra de estado pode agora depender de um campo do PEDIDO. CBO so e conflito quando o
-- pedido traz orcamento de conjunto: campanha CBO + conjunto SEM orcamento e configuracao valida.
alter table public.contrato_de_estado_execucao
  add column if not exists condicao_campo_pedido text;
comment on column public.contrato_de_estado_execucao.condicao_campo_pedido is
  'Quando preenchido, a regra so e avaliada se este campo estiver presente no pedido (mesma nocao de presenca de campo_presente_no_pedido). Existe porque CBO na campanha so conflita quando o pedido traz orcamento de conjunto; sem esse recorte a regra recusaria pedidos validos.';

insert into public.contrato_de_estado_execucao (
  acao, campo_destino, propriedade, valor_recusado, recusa_nomeada, mensagem_de_recusa,
  recusa_estado_desconhecido, mensagem_estado_desconhecido, fonte, condicao_campo_pedido)
select 'criar_conjunto_a_partir_de','campanha_destino_external_id','campanha_tem_orcamento_proprio',true,
  'campanha_usa_orcamento_proprio_cbo',
  'Nao emiti o card porque a campanha de destino ja tem orcamento PROPRIO (Otimizacao de Orcamento de Campanha, o CBO), e a Meta nao aceita orcamento na campanha e no conjunto ao mesmo tempo. Ou o dinheiro vive na CAMPANHA e ela distribui entre os conjuntos, ou vive em CADA CONJUNTO e a campanha fica sem. Escolha: use uma campanha sem orcamento proprio para poder definir R$/dia neste conjunto, ou peca o conjunto SEM orcamento para ele herdar o da campanha.',
  'estado_orcamento_da_campanha_nao_verificado',
  'Nao emiti o card porque nao tenho leitura confiavel do orcamento da campanha de destino, e sem isso nao da para saber se definir R$/dia no conjunto vai conflitar com a campanha. Atualize os dados da conta (a coleta de configuracao de campanha) e refaca o pedido.',
  'Graph GET /{campanha}?fields=daily_budget,lifetime_budget via meta-campaign-status (campaigns.config_coletada_em); executor meta-actions montarCriacao',
  'orcamento_diario_reais'
where not exists (select 1 from public.contrato_de_estado_execucao
                   where acao='criar_conjunto_a_partir_de' and campo_destino='campanha_destino_external_id'
                     and propriedade='campanha_tem_orcamento_proprio' and vigente);

-- O avaliador passa a: (1) percorrer TODAS as regras vigentes da acao, nao so a mais recente;
-- (2) resolver o estado na tabela certa por propriedade; (3) respeitar condicao_campo_pedido.
-- O `limit 1` anterior era seguro por acidente - havia uma regra so no sistema inteiro.
create or replace function public.avaliar_estado_destino_execucao(p_acao text, p_pedido jsonb, p_company_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_regra public.contrato_de_estado_execucao%rowtype;
  v_destino text; v_conta text; v_estado boolean; v_encontrado boolean;
  v_avaliacoes jsonb := '[]'::jsonb; v_uma jsonb; v_recusa jsonb := null; v_alguma boolean := false;
begin
  for v_regra in
    select * from public.contrato_de_estado_execucao
     where acao = p_acao and vigente order by campo_destino, propriedade
  loop
    -- Regra condicionada a um campo do pedido: ausente o campo, a regra nao se aplica.
    if v_regra.condicao_campo_pedido is not null
       and not public.campo_presente_no_pedido(p_pedido, v_regra.condicao_campo_pedido) then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'condicao_do_pedido_ausente', 'condicao', v_regra.condicao_campo_pedido);
      continue;
    end if;

    v_destino := coalesce(nullif(btrim(coalesce(p_pedido->>v_regra.campo_destino,'')),''),
                          nullif(btrim(coalesce(p_pedido->>'conjunto_destino','')),''));
    if v_destino is null then
      v_avaliacoes := v_avaliacoes || jsonb_build_object('propriedade', v_regra.propriedade,
        'avaliado', false, 'motivo', 'destino_ausente');
      continue;
    end if;
    v_conta := regexp_replace(nullif(btrim(coalesce(p_pedido->>'conta_destino','')),''), '^act_', '');

    v_estado := null; v_encontrado := false;
    if v_regra.propriedade = 'is_dynamic_creative' then
      select a.is_dynamic_creative, true into v_estado, v_encontrado from public.ad_sets a
       where a.external_id = v_destino and (p_company_id is null or a.company_id = p_company_id)
         and (v_conta is null or a.account_id = v_conta)
       order by a.estado_graph_observado_em desc nulls last limit 1;
    elsif v_regra.propriedade = 'campanha_tem_orcamento_proprio' then
      -- CONHECIMENTO SO VALE COM PROCEDENCIA. config_coletada_em nulo = a configuracao nunca foi
      -- lida na Graph, e daily_budget pode ser o default fabricado pelo espelho da executora - foi
      -- exatamente o caso desta campanha, que ficou com "0" no espelho enquanto a Meta tinha 1000.
      -- Sem coleta, o estado e DESCONHECIDO e falha fechado.
      select case when c.config_coletada_em is null then null
                  else (coalesce(c.daily_budget,0) > 0 or coalesce(c.lifetime_budget,0) > 0) end,
             true
        into v_estado, v_encontrado
        from public.campaigns c
       where c.external_id = v_destino and c.provider = 'meta_ads'
         and (p_company_id is null or c.company_id = p_company_id)
         and (v_conta is null or c.external_account_id = v_conta)
       order by c.config_coletada_em desc nulls last limit 1;
    end if;

    if not coalesce(v_encontrado,false) or v_estado is null then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', null, 'valido', false,
        'recusa', v_regra.recusa_estado_desconhecido, 'mensagem', v_regra.mensagem_estado_desconhecido);
    elsif v_estado = v_regra.valor_recusado then
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', false,
        'recusa', v_regra.recusa_nomeada, 'mensagem', v_regra.mensagem_de_recusa);
    else
      v_uma := jsonb_build_object('propriedade', v_regra.propriedade, 'avaliado', true,
        'estado_observado', v_estado, 'valido', true,
        'mensagem', 'Estado do destino verificado e compativel com o pedido.');
    end if;

    v_alguma := true;
    v_avaliacoes := v_avaliacoes || v_uma;
    if (v_uma->>'valido')::boolean is not true and v_recusa is null then v_recusa := v_uma; end if;
  end loop;

  if v_recusa is not null then
    return v_recusa || jsonb_build_object('avaliacoes', v_avaliacoes);
  end if;
  if not v_alguma then
    return jsonb_build_object('valido', true, 'avaliado', false,
      'motivo', case when exists (select 1 from public.contrato_de_estado_execucao where acao=p_acao and vigente)
                     then 'nenhuma_regra_aplicavel_ao_pedido' else 'acao_sem_regra_de_estado' end,
      'avaliacoes', v_avaliacoes);
  end if;
  return jsonb_build_object('valido', true, 'avaliado', true, 'avaliacoes', v_avaliacoes,
    'mensagem', 'Todos os estados de destino declarados para esta acao foram verificados e aceitam o pedido.');
end; $$;
revoke all on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) from public,anon;
grant execute on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) to authenticated,service_role;
comment on function public.avaliar_estado_destino_execucao(text,jsonb,uuid) is 'Avalia TODAS as regras de estado vigentes da acao usando o ultimo valor Graph espelhado. Estado desconhecido falha fechado; orcamento de campanha so conta como conhecido quando config_coletada_em prova coleta real. Nomes e mensagens vem de contrato_de_estado_execucao.';

-- PO-17 v4: a matriz passa a cobrir o eixo CBO x ABO, mantendo a invariante que ela existe para
-- proteger. Pergunta nao se edita no lugar: a v3 vira registro do criterio que valeu.
update public.perguntas_ouro set vigente=false where conjunto='v2' and codigo='PO-17' and vigente;
insert into public.perguntas_ouro(conjunto,codigo,versao,dimensao,pergunta,expectativa_verificavel,como_verificar,fonte_da_verdade,protege_regra,vigente) values (
 'v2','PO-17',4,'caminho_de_execucao',
 'Os dois validadores continuam fechando os eixos de campo e de estado, agora tambem para criar_conjunto_a_partir_de? Em particular: o sistema recusa, ANTES do card e ANTES de chamar a Meta, um conjunto com orcamento proprio pedido para dentro de uma campanha que ja usa orcamento de campanha (CBO) - pelo motivo real, sem depender de conhecer o texto de erro da plataforma?',
 'MATRIZ COMPLETA. (A) criar_anuncio_a_partir_de: tudo que a v3 exigia continua valendo - 4 obrigatorios nas duas rotas, carrossel e foto recusando pelo mesmo nome dos dois lados, peca em revisao mantendo apenas a assimetria segura completo=false/valido=true, destino is_dynamic_creative=true recusando com conjunto_destino_criativo_dinamico e estado desconhecido falhando fechado. (B) criar_conjunto_a_partir_de, eixo de campo: com os 6 obrigatorios presentes o contrato aceita; removendo cada um, recusa. (C) criar_conjunto_a_partir_de, eixo de estado CBO: pedido com orcamento_diario_reais para campanha COM orcamento proprio conhecido devolve valido=false com recusa campanha_usa_orcamento_proprio_cbo e mensagem que explica que ou o orcamento vive na campanha ou nos conjuntos; para campanha SEM orcamento proprio conhecido devolve valido=true; para campanha cuja configuracao nunca foi coletada (config_coletada_em nulo) devolve valido=false com estado_orcamento_da_campanha_nao_verificado - falha fechado, e o "0" fabricado pelo espelho NAO conta como leitura. (D) A MESMA campanha CBO com pedido SEM orcamento_diario_reais nao dispara a regra de CBO pela condicao do pedido (podendo recusar por campo obrigatorio, que e outro eixo). (E) PROIBIDO SEMPRE, e falha imediata: validador aprovando pedido que o executor recusa - nenhum caso pode ter completo=true ou valido=true com montarCriacao recusando por nome.',
 'Use a campanha 120254323578040191 (CBO medido na Graph em 07/08: daily_budget=1000, config_coletada_em preenchido), uma campanha ABO conhecida (120254137750140191) e um external_id de campanha sem coleta. Rode validar_pedido_contra_contrato(''criar_conjunto_a_partir_de'', pedido) sobre exatamente o mesmo JSON usado contra montarCriacao do meta-actions, com e sem orcamento_diario_reais. Repita a bateria da v3 para criar_anuncio_a_partir_de com pedido_de_anuncio_completo. Classifique validador=aceita com executor=recusa como falha imediata.',
 'validar_pedido_contra_contrato + pedido_de_anuncio_completo + avaliar_estado_destino_execucao + contrato_de_execucao + contrato_de_estado_execucao + campaigns.daily_budget/config_coletada_em + ad_sets.is_dynamic_creative + meta-actions montarCriacao',
 '{13}',true);

do $$ begin
  if not exists (select 1 from public.contrato_de_estado_execucao
                  where acao='criar_conjunto_a_partir_de' and propriedade='campanha_tem_orcamento_proprio' and vigente) then
    raise exception 'a regra de CBO nao ficou vigente';
  end if;
  if not exists (select 1 from public.perguntas_ouro where conjunto='v2' and codigo='PO-17' and versao=4 and vigente) then
    raise exception 'PO-17 v4 nao ficou vigente';
  end if;
end $$;
