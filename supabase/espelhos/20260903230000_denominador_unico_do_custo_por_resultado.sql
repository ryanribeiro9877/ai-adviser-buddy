-- Denominador unico do custo por resultado (03/09/2026)
--
-- POR QUE: o MESMO indicador de custo por resultado era calculado com CINCO denominadores
-- diferentes dentro do banco, com a formula copiada em treze lugares. Levantado em 03/09/2026:
--
--   base condicional (mensagem -> messaging_started, senao form_leads)
--        evaluate_alerts (regra cpl e regra pause_3d), evaluate_winners,
--        computar_perfil_vencedor, detectar_sinais_recomendacao
--   base form_leads incondicional
--        diagnosticar_custo, decidir_sobre_conjunto, get_report_export_data,
--        avaliar_pacing, montar_corpo_digest, casar_criativo_performance,
--        pode_pausar_por_custo, get_weekly_report_data   <- os cinco ultimos a auditoria nao listou
--   base leads (coluna agregada, desatualizada)
--        evaluate_alerts, regra spend_no_leads (`c.leads = 0`)  <- a auditoria nao listou
--
-- CONSEQUENCIA MEDIDA, com os numeros que o gestor ve na tela:
--
--   1) Conjunto WA_JUR_C1 (COHAPM_JURIDICO_CONV_WA_2026-08), 7 dias, 6 dias com entrega:
--      decidir_sobre_conjunto respondia `resultados_7d: 0` e
--      "Zero resultado, mas apenas R$ 163.28 gastos". O conjunto tinha 39 CONVERSAS.
--      Nao e custo alto nem custo baixo: e um resultado real reportado como inexistente,
--      no texto que o sistema usa para prescrever pausa.
--
--   2) avaliar_pacing da Legal e Viver respondia `custo_por_formulario_7d: 7.63` e
--      `leads_por_dia_que_a_estrutura_comporta: 16`. Os R$ 7,63 sao gasto TOTAL da empresa
--      (R$ 1.572,39 — que inclui R$ 1.283,19 de trafego e engajamento) dividido pelos 206
--      formularios, que sairam de apenas R$ 289,20 de leadgen. O custo por formulario
--      verdadeiro e R$ 1,40. Errado por 5,4x, no numero que dimensiona verba.
--
--   3) A PLANILHA que vai ao cliente repetia a mesma conta: o Resumo dividia o investimento
--      total pelos formularios do total. Mesmo erro, mesma empresa, mesmo periodo.
--
-- O DEFEITO NAO E SO O DENOMINADOR: e tambem o NUMERADOR. avaliar_pacing, montar_corpo_digest,
-- get_weekly_report_data e a planilha somavam o gasto de TODAS as campanhas e dividiam pelos
-- resultados de ALGUMAS. Por isso a camada abaixo separa gasto por base, e nao apenas troca
-- o `case when`.
--
-- ALINHAMENTO COM supabase/functions/_shared/metrica_canonica.ts (commits 73f7288 / c3c0bae):
-- aquele modulo estabelece que a base de resultado vai no NOME da metrica, de modo que nao
-- exista "CPL" sem denominador declarado. Esta migration traz a mesma regra para o SQL:
-- `base_de_resultado` espelha `baseDoObjetivo()`, `rotulo_da_base` espelha `rotuloDaBase()`,
-- e o SQL devolve valor BRUTO (o modulo arredonda uma vez so, do lado do TypeScript).
--
-- DUAS DIFERENCAS DELIBERADAS EM RELACAO AO MODULO, declaradas em vez de silenciosas:
--
--   (a) `baseDoObjetivo()` decide so pela categoria. No banco, categoria e NULL em 44 das 79
--       campanhas e em 35 das 41 com entrega nos ultimos 7 dias (conferido em 03/09/2026),
--       porque `classify_campaign` so e chamada por `sync_ingest_windsor` e a ingestao viva
--       entra por outro caminho. Decidir so pela categoria deixaria a maior parte do gasto
--       sem correcao: todos os caminhos passariam a concordar em "indefinido".
--       O desempate NAO usa contador. Usar "tem conversa > 0" tornaria a base dependente da
--       janela do relatorio — a troca silenciosa de base que o proprio modulo condena.
--       O desempate usa `ad_sets.optimization_goal = 'CONVERSATIONS'` e `campaigns.objective`,
--       que sao configuracao declarada na Meta, estavel, ja documentada em
--       `_shared/objetivo_odax.ts` como a marca de Click-to-WhatsApp. Conferido em 03/09/2026:
--       23 conjuntos tem esse valor e TODOS sao de mensagem; nenhum conjunto de leadgen tem.
--
--   (b) `baseDoObjetivo()` do modulo nunca devolve 'cliques_no_link', embora o tipo
--       `BaseDeResultado` ja preveja essa base. Aqui ela e devolvida: campanha de trafego,
--       engajamento, alcance e video NAO produz formulario, e joga-la na base 'formularios'
--       era a origem do erro de 5,4x do item (2) — 21 das 27 campanhas com entrega na Legal
--       e Viver sao impulsionamento de post. Recomendacao para o modulo TypeScript:
--       fazer `baseDoObjetivo()` devolver 'cliques_no_link' nesses objetivos, para que os
--       dois lados continuem espelhados.
--
-- O QUE ESTA MIGRATION NAO FAZ, de proposito:
--   - nao mexe em limiar de alerta (decisao de produto do gestor; os numeros estao no relatorio);
--   - nao regrava campaigns.category (mudaria QUAIS campanhas entram no motor de alertas);
--   - nao mexe nos filtros de elegibilidade de evaluate_alerts, pelo mesmo motivo;
--   - nao regrava a coluna agregada `campaigns.leads`, que segue desatualizada: a regra
--     spend_no_leads deixou de le-la (bloco 12), mas quem mais consumir essa coluna continua
--     lendo um numero velho. Corrigir a ingestao dela e trabalho separado.
--
-- REEXECUTAVEL: `select * from public.prova_denominador_unico(7)` compara, campanha a campanha,
-- o custo que cada caminho devolve contra o calculo canonico. `confere = false` em qualquer
-- linha significa que alguem voltou a escrever a formula a mao.

-- ============================================================================
-- 1) A CAMADA UNICA — a formula existe em um lugar so
-- ============================================================================

CREATE OR REPLACE FUNCTION public.base_de_resultado(p_categoria text, p_optimization_goal text DEFAULT NULL::text, p_objective text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when lower(btrim(coalesce(p_categoria,''))) in ('mensagem','mensagens')
      then 'conversas'
    when lower(btrim(coalesce(p_categoria,''))) in
         ('leadgen','lead','leads','formulario','formularios','cadastro','vendas','conversao','conversoes')
      then 'formularios'
    when lower(btrim(coalesce(p_categoria,''))) in
         ('trafego','engajamento','alcance','video','app','outro')
      then 'cliques_no_link'
    when upper(btrim(coalesce(p_optimization_goal,''))) = 'CONVERSATIONS'
      then 'conversas'
    when upper(coalesce(p_objective,'')) like '%MESSAGE%'
      then 'conversas'
    when upper(btrim(coalesce(p_optimization_goal,''))) in
         ('LEAD_GENERATION','QUALITY_LEAD','QUALITY_CALL','OFFSITE_CONVERSIONS','ONSITE_CONVERSIONS')
      then 'formularios'
    when upper(coalesce(p_objective,'')) like '%LEAD%'
      then 'formularios'
    when upper(coalesce(p_objective,'')) like any (array['%SALES%','%CONVERSION%','%CATALOG%'])
      then 'formularios'
    when upper(coalesce(p_objective,'')) like any
         (array['%TRAFFIC%','%LINK_CLICK%','%ENGAGEMENT%','%AWARENESS%','%REACH%','%VIDEO%','%APP%','%POST%','%PAGE_LIKES%'])
      then 'cliques_no_link'
    when upper(btrim(coalesce(p_optimization_goal,''))) in
         ('LANDING_PAGE_VIEWS','LINK_CLICKS','POST_ENGAGEMENT','VISIT_INSTAGRAM_PROFILE','PROFILE_VISIT',
          'REACH','IMPRESSIONS','THRUPLAY','VIDEO_VIEWS','PAGE_LIKES','EVENT_RESPONSES','AD_RECALL_LIFT')
      then 'cliques_no_link'
    else 'formularios'
  end
$function$
;

comment on function public.base_de_resultado(text, text, text) is
'Base de resultado de uma campanha: formularios, conversas ou cliques_no_link. Ordem: categoria primeiro (decisao humana), depois optimization_goal e objective da Meta (configuracao declarada). NUNCA olha contador: base que depende de quantos resultados apareceram na janela muda de identidade conforme o periodo do relatorio. Espelha baseDoObjetivo() de _shared/metrica_canonica.ts, com a diferenca declarada no cabecalho desta migration.';

CREATE OR REPLACE FUNCTION public.base_de_resultado_da_campanha(p_campaign_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.base_de_resultado(
           c.category,
           (select max(ast.optimization_goal) from public.ad_sets ast
             where ast.campaign_id = c.id
               and upper(coalesce(ast.optimization_goal,'')) = 'CONVERSATIONS'),
           c.objective)
    from public.campaigns c
   where c.id = p_campaign_id
$function$
;

CREATE OR REPLACE FUNCTION public.base_de_resultado_do_conjunto(p_adset_external_id text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.base_de_resultado(c.category, ast.optimization_goal, c.objective)
    from public.ad_sets ast
    left join public.campaigns c on c.id = ast.campaign_id
   where ast.external_id = p_adset_external_id
   limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.base_de_resultado_do_anuncio(p_ad_external_id text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.base_de_resultado(c.category, ast.optimization_goal, c.objective)
    from public.ads a
    left join public.ad_sets ast on ast.external_id = a.adset_external_id
    left join public.campaigns c on c.id = coalesce(a.campaign_id, ast.campaign_id)
   where a.external_id = p_ad_external_id
   limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.resultados_da_base(p_base text, p_form_leads numeric, p_messaging numeric, p_link_clicks numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case p_base
    when 'conversas'        then coalesce(p_messaging, 0)
    when 'cliques_no_link'  then p_link_clicks
    else coalesce(p_form_leads, 0)
  end
$function$
;

CREATE OR REPLACE FUNCTION public.custo_por_resultado(p_gasto numeric, p_form_leads numeric, p_messaging numeric, p_base text, p_link_clicks numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_gasto / nullif(public.resultados_da_base(p_base, p_form_leads, p_messaging, p_link_clicks), 0)
$function$
;

comment on function public.custo_por_resultado(numeric, numeric, numeric, text, numeric) is
'Custo por resultado com o denominador DECLARADO em p_base. Devolve BRUTO: quem exibe arredonda uma vez so, como manda _shared/metrica_canonica.ts. Zero resultado devolve NULL, nunca zero - "R$ 0,00 por lead" leria como "sai de graca".';

CREATE OR REPLACE FUNCTION public.rotulo_da_base(p_base text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case p_base
    when 'conversas'       then 'por conversa iniciada'
    when 'cliques_no_link' then 'por clique no link'
    else                        'por formulario enviado'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.unidade_da_base(p_base text, p_quantidade numeric DEFAULT NULL::numeric)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_base = 'conversas'       then case when p_quantidade = 1 then 'conversa iniciada' else 'conversas iniciadas' end
    when p_base = 'cliques_no_link' then case when p_quantidade = 1 then 'clique no link'    else 'cliques no link'    end
    else                                 case when p_quantidade = 1 then 'formulario enviado' else 'formularios' end
  end
$function$
;

comment on function public.unidade_da_base(text, numeric) is
'Substantivo do resultado, para texto que vai ao gestor e ao cliente. Concorda em numero quando a quantidade e informada. Existe para que nenhuma tela precise traduzir base_de_resultado por conta propria - traduzir no cliente e como recriar a formula no cliente.';

CREATE OR REPLACE FUNCTION public.metrica_do_teto(p_base text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case p_base
    when 'conversas'       then 'custo_por_conversa'
    when 'cliques_no_link' then 'custo_por_clique_link'
    else 'custo_por_formulario'
  end
$function$
;

comment on function public.metrica_do_teto(text) is
'Nome da regua que julga esta base. Campanha de trafego cai em custo_por_clique_link, que hoje nao tem regua vigente em nenhuma empresa - e por isso ela deixa de ser julgada contra custo_por_lead_lp, que era comparar numerador de uma base com regua de outra.';

-- ============================================================================
-- 2) FERRAMENTAS DO AGENTE — diagnosticar_custo
--    ANTES: `spend/nullif(form_leads,0)`. Num anuncio de WhatsApp isso e divisao
--    por zero em todos os dias: o diagnostico devolvia "custo nao subiu" para
--    peca que estava encarecendo a conversa.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.diagnosticar_custo(p_company_id uuid, p_ad_external_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d record; b record; v_idade int; v_maduro boolean;
  v_lim_ctr_queda numeric; v_lim_cpm_alta numeric; v_lim_ctr_min numeric; v_piso numeric; v_lim_freq numeric;
  v_sinal text; v_causa text; v_acao text; v_confirmacao text;
  v_var_custo numeric; v_var_ctr numeric; v_var_cpm numeric; v_var_freq numeric;
  v_base text; v_rotulo text; v_medidas jsonb;
begin
  if p_company_id is null or p_ad_external_id is null then
    raise exception 'diagnosticar_custo exige empresa e anuncio';
  end if;

  v_base   := public.base_de_resultado_do_anuncio(p_ad_external_id);
  v_rotulo := public.rotulo_da_base(v_base);

  select valor, piso_de_gasto into v_lim_ctr_min, v_piso from public.limiares_de_midia
   where company_id=p_company_id and metrica='ctr_link' and tipo='absoluto' and operador='<' and vigente limit 1;
  select valor into v_lim_ctr_queda from public.limiares_de_midia
   where company_id=p_company_id and metrica='ctr_link' and tipo='variacao_relativa' and vigente limit 1;
  select valor into v_lim_cpm_alta from public.limiares_de_midia
   where company_id=p_company_id and metrica='cpm' and tipo='variacao_relativa' and vigente limit 1;
  select valor into v_lim_freq from public.limiares_de_midia
   where company_id=p_company_id and metrica='frequencia' and tipo='absoluto' and vigente limit 1;

  select snapshot_date, spend, impressions, link_clicks, form_leads, messaging_started, frequency,
         (100.0*link_clicks/nullif(impressions,0)) ctr,
         (1000.0*spend/nullif(impressions,0)) cpm,
         public.custo_por_resultado(spend, form_leads, messaging_started, v_base, link_clicks) custo,
         public.resultados_da_base(v_base, form_leads, messaging_started, link_clicks) resultados
    into d
    from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0
   order by snapshot_date desc limit 1;

  if d is null then
    return jsonb_build_object('diagnostico','sem_entrega',
      'base_de_resultado', v_base,
      'motivo','Este anuncio nao tem nenhum dia com gasto. Sem entrega nao ha custo a diagnosticar - e ausencia de dado nao e ausencia de problema.');
  end if;

  select avg(100.0*link_clicks/nullif(impressions,0)) ctr,
         avg(1000.0*spend/nullif(impressions,0)) cpm,
         avg(public.custo_por_resultado(spend, form_leads, messaging_started, v_base, link_clicks)) custo,
         avg(frequency) freq, count(*) dias
    into b
    from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0
     and snapshot_date < d.snapshot_date and snapshot_date >= d.snapshot_date - 3;

  select count(*) into v_idade from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0;
  v_maduro := (v_idade >= 3);

  if coalesce(b.dias,0) = 0 then
    return jsonb_build_object('diagnostico','sem_base_de_comparacao',
      'dias_com_entrega', v_idade,
      'base_de_resultado', v_base,
      'motivo','Nao ha dias anteriores com entrega para comparar. Variacao exige base; sem ela qualquer conclusao sobre subida seria invencao.');
  end if;

  v_var_custo := case when b.custo > 0 then 100.0*(d.custo - b.custo)/b.custo end;
  v_var_ctr   := case when b.ctr   > 0 then 100.0*(d.ctr   - b.ctr)  /b.ctr   end;
  v_var_cpm   := case when b.cpm   > 0 then 100.0*(d.cpm   - b.cpm)  /b.cpm   end;
  v_var_freq  := case when b.freq  > 0 then 100.0*(d.frequency - b.freq)/b.freq end;

  if coalesce(v_var_custo,0) <= 0 then
    v_sinal := 'Custo ' || v_rotulo || ' NAO subiu: ' || round(coalesce(v_var_custo,0),1) || '% vs media dos ' || b.dias || ' dias anteriores.';
    v_causa := 'Nada a diagnosticar nesta leitura.';
    v_acao  := 'Nenhuma acao por custo. Se houver outro motivo de preocupacao, ele nao esta neste indicador.';
  elsif v_var_ctr is not null and v_var_ctr <= v_lim_ctr_queda then
    v_sinal := 'Custo ' || v_rotulo || ' subiu ' || round(v_var_custo,1) || '% e o CTR de link caiu ' || round(v_var_ctr,1) || '% (limiar ' || v_lim_ctr_queda || '%).';
    if coalesce(v_var_freq,0) > 0 or d.frequency > coalesce(v_lim_freq,3.5) then
      v_causa := 'FADIGA DE CRIATIVO: o CTR caiu e a frequencia subiu (' || round(coalesce(v_var_freq,0),1) || '%, nivel ' || round(d.frequency::numeric,2) || '). A mesma audiencia ja viu a peca demais, o leilao encarece e o custo sobe por consequencia.';
      v_acao  := 'Trocar o criativo (refresh), nao mexer no orcamento. Orcamento nao conserta peca cansada.';
    else
      v_causa := 'CRIATIVO FRACO, nao fadiga: o CTR caiu sem a frequencia subir. A peca nao esta conversando com o publico, e nao e saturacao.';
      v_acao  := 'Revisar gancho e proposta da peca. Trocar por variacao com angulo diferente, nao por mais do mesmo.';
    end if;
  elsif v_var_cpm is not null and v_var_cpm >= v_lim_cpm_alta then
    v_sinal := 'Custo ' || v_rotulo || ' subiu ' || round(v_var_custo,1) || '%, CTR estavel (' || round(coalesce(v_var_ctr,0),1) || '%) e CPM subiu ' || round(v_var_cpm,1) || '% (limiar ' || v_lim_cpm_alta || '%).';
    v_causa := 'LEILAO MAIS CARO PARA A MESMA AUDIENCIA: sobreposicao entre conjuntos ou publico estreito demais. O criativo nao piorou - a disputa piorou.';
    v_acao  := 'Investigar sobreposicao de publico entre os conjuntos ativos antes de mexer em orcamento ou criativo.';
  else
    v_sinal := 'Custo ' || v_rotulo || ' subiu ' || round(v_var_custo,1) || '% com CTR e CPM dentro dos limiares.';
    v_causa := 'PROBLEMA DEPOIS DO CLIQUE: a peca continua atraindo e o leilao nao encareceu, mas menos gente completa. Pagina, formulario ou qualidade da intencao.';
    v_acao  := 'Olhar a jornada apos o clique. ATENCAO: o que acontece depois do clique esta FORA do escopo deste sistema desde 06/08 - a acao aqui e apontar, nao investigar.';
  end if;

  v_confirmacao := 'Reler este mesmo diagnostico em 3 dias. A causa se confirma se o indicador apontado mudar de direcao apos a acao; se o custo cair sem a causa apontada ter mudado, a leitura estava errada.';

  v_medidas := jsonb_build_object(
    'custo_por_resultado', jsonb_build_object(
        'base', v_base,
        'rotulo', v_rotulo,
        'resultados_no_ultimo_dia', d.resultados,
        'hoje', round(d.custo::numeric,2),
        'base_comparacao', round(b.custo::numeric,2),
        'variacao_pct', round(v_var_custo,1)),
    'ctr_link_pct', jsonb_build_object('hoje', round(d.ctr::numeric,3), 'base', round(b.ctr::numeric,3), 'variacao_pct', round(v_var_ctr,1)),
    'cpm', jsonb_build_object('hoje', round(d.cpm::numeric,2), 'base', round(b.cpm::numeric,2), 'variacao_pct', round(v_var_cpm,1)),
    'frequencia', jsonb_build_object('hoje', round(d.frequency::numeric,2), 'base', round(b.freq::numeric,2), 'variacao_pct', round(v_var_freq,1)));

  -- A chave do custo carrega o NOME da base (custo_por_conversa, custo_por_formulario,
  -- custo_por_clique_link). Quem le o JSON nao precisa adivinhar o denominador.
  v_medidas := v_medidas || jsonb_build_object(
    public.metrica_do_teto(v_base),
    jsonb_build_object('hoje', round(d.custo::numeric,2), 'base', round(b.custo::numeric,2), 'variacao_pct', round(v_var_custo,1)));

  return jsonb_build_object(
    'anuncio', p_ad_external_id,
    'ultimo_dia', d.snapshot_date,
    'dias_de_base', b.dias,
    'maduro', v_maduro,
    'base_de_resultado', v_base,
    'rotulo_da_base', v_rotulo,
    'unidade_do_resultado', public.unidade_da_base(v_base),
    'medidas', v_medidas,
    'SINAL', v_sinal,
    'CAUSA', v_causa,
    'ACAO', v_acao,
    'CONFIRMACAO', v_confirmacao,
    'guarda_de_maturacao', case when not v_maduro
      then 'ATENCAO: este anuncio tem apenas ' || v_idade || ' dia(s) com entrega. NAO prescrever pausa por custo antes de 3 dias - objeto em aprendizado tem custo instavel por construcao.'
      else null end,
    'nota', 'Custo por resultado e CONSEQUENTE, nao controlavel direto. A acao age sobre a CAUSA apontada, nunca sobre o custo. A chave do custo dentro de medidas carrega a base do denominador: nao compare este numero com o de um objeto de outra base.');
end;
$function$
;

-- ============================================================================
-- 3) decidir_sobre_conjunto
--    ANTES: contava resultado com form_leads e julgava contra custo_por_lead_lp.
--    O conjunto WA_JUR_C1 aparecia com `resultados_7d: 0` tendo 39 conversas,
--    e o texto prescrevia "pausar_e_criar_reversao" por zero resultado.
--    AGORA: quando a base nao tem regua vigente, a decisao e PEDIR a regua -
--    julgar contra o teto de outra base era a comparacao que gerava o defeito.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.decidir_sobre_conjunto(p_company_id uuid, p_adset_external_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_teto numeric; v_mat_dias int;
  v_gasto7 numeric; v_res7 numeric; v_dias int; v_custo7 numeric;
  v_d0 numeric; v_d1 numeric; v_d2 numeric; v_revertendo boolean;
  v_volume boolean; v_entregando int; v_restariam int;
  v_decisao text; v_porque text; v_acao text; v_guarda text;
  v_base text; v_rotulo text; v_metrica text; v_unidade text; v_numeros jsonb;
begin
  if p_company_id is null or p_adset_external_id is null then
    raise exception 'decidir_sobre_conjunto exige empresa e conjunto';
  end if;

  v_base    := public.base_de_resultado_do_conjunto(p_adset_external_id);
  v_rotulo  := public.rotulo_da_base(v_base);
  v_metrica := public.metrica_do_teto(v_base);
  v_unidade := public.unidade_da_base(v_base);

  v_teto := (public.teto_vigente(p_company_id, v_metrica)->>'teto_que_governa')::numeric;

  select valor into v_mat_dias from public.limiares_de_midia
   where company_id=p_company_id and metrica='maturacao' and vigente limit 1;
  v_mat_dias := coalesce(v_mat_dias, 3);

  select coalesce(sum(s.spend),0),
         coalesce(sum(public.resultados_da_base(v_base, s.form_leads, s.messaging_started, s.link_clicks)),0),
         count(distinct s.snapshot_date)
    into v_gasto7, v_res7, v_dias
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
   where s.company_id=p_company_id and a.adset_external_id=p_adset_external_id
     and s.snapshot_date >= current_date - 7 and s.spend > 0;

  if v_dias = 0 then
    return jsonb_build_object('decisao','sem_entrega',
      'base_de_resultado', v_base,
      'porque','Este conjunto nao teve nenhum dia com gasto nos ultimos 7 dias. Nao ha custo a julgar.',
      'acao','Nenhuma por custo. Se ele esta ativo e nao entrega, o problema nao e custo.');
  end if;

  v_custo7 := case when v_res7 > 0 then v_gasto7 / v_res7 end;
  v_volume := (v_res7 >= 50 or v_gasto7 >= 300);

  select max(cpl) filter (where rn=1), max(cpl) filter (where rn=2), max(cpl) filter (where rn=3)
    into v_d0, v_d1, v_d2
    from (
      select s.snapshot_date,
             sum(s.spend)/nullif(sum(public.resultados_da_base(v_base, s.form_leads, s.messaging_started, s.link_clicks)),0) cpl,
             row_number() over (order by s.snapshot_date desc) rn
        from public.ad_metric_snapshots s
        join public.ads a on a.external_id = s.ad_external_id
        where s.company_id=p_company_id and a.adset_external_id=p_adset_external_id and s.spend>0
        group by s.snapshot_date) z
   where rn <= 3;

  v_revertendo := (v_d0 is not null and v_d1 is not null and v_d2 is not null
                   and v_d2 > v_d1 and v_d1 > v_d0);

  select count(distinct a.adset_external_id) into v_entregando
    from public.ad_metric_snapshots s join public.ads a on a.external_id = s.ad_external_id
   where s.company_id=p_company_id and s.snapshot_date >= current_date - 3 and s.spend > 0
     and a.adset_external_id is not null;
  v_restariam := greatest(v_entregando - 1, 0);

  if v_dias < v_mat_dias then
    v_decisao := 'manter_em_maturacao';
    v_porque  := 'Tem ' || v_dias || ' dia(s) de entrega e a maturacao minima e ' || v_mat_dias || '. Custo de objeto em aprendizado e instavel por construcao.';
    v_acao    := 'Monitorar. NAO pausar por custo antes de completar a maturacao.';
  elsif v_custo7 is null then
    if v_gasto7 >= 300 then
      v_decisao := 'pausar_e_criar_reversao';
      v_porque  := 'R$ ' || round(v_gasto7::numeric,2) || ' gastos em ' || v_dias || ' dias e ZERO resultado na base ' || v_base || ' (' || v_unidade || '). Nao ha custo ' || v_rotulo || ' porque nao ha resultado.';
      v_acao    := 'Criar objeto de reversao NOVO e pausado, validar, ativar, e SO ENTAO pausar este.';
    else
      v_decisao := 'manter_sem_dado_suficiente';
      v_porque  := 'Zero resultado na base ' || v_base || ', mas apenas R$ ' || round(v_gasto7::numeric,2) || ' gastos - abaixo do piso de amostra confiavel.';
      v_acao    := 'Aguardar. Julgar com este gasto seria julgar ruido.';
    end if;
  elsif v_teto is null then
    v_decisao := 'sem_regua_para_esta_base';
    v_porque  := 'Custo de R$ ' || round(v_custo7::numeric,2) || ' ' || v_rotulo || ' (' || v_res7 || ' ' || v_unidade || ' em ' || v_dias || ' dias, R$ ' || round(v_gasto7::numeric,2) || ' gastos). NAO existe regua vigente de ' || v_metrica || ' nesta empresa.';
    v_acao    := 'Pedir ao gestor a regua de ' || v_metrica || '. Julgar este numero contra o teto de outra base seria comparar coisas diferentes - foi essa comparacao que a correcao de 03/09/2026 eliminou.';
  elsif v_custo7 <= v_teto then
    v_decisao := case when v_volume then 'dentro_do_teto_com_volume' else 'dentro_do_teto_sem_volume' end;
    v_porque  := 'Custo de R$ ' || round(v_custo7::numeric,2) || ' ' || v_rotulo || ' contra a regua de R$ ' || v_teto || ' (' || v_metrica || ').'
              || case when v_volume then ' Amostra confiavel (' || v_res7 || ' ' || v_unidade || ', R$ ' || round(v_gasto7::numeric,2) || ').'
                      else ' Amostra ainda nao confiavel.' end;
    v_acao    := 'MANTER. NAO consigo dizer se e candidato a escala: a arvore do contrato exige uma regua de IDEAL separada do teto, e esta empresa so tem o teto de R$ ' || v_teto || ' decidido pelo gestor. Pedir a regua de ideal ao gestor antes de tratar isto como gatilho de escala.';
  else
    if v_revertendo then
      v_decisao := 'manter_esta_revertendo';
      v_porque  := 'Custo de R$ ' || round(v_custo7::numeric,2) || ' ' || v_rotulo || ' acima da regua de R$ ' || v_teto
                || ', MAS caindo nos tres ultimos dias (' || round(v_d2::numeric,2) || ' -> ' || round(v_d1::numeric,2) || ' -> ' || round(v_d0::numeric,2) || ').';
      v_acao    := 'MANTER e nao tocar. Pausar agora mataria uma recuperacao em curso - foi assim que um conjunto desta conta saiu de R$ 2,17 para R$ 1,36 em julho.';
    elsif v_volume then
      v_decisao := 'manter_e_trocar_criativo';
      v_porque  := 'Custo de R$ ' || round(v_custo7::numeric,2) || ' ' || v_rotulo || ' acima da regua de R$ ' || v_teto
                || ', sem tendencia de queda, e COM volume (' || v_res7 || ' ' || v_unidade || '). O conjunto entrega; o que cansou foi a peca.';
      v_acao    := 'Refresh de criativo. NAO pausar o conjunto: ele e o canal, a peca e o problema.';
    else
      v_decisao := 'pausar_e_criar_reversao';
      v_porque  := 'Custo de R$ ' || round(v_custo7::numeric,2) || ' ' || v_rotulo || ' acima da regua de R$ ' || v_teto
                || ', sem tendencia de queda e SEM volume (' || v_res7 || ' ' || v_unidade || ', R$ ' || round(v_gasto7::numeric,2) || ').';
      v_acao    := 'Criar objeto de reversao NOVO e pausado, validar, ativar, e SO ENTAO pausar este.';
    end if;
  end if;

  if v_decisao like 'pausar%' and v_restariam = 0 then
    v_guarda := 'GUARDA ACIONADA: este e o UNICO conjunto entregando nesta empresa. Pausar zeraria a entrega. '
             || 'A decisao de pausar foi SOBRESCRITA. Primeiro criar a alternativa nova, ativar e confirmar entrega; '
             || 'so depois pausar este. Sequencia invertida deixa a conta sem entrega no intervalo.';
    v_decisao := 'nao_pausar_sem_alternativa_ativa';
    v_acao    := 'Criar conjunto novo PAUSADO, validar, ATIVAR, confirmar que entrega, e somente ai pausar este.';
  end if;

  v_numeros := jsonb_build_object(
    'dias_com_entrega_7d', v_dias,
    'gasto_7d', round(v_gasto7::numeric,2),
    'resultados_7d', v_res7,
    'base_de_resultado', v_base,
    'unidade_do_resultado', v_unidade,
    'custo_por_resultado_7d', round(v_custo7::numeric,2),
    'metrica_da_regua', v_metrica,
    'regua_que_governa', v_teto,
    'amostra_confiavel', v_volume,
    'custo_ultimos_3_dias', jsonb_build_array(round(v_d2::numeric,2), round(v_d1::numeric,2), round(v_d0::numeric,2)),
    'revertendo', v_revertendo);

  -- A chave nomeada (custo_por_conversa_7d, custo_por_formulario_7d, ...) existe
  -- para que o texto do agente nunca diga "CPL" sem dizer de que.
  v_numeros := v_numeros || jsonb_build_object(v_metrica || '_7d', round(v_custo7::numeric,2));

  return jsonb_build_object(
    'conjunto', p_adset_external_id,
    'decisao', v_decisao,
    'porque', v_porque,
    'acao', v_acao,
    'base_de_resultado', v_base,
    'rotulo_da_base', v_rotulo,
    'numeros', v_numeros,
    'guarda', jsonb_build_object(
      'conjuntos_entregando_na_empresa', v_entregando,
      'restariam_se_este_pausar', v_restariam,
      'acionada', (v_guarda is not null),
      'mensagem', v_guarda),
    'LACUNA_DECLARADA', 'A arvore do contrato separa candidato a escala (custo <= IDEAL) de manter (custo <= TETO). Esta empresa tem apenas o TETO decidido pelo gestor; a aspiracao ele classificou como NAO-gate. Portanto os dois estados aparecem como um so e nenhuma escala e prescrita por esta funcao. Pedir a regua de IDEAL ao gestor.',
    'nota', 'A guarda conta ENTREGA, nao status. Medido em 06/08: 20 conjuntos com status ACTIVE e 3 entregando - contar status daria falsa seguranca de 20 alternativas onde existem 3.');
end;
$function$
;

-- ============================================================================
-- 4) pode_pausar_por_custo
--    ANTES: a excecao dura ("zero resultado + CTR abaixo do minimo") lia zero
--    resultado como form_leads = 0. Anuncio de WhatsApp com conversa entrando
--    atendia a excecao e era liberado para pausa por nao ter formulario.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pode_pausar_por_custo(p_company_id uuid, p_ad_external_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_dias int; v_gasto numeric; v_resultados numeric;
  v_ctr numeric; v_ctr_min numeric; v_piso numeric;
  v_maturacao_dias int := 3;
  v_excecao boolean;
  v_base text; v_rotulo text; v_unidade text;
begin
  if p_company_id is null or p_ad_external_id is null then
    raise exception 'pode_pausar_por_custo exige empresa e anuncio';
  end if;

  v_base    := public.base_de_resultado_do_anuncio(p_ad_external_id);
  v_rotulo  := public.rotulo_da_base(v_base);
  v_unidade := public.unidade_da_base(v_base);

  select valor, coalesce(piso_de_gasto, 0) into v_ctr_min, v_piso
    from public.limiares_de_midia
   where company_id = p_company_id and metrica = 'ctr_link'
     and tipo = 'absoluto' and operador = '<' and vigente limit 1;

  if v_ctr_min is null then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_limiar_cadastrado',
      'base_de_resultado', v_base,
      'mensagem_para_o_gestor','Nao existe limiar de CTR minimo cadastrado para esta empresa. Sem limiar eu nao consigo avaliar a excecao dura, e por isso NAO libero pausa por custo - ausencia de regra nao e permissao.');
  end if;

  select count(*) filter (where spend > 0),
         coalesce(sum(spend),0),
         coalesce(sum(public.resultados_da_base(v_base, form_leads, messaging_started, link_clicks)),0),
         (100.0 * coalesce(sum(link_clicks),0) / nullif(sum(impressions),0))
    into v_dias, v_gasto, v_resultados, v_ctr
    from public.ad_metric_snapshots
   where company_id = p_company_id and ad_external_id = p_ad_external_id;

  if coalesce(v_dias,0) = 0 then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_entrega',
      'base_de_resultado', v_base,
      'mensagem_para_o_gestor','Este anuncio nunca entregou. Nao existe custo a julgar, e pausar o que nao entrega nao muda nada - se ele esta ativo e nao entrega, o problema e outro.');
  end if;

  v_excecao := (v_resultados = 0 and v_ctr is not null and v_ctr < v_ctr_min and v_gasto >= v_piso);

  return jsonb_build_object(
    'anuncio', p_ad_external_id,
    'dias_com_entrega', v_dias,
    'maturacao_exigida_dias', v_maturacao_dias,
    'maduro', (v_dias >= v_maturacao_dias),
    'base_de_resultado', v_base,
    'rotulo_da_base', v_rotulo,
    'medidas', jsonb_build_object('gasto_acumulado', round(v_gasto::numeric,2),
                                  'resultados', v_resultados,
                                  'base_dos_resultados', v_base,
                                  'unidade_do_resultado', v_unidade,
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
          'Este anuncio tem so ' || v_dias || ' dia(s) de entrega, mas a excecao dura se aplica: ZERO resultado na base ' || v_base || ' (' || v_unidade || '), CTR de '
          || round(v_ctr::numeric,2) || '% abaixo do minimo de ' || v_ctr_min || '%, e R$ ' || round(v_gasto::numeric,2)
          || ' ja gastos. Aqui nao ha aprendizado a proteger - a peca nao conversa com ninguem. Pausar e o certo.'
        when v_dias >= v_maturacao_dias then
          'Anuncio maduro (' || v_dias || ' dias de entrega). Pausa por custo e avaliavel - mas ela ainda precisa passar pela guarda de alternativa ativa, que este sistema ainda NAO tem.'
        else
          'NAO pausar por custo: este anuncio tem apenas ' || v_dias || ' dia(s) de entrega e a maturacao minima e '
          || v_maturacao_dias || '. Custo de objeto em aprendizado e instavel por construcao, e pausar agora joga fora o que ja foi gasto na calibracao. '
          || 'A excecao dura nao se aplica porque ' || case
               when v_resultados > 0 then 'ele JA trouxe ' || v_resultados || ' ' || v_unidade
               when v_ctr >= v_ctr_min then 'o CTR de ' || round(v_ctr::numeric,2) || '% esta acima do minimo'
               else 'o gasto de R$ ' || round(v_gasto::numeric,2) || ' ainda nao alcancou o piso de R$ ' || v_piso end
          || '. Monitorar e reavaliar quando completar ' || v_maturacao_dias || ' dias.' end,
    'NAO_VERIFICADO_AQUI', 'A guarda do UNICO conjunto de lead sem alternativa ativa NAO e checada nesta funcao - ela e do ESP-17 e continua pendente. Hoje o motor de alertas recomenda pausar tres criativos que sao tudo o que entrega na conta. Liberado aqui nao significa seguro pausar.');
end;
$function$
;

-- ============================================================================
-- 5) avaliar_pacing — aqui o defeito era o NUMERADOR
--    ANTES: somava o gasto de TODAS as campanhas e dividia pelos formularios.
--    Na Legal e Viver isso dava R$ 7,63 por formulario (verdadeiro: R$ 1,40) e
--    projetava capacidade de 16 leads/dia onde cabem ~86. Erro de 5,4x no
--    numero que dimensiona verba.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.avaliar_pacing(p_company_id uuid, p_meta_leads_dia numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_orc_dia numeric; v_orc_form numeric; v_orc_conv numeric; v_orc_clq numeric; v_conjuntos int;
  v_gasto_form numeric; v_gasto_conv numeric; v_gasto_clq numeric;
  v_forms7 numeric; v_conv7 numeric; v_clq7 numeric;
  v_custo_form numeric; v_custo_conv numeric; v_custo_clq numeric;
  v_base_principal text; v_custo numeric; v_orc_base numeric; v_rotulo text;
  v_leads_dia numeric; v_verba_necessaria numeric; v_multiplo numeric;
begin
  if p_company_id is null then
    raise exception 'avaliar_pacing exige empresa';
  end if;

  select coalesce(sum(ast.daily_budget/100.0),0),
         coalesce(sum(ast.daily_budget/100.0) filter (where bs.base = 'formularios'),0),
         coalesce(sum(ast.daily_budget/100.0) filter (where bs.base = 'conversas'),0),
         coalesce(sum(ast.daily_budget/100.0) filter (where bs.base = 'cliques_no_link'),0),
         count(*)
    into v_orc_dia, v_orc_form, v_orc_conv, v_orc_clq, v_conjuntos
    from public.ad_sets ast
    left join public.campaigns c on c.id = ast.campaign_id
    cross join lateral (select public.base_de_resultado(c.category, ast.optimization_goal, c.objective) as base) bs
   where ast.company_id = p_company_id and upper(coalesce(ast.status,'')) = 'ACTIVE'
     and ast.daily_budget > 0
     and exists (select 1 from public.ad_metric_snapshots s join public.ads a on a.external_id=s.ad_external_id
                  where a.adset_external_id = ast.external_id and s.snapshot_date >= current_date - 3 and s.spend > 0);

  select coalesce(sum(s.spend) filter (where bs.base = 'formularios'),0),
         coalesce(sum(s.spend) filter (where bs.base = 'conversas'),0),
         coalesce(sum(s.spend) filter (where bs.base = 'cliques_no_link'),0),
         coalesce(sum(s.form_leads) filter (where bs.base = 'formularios'),0),
         coalesce(sum(s.messaging_started) filter (where bs.base = 'conversas'),0),
         coalesce(sum(s.link_clicks) filter (where bs.base = 'cliques_no_link'),0)
    into v_gasto_form, v_gasto_conv, v_gasto_clq, v_forms7, v_conv7, v_clq7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    left join public.ad_sets ast on ast.external_id = a.adset_external_id
    left join public.campaigns c on c.id = coalesce(a.campaign_id, ast.campaign_id)
    cross join lateral (select public.base_de_resultado(c.category, ast.optimization_goal, c.objective) as base) bs
   where s.company_id = p_company_id and s.snapshot_date >= current_date - 7;

  v_custo_form := case when v_forms7 > 0 then v_gasto_form / v_forms7 end;
  v_custo_conv := case when v_conv7  > 0 then v_gasto_conv / v_conv7  end;
  v_custo_clq  := case when v_clq7   > 0 then v_gasto_clq  / v_clq7   end;

  if v_gasto_conv > v_gasto_form then
    v_base_principal := 'conversas'; v_custo := v_custo_conv; v_orc_base := v_orc_conv;
  else
    v_base_principal := 'formularios'; v_custo := v_custo_form; v_orc_base := v_orc_form;
  end if;
  v_rotulo := public.rotulo_da_base(v_base_principal);

  v_leads_dia := case when v_custo > 0 then v_orc_base / v_custo end;

  if p_meta_leads_dia is not null and v_custo is not null then
    v_verba_necessaria := round(p_meta_leads_dia * v_custo, 2);
    v_multiplo := round(v_verba_necessaria / nullif(v_orc_base,0), 2);
  end if;

  return jsonb_build_object(
    'capacidade_atual', jsonb_build_object(
      'conjuntos_entregando', v_conjuntos,
      'orcamento_somado_dia', round(v_orc_dia::numeric,2),
      'base_da_projecao', v_base_principal,
      'rotulo_da_base', v_rotulo,
      'orcamento_dia_da_base', round(v_orc_base::numeric,2),
      'custo_por_resultado_7d', round(v_custo::numeric,2),
      'custo_por_formulario_7d', round(v_custo_form::numeric,2),
      'custo_por_conversa_7d', round(v_custo_conv::numeric,2),
      'custo_por_clique_link_7d', round(v_custo_clq::numeric,2),
      'resultados_por_dia_que_a_estrutura_comporta', round(v_leads_dia::numeric,0),
      'leads_por_dia_que_a_estrutura_comporta', round(v_leads_dia::numeric,0)),
    'gasto_por_base_7d', jsonb_build_object(
      'formularios',     jsonb_build_object('gasto', round(v_gasto_form::numeric,2), 'resultados', v_forms7, 'orcamento_dia', round(v_orc_form::numeric,2)),
      'conversas',       jsonb_build_object('gasto', round(v_gasto_conv::numeric,2), 'resultados', v_conv7,  'orcamento_dia', round(v_orc_conv::numeric,2)),
      'cliques_no_link', jsonb_build_object('gasto', round(v_gasto_clq::numeric,2),  'resultados', v_clq7,   'orcamento_dia', round(v_orc_clq::numeric,2))),
    'verba_que_nao_produz_lead_7d', round(v_gasto_clq::numeric,2),
    'POR_QUE_O_GASTO_E_SEPARADO_POR_BASE',
      'O gasto que entra no custo por formulario e SO o das campanhas medidas por formulario. Campanha de trafego, engajamento e alcance vai para a base cliques_no_link e NAO entra em nenhum custo por lead: somar esse gasto no numerador inflava o indicador e encolhia a capacidade projetada. Foi o defeito corrigido em 03/09/2026 e e o mesmo descrito nas linhas 155-160 de metrica_canonica.ts.',
    'meta_informada', p_meta_leads_dia,
    'nao_existe_meta_registrada','Este sistema NAO tem meta de leads por dia decidida por ninguem. A meta entra como parametro porque inventar uma para poder responder seria o mesmo erro de inventar a regua de ideal.',
    'projecao', case when p_meta_leads_dia is null then null else jsonb_build_object(
      'base', v_base_principal,
      'verba_diaria_necessaria_PISO', v_verba_necessaria,
      'multiplo_da_verba_atual', v_multiplo,
      'gap', case when v_multiplo > 1
              then 'Faltam ' || round((v_verba_necessaria - v_orc_base)::numeric,2) || ' por dia, ou seja ' || v_multiplo || ' vezes a verba atual da base ' || v_base_principal || '.'
              else 'A estrutura atual ja comporta a meta.' end) end,
    'POR_QUE_E_PISO_E_NAO_ESTIMATIVA', case when p_meta_leads_dia is null then null else
      'A verba de R$ ' || v_verba_necessaria || ' usa o custo ' || v_rotulo || ' ATUAL de R$ ' || round(v_custo::numeric,2)
      || '. Escalar EMPURRA esse custo para cima: a Meta passa a comprar resultado marginal mais caro. Portanto a verba real para atingir '
      || p_meta_leads_dia || ' resultados por dia e MAIOR que essa - quanto maior, so a escada de escala rodando por passos descobre. '
      || 'Tratar essa projecao como estimativa seria prometer meta com aritmetica correta e premissa falsa.' end,
    'nota','Capacidade conta apenas conjunto ACTIVE com orcamento proprio E com entrega nos ultimos 3 dias. Conjunto ativo que nao entrega nao comporta lead nenhum.');
end;
$function$
;

-- ============================================================================
-- 6) casar_criativo_performance
--    ANTES: custo_por_lead = gasto/form_leads para toda peca. Peca de WhatsApp
--    aparecia como "sem custo", e a comparacao entre pecas de bases diferentes
--    era feita sem ninguem declarar que os denominadores eram outros.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.casar_criativo_performance(p_company_id uuid, p_drive_file_id text DEFAULT NULL::text, p_ad_external_id text DEFAULT NULL::text, p_dias integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias integer := greatest(coalesce(p_dias, 7), 1);
  v_desde date := (current_date - v_dias);
  v_pares jsonb;
  v_n int;
begin
  if p_company_id is null then
    return jsonb_build_object('erro', 'company_id_obrigatorio',
      'motivo', 'casar_criativo_performance exige a empresa da conversa.');
  end if;

  with vinculos as (
    select ar.payload->>'drive_file_id' as drive_file_id,
           ar.execution_result->>'id_criado' as ad_external_id,
           ar.executed_at, ar.id as approval_id
    from public.approval_requests ar
    where ar.company_id = p_company_id
      and ar.action = 'criar_anuncio_a_partir_de'
      and ar.executed_at is not null
      and (ar.execution_result->>'ok') = 'true'
      and nullif(ar.payload->>'drive_file_id','') is not null
      and nullif(ar.execution_result->>'id_criado','') is not null
      and (p_drive_file_id is null or ar.payload->>'drive_file_id' = p_drive_file_id)
      and (p_ad_external_id is null or ar.execution_result->>'id_criado' = p_ad_external_id)
  ),
  uniq as (
    select distinct on (drive_file_id, ad_external_id)
      drive_file_id, ad_external_id, executed_at, approval_id
    from vinculos
    order by drive_file_id, ad_external_id, executed_at desc
  ),
  met as (
    select u.drive_file_id, u.ad_external_id, u.executed_at, u.approval_id,
           a.name as ad_name, a.status as ad_status,
           d.nome as peca_nome, d.produto_detectado, d.aproveitavel,
           public.base_de_resultado_do_anuncio(u.ad_external_id) as base,
           coalesce(sum(s.spend), 0) as gasto,
           coalesce(sum(s.impressions), 0) as impressoes,
           coalesce(sum(s.link_clicks), 0) as cliques_link,
           coalesce(sum(s.form_leads), 0) as formularios,
           coalesce(sum(s.messaging_started), 0) as conversas,
           count(s.snapshot_date) filter (where s.spend > 0) as dias_com_gasto
    from uniq u
    left join public.ads a on a.company_id = p_company_id and a.external_id = u.ad_external_id
    left join lateral (
      select da.nome, da.produto_detectado, da.aproveitavel
      from public.drive_midia_analises da
      where da.company_id = p_company_id and da.drive_file_id = u.drive_file_id
      order by da.analisado_em desc nulls last
      limit 1) d on true
    left join public.ad_metric_snapshots s
      on s.company_id = p_company_id and s.ad_external_id = u.ad_external_id and s.snapshot_date >= v_desde
    group by u.drive_file_id, u.ad_external_id, u.executed_at, u.approval_id,
             a.name, a.status, d.nome, d.produto_detectado, d.aproveitavel
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'drive_file_id', m.drive_file_id,
    'peca_nome', m.peca_nome,
    'produto', m.produto_detectado,
    'aproveitavel', m.aproveitavel,
    'ad_external_id', m.ad_external_id,
    'ad_name', m.ad_name,
    'ad_status', m.ad_status,
    'criado_em', m.executed_at,
    'approval_id', m.approval_id,
    'janela_dias', v_dias,
    'gasto', round(m.gasto::numeric, 2),
    'impressoes', m.impressoes,
    'cliques_link', m.cliques_link,
    'formularios', m.formularios,
    'conversas', m.conversas,
    'dias_com_gasto', m.dias_com_gasto,
    'base_de_resultado', m.base,
    'rotulo_da_base', public.rotulo_da_base(m.base),
    'unidade_do_resultado', public.unidade_da_base(m.base),
    'resultados', public.resultados_da_base(m.base, m.formularios, m.conversas, m.cliques_link),
    'metrica_do_custo', public.metrica_do_teto(m.base),
    'custo_por_resultado', round(public.custo_por_resultado(m.gasto, m.formularios, m.conversas, m.base, m.cliques_link), 2),
    'amostra_pequena', public.resultados_da_base(m.base, m.formularios, m.conversas, m.cliques_link) < 20,
    'sem_entrega_na_janela', m.gasto = 0
  ) order by m.gasto desc nulls last), '[]'::jsonb)
  into v_pares from met m;

  v_n := jsonb_array_length(v_pares);

  return jsonb_build_object(
    'pares', v_pares,
    'total', v_n,
    'janela_dias', v_dias,
    'filtro', jsonb_build_object('drive_file_id', p_drive_file_id, 'ad_external_id', p_ad_external_id),
    'amostra_limiar', 20,
    'nota',
      'Casamento so cobre anuncios criados PELO SISTEMA com payload.drive_file_id e execution_result.id_criado. Anuncios feitos no Gerenciador nao entram. custo_por_resultado usa o denominador declarado em base_de_resultado: pecas de bases diferentes NAO sao comparaveis entre si. amostra_pequena=true quando os resultados da propria base somam menos de 20 na janela.',
    'LACUNAS', jsonb_build_array(
      'Anuncios sem card criar_anuncio_a_partir_de (ou sem drive_file_id no payload) ficam orfaos deste casamento.',
      'Performance usa ad_metric_snapshots da janela; se o coletor atrasar, gasto pode aparecer zero sem a peca ser ruim.',
      'Nao deriva fadiga aqui - para fadiga chame avaliar_fadiga(ad_external_id) depois de obter o id neste retorno.'));
end;
$function$
;

-- ============================================================================
-- 7) get_weekly_report_data — o relatorio da tela e do WhatsApp
--    ANTES: custo_por_formulario = gasto TOTAL / formularios, e a tela ainda
--    dividia gasto por formularios de novo, por campanha. Campanha de conversa
--    saia com "—" em custo tendo 39 conversas no periodo.
--    AGORA cada linha carrega base, unidade, rotulo e custo ja calculado; a tela
--    nao divide nada (src/components/weekly-report.tsx).
-- ============================================================================

create or replace function public.get_weekly_report_data(p_company_id uuid, p_start date, p_end date)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with linha as (
    select m.spend, m.form_leads, m.messaging_started, m.link_clicks, m.landing_page_views,
           m.clicks, m.impressions, m.snapshot_date,
           public.base_de_resultado_da_campanha(m.campaign_id) as base
      from metric_snapshots m
     where m.company_id = p_company_id and m.snapshot_date between p_start and p_end
  ),
  base as (
    select coalesce(sum(spend),0) as gasto,
           coalesce(sum(form_leads),0) as formularios,
           coalesce(sum(messaging_started),0) as conversas,
           coalesce(sum(link_clicks),0) as cliques_link,
           coalesce(sum(landing_page_views),0) as page_views,
           coalesce(sum(clicks),0) as cliques_totais,
           coalesce(sum(impressions),0) as impressoes,
           count(distinct snapshot_date) as dias_com_dado,
           coalesce(sum(spend) filter (where base='formularios'),0) as gasto_form,
           coalesce(sum(form_leads) filter (where base='formularios'),0) as forms_da_base,
           coalesce(sum(spend) filter (where base='conversas'),0) as gasto_conv,
           coalesce(sum(messaging_started) filter (where base='conversas'),0) as conv_da_base,
           coalesce(sum(spend) filter (where base='cliques_no_link'),0) as gasto_sem_base_de_lead,
           coalesce(sum(link_clicks) filter (where base='cliques_no_link'),0) as cliques_da_base
      from linha
  ),
  por_campanha as (
    select c.name,
           public.base_de_resultado_da_campanha(c.id) as base,
           public.rotulo_da_base(public.base_de_resultado_da_campanha(c.id)) as rotulo_da_base,
           public.metrica_do_teto(public.base_de_resultado_da_campanha(c.id)) as metrica_do_custo,
           round(sum(m.spend)::numeric,2) as gasto,
           coalesce(sum(m.form_leads),0) as formularios,
           coalesce(sum(m.messaging_started),0) as conversas,
           coalesce(sum(m.link_clicks),0) as cliques_link,
           public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                     sum(m.form_leads), sum(m.messaging_started), sum(m.link_clicks)) as resultados,
           public.unidade_da_base(public.base_de_resultado_da_campanha(c.id),
                                  public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                     sum(m.form_leads), sum(m.messaging_started), sum(m.link_clicks))) as unidade,
           round(public.custo_por_resultado(sum(m.spend), sum(m.form_leads), sum(m.messaging_started),
                                            public.base_de_resultado_da_campanha(c.id), sum(m.link_clicks))::numeric,2) as custo_por_resultado
      from metric_snapshots m join campaigns c on c.id = m.campaign_id
     where m.company_id = p_company_id and m.snapshot_date between p_start and p_end
     group by c.id, c.name having sum(m.spend) > 0 order by 5 desc
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_start, 'fim', p_end,
       'dias_com_dado', (select dias_com_dado from base),
       'dias_no_periodo', (p_end - p_start + 1)),
    'investimento', round((select gasto from base)::numeric, 2),
    'formularios', (select formularios from base),
    'conversas', (select conversas from base),
    'custo_por_formulario', round(((select gasto_form from base) / nullif((select forms_da_base from base),0))::numeric, 2),
    'custo_por_conversa', round(((select gasto_conv from base) / nullif((select conv_da_base from base),0))::numeric, 2),
    'investimento_por_base', jsonb_build_object(
      'formularios',     jsonb_build_object('gasto', round((select gasto_form from base)::numeric,2), 'resultados', (select forms_da_base from base)),
      'conversas',       jsonb_build_object('gasto', round((select gasto_conv from base)::numeric,2), 'resultados', (select conv_da_base from base)),
      'cliques_no_link', jsonb_build_object('gasto', round((select gasto_sem_base_de_lead from base)::numeric,2), 'resultados', (select cliques_da_base from base))),
    'cliques_link', (select cliques_link from base),
    'custo_por_clique', round(((select gasto from base) / nullif((select cliques_link from base),0))::numeric, 2),
    'visualizacoes_pagina', (select page_views from base),
    'ctr_pct', round(((select cliques_totais from base)::numeric / nullif((select impressoes from base),0)) * 100, 2),
    'conversao_view_form_pct', round(((select formularios from base)::numeric / nullif((select page_views from base),0)) * 100, 2),
    'por_campanha', (select coalesce(jsonb_agg(jsonb_build_object(
        'campanha', name, 'gasto', gasto,
        'formularios', formularios, 'conversas', conversas, 'cliques_link', cliques_link,
        'base_de_resultado', base, 'rotulo_da_base', rotulo_da_base,
        'unidade', unidade, 'metrica_do_custo', metrica_do_custo,
        'resultados', resultados, 'custo_por_resultado', custo_por_resultado)), '[]'::jsonb) from por_campanha),
    'COMO_LER_O_CUSTO', 'custo_por_formulario divide APENAS o gasto das campanhas medidas por formulario. Campanha de trafego, engajamento e alcance vai para a base cliques_no_link e nao entra em custo por lead nenhum. Para custo por campanha use custo_por_resultado da propria linha, que ja vem com a base declarada - nao divida gasto por formularios no cliente.',
    'nao_disponivel', jsonb_build_array(
      'perfil_por_idade_e_genero: breakdown demografico nao e coletado pelo sistema (exige coleta adicional na fonte); nao estimar'));
$function$
;

-- ============================================================================
-- 8) get_report_export_data — a planilha que vai ao cliente
--    A serie diaria passa a repartir o gasto do dia por base (gasto_form,
--    gasto_conv, gasto_clk) para que o Resumo da planilha divida o investido
--    EM FORMULARIO pelos formularios, e nao o investimento inteiro.
--    O consumidor e src/lib/relatorio-xlsx.ts, colunas K, L e M.
-- ============================================================================

create or replace function public.get_report_export_data(p_company_id uuid, p_start date, p_end date)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with dia as (
    select snapshot_date d, round(sum(spend)::numeric,2) gasto, sum(impressions) imp, sum(clicks) clk,
           sum(link_clicks) lclk, sum(landing_page_views) views, sum(form_leads) forms, sum(messaging_started) conv,
           round(coalesce(sum(spend) filter (where public.base_de_resultado_da_campanha(campaign_id) = 'formularios'),0)::numeric,2) gasto_form,
           round(coalesce(sum(spend) filter (where public.base_de_resultado_da_campanha(campaign_id) = 'conversas'),0)::numeric,2) gasto_conv,
           round(coalesce(sum(spend) filter (where public.base_de_resultado_da_campanha(campaign_id) = 'cliques_no_link'),0)::numeric,2) gasto_clk
    from metric_snapshots
    where company_id = p_company_id and snapshot_date between p_start and p_end
    group by snapshot_date
  ),
  camp as (
    select c.name nome, public.base_de_resultado_da_campanha(c.id) base,
           public.rotulo_da_base(public.base_de_resultado_da_campanha(c.id)) rotulo_da_base,
           round(sum(m.spend)::numeric,2) gasto, sum(m.impressions) imp,
           sum(m.link_clicks) lclk, sum(m.landing_page_views) views, sum(m.form_leads) forms,
           sum(m.messaging_started) conv,
           public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                     sum(m.form_leads), sum(m.messaging_started), sum(m.link_clicks)) resultados,
           round(public.custo_por_resultado(sum(m.spend), sum(m.form_leads), sum(m.messaging_started),
                                            public.base_de_resultado_da_campanha(c.id), sum(m.link_clicks))::numeric,2) custo_por_resultado
    from metric_snapshots m join campaigns c on c.id = m.campaign_id
    where m.company_id = p_company_id and m.snapshot_date between p_start and p_end
    group by c.id, c.name having sum(m.spend) > 0
  ),
  tops as (
    select coalesce(a.name, ams.ad_external_id) nome, round(sum(ams.spend)::numeric,2) gasto,
           sum(ams.form_leads) forms, sum(ams.messaging_started) conv, sum(ams.link_clicks) lclk
    from ad_metric_snapshots ams left join ads a on a.external_id = ams.ad_external_id
    where ams.company_id = p_company_id and ams.snapshot_date between p_start and p_end
    group by 1 order by 2 desc limit 15
  ),
  demo as (
    select b.tipo_recorte, b.valor_recorte, round(sum(b.spend)::numeric,2) gasto,
           sum(b.form_leads) forms, sum(b.messaging_started) conversas,
           round((sum(b.spend) filter (where bs.base = 'formularios')
                  / nullif(sum(b.form_leads) filter (where bs.base = 'formularios'),0))::numeric,2) custo_por_form,
           round((sum(b.spend) filter (where bs.base = 'conversas')
                  / nullif(sum(b.messaging_started) filter (where bs.base = 'conversas'),0))::numeric,2) custo_por_conversa,
           round(sum(b.spend) filter (where bs.base = 'cliques_no_link')::numeric,2) gasto_sem_base_de_lead,
           (sum(public.resultados_da_base(bs.base, b.form_leads, b.messaging_started, b.link_clicks)) >= 50
            or sum(b.spend) >= 300) as amostra_confiavel
    from metric_breakdown_daily b
    left join lateral (
      select public.base_de_resultado(c.category, ast.optimization_goal, c.objective) as base
        from public.campaigns c
        left join public.ad_sets ast on ast.campaign_id = c.id
                                    and upper(coalesce(ast.optimization_goal,'')) = 'CONVERSATIONS'
       where c.external_id = b.campaign_external_id
       limit 1) bs on true
    where b.company_id = p_company_id and b.snapshot_date between p_start and p_end
    group by 1,2
  ),
  metricas as (
    select metric from public.targets
     where company_id = p_company_id and active and campaign_id is null
    union
    select metric from public.metas_de_negocio
     where company_id = p_company_id and vigente and tipo = 'gate'
  ),
  resolvidos as (
    select m.metric, public.teto_vigente(p_company_id, m.metric) as r from metricas m
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_start, 'fim', p_end,
        'dias_com_dado', (select count(*) from dia), 'dias_no_periodo', (p_end - p_start + 1)),
    'serie_diaria', (select coalesce(jsonb_agg(to_jsonb(dia) order by dia.d), '[]'::jsonb) from dia),
    'por_campanha', (select coalesce(jsonb_agg(to_jsonb(camp) order by camp.gasto desc), '[]'::jsonb) from camp),
    'top_anuncios', (select coalesce(jsonb_agg(to_jsonb(tops) order by tops.gasto desc), '[]'::jsonb) from tops),
    'tetos', (select coalesce(jsonb_object_agg(metric, (r->>'teto_que_governa')::numeric), '{}'::jsonb)
              from resolvidos where (r->>'teto_que_governa') is not null),
    'tetos_detalhe', (select coalesce(jsonb_object_agg(metric, r), '{}'::jsonb) from resolvidos),
    'perfil_demografico', (select coalesce(jsonb_agg(to_jsonb(demo) order by demo.tipo_recorte, demo.custo_por_form), '[]'::jsonb) from demo),
    'cobertura', public.nota_de_cobertura(p_company_id),
    'base_de_resultado', 'Cada linha de por_campanha declara sua base (formularios, conversas ou cliques_no_link) e o custo_por_resultado usa o denominador dessa base. Campanha de trafego e engajamento NAO tem custo por lead. Na serie diaria, gasto_form, gasto_conv e gasto_clk repartem o gasto do dia pela base da campanha: o custo por formulario do periodo e gasto_form / forms, nunca gasto / forms.',
    'proibicao', 'Em campanha de credito e PROIBIDO segmentar por idade, genero, CEP ou renda. O perfil demografico acima serve para escolher angulo e criativo, NUNCA para estreitar publico.');
$function$
;

comment on function public.get_report_export_data(uuid, date, date) is
'Dados da planilha exportada ao cliente. Desde 03/09/2026 a serie diaria reparte o gasto do dia por base de resultado (gasto_form, gasto_conv, gasto_clk) porque o Resumo da planilha dividia o gasto TOTAL pelos formularios: na Legal e Viver isso dava R$ 7,63 por formulario onde o verdadeiro e R$ 1,40 - os outros R$ 1,28 mil eram trafego e engajamento, que nao produzem formulario.';

-- ============================================================================
-- 9) montar_corpo_digest — o relatorio diario que o gestor le no WhatsApp
--    ANTES: "custo/formulário" do fechamento dividia o gasto do dia INTEIRO
--    pelos formularios do dia, e cada campanha era rotulada "formulários"
--    mesmo quando media conversa. AGORA cada linha usa a base da campanha e o
--    fechamento declara quanto foi para cada base, inclusive o que nao produz
--    lead nenhum.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.montar_corpo_digest(p_company_id uuid, p_dia date DEFAULT (CURRENT_DATE - 1))
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  corpo text;
  v_gasto numeric; v_forms int; v_links int; v_msgs int; v_leads int;
  v_gasto_form numeric; v_gasto_conv numeric; v_gasto_clq numeric;
  v_forms_base int; v_msgs_base int;
  v_teto_form numeric; v_custo_form numeric;
  v_teto_conv numeric; v_custo_conv numeric;
  v_teto_form_r jsonb; v_teto_form_nota text;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
  v_campanhas text; v_n_camp int; v_d1 date;
begin
  v_d1 := p_dia;

  select coalesce(sum(m.spend),0), coalesce(sum(m.form_leads),0), coalesce(sum(m.link_clicks),0),
         coalesce(sum(m.messaging_started),0), coalesce(sum(m.leads),0),
         coalesce(sum(m.spend) filter (where bs.base = 'formularios'),0),
         coalesce(sum(m.spend) filter (where bs.base = 'conversas'),0),
         coalesce(sum(m.spend) filter (where bs.base = 'cliques_no_link'),0),
         coalesce(sum(m.form_leads) filter (where bs.base = 'formularios'),0),
         coalesce(sum(m.messaging_started) filter (where bs.base = 'conversas'),0)
    into v_gasto, v_forms, v_links, v_msgs, v_leads,
         v_gasto_form, v_gasto_conv, v_gasto_clq, v_forms_base, v_msgs_base
    from public.metric_snapshots m
    cross join lateral (select public.base_de_resultado_da_campanha(m.campaign_id) as base) bs
   where m.company_id = p_company_id and m.snapshot_date = v_d1;

  v_teto_form_r := public.teto_vigente(p_company_id, 'custo_por_formulario');
  v_teto_form   := (v_teto_form_r->>'teto_que_governa')::numeric;
  v_teto_conv   := (public.teto_vigente(p_company_id, 'custo_por_conversa')->>'teto_que_governa')::numeric;
  v_teto_form_nota := case
    when v_teto_form is null then null
    when v_teto_form_r->>'governa' = 'meta_de_negocio' then
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form) || ' por formulário, decidida por '
      || coalesce(v_teto_form_r->'meta_de_negocio'->>'decidido_por','o gestor') || ' em '
      || to_char((v_teto_form_r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY') || '.'
      || case when (v_teto_form_r->'consistencia_historica'->>'valor') is not null
               and (v_teto_form_r->'consistencia_historica'->>'valor')::numeric <> v_teto_form
              then ' O teto histórico do próprio desempenho é R$ '
                   || public.fmt_brl((v_teto_form_r->'consistencia_historica'->>'valor')::numeric)
                   || ', e mede consistência com o passado — não rentabilidade.'
              else '' end || '_'
    else
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form)
      || ' por formulário, derivada do histórico do próprio desempenho — mede consistência com o passado, não rentabilidade. Não há régua de negócio declarada para esta métrica._'
    end;

  v_custo_form := case when v_forms_base > 0 then round(v_gasto_form / v_forms_base, 2) end;
  v_custo_conv := case when v_msgs_base  > 0 then round(v_gasto_conv / v_msgs_base,  2) end;

  with base as (
    select c.id, c.name,
           public.base_de_resultado_da_campanha(c.id)  as base,
           coalesce(sum(m.spend),0)              as sp,
           coalesce(sum(m.impressions),0)        as imp,
           coalesce(sum(m.reach),0)              as rch,
           coalesce(sum(m.clicks),0)             as clk,
           coalesce(sum(m.link_clicks),0)        as lclk,
           coalesce(sum(m.landing_page_views),0) as lpv,
           coalesce(sum(m.form_leads),0)         as frm,
           coalesce(sum(m.messaging_started),0)  as msg,
           round(avg(m.frequency)::numeric,2)    as freq
      from public.campaigns c
      left join public.metric_snapshots m on m.campaign_id = c.id and m.snapshot_date = v_d1
     where c.company_id = p_company_id
     group by c.id, c.name
  ), enriquecida as (
    select b.*,
           public.resultados_da_base(b.base, b.frm, b.msg, b.lclk) as res,
           case b.base when 'conversas' then v_teto_conv
                       when 'cliques_no_link' then null
                       else v_teto_form end as teto_base,
           case b.base when 'conversas' then 'conversas'
                       when 'cliques_no_link' then 'cliques no link'
                       else 'formulários' end as unidade,
           case b.base when 'conversas' then 'custo/conversa'
                       when 'cliques_no_link' then 'custo/clique no link'
                       else 'custo/formulário' end as rotulo,
           t.valor as teto,
           (select round(avg(x.spend)::numeric,2) from public.metric_snapshots x
             where x.campaign_id = b.id and x.snapshot_date between v_d1 - 6 and v_d1 - 1
               and x.spend > 0) as media6
      from base b
      left join public.targets t
             on t.campaign_id = b.id and t.metric = 'teto_gasto_diario' and t.active
     where b.sp > 0 or t.valor is not null
  )
  select count(*), string_agg(
    '### ' || name || e'\n'
    || '- Gasto **R$ ' || public.fmt_brl(sp) || '**'
       || case
            when teto is null then ' · sem teto declarado'
            when sp = 0 then ' · teto declarado R$ ' || public.fmt_brl(teto) || ' — **sem gasto ontem**'
            when sp > teto then ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → **' || round(100*sp/teto) || '% do teto** ⚠️'
            else ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → ' || round(100*sp/teto) || '% do teto ✅'
          end
       || case when media6 is not null and media6 > 0 and sp > 0 then
            ' · vs média dos 6 dias anteriores (R$ ' || public.fmt_brl(media6) || '): '
            || case when sp > media6 then '+' else '' end || round(100*(sp-media6)/media6) || '%'
          else '' end || e'\n'
    || case when sp = 0 then ''
       else
         '- **' || public.fmt_int(imp) || '** impressões para **' || public.fmt_int(rch)
         || '** pessoas' || case when freq is not null then ' (frequência ' || public.fmt_brl(freq) || ')' else '' end || e'\n'
         || '- **' || public.fmt_int(clk) || '** cliques · **' || public.fmt_int(lclk) || '** no link · **'
         || public.fmt_int(lpv) || '** chegaram na página' || e'\n'
         || '- **' || public.fmt_int(res::bigint) || '** ' || unidade
         || case when res > 0 then
              ' · ' || rotulo || ' **R$ ' || public.fmt_brl(round(sp/res,2)) || '**'
              || case when teto_base is not null then
                   case when round(sp/res,2) <= teto_base
                        then ' (dentro do teto R$ ' || public.fmt_brl(teto_base) || ' ✅)'
                        else ' (**ACIMA** do teto R$ ' || public.fmt_brl(teto_base) || ' ⚠️)' end
                 else ' (sem régua declarada para esta base)' end
            else ' — nenhum resultado' end || e'\n'
       end,
    e'\n' order by sp desc, name)
    into v_n_camp, v_campanhas from enriquecida;

  select count(*), coalesce(string_agg(
           '- ' || case severity::text when 'critical' then '🔴' when 'high' then '🟠'
                        when 'medium' then '🟡' else '🔵' end || ' **' || title || '**: ' || description,
           e'\n' order by case severity::text when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end), '- nenhum alerta ativo 👌')
    into v_n_alertas, v_alertas
    from public.alerts where company_id = p_company_id and resolved = false;

  select coalesce(string_agg('- ' || j.jobname || ': ' ||
           case d.status when 'succeeded' then '✅ rodou' else '❌ ' || coalesce(d.status,'?') end, e'\n'),
           '- (nenhuma rotina registrada hoje)')
    into v_sync
    from cron.job j
    join lateral (select status from cron.job_run_details r
       where r.jobid = j.jobid and r.start_time::date = current_date
       order by r.start_time desc limit 1) d on true
   where j.jobname in ('windsor-sync-daily','alerts-eval-daily','pipeboard-metrics-daily');

  select count(*), coalesce(string_agg('- ' ||
           case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**',
           e'\n' order by case impact when 'high' then 0 when 'medium' then 1 else 2 end),
           '- nada pendente de decisão')
    into v_n_recos, v_recos
    from public.ai_recommendations where company_id = p_company_id and status = 'new';

  corpo :=
    '# 📋 Relatório diário — ' || to_char(current_date, 'DD/MM/YYYY') || e'\n\n' ||
    '## 🔎 Ontem (' || to_char(v_d1, 'DD/MM') || ') — campanha por campanha' || e'\n\n' ||
    coalesce(v_campanhas, '- nenhuma campanha com gasto e nenhuma com teto declarado') || e'\n\n' ||
    '**Fechamento da empresa:** gasto **R$ ' || public.fmt_brl(v_gasto) || '** · ' ||
    public.fmt_int(v_links::bigint) || ' cliques no link · ' || public.fmt_int(v_forms::bigint) || ' formulários' ||
    case when v_custo_form is not null then ' · custo/formulário **R$ ' || public.fmt_brl(v_custo_form) ||
      '** (sobre os R$ ' || public.fmt_brl(v_gasto_form) || ' gastos em campanhas de formulário)' ||
      case when v_teto_form is not null then
        case when v_custo_form <= v_teto_form then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
             else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
      else '' end else '' end ||
    case when v_msgs > 0 then ' · ' || public.fmt_int(v_msgs::bigint) || ' conversas WhatsApp' ||
      case when v_custo_conv is not null then ' · custo/conversa **R$ ' || public.fmt_brl(v_custo_conv) ||
        '** (sobre os R$ ' || public.fmt_brl(v_gasto_conv) || ' gastos em campanhas de conversa)' ||
        case when v_teto_conv is not null then
          case when v_custo_conv <= v_teto_conv then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_conv) || ' ✅)'
               else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_conv) || ' ⚠️)' end
        else '' end else '' end
    else '' end || e'\n' ||
    case when v_gasto_clq > 0 then
      '_R$ ' || public.fmt_brl(v_gasto_clq) || ' do gasto de ontem foi em campanha de tráfego, engajamento ou alcance — base **cliques no link**. Esse dinheiro NÃO entra no custo por formulário nem no custo por conversa, porque não disputa esse resultado._' || e'\n'
    else '' end ||
    '_O fechamento é soma de ' || coalesce(v_n_camp,0) || ' campanhas: use-o para conferir o caixa, nunca para julgar desempenho. Custo/formulário, custo/conversa e gasto sem base de lead não dividem numerador — cada um soma apenas o gasto da sua base._' || e'\n' ||
    coalesce(v_teto_form_nota || e'\n', '') || e'\n' ||
    coalesce(public.nota_de_cobertura(p_company_id), '') || e'\n\n' ||
    '**Alertas ativos (' || v_n_alertas || '):**' || e'\n' || v_alertas || e'\n\n' ||
    '## ✅ Resolvi' || e'\n' ||
    'Rotinas de hoje (sync de dados, avaliação de regras e vencedores):' || e'\n' || v_sync || e'\n\n' ||
    '## 🫵 Depende de você (' || v_n_recos || ')' || e'\n' || v_recos;

  return corpo;
end $function$
;

-- ============================================================================
-- 10) A PROVA — reexecutavel, e o que impede a divergencia de voltar
--     `select * from public.prova_denominador_unico(7) where not confere`
--     Vazio = todos os caminhos concordam com o calculo canonico.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prova_denominador_unico(p_dias integer DEFAULT 7)
 RETURNS TABLE(escopo text, objeto text, base text, gasto numeric, resultados numeric, custo_canonico numeric, custo_da_funcao numeric, confere boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select 'conjunto'::text, z.adset_external_id, z.base,
         round(z.gasto,2), z.res,
         round(public.custo_por_resultado(z.gasto, z.forms, z.msgs, z.base, z.lclk),2),
         (public.decidir_sobre_conjunto(z.company_id, z.adset_external_id)
            ->'numeros'->>'custo_por_resultado_7d')::numeric,
         round(public.custo_por_resultado(z.gasto, z.forms, z.msgs, z.base, z.lclk),2)
           is not distinct from
         (public.decidir_sobre_conjunto(z.company_id, z.adset_external_id)
            ->'numeros'->>'custo_por_resultado_7d')::numeric
    from (
      select s.company_id, a.adset_external_id,
             public.base_de_resultado_do_conjunto(a.adset_external_id) as base,
             sum(s.spend) gasto, sum(s.form_leads) forms, sum(s.messaging_started) msgs,
             sum(s.link_clicks) lclk,
             sum(public.resultados_da_base(public.base_de_resultado_do_conjunto(a.adset_external_id),
                                           s.form_leads, s.messaging_started, s.link_clicks)) res
        from public.ad_metric_snapshots s
        join public.ads a on a.external_id = s.ad_external_id
       where s.snapshot_date >= current_date - p_dias and s.spend > 0
         and a.adset_external_id is not null
       group by 1,2,3) z

  union all

  select 'empresa/' || b.base, co.name, b.base,
         round(w.gasto,2), w.res,
         round(w.gasto / nullif(w.res,0), 2),
         (public.avaliar_pacing(co.id)->'capacidade_atual'->>(public.metrica_do_teto(b.base) || '_7d'))::numeric,
         round(w.gasto / nullif(w.res,0), 2) is not distinct from
         (public.avaliar_pacing(co.id)->'capacidade_atual'->>(public.metrica_do_teto(b.base) || '_7d'))::numeric
    from public.companies co
    cross join (values ('formularios'),('conversas'),('cliques_no_link')) as b(base)
    cross join lateral (
      select coalesce(sum(s.spend) filter (where bs.base = b.base),0) gasto,
             coalesce(sum(public.resultados_da_base(b.base, s.form_leads, s.messaging_started, s.link_clicks))
                        filter (where bs.base = b.base),0) res
        from public.ad_metric_snapshots s
        join public.ads a on a.external_id = s.ad_external_id
        left join public.ad_sets ast on ast.external_id = a.adset_external_id
        left join public.campaigns c on c.id = coalesce(a.campaign_id, ast.campaign_id)
        cross join lateral (select public.base_de_resultado(c.category, ast.optimization_goal, c.objective) base) bs
       where s.company_id = co.id and s.snapshot_date >= current_date - p_dias) w
$function$
;

comment on function public.prova_denominador_unico(integer) is
'Prova reexecutavel do denominador unico: compara o custo canonico (camada unica) com o que cada funcao devolve, por conjunto e por empresa/base. Rodar depois de qualquer mexida em custo. Linha com confere=false significa que a formula foi reescrita a mao em algum lugar - a causa raiz que esta migration removeu.';

-- ============================================================================
-- 11) evaluate_winners e computar_perfil_vencedor
--     Estes ja usavam denominador condicional, mas escrito a mao e cego para a
--     base cliques_no_link. Passam a usar a camada unica e a nomear a metrica
--     por metrica_do_teto. A ELEGIBILIDADE (category in leadgen/mensagem) NAO
--     muda: mexer nela mudaria QUAIS anuncios entram, o que e decisao do gestor.
--     A lacuna fica declarada no proprio retorno de computar_perfil_vencedor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_winners()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare total int;
v_hoje text := to_char((timezone('America/Sao_Paulo', now()))::date, 'YYYYMMDD');
begin
  delete from public.ai_recommendations
   where status = 'new' and (description like '%[auto: vencedores]%' or source = 'sql:winners');

  with base as (
    select s.ad_external_id,
           max(a.name) as ad_name, max(c.name) as camp_name, max(c.category) as category,
           max(public.base_de_resultado_da_campanha(c.id)) as base_resultado,
           max(c.company_id::text)::uuid as company_id,
           max(coalesce(a.object_type,'')) as object_type,
           max(coalesce(a.call_to_action_type,'')) as cta,
           max(coalesce(a.title,'')) as ad_title,
           sum(s.spend) as spend7,
           sum(public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                         s.form_leads, s.messaging_started, s.link_clicks)) as results7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    join public.campaigns c on c.id = a.campaign_id
    where c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= current_date - 7
    group by s.ad_external_id
  ), scored as (
    select b.*, round(b.spend7 / b.results7, 2) as custo7,
           (t.r->>'teto_que_governa')::numeric as teto,
           public.metrica_do_teto(b.base_resultado) as metrica,
           case when b.base_resultado = 'conversas' then 'custo/conversa' else 'custo/formulário' end as metric_label,
           case when t.r->>'governa' = 'meta_de_negocio'
                then 'régua de negócio de ' || coalesce(t.r->'meta_de_negocio'->>'decidido_por','gestor')
                     || ', ' || to_char((t.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                else 'teto histórico do próprio desempenho' end as regua_label,
           round(100 * (1 - (b.spend7 / b.results7) / (t.r->>'teto_que_governa')::numeric)) as economia_pct
    from base b
    cross join lateral (
      select public.teto_vigente(b.company_id, public.metrica_do_teto(b.base_resultado)) as r
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and (t.r->>'teto_que_governa') is not null
      and (b.spend7 / b.results7) <= (t.r->>'teto_que_governa')::numeric * 0.80
  )
  insert into public.ai_recommendations (
    company_id, title, description, impact, category, status,
    signal_key, entity_type, entity_id, entity_name, evidence_json,
    suggested_prompt, maturity_days, source, dedupe_key, family
  )
  select company_id,
         'Escalar criativo vencedor: ' || ad_name,
         'Últimos 7 dias: ' || results7 || ' resultados a R$ ' || to_char(custo7,'FM999990.00') ||
         ' (' || metric_label || ') — ' || economia_pct || '% abaixo do teto R$ ' || to_char(teto,'FM999990.00') ||
         ', com R$ ' || to_char(spend7,'FM999990.00') || ' investidos. Recomendação: aumentar orçamento ou duplicar este anúncio. Campanha ' || camp_name ||
         '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'high', 'escala', 'new'::recommendation_status,
         'vencedor.escala', 'ad', ad_external_id, ad_name,
         jsonb_build_object('fonte','evaluate_winners','custo7',custo7,'teto',teto,'results7',results7,'spend7',spend7,
                            'base_de_resultado',base_resultado,'metrica',metrica),
         'Quero discutir a recomendacao de escalar o criativo "' || ad_name || '" (custo R$ ' || to_char(custo7,'FM999990.00') || ' vs teto R$ ' || to_char(teto,'FM999990.00') || '). Como proceder com aprovacao?',
         7, 'sql:winners', 'vencedor.escala|' || ad_external_id || '|' || v_hoje, 'vencedor'
  from scored
  union all
  select company_id,
         'Produza mais como: ' || ad_name,
         'Este criativo performa a R$ ' || to_char(custo7,'FM999990.00') || ' (' || metric_label ||
         '), ' || economia_pct || '% abaixo do teto. Padrão para replicar: formato ' ||
         coalesce(nullif(object_type,''),'(sem registro)') || ', CTA ' || coalesce(nullif(cta,''),'(sem registro)') ||
         case when ad_title <> '' then ', título "' || ad_title || '"' else '' end ||
         '. Campanha ' || camp_name || '. Régua usada: ' || regua_label || '. [auto: vencedores]',
         'medium', 'criativo', 'new'::recommendation_status,
         'vencedor.padrao', 'ad', ad_external_id, ad_name,
         jsonb_build_object('fonte','evaluate_winners','custo7',custo7,'object_type',object_type,'cta',cta,
                            'base_de_resultado',base_resultado,'metrica',metrica),
         'Quero produzir mais pecas no padrao do vencedor "' || ad_name || '" (formato ' || coalesce(nullif(object_type,''),'?') || ', CTA ' || coalesce(nullif(cta,''),'?') || ').',
         7, 'sql:winners', 'vencedor.padrao|' || ad_external_id || '|' || v_hoje, 'vencedor'
  from scored;

  select count(*) into total from public.ai_recommendations
   where status = 'new' and source = 'sql:winners';
  return total;
end $function$
;

CREATE OR REPLACE FUNCTION public.computar_perfil_vencedor(p_company_id uuid, p_dias integer DEFAULT 7, p_forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias integer := greatest(coalesce(p_dias, 7), 1);
  v_vencedores jsonb; v_padroes jsonb; v_criterio jsonb; v_lacunas jsonb;
  v_n int; v_versao int; v_hash text;
  v_ultima_hash text; v_ultima_versao int; v_ultima_dia date;
begin
  if p_company_id is null then
    return jsonb_build_object('erro', 'company_id_obrigatorio',
      'motivo', 'computar_perfil_vencedor exige a empresa da conversa.');
  end if;

  with base as (
    select s.ad_external_id,
           max(a.name) as ad_name, max(c.name) as camp_name, max(c.category) as category,
           max(public.base_de_resultado_da_campanha(c.id)) as base_resultado,
           max(coalesce(a.object_type,'')) as object_type,
           max(coalesce(a.call_to_action_type,'')) as cta,
           max(coalesce(a.title,'')) as ad_title,
           sum(s.spend) as spend7,
           sum(public.resultados_da_base(public.base_de_resultado_da_campanha(c.id),
                                         s.form_leads, s.messaging_started, s.link_clicks)) as results7
    from public.ad_metric_snapshots s
    join public.ads a on a.external_id = s.ad_external_id
    join public.campaigns c on c.id = a.campaign_id
    where c.company_id = p_company_id
      and c.status = 'active'
      and coalesce(c.category,'') in ('leadgen','mensagem')
      and upper(coalesce(a.status,'ACTIVE')) in ('ACTIVE','ADSET_PAUSED_OVERRIDE')
      and s.snapshot_date >= current_date - v_dias
    group by s.ad_external_id
  ), scored as (
    select b.*, round(b.spend7 / b.results7, 2) as custo7,
           (t.r->>'teto_que_governa')::numeric as teto,
           public.metrica_do_teto(b.base_resultado) as metrica,
           case when b.base_resultado = 'conversas' then 'custo/conversa' else 'custo/formulário' end as metric_label,
           case when t.r->>'governa' = 'meta_de_negocio'
                then 'régua de negócio de ' || coalesce(t.r->'meta_de_negocio'->>'decidido_por','gestor')
                     || ', ' || to_char((t.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                else 'teto histórico do próprio desempenho' end as regua_label,
           round(100 * (1 - (b.spend7 / b.results7) / (t.r->>'teto_que_governa')::numeric)) as economia_pct
    from base b
    cross join lateral (
      select public.teto_vigente(p_company_id, public.metrica_do_teto(b.base_resultado)) as r
    ) t
    where b.results7 >= 30 and b.spend7 >= 30
      and (t.r->>'teto_que_governa') is not null
      and (b.spend7 / b.results7) <= (t.r->>'teto_que_governa')::numeric * 0.80
  ), enriched as (
    select sc.*, dl.drive_file_id, dl.peca_nome, dl.produto
    from scored sc
    left join lateral (
      select ar.payload->>'drive_file_id' as drive_file_id,
             da.nome as peca_nome, da.produto_detectado as produto
      from public.approval_requests ar
      left join lateral (
        select d2.nome, d2.produto_detectado
        from public.drive_midia_analises d2
        where d2.company_id = p_company_id
          and d2.drive_file_id = ar.payload->>'drive_file_id'
        order by d2.analisado_em desc nulls last
        limit 1) da on true
      where ar.company_id = p_company_id
        and ar.action = 'criar_anuncio_a_partir_de'
        and ar.executed_at is not null
        and (ar.execution_result->>'id_criado') = sc.ad_external_id
        and nullif(ar.payload->>'drive_file_id','') is not null
      order by ar.executed_at desc
      limit 1) dl on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ad_external_id', ad_external_id,
      'ad_name', ad_name,
      'campanha', camp_name,
      'categoria', category,
      'base_de_resultado', base_resultado,
      'metrica', metrica,
      'metric_label', metric_label,
      'custo', custo7,
      'teto', teto,
      'economia_pct', economia_pct,
      'regua', regua_label,
      'formato', nullif(object_type,''),
      'cta', nullif(cta,''),
      'titulo', nullif(ad_title,''),
      'resultados', results7,
      'gasto', round(spend7::numeric, 2),
      'drive_file_id', drive_file_id,
      'peca_nome', peca_nome,
      'produto', produto
    ) order by economia_pct desc nulls last), '[]'::jsonb), count(*)
  into v_vencedores, v_n
  from enriched;

  v_padroes := jsonb_build_object(
    'por_formato', coalesce((select jsonb_object_agg(k, c) from (
        select coalesce(x->>'formato','(sem registro)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1) q), '{}'::jsonb),
    'por_cta', coalesce((select jsonb_object_agg(k, c) from (
        select coalesce(x->>'cta','(sem registro)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1) q), '{}'::jsonb),
    'por_produto', coalesce((select jsonb_object_agg(k, c) from (
        select coalesce(x->>'produto','(indeterminado)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1) q), '{}'::jsonb),
    'por_base_de_resultado', coalesce((select jsonb_object_agg(k, c) from (
        select coalesce(x->>'base_de_resultado','(indeterminada)') as k, count(*) as c
        from jsonb_array_elements(v_vencedores) x group by 1) q), '{}'::jsonb),
    'com_peca_de_origem', coalesce((select count(*) from jsonb_array_elements(v_vencedores) x
      where nullif(x->>'drive_file_id','') is not null), 0));

  v_criterio := jsonb_build_object(
    'janela_dias', v_dias,
    'significancia_minima', jsonb_build_object('resultados', 30, 'gasto', 30),
    'limiar_vencedor', 'custo <= teto_vigente * 0.80',
    'denominador', 'public.resultados_da_base(public.base_de_resultado_da_campanha(...)) - camada unica compartilhada desde 03/09/2026',
    'metricas', jsonb_build_object(
      'formularios', 'form_leads / custo_por_formulario',
      'conversas', 'messaging_started / custo_por_conversa'),
    'fonte_teto', 'teto_vigente()',
    'observacao', 'Mesma logica de evaluate_winners (ESP-01), escopo por empresa. Vencedores de bases diferentes NAO sao comparaveis entre si.');

  v_lacunas := jsonb_build_array(
    'Vencedor sem card criar_anuncio_a_partir_de fica sem drive_file_id/peca (orfao de origem).',
    'Janela curta: se o coletor de metricas atrasar, um vencedor real pode nao aparecer.',
    'Perfil descreve o passado da janela; nao garante repeticao futura. Confirme antes de escalar (ESP-39: vencedor mora em ESCALA).',
    'Elegibilidade ainda exige campaigns.category preenchida (leadgen ou mensagem). Com category nula a campanha nao entra aqui, mesmo tendo base de resultado derivavel do objetivo declarado na Meta.');

  select coalesce(string_agg(x->>'ad_external_id', ',' order by x->>'ad_external_id'), '(vazio)')
    into v_hash from jsonb_array_elements(v_vencedores) x;

  select versao, computado_em::date, procedencia->>'hash_vencedores'
    into v_ultima_versao, v_ultima_dia, v_ultima_hash
    from public.perfil_vencedor_versoes
   where company_id = p_company_id order by versao desc limit 1;

  if not p_forcar and v_ultima_versao is not null
     and v_ultima_dia = current_date and v_ultima_hash = v_hash then
    return jsonb_build_object('ok', true, 'pulado', true,
      'motivo', 'perfil identico ja computado hoje (use p_forcar=true para regravar).',
      'versao', v_ultima_versao, 'total', v_n);
  end if;

  v_versao := coalesce(v_ultima_versao, 0) + 1;

  insert into public.perfil_vencedor_versoes
    (company_id, versao, janela_dias, total_vencedores, criterio, vencedores, padroes, procedencia, lacunas)
  values (p_company_id, v_versao, v_dias, v_n, v_criterio, v_vencedores, v_padroes,
    jsonb_build_object(
      'fontes', jsonb_build_array('evaluate_winners_logic(ESP-01)', 'teto_vigente',
        'approval_requests(criar_anuncio_a_partir_de)', 'drive_midia_analises(ESP-33)',
        'base_de_resultado_da_campanha(camada unica)'),
      'hash_vencedores', v_hash,
      'gerado_por', 'computar_perfil_vencedor'),
    v_lacunas);

  return jsonb_build_object('ok', true, 'versao', v_versao, 'computado_em', now(),
    'janela_dias', v_dias, 'total', v_n, 'vencedores', v_vencedores, 'padroes', v_padroes,
    'criterio', v_criterio, 'lacunas', v_lacunas,
    'nota', 'ESP-34: perfil versionado do vencedor por empresa. Nao substitui get_recommendations nem a aprovacao humana de escala. Vencedor deve viver em campanha ESCALA (ESP-39).');
end $function$
;

-- ============================================================================
-- 12) evaluate_alerts — regra cpl e regra pause_3d
--     ANTES: o `case when c.category = 'mensagem'` escrito a mao, e o rotulo da
--     metrica idem. AGORA a base, o denominador e o NOME da metrica do teto vem
--     da camada unica: um anuncio de conversa passa a ser julgado contra
--     custo_por_conversa, e um de trafego contra custo_por_clique_link (que nao
--     tem regua vigente, entao nao gera alerta em vez de gerar alerta errado).
--
--     O QUE NAO MUDA, de proposito: o filtro `coalesce(c.category,'') in
--     ('leadgen','mensagem')` e o limiar de cada regra. Quais campanhas o motor
--     julga e decisao do gestor; esta migration so conserta a conta.
--     Efeito medido na regra cpl: as tres campanhas de WhatsApp ativas da COHAPM
--     dao o MESMO custo antes e depois (R$ 16,87 / R$ 4,00 / R$ 4,96 por conversa),
--     porque a categoria delas ja dizia 'mensagem'. Nenhuma passa do limiar de
--     R$ 21,80, entao a regra segue sem disparar. As tres de trafego seguem fora
--     do filtro - antes seriam julgadas contra custo_por_lead_lp com denominador
--     zerado, agora sao reconhecidas como custo_por_clique_link sem regua vigente.
--
--     A regra spend_no_leads MUDA de comportamento, e essa mudanca e o ponto:
--     ela lia `c.leads = 0`, coluna agregada que a ingestao viva parou de
--     atualizar (as tres campanhas de WhatsApp tem leads = 0 com 34, 83 e 23
--     conversas; 'CAMPANHA TESTE AGO26 RR' tem leads = 0 com 202 formularios).
--     Com a categoria recem-derivada, as tres entrariam na regra e receberiam
--     'Gasto sem nenhum lead' na proxima corrida do cron. Passa a ler a base
--     canonica: zero alerta falso. O piso de R$ 100 nao foi tocado.
-- ============================================================================

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
  for v_r in
    select c.company_id, c.id as campaign_id, c.name as camp_name,
           r.id as rule_id, r.severity,
           d.custo, coalesce(d.teto, r.threshold) as teto, d.regua_label,
           case when den.metrica = 'custo_por_conversa' then 'conversa iniciada'
                else 'formulario preenchido' end as unidade
      from public.alert_rules r
      join public.campaigns c on c.company_id = r.company_id and c.status = 'active'
      cross join lateral (select public.base_de_resultado_da_campanha(c.id) as base) bd
      cross join lateral (
        select nullif(public.resultados_da_base(bd.base, c.form_leads, c.messaging_started, c.link_clicks), 0) as resultados,
               public.metrica_do_teto(bd.base) as metrica
      ) den
      cross join lateral (select public.teto_vigente(r.company_id, den.metrica) as tv) t
      cross join lateral (
        select c.spend / den.resultados as custo,
               (t.tv->>'teto_que_governa')::numeric as teto,
               case when t.tv->>'governa' = 'meta_de_negocio'
                    then 'meta de negocio definida por ' || coalesce(t.tv->'meta_de_negocio'->>'decidido_por','gestor')
                         || ' em ' || to_char((t.tv->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                    else 'historico do proprio desempenho' end as regua_label
      ) d
     where r.active and r.metric = 'cpl'
       and coalesce(c.category,'') in ('leadgen','mensagem')
       and den.resultados is not null
       and d.custo > coalesce(d.teto, r.threshold)
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
                        then 'meta de negocio definida por ' || coalesce(tv.r->'meta_de_negocio'->>'decidido_por','gestor')
                             || ' em ' || to_char((tv.r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY')
                        else 'historico do proprio desempenho' end as regua_label
              from (select public.teto_vigente(a0.company_id, public.metrica_do_teto(a0.base_resultado)) as r) tv
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
end $function$
;

-- ============================================================================
-- 13) detectar_sinais_recomendacao
--     Convergida por substituicao dirigida no proprio corpo, porque o resto da
--     funcao (candidatos, dedupe, fila de LLM) nao tem relacao com custo e
--     copiar 400 linhas so para trocar duas expressoes multiplicaria a chance
--     de erro. O bloco FALHA RUIDOSAMENTE se o padrao nao for encontrado -
--     nunca converge pela metade em silencio.
--
--     ANTES: campanha de engajamento ou trafego tinha o custo calculado com
--     form_leads e comparado contra a regua custo_por_lead_lp - numerador de
--     uma base contra regua de outra.
-- ============================================================================

do $mig$
declare
  v_src text; v_novo text; v_n1 int; v_n2 int;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_sinais_recomendacao';

  if v_src is null then
    raise exception 'detectar_sinais_recomendacao nao encontrada';
  end if;

  v_novo := regexp_replace(v_src,
    'sum\(case when c\.category = ''mensagem'' then ms\.messaging_started else ms\.form_leads end\)',
    'sum(public.resultados_da_base(public.base_de_resultado_da_campanha(c.id), ms.form_leads, ms.messaging_started, ms.link_clicks))',
    'g');

  v_novo := regexp_replace(v_novo,
    'case when camp\.category = ''mensagem'' then ''custo_por_conversa''\s*when camp\.category = ''leadgen'' then ''custo_por_formulario''\s*else ''custo_por_lead_lp'' end',
    'public.metrica_do_teto(public.base_de_resultado_da_campanha(camp.id))',
    'g');

  select count(*) into v_n1 from regexp_matches(v_novo, 'c\.category = ''mensagem''', 'g');
  select count(*) into v_n2 from regexp_matches(v_novo, 'custo_por_lead_lp', 'g');

  if v_n1 > 0 or v_n2 > 0 then
    raise exception 'convergencia incompleta: % denominadores e % reguas de base implicita ainda no corpo', v_n1, v_n2;
  end if;

  execute 'create or replace function public.detectar_sinais_recomendacao(p_modo text default ''diario''::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''public'', ''private'', ''pg_temp''
as $dsr$' || v_novo || '$dsr$';
end $mig$;

comment on function public.detectar_sinais_recomendacao(text) is
'Detector de sinais de recomendacao. Denominador e metrica do teto vem da camada unica desde 03/09/2026. ANTES: campanha de engajamento ou trafego tinha o custo calculado com form_leads e comparado contra a regua custo_por_lead_lp - numerador de uma base contra regua de outra. AGORA a base vem de base_de_resultado_da_campanha e a metrica de metrica_do_teto; campanha de trafego cai em custo_por_clique_link, que nao tem regua vigente, e por isso nao gera sinal em vez de gerar sinal com aritmetica misturada. PENDENTE DE DECISAO DO GESTOR: existem dois targets ativos de custo_por_lead_lp (6,85 e 1,50) que agora ficam sem funcao ate ele declarar o que essa metrica mede.';

-- ============================================================================
-- 14) A migration se recusa a terminar divergente
-- ============================================================================

do $conferencia$
declare
  v_div int; v_mao int;
begin
  select count(*) into v_div from public.prova_denominador_unico(7) where not confere;
  if v_div > 0 then
    raise exception 'A migration terminaria com % caminho(s) discordando do calculo canonico. Rode: select * from public.prova_denominador_unico(7) where not confere;', v_div;
  end if;

  -- Nenhuma funcao pode voltar a escrever o denominador a mao.
  select count(*) into v_mao
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.prosrc like '%category = ''mensagem''%'
     and p.proname <> 'base_de_resultado';
  if v_mao > 0 then
    raise exception '% funcao(oes) ainda decidem a base por category escrita a mao - a causa raiz que esta migration remove', v_mao;
  end if;

  -- Nenhuma regra pode voltar a contar resultado pela coluna agregada.
  select count(*) into v_mao
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%c.leads = 0%';
  if v_mao > 0 then
    raise exception '% funcao(oes) ainda contam resultado por campaigns.leads, coluna desatualizada', v_mao;
  end if;
end $conferencia$;

