-- A nota de cobertura nomeia o recorte, em vez de dizer "1 tipos"
-- (05/09/2026)
--
-- O QUE APARECEU AO RESTAURAR A COLETA. Com pipeboard-breakdowns-sync no ar, a nota passou a
-- publicar: "outros recortes (1 tipos, coletado de 04/09 a 04/09)". A frase esta correta e nao
-- informa nada. Pior: ela ESCONDE duas coisas diferentes no mesmo balde.
--
--   1. O que voltou a ser coletado e recorte por PLATAFORMA (facebook / instagram) — util para
--      decidir onde o criativo rende, e o gestor nao tem como saber disso lendo "1 tipos".
--   2. Recorte por POSICIONAMENTO (feed, stories, reels) continua sem ser coletado por rotina
--      nenhuma — nunca foi, nem pela Windsor. Antes desta coleta voltar, a nota dizia isso por
--      escrito, na lista de NUNCA. Depois que `plataforma` entrou, o `not in ('idade','genero')`
--      passou a achar linha e o aviso sumiu. Plataforma e posicionamento sao perguntas
--      diferentes: "Facebook ou Instagram" nao responde "feed ou stories".
--
-- E O MESMO FORMATO DE DEFEITO DO RESTO DA SERIE, agora produzido pelo conserto anterior: dado
-- novo chegando fez uma ausencia declarada virar silencio. O balde generico e a causa, entao o
-- conserto e tirar o balde, nao remendar a frase.
--
-- O QUE MUDA. Os quatro valores que o CHECK de tipo_recorte admite passam a ser enumerados um a
-- um, pelo mesmo caminho que idade e genero ja usavam — com data, com contagem, e caindo em
-- ATUALIZADO / PAROU / NUNCA conforme a ultima data, nunca conforme texto fixo. E fica uma
-- guarda para o proprio recorte: se alguem acrescentar um tipo ao CHECK sem passar por aqui, a
-- nota avisa que existe recorte que ela nao sabe descrever, em vez de omiti-lo.

begin;

create or replace function public.nota_de_cobertura(p_company_id uuid)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  -- Recorte e ranking sao dados diarios. Passou de 3 dias, a coleta parou; nao e atraso.
  c_tol constant int := 3;

  r            record;
  v_rank       record;
  v_atual      text[] := '{}';
  v_parado     text[] := '{}';
  v_nunca      text[] := '{}';
  v_ressalva   text[] := '{}';
  v_teve_idade boolean := false;
  v_detalhe    text;
  v_dias       int;
  v_desconhecidos text;
begin
  -- Um item por tipo de recorte, com nome proprio. A lista espelha o CHECK de
  -- metric_breakdown_daily.tipo_recorte; o bloco logo abaixo cobra que ela continue espelhando.
  for r in
    select e.tipo, e.rotulo, e.unidade,
           coalesce(b.linhas, 0) as linhas, b.valores, b.anuncios, b.de, b.ate
      from (values
              ('idade',         '**idade**',                                 'faixas'),
              ('genero',        '**gênero**',                                'valores'),
              ('plataforma',    '**plataforma** (Facebook × Instagram)',     'plataformas'),
              ('posicionamento','**posicionamento** (feed, stories, reels)', 'posições')
           ) as e(tipo, rotulo, unidade)
      cross join lateral (
        select count(*)                        as linhas,
               count(distinct m.valor_recorte)  as valores,
               count(distinct m.ad_external_id) as anuncios,
               min(m.snapshot_date)             as de,
               max(m.snapshot_date)             as ate
          from public.metric_breakdown_daily m
         where m.company_id = p_company_id and m.tipo_recorte = e.tipo
      ) b
  loop
    if r.linhas = 0 then
      v_nunca := array_append(v_nunca, 'recorte por ' || r.rotulo);
      continue;
    end if;

    if r.tipo = 'idade' then
      v_teve_idade := true;
    end if;

    v_dias    := current_date - r.ate;
    v_detalhe := 'recorte por ' || r.rotulo || ' (' || r.valores || ' ' || r.unidade
                 || ', ' || r.anuncios || ' anúncios, coletado de '
                 || to_char(r.de, 'DD/MM') || ' a ' || to_char(r.ate, 'DD/MM') || ')';

    if v_dias > c_tol then
      v_parado := array_append(v_parado, v_detalhe || ' — **parou há ' || v_dias || ' dias**');
    else
      v_atual := array_append(v_atual, v_detalhe);
    end if;
  end loop;

  -- Recorte gravado que esta lista nao conhece. Sem isto, acrescentar um tipo ao CHECK e
  -- esquecer desta funcao faria o dado novo existir na tabela e nao existir na nota — ausencia
  -- por omissao, que e o defeito que esta funcao inteira existe para nao cometer.
  select string_agg(distinct m.tipo_recorte, ', ' order by m.tipo_recorte)
    into v_desconhecidos
    from public.metric_breakdown_daily m
   where m.company_id = p_company_id
     and m.tipo_recorte not in ('idade', 'genero', 'plataforma', 'posicionamento');
  if v_desconhecidos is not null then
    v_ressalva := array_append(v_ressalva,
      'existe recorte gravado que esta nota não sabe descrever (' || v_desconhecidos
      || ') — trate como dado não conferido até alguém declarar o que ele significa');
  end if;

  select count(*) filter (where s.quality_ranking is not null)          as coletadas,
         count(*) filter (where s.quality_ranking = 'UNKNOWN')          as desconhecidas,
         max(s.snapshot_date) filter (where s.quality_ranking is not null) as ate
    into v_rank
    from public.ad_metric_snapshots s
   where s.company_id = p_company_id;

  if coalesce(v_rank.coletadas, 0) = 0 then
    v_nunca := array_append(v_nunca, 'os três rankings de qualidade da Meta');
  else
    v_dias    := current_date - v_rank.ate;
    v_detalhe := 'os rankings de qualidade da Meta (' || v_rank.coletadas
                 || ' leituras, a última em ' || to_char(v_rank.ate, 'DD/MM') || ')';

    if v_dias > c_tol then
      v_parado := array_append(v_parado, v_detalhe || ' — **parou há ' || v_dias || ' dias**');
    else
      v_atual := array_append(v_atual, v_detalhe);
      -- Esta explicacao so pode ser dita enquanto a coleta esta viva. Com a coleta parada,
      -- "falta volume no anuncio, nao falta coleta nossa" e diagnostico errado com cara de certo.
      if v_rank.coletadas = v_rank.desconhecidas then
        v_ressalva := array_append(v_ressalva,
          'a Meta devolveu "não classificado" em todas as leituras de ranking — aí falta volume '
          || 'no anúncio, não falta coleta nossa');
      end if;
    end if;
  end if;

  if v_teve_idade then
    v_ressalva := array_append(v_ressalva,
      'faixa com menos de 50 formulários ou menos de R$ 300 de gasto na janela é ruído — não '
      || 'chame de "mais barata"');
    v_ressalva := array_append(v_ressalva,
      'em crédito é PROIBIDO segmentar por idade, gênero, CEP ou renda; o recorte serve para '
      || 'escolher ângulo e criativo, nunca público');
  end if;

  return '> **O que este relatório sabe e o que não sabe.** '
    || case when array_length(v_atual, 1) > 0
            then 'ATUALIZADO no sistema: ' || array_to_string(v_atual, '; ') || '. '
            else '' end
    || case when array_length(v_parado, 1) > 0
            then '⚠️ **PAROU DE SER COLETADO** — o que vem a seguir descreve o passado, não a '
                 || 'situação de hoje. Não diga que o sistema "tem" esse dado no presente; diga '
                 || 'que teve até a data indicada, e que ninguém está trazendo dado novo: '
                 || array_to_string(v_parado, '; ') || '. '
            else '' end
    || case when array_length(v_nunca, 1) > 0
            then 'NUNCA foi coletado por nenhuma rotina: ' || array_to_string(v_nunca, '; ')
                 || ' — não conclua nada sobre isso. '
            else '' end
    || case when array_length(v_ressalva, 1) > 0
            then 'Ressalvas: ' || array_to_string(v_ressalva, '; ') || '.'
            else '' end;
end;
$function$;

comment on function public.nota_de_cobertura(uuid) is
  'Envelope do relatorio: o que o sistema sabe HOJE, o que teve e parou (com a data), e o que '
  || 'nunca teve. Cada item sai da ultima data coletada, nunca de texto fixo. Os quatro tipos '
  || 'de recorte sao enumerados um a um: contar tipos num balde "outros" escondia que '
  || 'posicionamento continua sem coleta enquanto plataforma passou a ter.';

-- ============================================================================
-- PROVA
-- ============================================================================
do $prova$
declare
  v_texto text;
  v_c uuid;
begin
  select id into v_c from public.companies
   where exists (select 1 from public.metric_breakdown_daily m
                  where m.company_id = companies.id and m.tipo_recorte = 'plataforma')
   limit 1;
  if v_c is null then
    raise exception 'nenhuma empresa com recorte de plataforma: a prova nao teria o que conferir';
  end if;

  v_texto := public.nota_de_cobertura(v_c);
  raise notice 'nota: %', v_texto;

  if v_texto like '%outros recortes%' then
    raise exception 'o balde generico continua na nota';
  end if;
  if v_texto not like '%plataforma%' then
    raise exception 'a nota nao nomeia o recorte por plataforma que acabou de ser coletado';
  end if;
  -- posicionamento nunca foi coletado por rotina nenhuma; a nota tem de continuar dizendo isso
  -- em vez de deixar a chegada de `plataforma` calar o aviso.
  if v_texto not like '%posicionamento%' then
    raise exception 'a nota parou de declarar que posicionamento nao e coletado';
  end if;
end;
$prova$;

commit;
