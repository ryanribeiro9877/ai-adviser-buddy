-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806184142
-- name: esp16_regra_de_maturacao_e_excecao_dura
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-16 · regra de maturacao e a excecao dura. Fonte unica da decisao "pode pausar por custo?".
--
-- A REGRA, do CONTRA_2 Parte III: objeto com menos de 3 dias de entrega NAO se pausa por custo.
-- Custo de objeto em aprendizado e instavel por construcao - a Meta ainda esta calibrando a
-- entrega, e pausar ali mata a calibracao e joga o dinheiro ja gasto fora. Pausar cedo por custo
-- alto e o erro numero um do gestor amador, e e o tipo de erro que o sistema estaria pronto para
-- automatizar se ninguem escrevesse esta regra.
--
-- A EXCECAO DURA, que vale em QUALQUER idade: zero resultado E CTR abaixo do minimo E gasto acima
-- do piso. Aqui nao ha aprendizado a proteger - ha peca que nao conversa com ninguem consumindo
-- verba. Esperar maturacao neste caso e financiar um erro conhecido.
--
-- "~ZERO LEAD" LIDO COMO ZERO EXATO: o contrato diz "aproximadamente zero". Eu leio como ZERO,
-- de proposito, para nao inventar corte. Inventar "ate 2 leads conta como quase zero" seria
-- colocar numero meu no lugar de numero dele.
--
-- LIMIARES VEM DA TABELA, nao do codigo: CTR minimo e piso de gasto sao lidos de
-- limiares_de_midia. Se o gestor mudar o limiar, esta regra muda com ele sem deploy.
--
-- O QUE ESTA FUNCAO NAO CHECA, e esta declarado na resposta: a guarda do UNICO conjunto de lead
-- sem alternativa ativa. Essa e do ESP-17 e continua devendo - hoje o motor de alertas recomenda
-- pausar tres criativos que sao tudo que entrega na conta.
--
-- SOBRE DUPLICACAO: diagnosticar_custo (ESP-18) tem uma nota de maturacao inline. Ela INFORMA;
-- esta funcao DECIDE. Nao sao a mesma regra em dois lugares - uma avisa, a outra recusa.

create or replace function public.pode_pausar_por_custo(p_company_id uuid, p_ad_external_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_dias int; v_gasto numeric; v_resultados bigint;
  v_ctr numeric; v_ctr_min numeric; v_piso numeric;
  v_maturacao_dias int := 3;
  v_excecao boolean;
begin
  if p_company_id is null or p_ad_external_id is null then
    raise exception 'pode_pausar_por_custo exige empresa e anuncio';
  end if;

  select valor, coalesce(piso_de_gasto, 0) into v_ctr_min, v_piso
    from public.limiares_de_midia
   where company_id = p_company_id and metrica = 'ctr_link'
     and tipo = 'absoluto' and operador = '<' and vigente limit 1;

  if v_ctr_min is null then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_limiar_cadastrado',
      'mensagem_para_o_gestor','Nao existe limiar de CTR minimo cadastrado para esta empresa. Sem limiar eu nao consigo avaliar a excecao dura, e por isso NAO libero pausa por custo - ausencia de regra nao e permissao.');
  end if;

  select count(*) filter (where spend > 0),
         coalesce(sum(spend),0),
         coalesce(sum(form_leads),0),
         (100.0 * coalesce(sum(link_clicks),0) / nullif(sum(impressions),0))
    into v_dias, v_gasto, v_resultados, v_ctr
    from public.ad_metric_snapshots
   where company_id = p_company_id and ad_external_id = p_ad_external_id;

  if coalesce(v_dias,0) = 0 then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_entrega',
      'mensagem_para_o_gestor','Este anuncio nunca entregou. Nao existe custo a julgar, e pausar o que nao entrega nao muda nada - se ele esta ativo e nao entrega, o problema e outro.');
  end if;

  v_excecao := (v_resultados = 0 and v_ctr is not null and v_ctr < v_ctr_min and v_gasto >= v_piso);

  return jsonb_build_object(
    'anuncio', p_ad_external_id,
    'dias_com_entrega', v_dias,
    'maturacao_exigida_dias', v_maturacao_dias,
    'maduro', (v_dias >= v_maturacao_dias),
    'medidas', jsonb_build_object('gasto_acumulado', round(v_gasto::numeric,2),
                                  'resultados', v_resultados,
                                  'ctr_link_pct', round(v_ctr::numeric,3)),
    'limiares_usados', jsonb_build_object('ctr_minimo_pct', v_ctr_min, 'piso_de_gasto', v_piso),
    'excecao_dura_atendida', v_excecao,
    'permitido', (v_dias >= v_maturacao_dias or v_excecao),
    'motivo', case
        when v_excecao and v_dias < v_maturacao_dias then 'excecao_dura_zero_resultado'
        when v_dias >= v_maturacao_dias then 'maduro'
        else 'em_maturacao' end,
    'mensagem_para_o_gestor', case
        when v_excecao and v_dias < v_maturacao_dias then
          'Este anuncio tem so ' || v_dias || ' dia(s) de entrega, mas a excecao dura se aplica: ZERO resultado, CTR de '
          || round(v_ctr::numeric,2) || '% abaixo do minimo de ' || v_ctr_min || '%, e R$ ' || round(v_gasto::numeric,2)
          || ' ja gastos. Aqui nao ha aprendizado a proteger - a peca nao conversa com ninguem. Pausar e o certo.'
        when v_dias >= v_maturacao_dias then
          'Anuncio maduro (' || v_dias || ' dias de entrega). Pausa por custo e avaliavel - mas ela ainda precisa passar pela guarda de alternativa ativa, que este sistema ainda NAO tem.'
        else
          'NAO pausar por custo: este anuncio tem apenas ' || v_dias || ' dia(s) de entrega e a maturacao minima e '
          || v_maturacao_dias || '. Custo de objeto em aprendizado e instavel por construcao, e pausar agora joga fora o que ja foi gasto na calibracao. '
          || 'A excecao dura nao se aplica porque ' || case
               when v_resultados > 0 then 'ele JA trouxe ' || v_resultados || ' resultado(s)'
               when v_ctr >= v_ctr_min then 'o CTR de ' || round(v_ctr::numeric,2) || '% esta acima do minimo'
               else 'o gasto de R$ ' || round(v_gasto::numeric,2) || ' ainda nao alcancou o piso de R$ ' || v_piso end
          || '. Monitorar e reavaliar quando completar ' || v_maturacao_dias || ' dias.' end,
    'NAO_VERIFICADO_AQUI', 'A guarda do UNICO conjunto de lead sem alternativa ativa NAO e checada nesta funcao - ela e do ESP-17 e continua pendente. Hoje o motor de alertas recomenda pausar tres criativos que sao tudo o que entrega na conta. Liberado aqui nao significa seguro pausar.'
  );
end;
$$;