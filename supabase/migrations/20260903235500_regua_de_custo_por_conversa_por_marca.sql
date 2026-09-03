-- Regua de custo por conversa, separada por marca (03/09/2026)
--
-- POR QUE: depois que dd12675 deu UM denominador ao custo por resultado, o numero de conversa
-- ficou confiavel e o buraco apareceu: NAO EXISTE regua de custo_por_conversa. O motor de
-- alertas cai no `coalesce(teto_vigente, alert_rules.threshold)` e julga conversa contra os
-- R$ 21,80 da regra `cpl`, que e uma regua de formulario.
--
-- DE ONDE VEM ESSE 21,80, conferido em 03/09/2026: e o p75 do custo por conversa dos dias de
-- marco de 2026 (`percentile_cont(0.75) ... where snapshot_date < '2026-04-01'` devolve
-- exatamente 21.80). Aqueles dias sao, TODOS eles, das oito campanhas
-- `[SALT] [LF | CONV | OBRA + GEO + LISTA | WA]` — ou seja, La Felicita, rodada por outra
-- agencia, ha seis meses. O numero generico que hoje governa as tres marcas e um p75 de UMA
-- marca so, de uma operacao que nao existe mais. COHAPM Juridico (R$ 4,00) e Sistema Ocular
-- (R$ 4,96) passam como "dentro do limite" porque estao medidos contra o alvo de outra marca.
--
-- O QUE O HISTORICO SUSTENTA, E O QUE ELE NAO SUSTENTA. Serie apurada pela camada canonica
-- (`base_de_resultado_da_campanha` + `resultados_da_base`), excluindo o dia corrente, que e
-- parcial e distorceria tudo (em 03/09 as tres campanhas somavam R$ 20,39 de gasto contra
-- R$ 150 a R$ 300 nos dias fechados):
--
--   marca             dias  conversas  acumulado  diario mediana  diario min-max  janela 3d
--   COHAPM Juridico      5         82      4,01            3,57      3,30- 5,39   3,31- 4,35
--   La Felicita          5         32     17,68           14,77     13,18-89,19  13,30-21,53
--   Sistema Ocular       2         20      5,25            5,02      4,55- 5,49   4,55- 5,25
--
-- TRES LEITURAS QUE MUDAM A DECISAO:
--
--   (a) NENHUMA das tres marcas tem historico longo. A operacao atual comecou em 29/08 (as duas
--       primeiras) e em 01/09 (VISTTA). Cinco dias fechados nao e "historico"; e comeco de
--       serie. Isso vale para as tres, nao so para a VISTTA. Toda regua aqui nasce PROVISORIA,
--       e a coluna `provisoria` existe para que ninguem leia esses numeros como consolidados.
--
--   (b) A dispersao DIARIA de La Felicita (13,18 a 89,19) nao mede custo: mede contagem
--       pequena. A marca teve de 1 a 12 conversas por dia; no dia de R$ 89,19 houve UMA
--       conversa. Uma regua tirada dessa dispersao ficaria perto de R$ 60-90 e nunca
--       dispararia. A janela de 3 dias da mesma marca varia so de 13,30 a 21,53 — 1,6x contra
--       6,8x do diario. E a janela de 3 dias que descreve o custo; o dia isolado descreve o
--       tamanho da amostra. As reguas abaixo saem da janela de 3 dias e do acumulado, que sao
--       as grandezas que as regras R1 e R5 de fato comparam.
--
--   (c) La Felicita e a UNICA marca com uma segunda janela independente: marco/2026, outra
--       agencia, mesmo objetivo (CONV WA). Acumulado de entao: R$ 21,13; p75 diario R$ 21,80.
--       Hoje ela roda a R$ 17,68. Duas operacoes separadas por seis meses colocam essa marca na
--       faixa de R$ 13 a R$ 22 — corroboracao que Juridico e VISTTA nao tem.
--
-- AS REGUAS, uma frase cada:
--
--   COHAPM Juridico  R$  7,00  A marca nunca passou de R$ 5,39 num dia nem de R$ 4,35 numa
--                              janela de tres dias, entao R$ 7,00 so e alcancado se o custo
--                              quase dobrar e ficar la — o que nao e oscilacao, e mudanca.
--   La Felicita      R$ 26,00  Duas operacoes distintas, com seis meses de distancia, mantiveram
--                              essa marca entre R$ 13 e R$ 22 por conversa; R$ 26,00 e o primeiro
--                              valor que fica fora das duas.
--   Sistema Ocular   R$ 12,00  PROVISORIA e deliberadamente larga: dois dias fechados nao
--                              permitem medir dispersao nenhuma, entao a faixa foi emprestada da
--                              marca que tem mais dado (Juridico precisa de 1,75x sobre o nivel
--                              dela) e alargada por cima do nivel da VISTTA justamente porque a
--                              dispersao dela e desconhecida, nao porque se sabe que e grande.
--
-- POR QUE VISTTA GANHA REGUA PROVISORIA EM VEZ DE FICAR SEM: porque "sem regua" nao e silencio.
-- Hoje, sem regua, ela cai nos R$ 21,80 de La Felicita/marco. A escolha real nao e entre um
-- numero e nenhum numero: e entre um numero declarado provisorio e um numero errado que ninguem
-- sabe que esta la. A migration seguinte (20260903235600) tira o fallback silencioso, para que
-- na base 'conversas' ausencia de regua passe a significar ausencia de veredito.
--
-- DOIS NIVEIS (atencao e critico)? Sim, e eles JA EXISTEM — nao como dois numeros, mas como duas
-- janelas sobre o mesmo numero. R1 (`cpl`, severidade high) olha o acumulado da campanha: o
-- conjunto todo passou da linha. R5 (`pause_3d`, severidade critical) olha um criativo em tres
-- dias seguidos acima da MESMA linha. Inventar um segundo limiar por marca seria inventar mais
-- tres numeros com os mesmos cinco dias de dado atras deles.
--
-- MUDAR OS NUMEROS DEPOIS NAO EXIGE MIGRATION: `public.definir_regua_de_marca(...)`, no bloco 4.
--
-- REEXECUTAVEL: `select * from public.prova_regua_de_conversa();`

-- ============================================================================
-- 1) A marca entra na camada de regua de negocio
-- ============================================================================
-- marca NULL = regua da empresa inteira (o que existe hoje: o gate de R$ 1,60 por formulario da
-- Legal e Viver). marca preenchida = regua daquela linha de produto, com precedencia sobre ela.

alter table public.metas_de_negocio add column if not exists marca text;
alter table public.metas_de_negocio add column if not exists provisoria boolean not null default false;
alter table public.metas_de_negocio add column if not exists revisar_em date;

comment on column public.metas_de_negocio.marca is
  'Linha de produto (brand_identity.marca_nome) a que esta regua se aplica. NULL = vale para a empresa inteira. A regua da marca tem precedencia sobre a da empresa: a mesma empresa pode ter custo por conversa muito diferente entre marcas (em 03/09/2026, R$ 4,00 no Juridico contra R$ 16,87 em La Felicita).';
comment on column public.metas_de_negocio.provisoria is
  'true = o valor foi derivado de serie curta e NAO e regua consolidada. Quem cita a regua tem de citar tambem que ela e provisoria: limiar tirado de poucos dias que se apresenta como definitivo e pior que limiar ausente, porque ninguem sabe que e chute.';
comment on column public.metas_de_negocio.revisar_em is
  'Data a partir da qual havera serie suficiente para refazer a conta. Nao expira sozinha: serve para o gestor saber quando o numero merece uma segunda olhada.';

-- A unique antiga era (company_id, metric, tipo, vigente). Duas limitacoes: nao separa marca, e
-- como inclui `vigente` no corpo da chave, so admite UMA linha desativada por metrica — o que
-- impediria guardar o historico de versoes que o bloco 4 precisa gravar.
alter table public.metas_de_negocio drop constraint if exists metas_uma_vigente_por_tipo;

create unique index if not exists metas_uma_vigente_por_marca_e_tipo
  on public.metas_de_negocio (company_id, metric, coalesce(marca, ''), tipo)
  where vigente;

comment on index public.metas_uma_vigente_por_marca_e_tipo is
  'Uma regua vigente por (empresa, metrica, marca, tipo). Parcial em `vigente`: versoes antigas ficam no banco com vigente=false, quantas forem, para dar historico de quem mudou a regua e quando.';

-- ============================================================================
-- 2) O leitor da regua que governa, agora ciente de marca
-- ============================================================================
-- A doutrina do sistema (registro de ferramentas, 20260903190000) manda: chame teto_vigente e
-- use SOMENTE a regua que o retorno disser que governa; nunca leia targets nem metas direto.
-- Esta migration NAO abre um segundo caminho — ela estende o mesmo leitor. Continua existindo
-- UM lugar que resolve teto, e `metas_de_negocio` segue sem nenhum outro leitor no banco.

CREATE OR REPLACE FUNCTION public.teto_vigente_da_marca(p_company_id uuid, p_metric text, p_marca text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_gate record; v_asp record; v_hist record;
  tem_gate boolean := false; tem_asp boolean := false; tem_hist boolean := false;
  v_escopo text;
  v_reguas_marca jsonb;
  v jsonb;
begin
  if p_company_id is null or p_metric is null then
    raise exception 'teto_vigente exige p_company_id e p_metric';
  end if;

  -- Precedencia: regua da marca > regua da empresa. Nunca as duas somadas.
  if p_marca is not null then
    select * into v_gate from public.metas_de_negocio
     where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
       and marca = p_marca
     limit 1;
    tem_gate := found;
    if tem_gate then v_escopo := 'marca'; end if;
  end if;

  if not tem_gate then
    select * into v_gate from public.metas_de_negocio
     where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
       and marca is null
     limit 1;
    tem_gate := found;
    if tem_gate then v_escopo := 'empresa'; end if;
  end if;

  select * into v_asp from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'aspiracao' and vigente
     and (marca is not distinct from p_marca or marca is null)
   order by (marca is not null) desc
   limit 1;
  tem_asp := found;

  -- targets nao tem marca: e a camada de consistencia historica da empresa inteira.
  select * into v_hist from public.targets
   where company_id = p_company_id and metric = p_metric and active and campaign_id is null limit 1;
  tem_hist := found;

  -- Todas as reguas por marca desta metrica, sempre declaradas. E isso que impede o consumidor
  -- de dois argumentos de concluir "nao existe regua" quando na verdade existem tres.
  select jsonb_object_agg(m.marca, jsonb_build_object(
           'valor', m.valor, 'provisoria', m.provisoria, 'revisar_em', m.revisar_em,
           'decidido_por', m.decidido_por, 'decidido_em', m.decidido_em))
    into v_reguas_marca
    from public.metas_de_negocio m
   where m.company_id = p_company_id and m.metric = p_metric and m.tipo = 'gate'
     and m.vigente and m.marca is not null;

  v := jsonb_build_object(
    'company_id', p_company_id,
    'metric', p_metric,
    'marca', p_marca,
    'governa', case when tem_gate then 'meta_de_negocio'
                    when tem_hist then 'consistencia_historica'
                    when v_reguas_marca is not null then 'meta_de_negocio_por_marca'
                    else 'nenhum' end,
    'escopo_da_regua', v_escopo,
    'teto_que_governa', case when tem_gate then v_gate.valor
                             when tem_hist then v_hist.valor
                             else null end,
    'provisoria', case when tem_gate then v_gate.provisoria else null end,
    'revisar_em', case when tem_gate then v_gate.revisar_em else null end,
    'denominador', case when tem_gate then v_gate.denominador
       else case p_metric
              when 'custo_por_formulario' then 'form_leads'
              when 'custo_por_conversa' then 'messaging_started'
              when 'custo_por_lead_lp' then 'link_clicks (o NOME desta metrica e enganoso - descoberto em 30/07)'
              else 'nao declarado' end end,
    'meta_de_negocio', case when not tem_gate then null else jsonb_build_object(
        'valor', v_gate.valor, 'decidido_por', v_gate.decidido_por,
        'decidido_em', v_gate.decidido_em, 'citacao', v_gate.citacao_da_decisao,
        'marca', v_gate.marca, 'provisoria', v_gate.provisoria, 'revisar_em', v_gate.revisar_em) end,
    'consistencia_historica', case when not tem_hist then null else jsonb_build_object(
        'valor', v_hist.valor, 'fonte', v_hist.fonte,
        'responde', 'consistencia com o proprio passado, nao rentabilidade') end,
    'aspiracao_nao_governa', case when tem_asp then v_asp.valor else null end,
    'reguas_por_marca', v_reguas_marca
  );

  if tem_gate and v_gate.provisoria then
    v := v || jsonb_build_object('aviso_provisoria',
      'Esta regua e PROVISORIA: saiu de serie curta e nao e teto consolidado. Ao reportar, diga que e provisoria'
      || coalesce(' e que a revisao esta marcada para ' || to_char(v_gate.revisar_em,'DD/MM/YYYY'), '')
      || '. ' || coalesce(v_gate.citacao_da_decisao, ''));
  end if;

  if tem_gate and tem_hist and v_gate.valor <> v_hist.valor then
    v := v || jsonb_build_object('divergencia_declarada',
      'Existem DUAS reguas e elas nao coincidem. Governa a de negocio (' || v_gate.valor ||
      ', decidida por ' || v_gate.decidido_por || ' em ' || to_char(v_gate.decidido_em,'DD/MM/YYYY') ||
      '). O valor de ' || v_hist.valor || ' e teto de consistencia historica e NAO deve ser usado como veredito de negocio. Ao reportar, cite a regua que governou.');
  end if;

  if not tem_gate and tem_hist then
    v := v || jsonb_build_object('aviso',
      'Nao existe regua de negocio para esta metrica nesta empresa: o veredito esta saindo do teto de consistencia historica, que mede o passado e nao a rentabilidade. Pedir a regua ao gestor.');
  end if;

  -- O caso novo: a metrica TEM regua, mas por marca, e quem perguntou nao disse a marca.
  -- Devolver "nenhum" aqui seria mentir por omissao.
  if not tem_gate and not tem_hist and v_reguas_marca is not null then
    v := v || jsonb_build_object('aviso',
      'Esta metrica NAO tem regua unica para a empresa: ela e governada por marca, e as marcas divergem entre si. '
      || 'Nao existe um numero unico que sirva de veredito aqui. Use teto_vigente_da_campanha(campaign_id) ou '
      || 'teto_vigente_da_marca(company_id, metric, marca) para obter a regua de cada caso; as reguas vigentes '
      || 'estao em reguas_por_marca.');
  end if;

  if not tem_gate and not tem_hist and v_reguas_marca is null then
    v := v || jsonb_build_object('aviso',
      'Nenhuma regua existe para esta metrica nesta empresa. Qualquer veredito de bom ou ruim aqui seria opiniao sem referencia - declarar a ausencia em vez de julgar.');
  end if;

  return v;
end;
$function$
;

comment on function public.teto_vigente_da_marca(uuid, text, text) is
  'Resolve o teto vigente de uma metrica PARA UMA MARCA. Precedencia: regua da marca > regua da empresa > consistencia historica (targets). Declara em escopo_da_regua qual camada governou e em reguas_por_marca todas as reguas de marca existentes. Mesmo contrato de teto_vigente(uuid,text), que passou a delegar aqui com marca nula.';

-- A funcao de dois argumentos continua existindo com a MESMA assinatura e o mesmo contrato:
-- nenhum chamador (SQL ou ferramenta do agente) precisa mudar, e o `teto_que_governa` que ela
-- devolve e identico ao de antes desta migration em todos os casos que ja existiam.
CREATE OR REPLACE FUNCTION public.teto_vigente(p_company_id uuid, p_metric text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.teto_vigente_da_marca(p_company_id, p_metric, null)
$function$
;

comment on function public.teto_vigente(uuid, text) is
  'FONTE PRIORITARIA do teto vigente de uma metrica na EMPRESA. Delega para teto_vigente_da_marca com marca nula. Quando a metrica so tem regua por marca (caso de custo_por_conversa desde 03/09/2026), devolve teto_que_governa nulo e declara as reguas por marca em reguas_por_marca - nunca escolhe uma marca por conta propria.';

-- Resolucao a partir do objeto, espelhando base_de_resultado_da_campanha: quem tem a campanha na
-- mao nao precisa saber nem a metrica nem a marca para achar a regua certa.
CREATE OR REPLACE FUNCTION public.teto_vigente_da_campanha(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.teto_vigente_da_marca(
           c.company_id,
           public.metrica_do_teto(public.base_de_resultado_da_campanha(c.id)),
           public.linha_de_produto_do_nome(c.name, c.company_id))
    from public.campaigns c
   where c.id = p_campaign_id
$function$
;

comment on function public.teto_vigente_da_campanha(uuid) is
  'Teto vigente de uma campanha: deriva a metrica da base de resultado canonica e a marca do nome da campanha, e resolve por teto_vigente_da_marca. Evita que o chamador redescubra denominador ou marca a mao.';

-- ============================================================================
-- 3) As tres reguas
-- ============================================================================
-- A marca e buscada em brand_identity pelo marca_tag, e nao escrita a mao, para que o valor
-- gravado em metas_de_negocio.marca seja exatamente o que linha_de_produto_do_nome() devolve —
-- se a marca for renomeada, a regua nao fica orfa por causa de um acento digitado diferente.

insert into public.metas_de_negocio
  (company_id, metric, marca, denominador, valor, tipo, provisoria, revisar_em,
   decidido_por, decidido_em, citacao_da_decisao, memoria)
select b.company_id, 'custo_por_conversa', b.marca_nome, 'messaging_started',
       v.valor, 'gate', true, date '2026-09-24',
       'proposta do sistema a partir do historico da marca, aguardando confirmacao do gestor',
       date '2026-09-03', v.frase,
       jsonb_build_object(
         'metodo', v.metodo,
         'serie_usada', v.serie,
         'por_que_provisoria', 'Serie curta: a operacao atual comecou em 29/08/2026 (Juridico e La Felicita) e em 01/09/2026 (Sistema Ocular). Cinco dias fechados, ou dois, nao descrevem dispersao. Revisar em 24/09/2026, quando houver tres semanas fechadas.',
         'o_que_substitui', 'Ate 03/09/2026 conversa era julgada contra os R$ 21,80 do alert_rules.cpl da COHAPM, que e o p75 diario de marco/2026 e vem exclusivamente das campanhas [SALT] [LF | CONV | ...] de La Felicita.')
  from public.brand_identity b
  join (values
    ('COHAPM', 7.00::numeric,
     'A marca nunca passou de R$ 5,39 num dia nem de R$ 4,35 numa janela de tres dias, entao R$ 7,00 so e alcancado se o custo quase dobrar e ficar la - o que nao e oscilacao, e mudanca.',
     'Acima do pior dia fechado (R$ 5,39) e ~60% acima da pior janela de 3 dias (R$ 4,35); 75% acima do acumulado atual de R$ 4,01. Fica logo abaixo do p90 de anuncio-dia (R$ 8,19) para que um criativo ruim ainda consiga cruzar a linha em R5.',
     '5 dias fechados (29/08 a 02/09/2026), 82 conversas, acumulado R$ 4,01, mediana diaria R$ 3,57, diario 3,30-5,39, janela 3d 3,31-4,35, anuncio-dia p75 5,89 / p90 8,19 / max 10,58'),
    ('LAF', 26.00::numeric,
     'Duas operacoes distintas, com seis meses de distancia, mantiveram essa marca entre R$ 13 e R$ 22 por conversa; R$ 26,00 e o primeiro valor que fica fora das duas.',
     'Acima da pior janela de 3 dias de hoje (R$ 21,53) e acima do p75 diario de marco/2026 (R$ 21,80); ~47% acima do acumulado atual de R$ 17,68. Deliberadamente NAO derivado da dispersao diaria (13,18 a 89,19), que mede contagem pequena - 1 a 12 conversas por dia - e nao custo: por ali a regua sairia perto de R$ 60-90 e nunca dispararia.',
     '5 dias fechados (29/08 a 02/09/2026), 32 conversas, acumulado R$ 17,68, mediana diaria R$ 14,77, janela 3d 13,30-21,53. Janela independente de marco/2026 (8 campanhas [SALT], outra agencia): acumulado R$ 21,13, p75 diario R$ 21,80, faixa 8,45-34,49'),
    ('VISTTA', 12.00::numeric,
     'PROVISORIA e deliberadamente larga: dois dias fechados nao permitem medir dispersao nenhuma, entao a faixa foi emprestada da marca que tem mais dado e alargada por cima do nivel da VISTTA justamente porque a dispersao dela e desconhecida, nao porque se sabe que e grande.',
     'NAO derivado da dispersao propria, que com dois dias nao existe. Nivel medido: R$ 5,25. Banda relativa emprestada do COHAPM Juridico (regua 7,00 sobre nivel 4,01 = 1,75x) daria ~R$ 9,20; alargado para R$ 12,00 (2,3x o nivel) porque o que e maior aqui e a incerteza, nao a volatilidade conhecida. Pega degradacao grosseira e nada mais - e essa e a intencao enquanto a serie nao existir.',
     '2 dias fechados (01 e 02/09/2026), 20 conversas, acumulado R$ 5,25, diario 4,55 e 5,49, maior anuncio-dia R$ 10,65')
  ) as v(tag, valor, frase, metodo, serie) on upper(b.marca_tag) = v.tag
 where b.vigente
   and b.company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
on conflict do nothing;

-- ============================================================================
-- 4) Mudar a regua depois NAO exige migration
-- ============================================================================
-- O gestor vai querer mexer nesses numeros depois de umas semanas vendo o comportamento - as
-- reguas nascem provisorias justamente por isso. Sem esta funcao, cada ajuste seria uma
-- migration, o que na pratica significa que o ajuste nao acontece.
--
-- Guarda o valor anterior como vigente=false em vez de sobrescrever: da para responder depois
-- "quem mudou a regua, quando, e o que ela era antes".

CREATE OR REPLACE FUNCTION public.definir_regua_de_marca(
  p_company_id uuid,
  p_metric text,
  p_marca text,
  p_valor numeric,
  p_decidido_por text,
  p_citacao text,
  p_provisoria boolean DEFAULT false,
  p_revisar_em date DEFAULT NULL,
  p_denominador text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_den text;
  v_anterior numeric;
begin
  if p_company_id is null or p_metric is null then
    raise exception 'definir_regua_de_marca exige empresa e metrica';
  end if;
  if auth.uid() is not null and not public.is_company_member(p_company_id, auth.uid()) then
    raise exception 'sem permissao nesta empresa';
  end if;
  if p_marca is not null and not exists (
       select 1 from public.brand_identity b
        where b.company_id = p_company_id and b.vigente and b.marca_nome = p_marca) then
    raise exception 'marca "%" nao esta cadastrada e vigente em brand_identity para esta empresa. A regua tem de casar exatamente com o nome que linha_de_produto_do_nome() devolve, senao ela nunca sera encontrada.', p_marca;
  end if;
  if p_valor is not null and p_valor <= 0 then
    raise exception 'regua tem de ser maior que zero (recebido: %)', p_valor;
  end if;
  if p_valor is not null and coalesce(btrim(p_decidido_por),'') = '' then
    raise exception 'definir_regua_de_marca exige p_decidido_por: regua sem autor nao da para auditar depois';
  end if;

  v_den := coalesce(p_denominador, case p_metric
    when 'custo_por_conversa'    then 'messaging_started'
    when 'custo_por_formulario'  then 'form_leads'
    when 'custo_por_clique_link' then 'link_clicks'
    else null end);

  if p_valor is not null and v_den is null then
    raise exception 'metrica "%" nao tem denominador conhecido: passe p_denominador explicitamente. Foi a ausencia de denominador declarado que produziu o custo_por_lead_lp que media clique no link.', p_metric;
  end if;

  select valor into v_anterior from public.metas_de_negocio
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
     and marca is not distinct from p_marca;

  update public.metas_de_negocio
     set vigente = false
   where company_id = p_company_id and metric = p_metric and tipo = 'gate' and vigente
     and marca is not distinct from p_marca;

  -- p_valor nulo = retirar a regua. Na base 'conversas' isso significa que o motor deixa de
  -- julgar aquela marca, e nao que ela volta a cair num limiar generico.
  if p_valor is not null then
    insert into public.metas_de_negocio
      (company_id, metric, marca, denominador, valor, tipo, provisoria, revisar_em,
       decidido_por, decidido_em, citacao_da_decisao, memoria)
    values
      (p_company_id, p_metric, p_marca, v_den, p_valor, 'gate',
       coalesce(p_provisoria, false), p_revisar_em,
       p_decidido_por, current_date,
       coalesce(nullif(btrim(p_citacao),''), 'sem citacao registrada'),
       jsonb_build_object('valor_anterior', v_anterior, 'trocado_em', now(),
                          'via', 'definir_regua_de_marca'));
  end if;

  return public.teto_vigente_da_marca(p_company_id, p_metric, p_marca)
         || jsonb_build_object('valor_anterior', v_anterior);
end;
$function$
;

comment on function public.definir_regua_de_marca(uuid, text, text, numeric, text, text, boolean, date, text) is
  'Cria ou troca a regua de negocio de uma marca sem migration. A versao anterior fica no banco com vigente=false (historico de quem mudou o que, e quando). p_valor nulo retira a regua. Devolve a regua ja resolvida por teto_vigente_da_marca.';

-- ============================================================================
-- 5) Prova reexecutavel
-- ============================================================================
-- Responde, com o dado de producao: o que cada campanha de conversa faz contra a regua nova,
-- a que distancia esta do limiar, e se alguma campanha consegue disparar cpl e spend_no_leads
-- ao mesmo tempo (nao consegue - e a prova checa em vez de afirmar).

CREATE OR REPLACE FUNCTION public.prova_regua_de_conversa()
 RETURNS TABLE(marca text, campanha text, base text, custo numeric, teto numeric,
               escopo text, provisoria boolean, veredito text, distancia_do_teto text,
               conflito_com_spend_no_leads text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    coalesce(tv.r->>'marca', '(marca nao resolvida pelo nome)') as marca,
    c.name as campanha,
    bd.base,
    round(c.spend / nullif(den.resultados, 0), 2) as custo,
    (tv.r->>'teto_que_governa')::numeric as teto,
    tv.r->>'escopo_da_regua' as escopo,
    (tv.r->>'provisoria')::boolean as provisoria,
    case
      when (tv.r->>'teto_que_governa') is null then 'sem regua: nao julga (e nao cai mais em limiar generico)'
      when den.resultados = 0 then 'fora da regra cpl (zero resultado)'
      when c.spend / nullif(den.resultados, 0) > (tv.r->>'teto_que_governa')::numeric then 'DISPARA'
      else 'nao dispara'
    end as veredito,
    case
      when (tv.r->>'teto_que_governa') is null or den.resultados = 0 then null
      else to_char(round(100 * ((c.spend / den.resultados) / (tv.r->>'teto_que_governa')::numeric - 1), 1), 'FM990.0') || '%'
    end as distancia_do_teto,
    case
      when den.resultados = 0 and c.spend > coalesce(
             (select r2.threshold from public.alert_rules r2
               where r2.company_id = c.company_id and r2.metric = 'spend_no_leads' and r2.active), 1e9)
        then 'spend_no_leads DISPARA (cpl nao, porque cpl exige resultado > 0)'
      when den.resultados > 0
        then 'sem conflito: spend_no_leads exige resultado = 0, cpl exige resultado > 0'
      else 'sem conflito: zero resultado, mas gasto abaixo do piso de spend_no_leads'
    end as conflito_com_spend_no_leads
  from public.campaigns c
  cross join lateral (select public.base_de_resultado_da_campanha(c.id) as base) bd
  cross join lateral (
    select public.resultados_da_base(bd.base, c.form_leads, c.messaging_started, c.link_clicks) as resultados
  ) den
  cross join lateral (select public.teto_vigente_da_campanha(c.id) as r) tv
  where c.status = 'active'
    and bd.base = 'conversas'
  order by 1, 2
$function$
;

comment on function public.prova_regua_de_conversa() is
  'Prova reexecutavel da regua de custo por conversa: campanha a campanha, custo canonico contra o teto da marca, distancia do limiar e checagem de que cpl e spend_no_leads sao mutuamente exclusivas.';

-- ============================================================================
-- 6) A migration se recusa a terminar se algo nao bater
-- ============================================================================
do $$
declare
  v_jur numeric; v_laf numeric; v_vis numeric;
  v_empresa jsonb; v_lev jsonb;
begin
  select (public.teto_vigente_da_marca('57f755b9-c23d-4f58-a488-8173d697c010','custo_por_conversa','COHAPM Juridico')->>'teto_que_governa')::numeric into v_jur;
  select (public.teto_vigente_da_marca('57f755b9-c23d-4f58-a488-8173d697c010','custo_por_conversa',(select marca_nome from public.brand_identity where marca_tag='LAF'))->>'teto_que_governa')::numeric into v_laf;
  select (public.teto_vigente_da_marca('57f755b9-c23d-4f58-a488-8173d697c010','custo_por_conversa','Sistema Ocular')->>'teto_que_governa')::numeric into v_vis;

  if v_jur is distinct from 7.00 or v_laf is distinct from 26.00 or v_vis is distinct from 12.00 then
    raise exception 'As tres reguas de conversa nao resolveram: Juridico=%, La Felicita=%, Sistema Ocular=%', v_jur, v_laf, v_vis;
  end if;

  -- Nenhuma mudanca de comportamento no leitor de dois argumentos: conversa segue sem teto de
  -- empresa (agora com aviso que declara as reguas por marca em vez de negar que existam).
  v_empresa := public.teto_vigente('57f755b9-c23d-4f58-a488-8173d697c010','custo_por_conversa');
  if (v_empresa->>'teto_que_governa') is not null then
    raise exception 'teto_vigente de dois argumentos passou a devolver teto para custo_por_conversa (%). Isso mudaria o comportamento de consumidores que nao foram revisados.', v_empresa->>'teto_que_governa';
  end if;
  if (v_empresa->'reguas_por_marca') is null or v_empresa->>'governa' <> 'meta_de_negocio_por_marca' then
    raise exception 'teto_vigente de dois argumentos nao esta declarando as reguas por marca: %', v_empresa;
  end if;

  -- Nenhuma regressao na regua que ja existia (gate de R$ 1,60 por formulario da Legal e Viver).
  v_lev := public.teto_vigente('ded20b38-f42e-4c71-800c-31b97ea48bcf','custo_por_formulario');
  if (v_lev->>'teto_que_governa')::numeric is distinct from 1.60
     or v_lev->>'governa' <> 'meta_de_negocio'
     or (v_lev->>'aspiracao_nao_governa')::numeric is distinct from 0.80
     or (v_lev->'consistencia_historica'->>'valor')::numeric is distinct from 2.30 then
    raise exception 'A regua de formulario da Legal e Viver mudou de comportamento: %', v_lev;
  end if;

  raise notice 'Reguas de conversa: Juridico R$ %, La Felicita R$ %, Sistema Ocular R$ % (todas provisorias, revisar em 24/09/2026).', v_jur, v_laf, v_vis;
end $$;
