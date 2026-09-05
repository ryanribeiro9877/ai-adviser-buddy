-- Os recortes de midia voltam a ser coletados, e desta vez entram no registro
-- (05/09/2026)
--
-- O QUE ESTAVA QUEBRADO. public.metric_breakdown_daily parou em 13/08/2026, quando a Windsor
-- foi encerrada. Ficou 23 dias parada sem um alarme, e o digest continuou afirmando NO PRESENTE
-- que o sistema "tem" recorte por idade e genero. Duas causas somadas, e as duas precisam de
-- conserto ou o caso se repete:
--   1. nao havia coletor vivo para esse dado;
--   2. nao havia TAREFA declarada para ele. O vigia de frescor criado em 20260905090000 e
--      guiado pelo registro, e registro que nao existe nao pode ser vigiado. Devolver o dado
--      sem declarar a tarefa devolveria tambem o ponto cego.
--
-- O QUE FOI MEDIDO ANTES (05/09/2026, pelo proxy pipeboard-read, requests 10627 a 10637):
--   - tools/list: o conector expoe 121 ferramentas, 59 alcancaveis. `get_insights` aceita
--     `breakdown` no schema; `bulk_get_insights` aceita `breakdown` E `fields`.
--   - breakdown=age / gender / publisher_platform devolvem o valor DENTRO de metrics, com a
--     mesma grafia que a Windsor gravava ("18-24".."65+", "female"/"male"). Nenhum leitor da
--     tabela precisa de tradutor, e nenhuma linha antiga precisa de migracao.
--   - A primeira coleta real (request 10637, janela de um dia) gravou 520 linhas em 64
--     anuncios: 290 de idade, 128 de genero e 102 de plataforma. A Windsor cobria 18 anuncios.
--   - Os tres rankings de qualidade tem origem DIFERENTE, e a diferenca e o motivo de eles
--     terem parado em 30/07 sem ninguem notar: `get_insights` nao tem `fields` no schema, entao
--     a lista que pipeboard-metrics-sync monta era descartada em silencio e o conjunto fixo do
--     get_insights nao traz ranking. Por isso `pipeboard:meta` gravou 1.066 linhas com ranking
--     NULO em todas. `bulk_get_insights` devolve os tres (request 10634) — e devolve "UNKNOWN",
--     que e a resposta da Meta para anuncio sem volume para classificar, nao uma falha nossa.
--     O conserto ficou na edge dona de ad_metric_snapshots, que ja e vigiada; aqui nao entra.
--
-- O QUE ESTA MIGRATION FAZ:
--   1. declara `recortes-pipeboard` em tarefas_agendadas, com destino, carimbo e tolerancia, e
--      agenda o cron;
--   2. fecha as tres coletas que o vigia listou como SEM REGISTRO — estrutura-campanhas,
--      estrutura-conjuntos e estrutura-anuncios;
--   3. confere, no fim, que o vigia passou a enxergar as quatro.
--
-- ESCOPO DECLARADO DO QUE NAO FOI CONSERTADO. A coleta funciona em 6 das 20 contas. As outras
-- 14 voltam "This API token does not have access to account(s): ... this allowlist comes from
-- the connected Facebook login that is currently routing this request". Isso NAO e desta
-- entrega e nao e novo: `metricas-pipeboard` falha nas mesmas 14 contas hoje de manha (request
-- 10600). Fica registrado aqui porque a coleta de recorte nasce com a mesma limitacao, e um
-- relatorio que diga "recorte restaurado" sem essa frase seria a mesma meia-verdade que esta
-- serie de entregas vem desfazendo.

begin;

-- ============================================================================
-- 1. GUARDA: nao se declara no registro uma coleta que ninguem provou
-- ============================================================================
-- Declarar tarefa para um coletor que nao grava seria trocar um ponto cego por um alarme
-- permanente — e um vigia que grita todo dia e um vigia que ninguem le. A prova exigida e a
-- mais direta possivel: linha na tabela de destino com a fonte do coletor novo.
do $guarda$
declare
  v_linhas int;
  v_tipos  int;
  v_faltando text;
begin
  select count(*), count(distinct tipo_recorte)
    into v_linhas, v_tipos
    from public.metric_breakdown_daily
   where fonte = 'pipeboard:meta';

  if v_linhas = 0 then
    raise exception 'pipeboard-breakdowns-sync nunca gravou em metric_breakdown_daily: '
      'publique e rode a edge antes de declarar a tarefa, senao o registro promete um dado '
      'que nao chega e o vigia alarma todo dia';
  end if;
  if v_tipos < 3 then
    raise exception 'a coleta trouxe % tipo(s) de recorte; esperados 3 (idade, genero, plataforma)', v_tipos;
  end if;

  -- O vigia le tabela_destino/coluna_carimbo por nome e monta SQL dinamico. Nome errado aqui
  -- vira tarefa "nao vigiada" em silencio, que e exatamente o estado que estamos fechando.
  select string_agg(x.t || '.' || x.c, ', ')
    into v_faltando
    from (values ('metric_breakdown_daily','created_at'),
                 ('campaigns','last_synced_at'),
                 ('ad_sets','last_synced_at'),
                 ('ads','last_synced_at')) as x(t, c)
   where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = 'public'
                        and ic.table_name = x.t and ic.column_name = x.c);
  if v_faltando is not null then
    raise exception 'destino declarado que nao existe: %', v_faltando;
  end if;

  raise notice 'guarda ok: % linhas em % tipos de recorte pela fonte nova', v_linhas, v_tipos;
end;
$guarda$;

-- ============================================================================
-- 2. A TAREFA DE RECORTES ENTRA NO REGISTRO
-- ============================================================================
-- chave_chamador FICA NULA de proposito. As outras duas edges do Pipeboard usam chave nomeada
-- em mcp_api_keys, e o padrao e melhor; mas criar a chave exige gerar um segredo, e segredo
-- gerado dentro de migration vira segredo versionado no git. Com chave nula, disparar_tarefa_http
-- usa a chave de mcp_config — o mesmo caminho de `digest-por-email`, e o caminho pelo qual a
-- coleta foi provada (request 10637). Nomear o chamador depois e uma troca de uma linha.
--
-- janela_dias = 2 (tres dias por rodada) porque numero de midia da Meta ainda se acerta por
-- ate ~72h: coletar so ontem congelaria o dado na primeira leitura, que costuma ser a mais
-- baixa. O upsert e por (anuncio, dia, tipo, valor), entao reler o mesmo dia corrige em vez
-- de duplicar.
insert into public.tarefas_agendadas (
  tarefa, titulo, pergunta, tipo, edge, chave_chamador, modo_auth, corpo,
  timeout_ms, janela_dias, periodicidade, tolerancia_horas,
  tabela_destino, coluna_carimbo, natureza, tolerancia_frescor_horas, ativa, observacao
) values (
  'recortes-pipeboard',
  'Recortes diarios de midia',
  'Qual faixa de idade, qual genero e qual plataforma respondem melhor a cada anuncio?',
  'http',
  'pipeboard-breakdowns-sync',
  null,
  'x-mcp-key',
  jsonb_build_object('date_from', '@data_inicio', 'date_to', '@data_fim'),
  150000,
  2,
  'diaria',
  30,
  'metric_breakdown_daily',
  'created_at',
  'coleta',
  30,
  true,
  'Substitui a coleta que a Windsor fazia ate 13/08/2026. Recortes: age->idade, '
  || 'gender->genero, publisher_platform->plataforma. Escreve so em metric_breakdown_daily; '
  || 'os rankings de qualidade sao de ad_metric_snapshots e pertencem a metricas-pipeboard.'
)
on conflict (tarefa) do update set
  titulo                   = excluded.titulo,
  pergunta                 = excluded.pergunta,
  tipo                     = excluded.tipo,
  edge                     = excluded.edge,
  modo_auth                = excluded.modo_auth,
  corpo                    = excluded.corpo,
  timeout_ms               = excluded.timeout_ms,
  janela_dias              = excluded.janela_dias,
  periodicidade            = excluded.periodicidade,
  tolerancia_horas         = excluded.tolerancia_horas,
  tabela_destino           = excluded.tabela_destino,
  coluna_carimbo           = excluded.coluna_carimbo,
  natureza                 = excluded.natureza,
  tolerancia_frescor_horas = excluded.tolerancia_frescor_horas,
  ativa                    = true,
  observacao               = excluded.observacao;

-- 09:45 UTC (06:45 em Sao Paulo): depois de `pipeboard-metrics-daily` (09:00), que traz o
-- universo de anuncios do dia, e 25 minutos antes de `vigia-frescor-1010`, que vai conferir se
-- este dado chegou. A ordem importa: vigia que roda antes do coletor acusa atraso que nao
-- existe, e alarme falso diario e o comeco do habito de ignorar alarme.
select cron.schedule(
  'pipeboard-breakdowns-daily',
  '45 9 * * *',
  $cron$select public.disparar_tarefa_http('recortes-pipeboard');$cron$);

-- ============================================================================
-- 3. AS TRES COLETAS DE ESTRUTURA SAEM DE "NAO VIGIADA"
-- ============================================================================
-- O vigia de 20260905090000 listou estas tres por nome, sob "SEM REGISTRO", porque nenhuma
-- declarava destino. Elas apontam para a MESMA edge (pipeboard-structure-sync) com `level`
-- diferente no corpo, e cada nivel grava numa tabela propria — entao cada tarefa tem destino
-- proprio e nao ha ambiguidade de tabela compartilhada a resolver com filtro.
--
-- A COLUNA DE CARIMBO E last_synced_at, NAO created_at. O upsert e por
-- (provider, external_id): campanha que ja existe nao ganha created_at novo, e uma tabela cujo
-- max(created_at) e do dia em que a campanha nasceu ficaria "velha" para sempre depois que a
-- conta parasse de criar campanha — alarme falso permanente. last_synced_at e reescrito a cada
-- rodada e e o unico dos dois que responde "a coleta passou por aqui hoje?". Medido em
-- 05/09/2026: campaigns 08:40, ad_sets 08:45, ads 09:10, todos do mesmo dia.
update public.tarefas_agendadas
   set tabela_destino           = v.tabela,
       coluna_carimbo           = 'last_synced_at',
       tolerancia_frescor_horas = 30
  from (values ('estrutura-campanhas', 'campaigns'),
               ('estrutura-conjuntos', 'ad_sets'),
               ('estrutura-anuncios',  'ads')) as v(tarefa, tabela)
 where public.tarefas_agendadas.tarefa = v.tarefa;

-- ============================================================================
-- 4. PROVA: o vigia enxerga as quatro, e nenhuma delas sobrou sem registro
-- ============================================================================
do $prova$
declare
  v_r         jsonb;
  v_sem       int;
  v_nomes     text;
  v_ultimo    timestamptz;
  v_registradas int;
begin
  select count(*) into v_registradas
    from public.tarefas_agendadas
   where tarefa in ('recortes-pipeboard','estrutura-campanhas','estrutura-conjuntos','estrutura-anuncios')
     and ativa and natureza = 'coleta'
     and tabela_destino is not null and coluna_carimbo is not null;
  if v_registradas <> 4 then
    raise exception 'esperava 4 tarefas de coleta com destino declarado, achei %', v_registradas;
  end if;

  -- O carimbo tem de ser LEGIVEL pelo mesmo caminho que o vigia usa, e nao so existir no
  -- catalogo: e a diferenca entre "a coluna esta la" e "o vigia consegue ler a coluna".
  v_ultimo := public.ultimo_carimbo_no_destino('metric_breakdown_daily', 'created_at', null, null, null);
  if v_ultimo is null then
    raise exception 'o vigia nao consegue ler o carimbo de metric_breakdown_daily';
  end if;
  raise notice 'ultimo carimbo lido pelo vigia em metric_breakdown_daily: %', v_ultimo;

  v_r := public.vigiar_frescor_do_dado();
  v_sem   := coalesce((v_r->>'sem_registro')::int, 0);
  v_nomes := coalesce(v_r->>'nao_vigiadas', '[]');
  raise notice 'vigia apos o registro: %', v_r::text;

  -- As quatro tem de ter SAIDO da lista de nao vigiadas. Conferir so o total cairia no mesmo
  -- erro do digest antigo: um numero que fecha por acaso enquanto o item errado continua la.
  if v_nomes like '%recortes-pipeboard%'
     or v_nomes like '%estrutura-campanhas%'
     or v_nomes like '%estrutura-conjuntos%'
     or v_nomes like '%estrutura-anuncios%' then
    raise exception 'alguma das quatro continua sem registro suficiente: %', v_nomes;
  end if;
  raise notice 'coletas ainda sem registro apos esta migration: % -> %', v_sem, v_nomes;

  if exists (
    select 1 from public.alerts
     where resolved = false
       and chave_dedupe in ('dado_velho:recortes-pipeboard',
                            'dado_velho:estrutura-campanhas',
                            'dado_velho:estrutura-conjuntos',
                            'dado_velho:estrutura-anuncios')
  ) then
    raise exception 'o vigia acusou atraso numa coleta que acabou de rodar: registro errado';
  end if;
end;
$prova$;

comment on table public.metric_breakdown_daily is
  'Recorte diario de metricas por anuncio (idade, genero, plataforma). Fonte viva desde '
  || '05/09/2026: pipeboard-breakdowns-sync, tarefa `recortes-pipeboard`, vigiada por '
  || 'vigiar_frescor_do_dado. Linhas com fonte=windsor:facebook sao historicas (28/07 a '
  || '13/08/2026) e usam a MESMA grafia de valor_recorte que a fonte nova — nao ha formato '
  || 'antigo a traduzir. tipo_recorte=posicionamento nunca foi coletado por rotina nenhuma.';

commit;
