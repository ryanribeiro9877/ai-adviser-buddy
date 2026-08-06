-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806190459
-- name: esp19_escada_de_escala_por_duplicacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-19 · escada de escala: +20% no maximo, por DUPLICACAO, com espera entre passos.
--
-- O BLOQUEIO E COMO ELE FOI RESOLVIDO SEM INVENTAR NUMERO: a escada do contrato dispara quando o
-- custo esta abaixo do "IDEAL", e o gestor definiu APENAS o teto de R$ 1,60 (confirmado pelo Ryan
-- em 06/08). Nao existe regua de ideal.
-- Em vez de inventar uma, uso a definicao que o sistema JA TEM: evaluate_winners classifica
-- vencedor como custo <= 80% do teto. Isso esta em producao e e convencao decidida, nao numero meu.
-- Portanto o gatilho de escala e teto x 0,80 - hoje R$ 1,28 - e a procedencia e o criterio de
-- vencedor existente.
--
-- POR QUE DUPLICAR E NAO EDITAR, que e o coracao deste card: editar o orcamento de um objeto que
-- entrega bem devolve ele ao aprendizado, e o aprendizado e justamente o que fez ele entregar bem.
-- Duplicar preserva o original entregando enquanto a copia com verba maior calibra. Se a copia
-- piorar, o original continua de pe. Editar aposta tudo num movimento sem volta.
--
-- +20% E TETO POR PASSO, NAO SUGESTAO: salto grande joga o objeto em aprendizado do mesmo jeito
-- que a edicao. A escada existe para subir devagar o suficiente para a Meta nao recalibrar.
--
-- LACUNA DECLARADA E NAO CONTORNADA - A ESPERA ENTRE PASSOS: o contrato pede 3 a 4 dias entre
-- aumentos. O sistema NAO tem historico de alteracao de orcamento de conjunto. Da para verificar
-- alteracoes feitas PELO SISTEMA (audit_log), e nao da para verificar alteracao feita a mao no
-- Gerenciador. Entao a espera e verificavel so em parte, e a resposta diz isso em vez de afirmar
-- que o objeto esta liberado.
--
-- A ESCADA NAO DECIDE SOZINHA: ela chama decidir_sobre_conjunto (ESP-17) primeiro. Se a arvore nao
-- disser que o conjunto esta dentro do teto COM volume, nao ha escala a avaliar - e a arvore ja
-- carrega maturacao, tendencia de reversao e a guarda do unico conjunto.

create or replace function public.avaliar_escala(p_company_id uuid, p_adset_external_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_arvore jsonb; v_decisao text; v_cpl numeric; v_teto numeric; v_volume boolean;
  v_barra numeric; v_orc_atual numeric; v_orc_novo numeric;
  v_ultima_escala timestamptz; v_dias_desde int; v_espera_dias int := 3;
  v_exposicao jsonb; v_apto boolean;
begin
  if p_company_id is null or p_adset_external_id is null then
    raise exception 'avaliar_escala exige empresa e conjunto';
  end if;

  v_arvore := public.decidir_sobre_conjunto(p_company_id, p_adset_external_id);
  v_decisao := v_arvore->>'decisao';
  v_cpl     := (v_arvore->'numeros'->>'custo_por_formulario_7d')::numeric;
  v_teto    := (v_arvore->'numeros'->>'regua_que_governa')::numeric;
  v_volume  := (v_arvore->'numeros'->>'amostra_confiavel')::boolean;
  v_barra   := round(v_teto * 0.80, 2);

  select daily_budget/100.0 into v_orc_atual from public.ad_sets
   where external_id = p_adset_external_id and company_id = p_company_id;

  if v_orc_atual is null then
    return jsonb_build_object('apto_a_escalar', false, 'motivo','sem_orcamento_no_conjunto',
      'mensagem_para_o_gestor','Este conjunto nao tem orcamento proprio no espelho - pode ser CBO, com o orcamento na campanha. Escalar CBO e outro movimento e esta funcao nao o cobre.');
  end if;

  v_orc_novo := round(v_orc_atual * 1.20, 2);

  -- espera entre passos: verificavel apenas para alteracoes feitas PELO sistema
  select max(created_at) into v_ultima_escala from public.audit_log
   where company_id = p_company_id
     and (details::text ilike '%alterar_orcamento%' or details::text ilike '%escalar%')
     and details::text like '%' || p_adset_external_id || '%';
  v_dias_desde := case when v_ultima_escala is not null
                       then extract(day from (now() - v_ultima_escala))::int end;

  v_apto := (v_decisao = 'dentro_do_teto_com_volume')
        and v_cpl is not null and v_cpl <= v_barra
        and v_volume
        and (v_dias_desde is null or v_dias_desde >= v_espera_dias);

  if v_apto then
    v_exposicao := public.avaliar_orcamento_diario(p_company_id, v_orc_novo, 1);
  end if;

  return jsonb_build_object(
    'conjunto', p_adset_external_id,
    'apto_a_escalar', v_apto,
    'decisao_da_arvore', v_decisao,
    'barra_de_escala', jsonb_build_object(
      'valor', v_barra,
      'origem','80% do teto que governa (R$ ' || v_teto || '), reusando o criterio de vencedor que ja existe em evaluate_winners. NAO e regua nova nem numero inventado - o gestor definiu apenas o teto.'),
    'medidas', jsonb_build_object(
      'custo_por_formulario_7d', v_cpl,
      'amostra_confiavel', v_volume,
      'orcamento_atual_dia', v_orc_atual,
      'orcamento_proposto_dia', v_orc_novo,
      'aumento_pct', 20),
    'espera_entre_passos', jsonb_build_object(
      'dias_exigidos', v_espera_dias,
      'ultima_escala_pelo_sistema', v_ultima_escala,
      'dias_desde', v_dias_desde,
      'LIMITE','Verifico apenas alteracoes feitas PELO SISTEMA, no audit_log. Alteracao feita a mao no Gerenciador NAO aparece aqui - se o gestor subiu verba ontem por fora, eu nao sei e este campo nao prova nada.'),
    'exposicao_se_escalar', v_exposicao,
    'como_executar', case when not v_apto then null else
      'DUPLICAR o conjunto com o orcamento novo de R$ ' || v_orc_novo || '/dia. NAO editar o orcamento do original. '
      || 'O original continua entregando enquanto a copia calibra; se a copia piorar, nada foi perdido. '
      || 'Editar devolveria ao aprendizado justamente o objeto cujo aprendizado fez ele entregar bem.' end,
    'porque_nao', case
      when v_apto then null
      when v_decisao <> 'dentro_do_teto_com_volume' then
        'A arvore nao classificou este conjunto como dentro do teto com volume - ela disse "' || v_decisao || '". Escala so se avalia sobre objeto que a arvore aprovou; ela carrega maturacao, tendencia de reversao e a guarda do unico conjunto.'
      when v_cpl > v_barra then
        'Custo de R$ ' || v_cpl || ' esta acima da barra de escala de R$ ' || v_barra
        || ' (80% do teto). Dentro do teto nao basta: escalar tende a EMPURRAR o custo para cima, porque a Meta passa a comprar resultado marginal mais caro. Escalar quem esta encostado no teto e escalar direto para fora dele.'
      when not v_volume then
        'Amostra ainda nao confiavel. Escalar sobre ruido e aumentar verba com base em coincidencia.'
      when v_dias_desde < v_espera_dias then
        'Ultima escala feita pelo sistema ha ' || v_dias_desde || ' dia(s), e a espera minima e ' || v_espera_dias || '. Objeto recem-escalado ainda esta recalibrando.'
      else 'Nao apto por combinacao de fatores - ver medidas.' end,
    'nota','Escala e por DUPLICACAO com +20% no maximo por passo. Salto grande devolve o objeto ao aprendizado do mesmo jeito que a edicao, e ai o ganho vira prejuizo.'
  );
end;
$$;