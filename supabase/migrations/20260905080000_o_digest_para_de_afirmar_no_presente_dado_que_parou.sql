-- O DIGEST PARA DE AFIRMAR NO PRESENTE UM DADO QUE PAROU (05/09/2026)
--
-- ==========================================================================================
-- A CONSTRUCAO ERA VIVA, MAS PERGUNTAVA A COISA ERRADA
-- ==========================================================================================
-- A duvida certa era se o "JA EXISTE no sistema" da `nota_de_cobertura` vinha de consulta viva
-- ou de texto fixo. Vem de consulta viva — e por isso o defeito e pior, nao melhor: a consulta
-- pergunta `count(*) > 0`, ou seja "ja teve alguma linha algum dia", e imprime a resposta como
-- se fosse "tem hoje". Nao e uma linha ruim, e a construcao inteira. Todo item da nota carrega
-- o mesmo risco, e MEDINDO os tres em 05/09/2026:
--
--   recorte por idade         — ultima coleta 13/08, parado ha 23 dias
--   recorte por genero        — ultima coleta 13/08, parado ha 23 dias
--   rankings de qualidade     — ultima leitura 30/07, parado ha 37 dias
--
-- O de genero era o mais cego dos tres: a consulta nem buscava data, so contava valores, entao
-- a frase saia como "recorte por **genero** (3 valores)", sem nada que permitisse desconfiar.
--
-- E o de ranking nao ficava so calado, ele EXPLICAVA errado. O texto dizia "os rankings de
-- qualidade da Meta **sao coletados** (9 leituras), mas a plataforma devolveu 'nao classificado'
-- em todas elas — falta volume no anuncio, nao falta coleta nossa". A ultima clausula afirma com
-- confianca que a coleta esta boa e joga a causa no volume do anuncio. A coleta parou ha 37
-- dias. Uma frase que nao sabe vale menos que o silencio; uma frase que nao sabe e da o
-- diagnostico errado manda o leitor procurar no lugar errado.
--
-- ==========================================================================================
-- POR QUE CARREGAR A DATA E NAO REMOVER A FRASE
-- ==========================================================================================
-- Apagar o item resolveria a mentira e criaria outra, na direcao oposta: o gestor deixaria de
-- saber que ja teve recorte por idade e que ele parou. Sumir em silencio e o mesmo formato de
-- falha. Entao a nota passa a ter tres baldes, e todo item cai em um deles com a data na frente:
--
--   ATUALIZADO — chegou dado dentro da tolerancia, com a data da ultima coleta
--   PAROU DE SER COLETADO — o que existe, ate quando, e ha quantos dias parou
--   NUNCA foi coletado — segue como antes
--
-- A tolerancia e de 3 dias, declarada como constante no corpo: recorte e ranking sao dados
-- diarios, entao 3 dias ja e parada, nao atraso.
--
-- ==========================================================================================
-- O MESMO DEFEITO NO CORPO DO DIGEST, UMA SECAO ACIMA
-- ==========================================================================================
-- Procurando outras afirmacoes no presente, apareceu uma pior que a da nota, porque e sobre
-- dinheiro. O bloco "Ontem, campanha por campanha" le `metric_snapshots` do dia do relatorio.
-- Se a coleta falhar, o `coalesce(sum(m.spend),0)` devolve zero e o digest publica
-- "Gasto **R$ 0,00**", "sem gasto ontem" e "nenhum resultado" — como fato sobre a campanha.
-- Nao ha nada no texto que distinga "a campanha nao gastou" de "o numero nao chegou", e as
-- duas coisas levam o gestor a decisoes opostas.
--
-- Hoje `metric_snapshots` esta em dia (ultimo dia 05/09), entao isso ainda nao aconteceu. Mas e
-- exatamente a mesma forma da `metric_breakdown_daily`, e a `metric_breakdown_daily` tambem
-- estava em dia ate o dia em que parou. Entao entra um aviso que so aparece quando nao chegou
-- linha nenhuma para o dia, dizendo que os zeros sao ausencia de dado e informando qual foi a
-- coleta mais recente disponivel.

-- ============================================================================
-- 1) A nota passa a carregar a data de cada afirmacao
-- ============================================================================

create or replace function public.nota_de_cobertura(p_company_id uuid)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  -- Recorte e ranking sao dados diarios. Passou de 3 dias, a coleta parou; nao e atraso.
  c_tol constant int := 3;

  r            record;
  v_rank       record;
  v_outros     record;
  v_atual      text[] := '{}';
  v_parado     text[] := '{}';
  v_nunca      text[] := '{}';
  v_ressalva   text[] := '{}';
  v_teve_idade boolean := false;
  v_detalhe    text;
  v_dias       int;
begin
  for r in
    select e.tipo, e.rotulo, e.unidade,
           coalesce(b.linhas, 0) as linhas, b.valores, b.anuncios, b.de, b.ate
      from (values ('idade',  '**idade**',  'faixas'),
                   ('genero', '**gênero**', 'valores')) as e(tipo, rotulo, unidade)
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

  select count(*)                       as linhas,
         count(distinct m.tipo_recorte) as tipos,
         min(m.snapshot_date)           as de,
         max(m.snapshot_date)           as ate
    into v_outros
    from public.metric_breakdown_daily m
   where m.company_id = p_company_id and m.tipo_recorte not in ('idade', 'genero');

  if coalesce(v_outros.linhas, 0) = 0 then
    v_nunca := array_append(v_nunca, 'recorte por **posicionamento**');
  else
    v_dias    := current_date - v_outros.ate;
    v_detalhe := 'outros recortes (' || v_outros.tipos || ' tipos, coletado de '
                 || to_char(v_outros.de, 'DD/MM') || ' a ' || to_char(v_outros.ate, 'DD/MM') || ')';
    if v_dias > c_tol then
      v_parado := array_append(v_parado, v_detalhe || ' — **parou há ' || v_dias || ' dias**');
    else
      v_atual := array_append(v_atual, v_detalhe);
    end if;
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
$fn$;

comment on function public.nota_de_cobertura(uuid) is
'Nota de cobertura do digest. Todo item sai com a data da ultima coleta e cai em um de tres baldes: ATUALIZADO, PAROU DE SER COLETADO (com ha quantos dias) ou NUNCA coletado. A versao anterior perguntava count(*) > 0 e imprimia "JA EXISTE no sistema", o que afirmava no presente dado parado ha 23 dias (idade e genero) e ha 37 dias (rankings). Item parado NAO e removido de proposito: sumir em silencio esconderia do gestor que ele ja teve esse dado e que ele parou.';

-- ============================================================================
-- 2) Zero por ausencia de dado deixa de ser publicado como zero de desempenho
-- ============================================================================

do $digest$
declare
  v_def  text;
  v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'montar_corpo_digest';

  if v_def is null then
    raise exception 'montar_corpo_digest nao encontrada';
  end if;

  if position('não chegou.**' in v_def) > 0 then
    raise notice 'aviso de dia sem dado ja aplicado; nada a fazer';
    return;
  end if;

  v_novo := v_def;

  -- 2.1 declara as variaveis do aviso
  v_novo := replace(v_novo,
    '  v_campanhas text; v_n_camp int; v_d1 date;',
    '  v_campanhas text; v_n_camp int; v_d1 date;' || chr(10) ||
    '  v_linhas_dia int; v_ultimo_dia date; v_aviso_dia text;');

  if v_novo = v_def then
    raise exception 'nao achei a linha de declaracao esperada em montar_corpo_digest';
  end if;

  -- 2.2 mede se chegou linha para o dia do relatorio
  v_novo := replace(v_novo,
    '  v_d1 := p_dia;',
    '  v_d1 := p_dia;' || chr(10) || chr(10) ||
    '  -- Ausencia de dado nao e desempenho zero. Sem linha nenhuma para o dia, os numeros' || chr(10) ||
    '  -- abaixo sao AUSENCIA, e o texto precisa dizer isso antes de alguem ler R$ 0,00' || chr(10) ||
    '  -- como "a campanha nao gastou".' || chr(10) ||
    '  select count(*), (select max(x.snapshot_date) from public.metric_snapshots x' || chr(10) ||
    '                     where x.company_id = p_company_id)' || chr(10) ||
    '    into v_linhas_dia, v_ultimo_dia' || chr(10) ||
    '    from public.metric_snapshots m' || chr(10) ||
    '   where m.company_id = p_company_id and m.snapshot_date = v_d1;' || chr(10) || chr(10) ||
    '  v_aviso_dia := case when coalesce(v_linhas_dia, 0) = 0 then' || chr(10) ||
    '      ''> ⚠️ **O dado de '' || to_char(v_d1, ''DD/MM'') || '' não chegou.** Nenhuma linha de ''' || chr(10) ||
    '      || ''métrica foi gravada para esse dia. Os números abaixo são AUSÊNCIA DE DADO, não ''' || chr(10) ||
    '      || ''desempenho zero: não conclua que não houve gasto nem que não houve resultado. ''' || chr(10) ||
    '      || coalesce(''A coleta mais recente disponível é de '' || to_char(v_ultimo_dia, ''DD/MM'')' || chr(10) ||
    '                  || '' (há '' || (current_date - v_ultimo_dia) || '' dias).'',' || chr(10) ||
    '                  ''Não há nenhuma métrica coletada para esta empresa.'')' || chr(10) ||
    '      || e''\n\n''' || chr(10) ||
    '    else '''' end;');

  if position('v_aviso_dia := case' in v_novo) = 0 then
    raise exception 'nao achei o ponto de calculo (v_d1 := p_dia) em montar_corpo_digest';
  end if;

  -- 2.3 imprime o aviso no topo do bloco de ontem
  v_novo := replace(v_novo,
    ''') — campanha por campanha'' || e''\n\n'' ||',
    ''') — campanha por campanha'' || e''\n\n'' ||' || chr(10) ||
    '    v_aviso_dia ||');

  if position('    v_aviso_dia ||' in v_novo) = 0 then
    raise exception 'nao achei o cabecalho do bloco de ontem em montar_corpo_digest';
  end if;

  -- O conserto de 04/09 (rotina que sumiu do cron aparece em vez de sumir do texto)
  -- precisa continuar de pe depois desta cirurgia.
  if position('NÃO ESTÁ AGENDADA' in v_novo) = 0 then
    raise exception 'a cirurgia derrubou o aviso de rotina nao agendada';
  end if;

  if position('p_dia date DEFAULT (CURRENT_DATE - 1)' in v_novo) = 0 then
    raise exception 'o DEFAULT de p_dia se perdeu; quem chama sem o segundo argumento quebraria';
  end if;

  execute v_novo;
end $digest$;

-- ============================================================================
-- 3) Conferencia
-- ============================================================================

do $prova$
declare
  v_empresa uuid;
  v_nota    text;
  v_corpo   text;
begin
  select company_id into v_empresa from public.digest_config where ativo limit 1;
  if v_empresa is null then
    select id into v_empresa from public.companies limit 1;
  end if;

  v_nota := public.nota_de_cobertura(v_empresa);

  if v_nota like '%JÁ EXISTE no sistema%' then
    raise exception 'a nota ainda usa a frase que afirma no presente';
  end if;

  -- Em 05/09/2026 idade, genero e ranking estao parados; se algum dia voltarem a ser
  -- coletados esta prova para de exigir o balde de parado, mas nunca aceita a frase antiga.
  if v_nota not like '%PAROU DE SER COLETADO%' and v_nota not like '%ATUALIZADO no sistema%' then
    raise exception 'a nota saiu sem nenhum dos baldes com data: %', left(v_nota, 300);
  end if;

  v_corpo := public.montar_corpo_digest(v_empresa);

  if length(v_corpo) < 200 then
    raise exception 'corpo do digest saiu curto demais: % caracteres', length(v_corpo);
  end if;

  if position('Rotinas de hoje' in v_corpo) = 0 then
    raise exception 'a secao de rotinas sumiu do digest';
  end if;

  raise notice 'nota de cobertura com data em cada item; digest montou com % caracteres', length(v_corpo);
  raise notice 'nota: %', v_nota;
end $prova$;
