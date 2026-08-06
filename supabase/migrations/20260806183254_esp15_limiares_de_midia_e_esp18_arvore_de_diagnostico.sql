-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806183254
-- name: esp15_limiares_de_midia_e_esp18_arvore_de_diagnostico
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-15 (limiares com acao) + ESP-18 (arvore "o CPL subiu, por que") · construidos juntos.
--
-- POR QUE JUNTOS: a arvore ramifica em "o CTR caiu?", "a frequencia subiu?", "o CPM subiu?".
-- Sem os limiares ela ramifica em nada; sem quem os leia, os limiares sao decoracao. Separar os
-- dois cards produziria duas metades inuteis.
--
-- A CADEIA CAUSAL, que e o ativo do contrato do Roberto e o que o sistema nao tinha:
--   criativo bom -> CTR alto -> CPM cai -> CPC cai -> CUSTO POR RESULTADO cai
--   criativo cansado -> CTR cai + frequencia sobe -> CPM sobe -> CUSTO SOBE
-- Custo por resultado e CONSEQUENTE. Nao se controla direto: controla-se criativo, publico,
-- estrutura e lance. Por isso a arvore devolve sempre SINAL -> CAUSA -> ACAO -> CONFIRMACAO.
--
-- DUAS ESPECIES DE LIMIAR, e misturar as duas foi o que faltava:
--   absoluto        -> "CTR de link abaixo de 0,8% com pelo menos R$50 gastos"
--   variacao_relativa -> "CTR caiu 25% ou mais contra a media dos 3 dias anteriores"
-- Fadiga so se diagnostica pela segunda especie; nivel absoluto nao distingue criativo fraco de
-- criativo cansado.
--
-- MATURACAO ENTRA COMO GUARDA AQUI, mesmo sendo o ESP-16: objeto com menos de 3 dias NAO recebe
-- prescricao de pausa por custo. Deixar a arvore prescrever pausa em objeto em aprendizado seria
-- codificar o erro numero um do gestor amador.
--
-- AMBIGUIDADE DECLARADA: o contrato diz "CTR saudavel em credito BR: 4 a 8%" sem dizer o
-- DENOMINADOR. A conta opera hoje entre 3,1% e 4,9% de CTR de LINK. Se o 4-8% do contrato for
-- CTR de todos os cliques, os dois numeros nao se comparam. O limiar de faixa saudavel entra
-- marcado como denominador_incerto e NAO gera prescricao ate ser confirmado.

create table if not exists public.limiares_de_midia (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  metrica text not null,
  tipo text not null,
  operador text not null,
  valor numeric not null,
  janela_dias int not null default 1,
  piso_de_gasto numeric,
  acao_prescrita text not null,
  porque text not null,
  denominador text,
  denominador_incerto boolean not null default false,
  fonte text not null,
  vigente boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint limiares_tipo_valido check (tipo in ('absoluto','variacao_relativa')),
  constraint limiares_operador_valido check (operador in ('<','>','<=','>=')),
  constraint limiares_unico unique (company_id, metrica, tipo, operador, vigente)
);

comment on table public.limiares_de_midia is
  'ESP-15: limiar com ACAO PRESCRITA e o PORQUE. tipo absoluto = nivel; variacao_relativa = mudanca contra a media da janela. denominador_incerto = limiar existe mas nao prescreve, porque nao se sabe contra o que comparar.';

alter table public.limiares_de_midia enable row level security;
drop policy if exists limiares_leitura on public.limiares_de_midia;
create policy limiares_leitura on public.limiares_de_midia for select to authenticated using (true);

insert into public.limiares_de_midia
  (company_id, metrica, tipo, operador, valor, janela_dias, piso_de_gasto, acao_prescrita, porque, denominador, denominador_incerto, fonte)
select c.id, v.metrica, v.tipo, v.operador, v.valor, v.janela, v.piso, v.acao, v.porque, v.den, v.incerto, v.fonte
from public.companies c,
(values
 ('ctr_link','absoluto','<',0.8,1,50.0,
  'Revisar o criativo e, se nao houver tendencia de recuperacao, pausar. NAO pausar objeto com menos de 3 dias.',
  'CTR baixo com gasto ja consumido significa que a peca nao conversa com o publico: o leilao encarece o CPM e o custo por resultado sobe por consequencia.',
  'cliques no link / impressoes, em %', false, 'CONTRA_2 Parte I - ctr_min 0,008 com piso de R$50'),
 ('ctr_link','variacao_relativa','<',-25.0,3,null,
  'Se a frequencia estiver subindo junto, e FADIGA: trocar o criativo. Se a frequencia estiver estavel, e criativo fraco desde o inicio.',
  'Queda relativa distingue criativo CANSADO de criativo RUIM. Nivel absoluto nao distingue, e a acao para os dois casos e diferente.',
  'cliques no link / impressoes, em %', false, 'CONTRA_2 Parte I - queda de CTR >=25% vs media de 3 dias'),
 ('cpm','variacao_relativa','>',30.0,3,null,
  'Investigar sobreposicao de publico e fadiga antes de mexer em orcamento.',
  'CPM subindo sem mudanca de estrutura indica que o leilao ficou mais caro para a mesma audiencia - sobreposicao entre conjuntos ou saturacao.',
  'gasto / impressoes x 1000', false, 'CONTRA_2 Parte I - CPM +30% sem mudanca de estrutura'),
 ('frequencia','absoluto','>',3.5,30,null,
  'Trocar criativo ou ampliar publico.',
  'Acima de 3,5 exposicoes por pessoa no mes a mesma audiencia ja viu a peca demais: o retorno marginal cai e o CTR acompanha.',
  'impressoes / alcance na janela', false, 'CONTRA_2 Parte I - freq_alerta 3,5 em 30 dias'),
 ('ctr_link','absoluto','>',4.0,1,null,
  'Nenhuma - limiar de referencia apenas.',
  'O contrato cita faixa saudavel de 4 a 8% para credito no Brasil, mas NAO diz o denominador. A conta opera de 3,1% a 4,9% de CTR de LINK. Se a faixa do contrato for CTR de todos os cliques, os numeros nao se comparam - por isso este limiar nao prescreve nada ate o denominador ser confirmado.',
  'INDEFINIDO - ver porque', true, 'CONTRA_2 Parte I - faixa 4 a 8%, denominador nao declarado')
) as v(metrica,tipo,operador,valor,janela,piso,acao,porque,den,incerto,fonte)
where c.name = 'Legal é Viver'
on conflict do nothing;

-- ESP-18 · a arvore
create or replace function public.diagnosticar_custo(p_company_id uuid, p_ad_external_id text)
returns jsonb
language plpgsql
stable
as $$
declare
  d record; b record; v_idade int; v_maduro boolean;
  v_lim_ctr_queda numeric; v_lim_cpm_alta numeric; v_lim_ctr_min numeric; v_piso numeric; v_lim_freq numeric;
  v_sinal text; v_causa text; v_acao text; v_confirmacao text;
  v_var_custo numeric; v_var_ctr numeric; v_var_cpm numeric; v_var_freq numeric;
begin
  if p_company_id is null or p_ad_external_id is null then
    raise exception 'diagnosticar_custo exige empresa e anuncio';
  end if;

  select valor, piso_de_gasto into v_lim_ctr_min, v_piso from public.limiares_de_midia
   where company_id=p_company_id and metrica='ctr_link' and tipo='absoluto' and operador='<' and vigente limit 1;
  select valor into v_lim_ctr_queda from public.limiares_de_midia
   where company_id=p_company_id and metrica='ctr_link' and tipo='variacao_relativa' and vigente limit 1;
  select valor into v_lim_cpm_alta from public.limiares_de_midia
   where company_id=p_company_id and metrica='cpm' and tipo='variacao_relativa' and vigente limit 1;
  select valor into v_lim_freq from public.limiares_de_midia
   where company_id=p_company_id and metrica='frequencia' and tipo='absoluto' and vigente limit 1;

  -- ultimo dia com entrega
  select snapshot_date, spend, impressions, link_clicks, form_leads, frequency,
         (100.0*link_clicks/nullif(impressions,0)) ctr,
         (1000.0*spend/nullif(impressions,0)) cpm,
         (spend/nullif(form_leads,0)) custo
    into d
    from public.ad_metric_snapshots
   where company_id=p_company_id and ad_external_id=p_ad_external_id and spend>0
   order by snapshot_date desc limit 1;

  if d is null then
    return jsonb_build_object('diagnostico','sem_entrega',
      'motivo','Este anuncio nao tem nenhum dia com gasto. Sem entrega nao ha custo a diagnosticar - e ausencia de dado nao e ausencia de problema.');
  end if;

  -- base: os 3 dias anteriores ao ultimo
  select avg(100.0*link_clicks/nullif(impressions,0)) ctr,
         avg(1000.0*spend/nullif(impressions,0)) cpm,
         avg(spend/nullif(form_leads,0)) custo,
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
      'motivo','Nao ha dias anteriores com entrega para comparar. Variacao exige base; sem ela qualquer conclusao sobre "subiu" seria invencao.');
  end if;

  v_var_custo := case when b.custo > 0 then 100.0*(d.custo - b.custo)/b.custo end;
  v_var_ctr   := case when b.ctr   > 0 then 100.0*(d.ctr   - b.ctr)  /b.ctr   end;
  v_var_cpm   := case when b.cpm   > 0 then 100.0*(d.cpm   - b.cpm)  /b.cpm   end;
  v_var_freq  := case when b.freq  > 0 then 100.0*(d.frequency - b.freq)/b.freq end;

  if coalesce(v_var_custo,0) <= 0 then
    v_sinal := 'Custo por resultado NAO subiu: ' || round(coalesce(v_var_custo,0),1) || '% vs media dos ' || b.dias || ' dias anteriores.';
    v_causa := 'Nada a diagnosticar nesta leitura.';
    v_acao  := 'Nenhuma acao por custo. Se houver outro motivo de preocupacao, ele nao esta neste indicador.';
  elsif v_var_ctr is not null and v_var_ctr <= v_lim_ctr_queda then
    v_sinal := 'Custo subiu ' || round(v_var_custo,1) || '% e o CTR de link caiu ' || round(v_var_ctr,1) || '% (limiar ' || v_lim_ctr_queda || '%).';
    if coalesce(v_var_freq,0) > 0 or d.frequency > coalesce(v_lim_freq,3.5) then
      v_causa := 'FADIGA DE CRIATIVO: o CTR caiu e a frequencia subiu (' || round(coalesce(v_var_freq,0),1) || '%, nivel ' || round(d.frequency::numeric,2) || '). A mesma audiencia ja viu a peca demais, o leilao encarece e o custo sobe por consequencia.';
      v_acao  := 'Trocar o criativo (refresh), nao mexer no orcamento. Orcamento nao conserta peca cansada.';
    else
      v_causa := 'CRIATIVO FRACO, nao fadiga: o CTR caiu sem a frequencia subir. A peca nao esta conversando com o publico, e nao e saturacao.';
      v_acao  := 'Revisar gancho e proposta da peca. Trocar por variacao com angulo diferente, nao por mais do mesmo.';
    end if;
  elsif v_var_cpm is not null and v_var_cpm >= v_lim_cpm_alta then
    v_sinal := 'Custo subiu ' || round(v_var_custo,1) || '%, CTR estavel (' || round(coalesce(v_var_ctr,0),1) || '%) e CPM subiu ' || round(v_var_cpm,1) || '% (limiar ' || v_lim_cpm_alta || '%).';
    v_causa := 'LEILAO MAIS CARO PARA A MESMA AUDIENCIA: sobreposicao entre conjuntos ou publico estreito demais. O criativo nao piorou - a disputa piorou.';
    v_acao  := 'Investigar sobreposicao de publico entre os conjuntos ativos antes de mexer em orcamento ou criativo.';
  else
    v_sinal := 'Custo subiu ' || round(v_var_custo,1) || '% com CTR e CPM dentro dos limiares.';
    v_causa := 'PROBLEMA DEPOIS DO CLIQUE: a peca continua atraindo e o leilao nao encareceu, mas menos gente completa. Pagina, formulario ou qualidade da intencao.';
    v_acao  := 'Olhar a jornada apos o clique. ATENCAO: o que acontece depois do clique esta FORA do escopo deste sistema desde 06/08 - a acao aqui e apontar, nao investigar.';
  end if;

  v_confirmacao := 'Reler este mesmo diagnostico em 3 dias. A causa se confirma se o indicador apontado mudar de direcao apos a acao; se o custo cair sem a causa apontada ter mudado, a leitura estava errada.';

  return jsonb_build_object(
    'anuncio', p_ad_external_id,
    'ultimo_dia', d.snapshot_date,
    'dias_de_base', b.dias,
    'maduro', v_maduro,
    'medidas', jsonb_build_object(
      'custo_por_formulario', jsonb_build_object('hoje', round(d.custo::numeric,2), 'base', round(b.custo::numeric,2), 'variacao_pct', round(v_var_custo,1)),
      'ctr_link_pct', jsonb_build_object('hoje', round(d.ctr::numeric,3), 'base', round(b.ctr::numeric,3), 'variacao_pct', round(v_var_ctr,1)),
      'cpm', jsonb_build_object('hoje', round(d.cpm::numeric,2), 'base', round(b.cpm::numeric,2), 'variacao_pct', round(v_var_cpm,1)),
      'frequencia', jsonb_build_object('hoje', round(d.frequency::numeric,2), 'base', round(b.freq::numeric,2), 'variacao_pct', round(v_var_freq,1))),
    'SINAL', v_sinal,
    'CAUSA', v_causa,
    'ACAO', v_acao,
    'CONFIRMACAO', v_confirmacao,
    'guarda_de_maturacao', case when not v_maduro
      then 'ATENCAO: este anuncio tem apenas ' || v_idade || ' dia(s) com entrega. NAO prescrever pausa por custo antes de 3 dias - objeto em aprendizado tem custo instavel por construcao.'
      else null end,
    'nota', 'Custo por resultado e CONSEQUENTE, nao controlavel direto. A acao age sobre a CAUSA apontada, nunca sobre o custo.'
  );
end;
$$;