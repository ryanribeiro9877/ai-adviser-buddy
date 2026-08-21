-- name: geo_bairros_criar_conjunto
-- data: 2026-08-21
-- efeito:
--   (1) contrato criar_conjunto: campos opcionais geo_locations + bairros
--   (2) agent_context: doutrina — HA campo para bairros; use buscar_geolocalizacao
--   (3) remove afirmacao falsa de ausencia de campo (se houver)

insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado)
values
  ('criar_conjunto_a_partir_de', 'geo_locations', false, 'jsonb',
   'Objeto Meta targeting.geo_locations (neighborhoods/cities/regions/countries/zips/custom_locations/places + location_types). Sobrescreve geo do molde/sem_molde. Items exigem key Meta — resolver nomes com buscar_geolocalizacao. Ate 250 locais. Em credito, neighborhoods/zips sao recusados por checar_segmentacao.',
   'traffic-chat v28.48 / meta-actions v5.33', true, true),
  ('criar_conjunto_a_partir_de', 'bairros', false, 'array',
   'Atalho: array de keys Meta (ou {key,name}) → geo_locations.neighborhoods. Nao misturar com geo_locations no mesmo pedido. Nomes sem key sao recusados.',
   'traffic-chat v28.48 / meta-actions v5.33', true, true)
on conflict do nothing;

-- Doutrina universal: o agente NAO pode dizer que falta campo de bairros.
update public.agent_context
   set vigente = false
 where vigente = true
   and company_id is null
   and categoria = 'doutrina'
   and fato ilike '%nao possui campo%bairro%';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  null,
  'doutrina',
  $fato$
GEO/BAIRROS NO CRIAR_CONJUNTO (21/08/2026). O card criar_conjunto_a_partir_de ACEITA geolocalizacao fina:
(1) Tool buscar_geolocalizacao: nomes → keys Meta (Graph adgeolocation; default neighborhood+BR; lote max 40 — para ~118 bairros chame em lotes e una as keys).
(2) No propose_action: params.bairros = [key,…] OU params.geo_locations = {neighborhoods:[{key,name?}], location_types:['home','recent']}.
(3) O executor (meta-actions) sobrescreve targeting.geo_locations; idade/plataformas do molde permanecem.
(4) PROIBIDO dizer que a API de criacao nao tem campo para bairros individuais — isso era verdade antes de 21/08 e esta SUPERADO.
(5) Fair lending: em empresa de credito, checar_segmentacao ainda recusa neighborhoods/zips; juridico/COHAPM normalmente fora desse gate.
$fato$,
  true,
  '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where vigente = true
    and company_id is null
    and fato ilike 'GEO/BAIRROS NO CRIAR_CONJUNTO (21/08/2026%'
);
