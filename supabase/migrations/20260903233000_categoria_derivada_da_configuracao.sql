-- A classificacao da campanha deixa de depender de alguem lembrar.
--
-- CONTEXTO: as seis campanhas ativas estavam com `category` nula, e as tres regras de
-- custo exigem `category in ('leadgen','mensagem')`. Estavam estruturalmente mortas. A
-- saida obvia seria pedir ao gestor que classificasse na mao -- mas o dado que classifica
-- ja esta gravado: `campaigns.objective` e `ad_sets.optimization_goal`.
--
-- POR QUE ISSO NAO E CHUTE: o repositorio ja tem a doutrina canonica dessa leitura em
-- `public.base_de_resultado(categoria, optimization_goal, objective)`, usada hoje pela
-- exportacao de relatorio. Ela declara a precedencia: categoria manda; na falta dela,
-- `optimization_goal = 'CONVERSATIONS'` significa conversa e `VISIT_INSTAGRAM_PROFILE`
-- significa clique. As 29 campanhas classificadas na mao no historico concordam com essa
-- doutrina, sem um unico contraexemplo:
--
--   leadgen      <- OUTCOME_LEADS      + OFFSITE_CONVERSIONS            (6 campanhas)
--   mensagem     <- OUTCOME_ENGAGEMENT + CONVERSATIONS                  (11 campanhas)
--   engajamento  <- OUTCOME_ENGAGEMENT + LANDING_PAGE_VIEWS / THRUPLAY  (3 campanhas)
--   trafego      <- LINK_CLICKS        + VISIT_INSTAGRAM_PROFILE        (9 campanhas)
--
-- Rodada contra essas 29 antes de gravar qualquer coisa, a funcao acertou 24 e se absteve
-- em 5 (as que nao tem objetivo gravado ou nao tem conjunto lido). ZERO contradicoes: nao
-- houve um caso em que ela afirmasse categoria diferente da que o humano escolheu.
--
-- Note que `OUTCOME_ENGAGEMENT` sozinho NAO decide: ele aparece em `mensagem` e em
-- `engajamento`. Quem separa os dois e `optimization_goal = 'CONVERSATIONS'`. Derivar so
-- pelo objetivo da campanha seria justamente o erro que apontaria a regra de custo para a
-- regua errada.
--
-- A TRAVA CONTRA CLASSIFICACAO ERRADA: classificar errado nao e neutro -- faz a regra
-- comparar a campanha contra a regua errada e o alerta resultante manda pausar campanha
-- saudavel. Entao a derivacao so e aceita se for NEUTRA perante a doutrina canonica:
-- exigimos que `base_de_resultado(categoria_derivada, ...)` seja igual a
-- `base_de_resultado(null, ...)`. Em palavras: a categoria que gravamos precisa concordar
-- com o que o sistema ja concluiria sem ela. Se discordar, devolvemos NULL e o caso vai
-- para o gestor. Assim e impossivel esta migration mudar o resultado de quem le
-- `base_de_resultado` hoje, e impossivel ela inventar uma regua.
--
-- AUDITORIA: `categoria_origem` registra se a classificacao veio da configuracao
-- ('derivada') ou de decisao humana ('manual'), com carimbo de quando. Manual sempre
-- ganha: o gatilho apenas PREENCHE o que esta nulo, nunca sobrescreve.
--
-- A CAUSA, NAO O SINTOMA: dois gatilhos garantem que campanha nova nao nasca sem
-- classificacao. Como o espelho grava a campanha antes dos conjuntos, o gatilho de
-- `campaigns` resolve o que o objetivo ja decide (OUTCOME_LEADS, LINK_CLICKS) e o de
-- `ad_sets` fecha o resto quando a meta de otimizacao chega.

alter table public.campaigns
  add column if not exists categoria_origem text,
  add column if not exists categoria_definida_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_categoria_origem_check') then
    alter table public.campaigns
      add constraint campaigns_categoria_origem_check
      check (categoria_origem is null or categoria_origem in ('derivada', 'manual'));
  end if;
end
$$;

comment on column public.campaigns.categoria_origem is
  'Procedencia da classificacao: derivada (da configuracao da campanha e do conjunto) ou manual (decisao humana). Manual nunca e sobrescrita pelo gatilho.';

-- Deriva a categoria a partir da configuracao real, ou NULL quando ha qualquer ambiguidade.
create or replace function public.categoria_derivada_da_configuracao(p_campaign_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_objective text;
  v_metas     int;
  v_conversas int;
  v_candidata text;
  v_discordou int;
begin
  select c.objective into v_objective
    from public.campaigns c
   where c.id = p_campaign_id;

  if v_objective is null then
    return null;  -- sem objetivo gravado nao ha o que derivar
  end if;

  -- Quantos conjuntos declaram meta de otimizacao, e quantos deles pedem conversa.
  select count(*) filter (where s.optimization_goal is not null),
         count(*) filter (where upper(btrim(s.optimization_goal)) = 'CONVERSATIONS')
    into v_metas, v_conversas
    from public.ad_sets s
   where s.campaign_id = p_campaign_id;

  v_candidata := case
    -- Objetivo de leads sempre foi formulario no historico, com ou sem conjunto lido.
    when upper(v_objective) = 'OUTCOME_LEADS' then 'leadgen'
    -- Clique no link sempre foi trafego no historico.
    when upper(v_objective) = 'LINK_CLICKS' then 'trafego'
    -- Engajamento so decide com a meta do conjunto, e ela precisa ser unanime.
    when upper(v_objective) = 'OUTCOME_ENGAGEMENT' and v_metas > 0 and v_conversas = v_metas
      then 'mensagem'
    when upper(v_objective) = 'OUTCOME_ENGAGEMENT' and v_metas > 0 and v_conversas = 0
      then 'engajamento'
    -- Engajamento sem conjunto lido, metas divergentes entre conjuntos, ou objetivo sem
    -- precedente no historico (OUTCOME_SALES, OUTCOME_TRAFFIC): indeciso de proposito.
    else null
  end;

  if v_candidata is null then
    return null;
  end if;

  -- Trava de neutralidade: a categoria derivada tem de concordar com a doutrina canonica
  -- em TODOS os conjuntos da campanha. Se um so discordar, a campanha e ambigua e volta a
  -- ser NULL -- preferimos o gestor decidir do que apontar a regra para a regua errada.
  select count(*) into v_discordou
    from public.ad_sets s
   where s.campaign_id = p_campaign_id
     and public.base_de_resultado(v_candidata, s.optimization_goal, v_objective)
      is distinct from public.base_de_resultado(null, s.optimization_goal, v_objective);

  if v_discordou > 0 then
    return null;
  end if;

  -- Campanha sem nenhum conjunto: confere a neutralidade so pelo objetivo.
  if v_metas = 0
     and public.base_de_resultado(v_candidata, null, v_objective)
      is distinct from public.base_de_resultado(null, null, v_objective) then
    return null;
  end if;

  return v_candidata;
end
$function$;

revoke all on function public.categoria_derivada_da_configuracao(uuid) from public, anon, authenticated;
grant execute on function public.categoria_derivada_da_configuracao(uuid) to service_role;

-- As 25 campanhas que ja tinham classificacao vieram de decisao humana: fica registrado.
update public.campaigns
   set categoria_origem = 'manual',
       categoria_definida_em = coalesce(categoria_definida_em, created_at)
 where category is not null
   and categoria_origem is null;

-- Preenche as campanhas ATIVAS que estao sem classificacao e cuja configuracao decide.
-- Deliberadamente nao mexemos em campanha pausada ou apagada: elas sao historico, e
-- reclassificar historico mudaria relatorio passado sem ninguem ter pedido.
update public.campaigns c
   set category = d.derivada,
       categoria_origem = 'derivada',
       categoria_definida_em = now()
  from (select x.id, public.categoria_derivada_da_configuracao(x.id) as derivada
          from public.campaigns x
         where x.status = 'active'
           and x.category is null) d
 where c.id = d.id
   and d.derivada is not null;

-- Uma unica funcao serve aos dois gatilhos. Ela roda DEPOIS da escrita (a derivacao
-- consulta os conjuntos, que sao outra tabela) e grava por UPDATE condicionado a
-- `category is null` -- e essa condicao que garante que classificacao manual sobrevive e
-- que o gatilho nao entra em laco quando ele mesmo dispara o UPDATE.
create or replace function public.aplicar_categoria_derivada_na_campanha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campanha uuid;
  v_derivada text;
begin
  -- Tem de ser IF, nao CASE: numa expressao CASE o PL/pgSQL resolve os campos dos DOIS
  -- ramos contra o mesmo registro, entao `new.campaign_id` estoura tambem quando o gatilho
  -- vem de `campaigns`. Com CASE, todo insert de campanha falharia e o espelho da Meta
  -- pararia inteiro -- foi assim que o teste do gatilho pegou o defeito.
  if tg_table_name = 'campaigns' then
    v_campanha := new.id;
  else
    v_campanha := new.campaign_id;
  end if;

  if v_campanha is null then
    return null;
  end if;

  v_derivada := public.categoria_derivada_da_configuracao(v_campanha);

  if v_derivada is not null then
    update public.campaigns
       set category = v_derivada,
           categoria_origem = 'derivada',
           categoria_definida_em = now()
     where id = v_campanha
       and category is null;   -- nunca sobrescreve classificacao existente
  end if;

  return null;
end
$function$;

revoke all on function public.aplicar_categoria_derivada_na_campanha() from public, anon, authenticated;

-- Gatilho 1: na entrada da campanha, resolve o que o objetivo sozinho ja decide
-- (OUTCOME_LEADS e LINK_CLICKS). Objetivo de engajamento fica para o gatilho 2.
drop trigger if exists trg_categoria_na_entrada_da_campanha on public.campaigns;
create trigger trg_categoria_na_entrada_da_campanha
  after insert or update of objective on public.campaigns
  for each row
  when (new.category is null)
  execute function public.aplicar_categoria_derivada_na_campanha();

-- Gatilho 2: quando a meta de otimizacao do conjunto chega, fecha o que faltava.
drop trigger if exists trg_categoria_quando_o_conjunto_chega on public.ad_sets;
create trigger trg_categoria_quando_o_conjunto_chega
  after insert or update of optimization_goal on public.ad_sets
  for each row
  execute function public.aplicar_categoria_derivada_na_campanha();
