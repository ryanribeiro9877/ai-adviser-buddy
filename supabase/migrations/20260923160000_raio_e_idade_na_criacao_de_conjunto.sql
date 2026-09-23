-- 23/09/2026. O card de conjunto do ocular nao saia.
--
-- 1) "orçamento de 30,00 e idade 35-75" virava contrato de R$ 75 e
--    propose_action recusava orcamento_diferente_do_contrato. O extrator
--    ignora faixa de idade (codigo). A ferramenta passa a dizer isso.
-- 2) buscar_geolocalizacao so devolvia key de bairro. Raio de 1 km precisa
--    de latitude/longitude. raio_km passa a devolver custom_locations.
-- 3) idade_max acima de 65 no criar_conjunto entra como 65 e o card sai.

update public.agent_ferramentas
   set descricao = $d$Resolve NOMES de bairro, cidade ou regiao para KEYS da Meta (Graph /search type=adgeolocation). Chame ANTES de criar_conjunto ou alterar_geo_do_conjunto. Para cidades da RMS use tipo=city (nao neighborhood). Para RAIO em km (ex. 1 km ao redor do CAB) passe raio_km: a resposta traz geo_locations_sugerido.custom_locations com latitude, longitude e radius. A key de bairro NAO e circulo — nao cole a key no lugar do raio. Lote maximo de 40 nomes por chamada (8 quando ha raio_km). Default tipo=neighborhood, country_code=BR. NAO cria conjunto e NUNCA diga que falta campo de bairros ou de cidades.$d$,
       parametros = $p${"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"},"description":"Lista de nomes (ate 40 por chamada; 8 se raio_km)."},"tipo":{"type":"string","description":"neighborhood|city|region|zip (default neighborhood). Ignorado como alvo do card quando raio_km vem preenchido."},"country_code":{"type":"string","description":"Default BR."},"cidade_contexto":{"type":"string","description":"Opcional: filtra ambiguidade (ex. Salvador)."},"regiao_contexto":{"type":"string","description":"Opcional: estado (ex. Bahia)."},"raio_km":{"type":"number","description":"Raio em km ao redor do nome (minimo 1, maximo 80). Quando vier, use geo_locations_sugerido.custom_locations no card. Nao use a key do bairro."}},"required":["nomes"]}$p$::jsonb,
       doutrina = case
         when coalesce(doutrina, '') like '%raio_km%' then doutrina
         else coalesce(doutrina, '') || $n$

Raio: passe raio_km (ex. 1) junto com nomes e cidade_contexto. Copie geo_locations_sugerido inteiro para params.geo_locations do criar_conjunto. Esse objeto e custom_locations (latitude, longitude, radius, distance_unit=kilometer). A key em resolvidos cobre o poligono do bairro e nao substitui o circulo. Cabula VI nao e o CAB.$n$
       end,
       atualizado_em = now()
 where chave = 'buscar_geolocalizacao';

update public.agent_ferramentas
   set parametros = jsonb_set(
         parametros,
         '{properties,params,description}',
         to_jsonb($desc$Campos da acao. alvo_external_id: id da Meta do objeto alvo, quando o nome nao for unico. Nome livre em nome / nome_novo / novo_nome. GEO no criar_conjunto E no alterar_geo_do_conjunto: params.cidades, params.bairros ou params.geo_locations, com as keys de buscar_geolocalizacao. RAIO: buscar_geolocalizacao com raio_km e params.geo_locations = geo_locations_sugerido (custom_locations com latitude/longitude/radius). Key de bairro nao e circulo. PUBLICO no alterar_publico_do_conjunto: params.interesses [{id,name}] de buscar_interesses; params.advantage_audience 0|1 (padrao 0). IDADE no criar_conjunto e no alterar_idade_do_conjunto: params.idade_min e params.idade_max. Acima de 65 o card SAI com teto 65 (aviso_idade); nao recuse a emissao por causa do teto. Faixa estreita desliga Advantage+. O numero ao lado de idade nao e orcamento. alterar_orcamento: params.novo_orcamento_diario_reais em REAIS/dia (alias: orcamento_diario_reais). CONJ.N no nome nao e dinheiro. Preferir a tool dedicada.$desc$::text)
       ),
       doutrina = case
         when coalesce(doutrina, '') like '%aviso_idade%' then doutrina
         else coalesce(doutrina, '') || $n$

CRIAR CONJUNTO COM RAIO E IDADE: chame buscar_geolocalizacao com raio_km e use o custom_locations devolvido. Passe params.idade_min e params.idade_max mesmo se o gestor pedir acima de 65 — o servidor limita a 65 e devolve aviso_idade; o card tem de sair. Orcamento e so o valor ao lado da palavra orcamento, em reais (30, nao 75 da idade, nao 3000 centavos).$n$
       end,
       atualizado_em = now()
 where chave = 'propose_action';
