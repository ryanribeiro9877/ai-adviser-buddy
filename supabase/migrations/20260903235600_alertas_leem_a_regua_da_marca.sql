-- O motor de alertas passa a ler a regua da MARCA (03/09/2026)
--
-- Continuacao de 20260903235500, que criou as reguas de custo por conversa por marca. Sem esta
-- migration aquelas reguas nao chegariam ao motor: `teto_vigente(empresa, metrica)` devolve nulo
-- para custo_por_conversa de proposito, porque nao existe UM numero de empresa que sirva de
-- veredito quando as marcas custam R$ 4,00, R$ 16,87 e R$ 4,96.
--
-- DUAS MUDANCAS, so em R1 (cpl) e R5 (pause_3d):
--
--   (i) o teto vem de `teto_vigente_da_marca(empresa, metrica, linha_de_produto_do_nome(...))`
--       em vez de `teto_vigente(empresa, metrica)`. A marca sai do nome da campanha pela mesma
--       funcao que ja carimba `p_linha_produto` no alerta - nao ha segunda forma de descobrir
--       marca sendo introduzida aqui.
--
--  (ii) na base 'conversas', o fallback para `alert_rules.threshold` acaba. Antes:
--       `coalesce(teto, r.threshold)`, o que fazia ausencia de regua virar R$ 21,80 - um p75 de
--       marco/2026 tirado exclusivamente das campanhas de La Felicita da agencia anterior.
--       Agora, sem regua de conversa, `custo > null` e nulo e a linha nao entra: ausencia de
--       regua vira ausencia de veredito, que e o que a propria `teto_vigente` ja mandava fazer
--       ("declarar a ausencia em vez de julgar"). Para formulario e para qualquer outra base o
--       coalesce continua exatamente como estava.
--
-- POR QUE R5 TAMBEM, e nao so R1: porque a escada de gravidade que o gestor pediu ja existe no
-- sistema e e feita de duas JANELAS sobre a mesma linha, nao de dois numeros. R1 (high) olha o
-- acumulado da campanha; R5 (critical) olha um criativo tres dias seguidos acima da MESMA linha.
-- Se so R1 enxergasse a regua de conversa, o nivel critico ficaria morto para conversa - R5
-- exige `t.teto is not null` e o teto era sempre nulo ali.
--
-- EFEITO MEDIDO ANTES DE APLICAR, com dias fechados (o dia corrente e parcial e, se entrasse,
-- esconderia disparos: em 03/09 os anuncios tinham gasto de R$ 0,01 a R$ 3,46):
--   R1: 0 de 3 campanhas de conversa disparam. Juridico 42,8% abaixo da regua, La Felicita 35,1%
--       abaixo, Sistema Ocular 58,6% abaixo.
--   R5: 0 de 67 anuncios avaliados disparam. A linha nao esta morta: 9,7% dos anuncio-dia do
--       Juridico e 14% dos anuncio-dia COM conversa de La Felicita ficam acima dela; o que nao
--       acontece e tres dias seguidos, que e justamente o filtro de ruido do R5.
--   Back-test na janela independente de marco/2026: das 4 campanhas [SALT] de La Felicita com
--       gasto sustentado, a regua de R$ 26,00 pegaria as duas piores (R$ 32,00 e R$ 26,60) e
--       deixaria passar as duas saudaveis (R$ 24,22 e R$ 14,44). A regua discrimina.
--
-- R1 x spend_no_leads NAO colidem, e isso e estrutural: R1 exige `resultados is not null`
-- (nullif(...,0), ou seja, resultados > 0) e spend_no_leads exige `resultados = 0`, os dois lendo
-- o MESMO `resultados_da_base(base_de_resultado_da_campanha(...))` desde 20260903220726. As
-- condicoes sao complementares - nenhuma campanha satisfaz as duas. `prova_regua_de_conversa()`
-- checa isso a cada execucao em vez de confiar na leitura.
--
-- O QUE NAO MUDA: os filtros de elegibilidade, as janelas, a excecao de tendencia de melhora do
-- R5, o piso de R$ 100 do spend_no_leads e os limiares de frequency (3.5), budget (20),
-- delivery_drop (50) e no_delivery (1). Os blocos R2, R3, R4, R6 e R7 abaixo sao copia verbatim
-- da versao viva em producao, conferida trecho a trecho contra pg_get_functiondef antes de
-- reescrever - inclusive o R4, que outro trabalho (20260903220726) ja havia trocado para a base
-- canonica.
--
-- UMA TROCA COSMETICA, declarada: a unidade do texto de R1 passa a vir de
-- `unidade_da_base(base, 1)` em vez de um `case` escrito a mao. Muda "formulario preenchido" para
-- "formulario enviado" e tira mais uma copia da camada canonica de dentro do motor.

CREATE OR REPLACE FUNCTION public.evaluate_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tarefa constant text := 'alertas-de-midia';
  v_r      record;
  v_chave  text;
  v_vivas  text[] := array[]::text[];
  v_total  integer;
begin
  -- R1: custo por resultado acima da regua que governa a MARCA daquela campanha
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity,
           d.custo, d.teto_efetivo as teto, d.regua_label,
           public.unidade_da_base(bd.base, 1) as unidade
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
      cross join lateral (select public.base_de_resultado_da_campanha(c.id) as base) bd
      cross join lateral (
        select nullif(public.resultados_da_base(bd.base, c.form_leads, c.messaging_started, c.link_clicks), 0) as resultados,
               public.metrica_do_teto(bd.base) as metrica
      ) den
      cross join lateral (
        select public.teto_vigente_da_marca(r.company_id, den.metrica,
                 public.linha_de_produto_do_nome(c.name, c.company_id)) as tv
      ) t
      cross join lateral (
        select c.spend / den.resultados as custo,
               case when bd.base = 'conversas'
                    then (t.tv->>'teto_que_governa')::numeric
                    else coalesce((t.tv->>'teto_que_governa')::numeric, r.threshold) end as teto_efetivo,
               case when t.tv->>'governa' = 'meta_de_negocio'
                    then case when t.tv->>'escopo_da_regua' = 'marca'
                              then 'regua da marca ' || coalesce(t.tv->'meta_de_negocio'->>'marca','?')
                              else 'meta de negocio da empresa' end
                         || ', definida por ' || coalesce(t.tv->'meta_de_negocio'->>'decidido_por','gestor')
                         || ' em ' || to_char((t.tv->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                         || case when (t.tv->>'provisoria')::boolean
                                 then ' (PROVISORIA, a revisar em '
                                      || to_char((t.tv->>'revisar_em')::date,'DD/MM/YYYY') || ')'
                                 else '' end
                    else 'historico do proprio desempenho' end as regua_label
      ) d
     where r.active and r.metric = 'cpl'
       and coalesce(c.category,'') in ('leadgen','mensagem')
       and den.resultados is not null
       and d.custo > d.teto_efetivo
  loop
    v_chave := 'midia:cpl:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Custo por resultado acima do aceitavel em ' || v_r.camp_name,
      p_o_que         => format('Esta campanha esta pagando %s por %s, acima do limite de %s que vale hoje para ela.',
                                public.reais(v_r.custo), v_r.unidade, public.reais(v_r.teto)),
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => format('%s por %s (limite %s, vindo de %s)',
                                public.reais(v_r.custo), v_r.unidade, public.reais(v_r.teto), v_r.regua_label),
      p_acao          => 'Comparar os criativos e publicos da campanha: se um anuncio puxa a media para cima, trocar. Se o limite ja nao reflete a meta atual, revisar a meta de negocio.',
      p_janela        => 'total acumulado da campanha',
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => round(v_r.custo, 2),
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R2: frequencia alta / fadiga de criativo (verbatim)
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity, c.frequency, r.threshold
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
     where r.active and r.metric = 'frequency'
       and c.frequency >= r.threshold
  loop
    v_chave := 'midia:frequency:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Mesmo publico vendo o anuncio muitas vezes em ' || v_r.camp_name,
      p_o_que         => format('Cada pessoa do publico ja viu o anuncio %s vezes em media. Acima de %s a resposta normalmente cai, porque o publico se cansou do criativo.',
                                public.numero_br(v_r.frequency, 1), public.numero_br(v_r.threshold, 1)),
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => format('frequencia media de %s exibicoes por pessoa (limite %s)',
                                public.numero_br(v_r.frequency, 1), public.numero_br(v_r.threshold, 1)),
      p_acao          => 'Subir criativo novo ou ampliar o publico. Manter o mesmo anuncio tende a encarecer o resultado.',
      p_janela        => 'total acumulado da campanha',
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => round(v_r.frequency, 2),
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R3: campanha ativa sem entrega (verbatim)
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity, r.window_days,
           (current_date - (select max(s.snapshot_date) from public.metric_snapshots s
                             where s.campaign_id = c.id)) as dias
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
     where r.active and r.metric = 'no_delivery'
       and exists (select 1 from public.metric_snapshots s
                    where s.campaign_id = c.id and s.snapshot_date >= current_date - 14)
       and not exists (select 1 from public.metric_snapshots s
                        where s.campaign_id = c.id and s.snapshot_date >= current_date - r.window_days
                          and s.impressions > 0)
  loop
    v_chave := 'midia:no_delivery:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Campanha ligada mas sem entregar em ' || v_r.camp_name,
      p_o_que         => format('A campanha esta com status ativo, porem nao registra nenhuma exibicao ha %s dia(s). Dinheiro parado e resultado zero enquanto isso.',
                                public.numero_br(v_r.dias)),
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => format('%s dia(s) sem nenhuma exibicao', public.numero_br(v_r.dias)),
      p_acao          => 'Conferir na ordem: conjunto pausado, orcamento esgotado, anuncio reprovado na revisao, ou publico pequeno demais para entregar.',
      p_janela        => format('ultimos %s dias', public.numero_br(v_r.window_days)),
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => v_r.dias::numeric,
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R4: gasto sem nenhum resultado na base canonica (verbatim, como em 20260903220726)
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity, c.spend
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
     where r.active and r.metric = 'spend_no_leads'
       and coalesce(c.category,'') in ('leadgen','mensagem')
       and public.resultados_da_base(public.base_de_resultado_da_campanha(c.id), c.form_leads, c.messaging_started, c.link_clicks) = 0
       and c.spend > r.threshold
  loop
    v_chave := 'midia:spend_no_leads:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Gasto sem nenhum resultado em ' || v_r.camp_name,
      p_o_que         => format('A campanha ja consumiu %s e nao trouxe um unico resultado na base pela qual ela e julgada. Nao e questao de custo alto: e ausencia total de resultado.',
                                public.reais(v_r.spend)),
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => format('%s gastos, 0 lead', public.reais(v_r.spend)),
      p_acao          => 'Testar o caminho do lead de ponta a ponta (formulario abre? mensagem chega?). Se o caminho esta certo, o problema e oferta ou publico - pausar antes de gastar mais.',
      p_janela        => 'total acumulado da campanha',
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => round(v_r.spend, 2),
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R5: criativo tres dias seguidos acima da regua DA MARCA
  for v_r in
    select agg.company_id, agg.campaign_id, agg.camp_name, agg.ad_name, agg.ad_external_id,
           r.id as rule_id, r.severity,
           agg.teto, agg.metric_label, agg.regua_label,
           agg.c0_num, agg.c0_txt, agg.c1_txt, agg.c2_txt, agg.decisao
      from (
        with last3 as (
          select s.ad_external_id, s.snapshot_date, s.spend,
                 public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                           s.form_leads, s.messaging_started, s.link_clicks) as results,
                 a.name as ad_name, c.id as campaign_id, c.company_id, c.name as camp_name,
                 public.base_de_resultado_da_campanha(c.id) as base_resultado,
                 public.linha_de_produto_do_nome(c.name, c.company_id) as marca,
                 row_number() over (partition by s.ad_external_id order by s.snapshot_date desc) as rn
            from public.ad_metric_snapshots s
            join public.ads a on a.external_id = s.ad_external_id
            join public.campaigns c on c.id = a.campaign_id
           where c.status = 'active'
             and coalesce(c.category,'') in ('leadgen','mensagem')
             and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
             and s.snapshot_date >= current_date - 14
             and s.spend > 0
        ), agg0 as (
          select ad_external_id,
                 max(ad_name) as ad_name, max(camp_name) as camp_name, max(base_resultado) as base_resultado,
                 max(marca) as marca,
                 max(company_id::text)::uuid as company_id, max(campaign_id::text)::uuid as campaign_id,
                 count(*) filter (where rn <= 3) as dias,
                 max(snapshot_date) filter (where rn = 1) as d0_date,
                 max(spend)   filter (where rn = 1) as s0, max(results) filter (where rn = 1) as r0,
                 max(spend)   filter (where rn = 2) as s1, max(results) filter (where rn = 2) as r1,
                 max(spend)   filter (where rn = 3) as s2, max(results) filter (where rn = 3) as r2
            from last3 where rn <= 3
           group by ad_external_id
        )
        select a0.*,
               t.teto, t.metric_label, t.regua_label,
               case when a0.r0 > 0 then round(a0.s0 / a0.r0, 2) end as c0_num,
               case when a0.r0 > 0 then public.reais(a0.s0 / a0.r0)
                    else 'sem resultado (' || public.reais(a0.s0) || ' gastos)' end as c0_txt,
               case when a0.r1 > 0 then public.reais(a0.s1 / a0.r1)
                    else 'sem resultado (' || public.reais(a0.s1) || ' gastos)' end as c1_txt,
               case when a0.r2 > 0 then public.reais(a0.s2 / a0.r2)
                    else 'sem resultado (' || public.reais(a0.s2) || ' gastos)' end as c2_txt,
               coalesce((select 'O conjunto todo indica: ' || (z.t->>'decisao') || '. ' || (z.t->>'acao')
                           from public.ads a2,
                                lateral (select public.decidir_sobre_conjunto(a0.company_id, a2.adset_external_id) t) z
                          where a2.external_id = a0.ad_external_id limit 1),
                        'Conjunto nao identificado no espelho: NAO pausar sem antes confirmar que existe outro anuncio ativo entregando.') as decisao
          from agg0 a0
          cross join lateral (
            select (tv.r->>'teto_que_governa')::numeric as teto,
                   case when a0.base_resultado = 'conversas' then 'custo por conversa'
                        when a0.base_resultado = 'cliques_no_link' then 'custo por clique no link'
                        else 'custo por formulario' end as metric_label,
                   case when tv.r->>'governa' = 'meta_de_negocio'
                        then case when tv.r->>'escopo_da_regua' = 'marca'
                                  then 'regua da marca ' || coalesce(tv.r->'meta_de_negocio'->>'marca','?')
                                  else 'meta de negocio da empresa' end
                             || ', definida por ' || coalesce(tv.r->'meta_de_negocio'->>'decidido_por','gestor')
                             || ' em ' || to_char((tv.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                             || case when (tv.r->>'provisoria')::boolean
                                     then ' (PROVISORIA, a revisar em '
                                          || to_char((tv.r->>'revisar_em')::date,'DD/MM/YYYY') || ')'
                                     else '' end
                        else 'historico do proprio desempenho' end as regua_label
              from (select public.teto_vigente_da_marca(a0.company_id,
                             public.metrica_do_teto(a0.base_resultado), a0.marca) as r) tv
          ) t
         where a0.dias >= 3
           and a0.d0_date >= current_date - 2
           and t.teto is not null
           and ((a0.r0 = 0 and a0.s0 > t.teto) or (a0.r0 > 0 and a0.s0 / a0.r0 > t.teto))
           and ((a0.r1 = 0 and a0.s1 > t.teto) or (a0.r1 > 0 and a0.s1 / a0.r1 > t.teto))
           and ((a0.r2 = 0 and a0.s2 > t.teto) or (a0.r2 > 0 and a0.s2 / a0.r2 > t.teto))
           and not (a0.r0 > 0 and a0.r1 > 0 and a0.r2 > 0
                    and (a0.s2 / a0.r2) > (a0.s1 / a0.r1) and (a0.s1 / a0.r1) > (a0.s0 / a0.r0))
      ) agg
      join public.alert_rules r on r.company_id = agg.company_id and r.metric = 'pause_3d' and r.active
  loop
    v_chave := 'midia:pause_3d:' || v_r.ad_external_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Criativo caro por tres dias seguidos: ' || v_r.ad_name,
      p_o_que         => format('O anuncio "%s" ficou acima do limite de %s (%s) em tres dias consecutivos, e nao esta melhorando. Tres dias seguidos ja descartam variacao normal do dia.',
                                v_r.ad_name, public.reais(v_r.teto), v_r.metric_label),
      p_onde          => format('Anuncio "%s", na campanha %s', v_r.ad_name, v_r.camp_name),
      p_quanto        => format('%s: dois dias atras %s, ontem %s, ultimo dia %s. Limite %s, vindo de %s.',
                                v_r.metric_label, v_r.c2_txt, v_r.c1_txt, v_r.c0_txt,
                                public.reais(v_r.teto), v_r.regua_label),
      p_acao          => v_r.decisao,
      p_janela        => 'tres ultimos dias com gasto registrado',
      p_tarefa        => v_tarefa,
      p_linha_produto => coalesce(public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
                                  public.linha_de_produto_do_nome(v_r.ad_name, v_r.company_id)),
      p_chave_dedupe  => v_chave,
      p_valor         => v_r.c0_num,
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R6: queda de entrega (verbatim)
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity, r.window_days,
           w.pct, w.media_recente, w.media_base
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
      cross join lateral (
        select round(avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)) as media_recente,
               round(avg(s.impressions) filter (where s.snapshot_date <  current_date - r.window_days
                                            and s.snapshot_date >= current_date - r.window_days - 7)) as media_base,
               round(100 * avg(s.impressions) filter (where s.snapshot_date >= current_date - r.window_days)
                     / nullif(avg(s.impressions) filter (where s.snapshot_date < current_date - r.window_days
                                                     and s.snapshot_date >= current_date - r.window_days - 7), 0)) as pct
          from public.metric_snapshots s
         where s.campaign_id = c.id and s.snapshot_date >= current_date - r.window_days - 7
      ) w
     where r.active and r.metric = 'delivery_drop'
       and w.media_base >= 500
       and w.media_recente is not null
       and w.pct < r.threshold
  loop
    v_chave := 'midia:delivery_drop:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => 'Entrega despencou em ' || v_r.camp_name,
      p_o_que         => format('A campanha continua ativa, mas passou a exibir muito menos: caiu para %s%% do volume que vinha entregando. Menos exibicao significa menos lead pelo mesmo orcamento.',
                                public.numero_br(v_r.pct)),
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => format('%s exibicoes por dia agora, contra %s por dia nos 7 dias anteriores (%s%% do volume anterior)',
                                public.numero_br(v_r.media_recente), public.numero_br(v_r.media_base), public.numero_br(v_r.pct)),
      p_acao          => 'Checar se houve mudanca de orcamento ou de publico, se algum anuncio foi reprovado, ou se o criativo saturou e o leilao deixou de entregar.',
      p_janela        => format('ultimos %s dias contra os 7 dias anteriores', public.numero_br(v_r.window_days)),
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => v_r.pct,
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  -- R7: orcamento estourado ou pico de gasto (verbatim)
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity,
           g.gasto_ontem, g.media_7d, b.budget_dia
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
      cross join lateral (
        select (select s.spend from public.metric_snapshots s
                 where s.campaign_id = c.id and s.snapshot_date = current_date - 1) as gasto_ontem,
               (select avg(s.spend) from public.metric_snapshots s
                 where s.campaign_id = c.id and s.snapshot_date < current_date - 1
                   and s.snapshot_date >= current_date - 8) as media_7d
      ) g
      cross join lateral (
        select sum(ast.daily_budget) / 100.0 as budget_dia
          from public.ad_sets ast
         where ast.campaign_id = c.id and upper(coalesce(ast.status,'')) = 'ACTIVE'
           and ast.daily_budget is not null
      ) b
     where r.active and r.metric = 'budget'
       and g.gasto_ontem is not null
       and (
         (b.budget_dia is not null and b.budget_dia > 0
           and g.gasto_ontem > b.budget_dia * (1 + r.threshold / 100.0))
         or
         (b.budget_dia is null and g.media_7d is not null and g.media_7d > 0
           and g.gasto_ontem > 1.8 * g.media_7d and g.gasto_ontem > 50)
       )
  loop
    v_chave := 'midia:budget:' || v_r.campaign_id;
    perform public.emitir_alerta(
      p_company_id    => v_r.company_id,
      p_severidade    => v_r.severity,
      p_titulo        => case when v_r.budget_dia is not null
                              then 'Gasto acima do orcamento diario em ' || v_r.camp_name
                              else 'Pico de gasto fora do padrao em ' || v_r.camp_name end,
      p_o_que         => case when v_r.budget_dia is not null
                              then format('Ontem a campanha gastou %s, mais do que o orcamento diario configurado de %s.',
                                          public.reais(v_r.gasto_ontem), public.reais(v_r.budget_dia))
                              else format('Ontem a campanha gastou %s, muito acima da media recente de %s por dia. Nao ha orcamento diario configurado nos conjuntos para comparar.',
                                          public.reais(v_r.gasto_ontem), public.reais(v_r.media_7d)) end,
      p_onde          => 'Campanha ' || v_r.camp_name,
      p_quanto        => case when v_r.budget_dia is not null
                              then format('%s gastos contra orcamento de %s (%s%% acima)',
                                          public.reais(v_r.gasto_ontem), public.reais(v_r.budget_dia),
                                          public.numero_br(round(100 * (v_r.gasto_ontem / v_r.budget_dia - 1))))
                              else format('%s gastos contra media de %s por dia (%sx a media)',
                                          public.reais(v_r.gasto_ontem), public.reais(v_r.media_7d),
                                          public.numero_br(round(v_r.gasto_ontem / nullif(v_r.media_7d,0), 1), 1)) end,
      p_acao          => 'Confirmar se a mudanca de orcamento foi intencional. Se nao foi, o gasto extra desse dia ja aconteceu - ajustar o orcamento agora evita repetir amanha.',
      p_janela        => 'gasto de ontem, comparado aos 7 dias anteriores',
      p_tarefa        => v_tarefa,
      p_linha_produto => public.linha_de_produto_do_nome(v_r.camp_name, v_r.company_id),
      p_chave_dedupe  => v_chave,
      p_valor         => round(v_r.gasto_ontem, 2),
      p_campaign_id   => v_r.campaign_id,
      p_rule_id       => v_r.rule_id);
    v_vivas := v_vivas || v_chave;
  end loop;

  perform public.resolver_alertas_da_tarefa(v_tarefa, v_vivas);

  select count(*) into v_total
    from public.alerts
   where resolved = false and tarefa = v_tarefa;

  return coalesce(v_total, 0);
end
$function$
;

-- ============================================================================
-- A migration se recusa a terminar se algo nao bater
-- ============================================================================
do $$
declare
  v_def text;
  v_dispara integer;
  v_total integer;
  v_conflito integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'evaluate_alerts';

  -- As sete regras continuam existindo e emitindo.
  if (length(v_def) - length(replace(v_def, 'for v_r in', ''))) / length('for v_r in') <> 7 then
    raise exception 'evaluate_alerts deixou de ter as sete regras';
  end if;

  -- Nao pode ter sobrado nenhum ponto lendo a regua sem marca dentro do motor.
  if v_def like '%teto_vigente(r.company_id%' or v_def like '%teto_vigente(a0.company_id%' then
    raise exception 'Ainda existe leitura de teto_vigente sem marca dentro de evaluate_alerts';
  end if;

  -- O fallback generico nao pode mais alcancar a base de conversas.
  if v_def like '%d.custo > coalesce(d.teto, r.threshold)%' then
    raise exception 'O fallback de alert_rules.threshold continua valendo para a base conversas';
  end if;

  -- O piso do spend_no_leads e a excecao de melhora do R5 seguem intactos.
  if v_def not like '%and c.spend > r.threshold%'
     or v_def not like '%(a0.s2 / a0.r2) > (a0.s1 / a0.r1) and (a0.s1 / a0.r1) > (a0.s0 / a0.r0)%' then
    raise exception 'Um filtro que nao era para mudar mudou em evaluate_alerts';
  end if;

  -- cpl e spend_no_leads nao podem alertar sobre o mesmo fato.
  select count(*) into v_conflito from public.prova_regua_de_conversa()
   where veredito = 'DISPARA' and conflito_com_spend_no_leads like 'spend_no_leads DISPARA%';
  if v_conflito > 0 then
    raise exception 'Ha % campanha(s) em que cpl e spend_no_leads disparariam sobre o mesmo fato', v_conflito;
  end if;

  -- Uma regua que dispara em TODAS as campanhas de conversa esta errada por construcao: ela foi
  -- derivada do nivel em que essas mesmas campanhas operam hoje.
  select count(*) filter (where veredito = 'DISPARA'), count(*)
    into v_dispara, v_total from public.prova_regua_de_conversa();
  if v_total > 0 and v_dispara = v_total then
    raise exception 'A regua nova dispararia em TODAS as % campanhas de conversa: revisar os valores antes de seguir.', v_total;
  end if;

  raise notice 'evaluate_alerts le a regua da marca. % de % campanhas de conversa disparariam hoje.', v_dispara, v_total;
end $$;
