-- name: geo_preset_juridico_salvador
-- data: 2026-08-21
-- efeito:
--   (1) tabela geo_targeting_presets (company+meio) com lista canônica Salvador–BA
--   (2) seed COHAPM meio=juridico (134 bairros) — La Felicità NÃO herda
--   (3) doutrina agent_context: preset obrigatório SÓ no Jurídico
--   (4) atualiza doutrina GEO/BAIRROS universal (não confundir com preset Jurídico)

create table if not exists public.geo_targeting_presets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meio text not null check (meio in ('juridico', 'la_felicita')),
  city text not null default 'Salvador',
  region text not null default 'Bahia',
  region_code text not null default 'BA',
  country_code text not null default 'BR',
  nomes_oficiais text[] not null,
  keys_meta jsonb,
  falhas_resolucao jsonb,
  keys_resolvidas_em timestamptz,
  vigente boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint geo_targeting_presets_meio_city check (length(trim(city)) > 0)
);

create unique index if not exists geo_targeting_presets_one_vigente
  on public.geo_targeting_presets (company_id, meio)
  where vigente = true;

comment on table public.geo_targeting_presets is
  'Presets geográficos por empresa+meio. COHAPM/juridico = Salvador–BA obrigatório. La Felicità tem linha própria (ou nenhuma) — NÃO herda a lista do Jurídico. Legal é Viver não usa esta tabela.';

comment on column public.geo_targeting_presets.keys_meta is
  'Cache de keys Meta validadas (Salvador+Bahia). Itens: {key,name,query,primary_city,region,country_code}.';

alter table public.geo_targeting_presets enable row level security;

drop policy if exists geo_targeting_presets_deny_clients on public.geo_targeting_presets;
create policy geo_targeting_presets_deny_clients
  on public.geo_targeting_presets
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.geo_targeting_presets from public, anon, authenticated;
grant select, insert, update, delete on table public.geo_targeting_presets to service_role;

-- Seed COHAPM Jurídico (idempotente: desativa vigentes e reinsere)
update public.geo_targeting_presets
   set vigente = false, updated_at = now()
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and meio = 'juridico'
   and vigente = true;

insert into public.geo_targeting_presets
  (company_id, meio, city, region, region_code, country_code, nomes_oficiais, vigente)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'juridico',
  'Salvador',
  'Bahia',
  'BA',
  'BR',
  ARRAY[
    'Acupe',
    'Águas Claras',
    'Alto da Terezinha',
    'Alto das Pombas',
    'Alto do Cabrito',
    'Alto do Coqueirinho',
    'Areia Branca',
    'Arenoso',
    'Arraial do Retiro',
    'Bairro da Paz',
    'Barreiras',
    'Beiru/Tancredo Neves',
    'Boa Viagem',
    'Boa Vista de Brotas',
    'Boa Vista de São Caetano',
    'Boca da Mata',
    'Bom Juá',
    'Bonfim',
    'Cabula VI',
    'Caixa D''Água',
    'Cajazeiras',
    'Cajazeiras II',
    'Cajazeiras IV',
    'Cajazeiras V',
    'Cajazeiras VI',
    'Cajazeiras VII',
    'Cajazeiras VIII',
    'Cajazeiras X',
    'Cajazeiras XI',
    'Calabar',
    'Calabetão',
    'Calçada',
    'Caminho de Areia',
    'Campinas de Pirajá',
    'Canabrava',
    'Candeal',
    'Capelinha',
    'Cassange',
    'Castelo Branco',
    'Chapada do Rio Vermelho',
    'Cidade Nova',
    'Colinas de Periperi',
    'Cosme de Farias',
    'Coutos',
    'Curuzu',
    'Dom Avelar',
    'Doron',
    'Engenho Velho da Federação',
    'Engenho Velho de Brotas',
    'Engomadeira',
    'Escada',
    'Fazenda Coutos',
    'Fazenda Grande do Retiro',
    'Fazenda Grande I',
    'Fazenda Grande II',
    'Fazenda Grande III',
    'Fazenda Grande IV',
    'Federação',
    'Garcia',
    'Granjas Rurais Presidente Vargas',
    'IAPI',
    'Ilha Amarela',
    'Ilha de Bom Jesus dos Passos',
    'Ilha de Maré',
    'Itacaranha',
    'Itapuã por microárea',
    'Itinga',
    'Jardim Cajazeiras',
    'Jardim das Margaridas',
    'Jardim Nova Esperança',
    'Jardim Santo Inácio',
    'Lapinha',
    'Liberdade',
    'Lobato',
    'Luiz Anselmo',
    'Mangueira',
    'Marechal Rondon',
    'Mares',
    'Massaranduba',
    'Mata Escura',
    'Matatu',
    'Mirantes de Periperi',
    'Monte Serrat',
    'Moradas da Lagoa',
    'Mussurunga',
    'Narandiba',
    'Nordeste de Amaralina',
    'Nova Brasília',
    'Nova Constituinte',
    'Nova Esperança',
    'Nova Sussuarana',
    'Novo Horizonte',
    'Novo Marotinho',
    'Palestina',
    'Paripe',
    'Pau da Lima',
    'Pau Miúdo',
    'Periperi',
    'Pernambués',
    'Pero Vaz',
    'Pirajá',
    'Plataforma',
    'Porto Seco Pirajá',
    'Praia Grande',
    'Resgate',
    'Retiro',
    'Ribeira',
    'Rio Sena',
    'Roma',
    'Saboeiro',
    'Santa Cruz',
    'Santa Luzia',
    'Santa Mônica',
    'Santo Agostinho',
    'São Caetano',
    'São Cristóvão',
    'São Gonçalo do Retiro',
    'São João do Cabrito',
    'São Marcos',
    'São Rafael',
    'São Tomé de Paripe',
    'Saramandaia',
    'Saúde',
    'Sete de Abril',
    'Sussuarana',
    'Tororó',
    'Trobogy',
    'Uruguai',
    'Vale das Pedrinhas',
    'Vale dos Lagos',
    'Valéria',
    'Vila Canária',
    'Vila Ruy Barbosa/Jardim Cruzeiro',
    'Vista Alegre'
  ]::text[],
  true
);

-- Doutrina universal: campo geo existe; preset obrigatório é SÓ Jurídico COHAPM.
update public.agent_context
   set vigente = false
 where vigente = true
   and company_id is null
   and categoria = 'doutrina'
   and fato ilike 'GEO/BAIRROS NO CRIAR_CONJUNTO (21/08/2026%';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  null,
  'doutrina',
  $fato$
GEO/BAIRROS NO CRIAR_CONJUNTO (21/08/2026, rev. preset). O card criar_conjunto_a_partir_de ACEITA geolocalizacao fina via params.bairros / params.geo_locations (keys Meta; tool buscar_geolocalizacao). Executor sobrescreve targeting.geo_locations.
EXCECAO COHAPM JURIDICO: ha preset obrigatorio Salvador–BA (tabela geo_targeting_presets, meio=juridico). Default automatico; qualquer geo diferente e REJEITADA. La Felicità NÃO herda. Outras empresas do portfolio NÃO herdam. Detectar meio por params.meio ou nome da campanha/conjunto (JURIDICO/JUR_ vs LAFELICITA/LF_).
$fato$,
  true,
  '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where vigente = true
    and company_id is null
    and fato ilike 'GEO/BAIRROS NO CRIAR_CONJUNTO (21/08/2026, rev. preset)%'
);

-- Doutrina específica COHAPM (company_id)
update public.agent_context
   set vigente = false
 where vigente = true
   and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and categoria = 'doutrina'
   and (
     fato ilike '%geo%bairro%'
     or fato ilike '%GEO PRESET%'
     or fato ilike '%geolocalizacao%juridico%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'doutrina',
  $fato$
GEO PRESET JURIDICO SALVADOR–BA (21/08/2026) — EXCLUSIVO DO MEIO JURIDICO.
(1) Fonte: public.geo_targeting_presets (company COHAPM, meio=juridico, city=Salvador, region=Bahia). ~134 bairros canônicos.
(2) Em criar_conjunto_a_partir_de do JURIDICO: se o agente/gestor NÃO passar geo → o sistema INJETA automaticamente as keys Meta do preset. Se passar bairros/geo_locations → só aceita se for EXATAMENTE o mesmo conjunto de keys do preset (ordem irrelevante). Qualquer outra geolocalização é REJEITADA com erro claro.
(3) Duplo check: buscar_geolocalizacao no contexto Jurídico força cidade_contexto=Salvador + filtro Bahia; matches fora de Salvador–BA são descartados (nunca incluir key de outro município/UF).
(4) La Felicità: NÃO usa este preset nem esta rejeição — tem configuração própria (ainda não neste seed). Nunca misture JUR e LF.
(5) Legal é Viver: company_id distinto; NÃO herda esta lista.
(6) Detectar meio: params.meio=juridico|la_felicita OU tokens no nome da campanha/conjunto (JURIDICO, JUR_, CJ_INSS vs LAFELICITA, LF_). Se ambíguo JUR+LF no mesmo pedido, NÃO aplique o preset (proteção LF).
(7) PROIBIDO dizer que geo do Jurídico é livre / manual só no Ads Manager / “escolha qualquer bairro”.
$fato$,
  true,
  '2026-08-21'
);

-- Contrato: nota de que no Jurídico COHAPM o campo vira efetivamente obrigatório via default.
update public.contrato_de_execucao
   set observacao = observacao || ' COHAPM meio=juridico: default automatico do preset Salvador–BA; geo diferente do preset e rejeitada. La Felicita nao herda.'
 where acao = 'criar_conjunto_a_partir_de'
   and campo in ('geo_locations', 'bairros')
   and vigente = true
   and observacao not ilike '%COHAPM meio=juridico%';
