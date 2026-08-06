-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260805204728
-- name: esp10_gate_de_segmentacao_fair_lending
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-10 · gate de segmentacao para categoria especial de credito (tratamento justo).
--
-- O QUE ELE IMPEDE, do CONTRA_2 secao 4.2: em campanha de credito a Meta trava idade (forca
-- 18+) e o gate DEVE REJEITAR idade estreita, exclusao geografica, genero e renda. Estreitar
-- idade e o que restringe conta - e o fato 71 (05/08) registra que o nosso proprio dado
-- FAVORECE uma faixa, o que torna o pedido mais provavel, nao menos.
--
-- CONSTRUIDO CONTRA A FORMA REAL DO TARGETING que o espelho guarda, lida de ad_sets.targeting
-- em 05/08: age_min, age_max, age_range (array), genders (array de inteiros, 0 = todos),
-- geo_locations com countries/cities/places/location_types. Nao inventei campo.
--
-- "E EMPRESA DE CREDITO" E DERIVADO de companies.industry (Legal e Viver = "Credito CLT"), nao
-- de id fixo. Empresa que nao e de credito recebe 'aplica: false' com motivo - o gate DECLARA
-- que nao se aplica em vez de devolver "permitido" e parecer aprovacao.
--
-- UMA INCERTEZA QUE EU DECLARO EM VEZ DE INVENTAR: a Meta impoe raio minimo para segmentacao
-- geografica em categoria especial, e eu NAO sei o valor vigente. Raio pequeno sai como ATENCAO
-- com essa ressalva, nunca como bloqueio com numero chutado.
--
-- ISTO E PRE-CHECAGEM, NAO SUBSTITUTO DA META: a plataforma tambem recusa. O ganho e nao gastar
-- aprovacao do gestor num card que morreria, e nao acumular tentativa de segmentacao injusta
-- no historico da conta.

create or replace function public.checar_segmentacao(p_company_id uuid, p_targeting jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_industry text; v_credito boolean;
  v_viol text[] := '{}'; v_aten text[] := '{}';
  v_age_min int; v_age_max int; v_generos jsonb; v_geo jsonb; v_excl jsonb;
  v_raio_min numeric;
begin
  if p_company_id is null then
    raise exception 'checar_segmentacao exige p_company_id';
  end if;

  select industry into v_industry from public.companies where id = p_company_id;
  v_credito := coalesce(v_industry,'') ~* 'cr[eé]dito|consignado|fintech|emprestimo|empr[eé]stimo';

  if not v_credito then
    return jsonb_build_object('aplica', false, 'industry', coalesce(v_industry,'(sem industry)'),
      'motivo', 'Esta empresa nao esta cadastrada como de credito, entao o gate de tratamento justo NAO se aplica a ela. Isto nao e aprovacao da segmentacao: e ausencia de jurisdicao deste gate.');
  end if;

  if p_targeting is null or p_targeting = '{}'::jsonb then
    return jsonb_build_object('aplica', true, 'permitido', null,
      'motivo', 'Nenhuma segmentacao informada. Nao ha o que avaliar - e ausencia de dado nao e conformidade.');
  end if;

  v_age_min := nullif(p_targeting->>'age_min','')::int;
  v_age_max := nullif(p_targeting->>'age_max','')::int;
  v_generos := p_targeting->'genders';
  v_geo     := p_targeting->'geo_locations';
  v_excl    := p_targeting->'excluded_geo_locations';

  -- 1) idade estreita
  if v_age_min is not null and v_age_min > 18 then
    v_viol := array_append(v_viol, 'idade minima ' || v_age_min || ': em credito a idade nao pode ser estreitada, a Meta forca 18+');
  end if;
  if v_age_max is not null and v_age_max < 65 then
    v_viol := array_append(v_viol, 'idade maxima ' || v_age_max || ': idade estreitada para cima tambem e estreitamento');
  end if;
  if p_targeting ? 'age_range' and jsonb_array_length(p_targeting->'age_range') = 2 then
    if (p_targeting->'age_range'->>0)::int > 18 or (p_targeting->'age_range'->>1)::int < 65 then
      v_viol := array_append(v_viol, 'age_range ' || (p_targeting->'age_range')::text || ': faixa de idade estreitada');
    end if;
  end if;

  -- 2) genero (0 = todos; qualquer lista sem o 0 e segmentacao por genero)
  if v_generos is not null and jsonb_typeof(v_generos) = 'array'
     and jsonb_array_length(v_generos) > 0
     and not (v_generos @> '[0]'::jsonb) then
    v_viol := array_append(v_viol, 'genders ' || v_generos::text || ': segmentar por genero e proibido em credito');
  end if;

  -- 3) exclusao geografica
  if v_excl is not null and v_excl <> '{}'::jsonb then
    v_viol := array_append(v_viol, 'excluded_geo_locations presente: excluir regiao funciona como proxy de renda ou raca e e proibido');
  end if;

  -- 4) CEP e bairro
  if v_geo is not null and (v_geo ? 'zips') and jsonb_array_length(coalesce(v_geo->'zips','[]'::jsonb)) > 0 then
    v_viol := array_append(v_viol, 'geo_locations.zips presente: segmentar por CEP e proxy proibido em credito');
  end if;
  if v_geo is not null and (v_geo ? 'neighborhoods') and jsonb_array_length(coalesce(v_geo->'neighborhoods','[]'::jsonb)) > 0 then
    v_viol := array_append(v_viol, 'geo_locations.neighborhoods presente: segmentar por bairro e proxy proibido em credito');
  end if;

  -- 5) renda
  if p_targeting::text ~* '"(income|renda|household_income|net_worth)"' then
    v_viol := array_append(v_viol, 'segmentacao por renda ou patrimonio detectada no targeting: proibida em credito');
  end if;

  -- ATENCAO: raio pequeno. Valor minimo da Meta desconhecido - declarado, nao chutado.
  select min((c->>'radius')::numeric) into v_raio_min
    from jsonb_array_elements(coalesce(v_geo->'cities','[]'::jsonb)) c
   where c ? 'radius';
  if v_raio_min is not null and v_raio_min < 25 then
    v_aten := array_append(v_aten, 'raio de cidade de ' || v_raio_min ||
      ' - a Meta impoe raio minimo em categoria especial e eu NAO sei o valor vigente; confirmar antes de usar raio pequeno');
  end if;

  return jsonb_build_object(
    'aplica', true,
    'industry', v_industry,
    'permitido', (array_length(v_viol,1) is null),
    'violacoes', to_jsonb(coalesce(v_viol,'{}')),
    'atencoes', to_jsonb(coalesce(v_aten,'{}')),
    'mensagem_para_o_gestor', case when array_length(v_viol,1) is null
      then null
      else 'NAO emiti o card: esta segmentacao seria recusada em campanha de credito e tentativas assim acumulam risco na conta. '
           || 'Se o motivo for que uma faixa converte mais barato, o caminho legitimo e usar esse sinal para escolher criativo, '
           || 'angulo e linguagem, mantendo o publico amplo para o sistema da Meta encontrar essas pessoas.' end,
    'nota', 'Pre-checagem. A Meta tambem recusa; o ganho aqui e nao gastar aprovacao do gestor num card que morreria e nao acumular tentativa de segmentacao injusta no historico da conta.'
  );
end;
$$;