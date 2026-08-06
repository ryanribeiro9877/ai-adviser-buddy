-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806162713
-- name: portao_com_tolerancia_e_janela_derivada
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CORRECAO DO PORTAO · duas falhas de desenho minhas, as duas achadas na primeira corrida real.
--
-- FALHA 1 - IGUALDADE EXATA SOBRE FONTE MUTAVEL. Eu exigi gasto, impressoes e alcance identicos
-- entre os dois coletores. Mas a Meta REESCREVE dias passados - isso esta na nossa propria
-- doutrina ("86% de cada corrida e reescrita") e eu nao apliquei. Medido em 06/08 nos 3 anuncios
-- de 05/08: Pipeboard SEMPRE maior, nunca menor (gasto +0,19 a +0,50; impressoes +3 a +10;
-- alcance +1 a +6), e form_leads e link_clicks IDENTICOS nos tres. Delta unidirecional com
-- conversao igual e assinatura de reescrita da plataforma, nao de discordancia de metrica.
-- Um portao de igualdade exata sobre isso nunca abriria.
--
-- FALHA 2 - JANELA ERRADA. so_na_real acusava 12 ausencias de 01 a 04/08, dias em que o coletor
-- paralelo nem existia. Comparar periodo anterior ao inicio do paralelo e comparar com o vazio.
--
-- O CONSERTO, e a assimetria e deliberada:
--   EXATO em form_leads e link_clicks - sao eles que alimentam a regua de custo por formulario,
--     o evaluate_alerts e o evaluate_winners. Divergencia ali muda decisao, e nao ha tolerancia
--     aceitavel para isso.
--   TOLERANCIA em gasto, impressoes e alcance - a plataforma revisa esses numeros, e exigir
--     igualdade seria exigir que a Meta parasse de fazer o que ela faz.
--   JANELA DERIVADA DO DADO, nao do chamador: do primeiro dia que o paralelo escreveu ate
--     current_date - 3, porque dia recente ainda esta sendo reescrito. A assinatura antiga
--     (uuid, date, date) e REMOVIDA de proposito: deixar quem chama escolher o periodo e deixar
--     abrir o portao escolhendo a janela conveniente.
--   DIRECAO DO DELTA reportada: delta sempre no mesmo sentido e evidencia de reescrita; delta
--     com sinal alternado seria evidencia de discordancia real. Sao diagnosticos diferentes e o
--     portao passa a dizer qual dos dois esta vendo.

drop function if exists public.comparar_coletores(uuid, date, date);

create or replace function public.comparar_coletores(p_company_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_inicio date; v_fim date; v_tol numeric := 1.0; v_v jsonb;
  v_pares int; v_div_exata int; v_div_tol int; v_pos int; v_neg int;
begin
  if p_company_id is null then
    raise exception 'comparar_coletores exige p_company_id';
  end if;

  select min(snapshot_date) into v_inicio from public.ad_metric_snapshots_paralelo
   where company_id = p_company_id;
  v_fim := current_date - 3;

  if v_inicio is null then
    return jsonb_build_object('portao','FECHADO',
      'motivo','O coletor paralelo nunca escreveu. Ausencia de paralelo nao e concordancia.');
  end if;

  if v_inicio > v_fim then
    return jsonb_build_object('portao','FECHADO',
      'janela', jsonb_build_object('primeiro_dia_do_paralelo', v_inicio, 'ultimo_dia_estavel', v_fim),
      'motivo','O paralelo comecou em ' || v_inicio || ' e o ultimo dia considerado estavel e ' || v_fim ||
               '. Ainda nao existe NENHUM dia maduro coletado pelos dois. Dia recente segue sendo reescrito pela Meta; comparar agora mediria a reescrita, nao os coletores. Aguardar.',
      'quando_reavaliar', v_inicio + 3);
  end if;

  with par as (
    select r.ad_external_id, r.snapshot_date,
           r.spend gr, p.spend gp, r.impressions ir, p.impressions ip,
           r.reach ar, p.reach ap,
           coalesce(r.form_leads,0) fr, coalesce(p.form_leads,0) fp,
           coalesce(r.link_clicks,0) lr, coalesce(p.link_clicks,0) lp
    from public.ad_metric_snapshots r
    join public.ad_metric_snapshots_paralelo p
      on p.ad_external_id = r.ad_external_id and p.snapshot_date = r.snapshot_date
    where r.company_id = p_company_id and r.snapshot_date between v_inicio and v_fim
  ),
  julgado as (
    select *,
      (fr <> fp or lr <> lp) as falha_exata,
      (abs(gp - gr) > greatest(gr * v_tol/100.0, 0.50)
       or abs(ip - ir) > greatest(ir * v_tol/100.0, 20)) as falha_tolerancia,
      sign(gp - gr) as direcao
    from par
  )
  select count(*), count(*) filter (where falha_exata), count(*) filter (where falha_tolerancia),
         count(*) filter (where direcao > 0), count(*) filter (where direcao < 0)
    into v_pares, v_div_exata, v_div_tol, v_pos, v_neg
  from julgado;

  select jsonb_build_object(
    'janela', jsonb_build_object('de', v_inicio, 'ate', v_fim,
       'nota','Derivada do dado, nao do chamador: do primeiro dia do paralelo ate current_date-3, porque dia recente ainda e reescrito pela Meta.'),
    'tolerancia_pct', v_tol,
    'pares_comparados', v_pares,
    'divergencia_em_conversao_EXATO', v_div_exata,
    'divergencia_em_volume_fora_da_tolerancia', v_div_tol,
    'direcao_do_delta', jsonb_build_object('pipeboard_maior', v_pos, 'pipeboard_menor', v_neg,
       'leitura', case
          when v_pos > 0 and v_neg = 0 then 'Delta UNIDIRECIONAL (Pipeboard sempre maior): assinatura de reescrita da plataforma entre as duas leituras, nao de discordancia de metrica.'
          when v_neg > 0 and v_pos = 0 then 'Delta unidirecional invertido: o Pipeboard le MENOS que o Windsor de forma sistematica. Isso NAO se explica por reescrita e precisa de causa antes de qualquer decisao.'
          when v_pos > 0 and v_neg > 0 then 'Delta com sinal ALTERNADO: nao e reescrita. Sugere definicao ou janela de atribuicao diferente entre os coletores - investigar antes de abrir o portao.'
          else 'Sem delta de gasto.' end),
    'ausentes_no_paralelo', coalesce((select jsonb_agg(jsonb_build_object('ad', ad_external_id,'dia', snapshot_date))
       from (select r.ad_external_id, r.snapshot_date from public.ad_metric_snapshots r
              where r.company_id = p_company_id and r.snapshot_date between v_inicio and v_fim
                and not exists (select 1 from public.ad_metric_snapshots_paralelo p
                                 where p.ad_external_id = r.ad_external_id and p.snapshot_date = r.snapshot_date)
              limit 20) a), '[]'::jsonb),
    'ausentes_na_real', coalesce((select jsonb_agg(jsonb_build_object('ad', ad_external_id,'dia', snapshot_date))
       from (select p.ad_external_id, p.snapshot_date from public.ad_metric_snapshots_paralelo p
              where p.company_id = p_company_id and p.snapshot_date between v_inicio and v_fim
                and not exists (select 1 from public.ad_metric_snapshots r
                                 where r.ad_external_id = p.ad_external_id and r.snapshot_date = p.snapshot_date)
              limit 20) b), '[]'::jsonb),
    'portao', case when v_pares > 0 and v_div_exata = 0 and v_div_tol = 0
                    and not exists (select 1 from public.ad_metric_snapshots r
                                     where r.company_id = p_company_id and r.snapshot_date between v_inicio and v_fim
                                       and not exists (select 1 from public.ad_metric_snapshots_paralelo p
                                                        where p.ad_external_id = r.ad_external_id and p.snapshot_date = r.snapshot_date))
                   then 'ABERTO' else 'FECHADO' end,
    'regra', 'ABRE com: pelo menos um dia maduro comparado, ZERO divergencia em form_leads e link_clicks, volume dentro de 1% (piso de R$0,50 e 20 impressoes) e nenhum anuncio ausente de um dos lados. Conversao NAO tem tolerancia porque e ela que move a regua, os alertas e os vencedores.'
  ) into v_v;

  return v_v;
end;
$$;