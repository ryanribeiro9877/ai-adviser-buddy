-- Paridade entre os dois lados da regra de base de resultado (03/09/2026)
--
-- POR QUE: a migration 20260903230000 unificou o denominador do custo por resultado dentro do
-- banco, mas a mesma regra existe DUAS VEZES no sistema, por necessidade real: as edges
-- decidem a base sem ida ao banco (`baseDoObjetivo()` em _shared/metrica_canonica.ts) e o
-- banco decide sem ida as edges (`public.base_de_resultado()`). Duas escritas da mesma regra
-- e a causa raiz que esta frente veio eliminar. Como aqui a duplicacao nao pode ser removida,
-- ela passa a ser DETECTAVEL.
--
-- O DESALINHAMENTO QUE ISTO FECHA: ate agora `baseDoObjetivo()` decidia so pela categoria e
-- nunca devolvia 'cliques_no_link', embora o tipo `BaseDeResultado` ja previsse a base. O SQL
-- passou a reconhecer campanha de trafego como base propria em 03/09/2026 e o TypeScript nao —
-- ou seja, os dois lados discordavam EXATAMENTE no ponto do erro de 5,4x da Legal e Viver
-- (gasto de impulsionamento de post entrando no custo por formulario). O TypeScript foi
-- alinhado no mesmo commit desta migration.
--
-- COMO A DIVERGENCIA APARECE, nos tres caminhos possiveis:
--   1. mexeram no SQL e nao na lista de casos
--      -> select * from public.prova_base_de_resultado() where not confere;
--   2. mexeram no TypeScript e nao na lista de casos
--      -> deno run --allow-read supabase/functions/_shared/_prova_metrica_canonica.ts
--   3. mexeram na lista de casos e nao regeraram o literal desta migration
--      -> a mesma prova do item 2 compara a lista com o literal daqui e reprova.
--
-- A LISTA DE CASOS TEM UMA FONTE SO: supabase/functions/_shared/casos_de_base_de_resultado.ts.
-- O literal abaixo e a saida de `casosParaJson()` daquele arquivo, copiada sem edicao manual.
-- Editar o literal a mao aqui e recriar o defeito num lugar novo.

create or replace function public.prova_base_de_resultado()
 returns table(caso text, base_sql text, base_ts text, confere boolean)
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select
    coalesce(nullif(btrim(c.categoria),''), '(sem categoria)') || ' | ' ||
      coalesce(nullif(btrim(c.optimization_goal),''), '(sem optimization_goal)') || ' | ' ||
      coalesce(nullif(btrim(c.objective),''), '(sem objective)') as caso,
    public.base_de_resultado(c.categoria, c.optimization_goal, c.objective) as base_sql,
    c.base_ts,
    public.base_de_resultado(c.categoria, c.optimization_goal, c.objective)
      is not distinct from c.base_ts as confere
  from jsonb_to_recordset(
$casos$[{"categoria":"mensagem","optimization_goal":"LINK_CLICKS","objective":"OUTCOME_TRAFFIC","base_ts":"conversas"},{"categoria":"mensagens","optimization_goal":null,"objective":null,"base_ts":"conversas"},{"categoria":"leadgen","optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":"cadastro","optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":"vendas","optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":"conversoes","optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":"trafego","optimization_goal":"LEAD_GENERATION","objective":"OUTCOME_LEADS","base_ts":"cliques_no_link"},{"categoria":"engajamento","optimization_goal":null,"objective":null,"base_ts":"cliques_no_link"},{"categoria":"alcance","optimization_goal":null,"objective":null,"base_ts":"cliques_no_link"},{"categoria":"video","optimization_goal":null,"objective":null,"base_ts":"cliques_no_link"},{"categoria":"MENSAGEM","optimization_goal":null,"objective":null,"base_ts":"conversas"},{"categoria":"  leadgen  ","optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":null,"optimization_goal":"CONVERSATIONS","objective":"OUTCOME_ENGAGEMENT","base_ts":"conversas"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_MESSAGES","base_ts":"conversas"},{"categoria":null,"optimization_goal":null,"objective":"MESSAGES","base_ts":"conversas"},{"categoria":null,"optimization_goal":"LEAD_GENERATION","objective":null,"base_ts":"formularios"},{"categoria":null,"optimization_goal":"QUALITY_LEAD","objective":null,"base_ts":"formularios"},{"categoria":null,"optimization_goal":"OFFSITE_CONVERSIONS","objective":"OUTCOME_LEADS","base_ts":"formularios"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_LEADS","base_ts":"formularios"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_SALES","base_ts":"formularios"},{"categoria":null,"optimization_goal":null,"objective":"PRODUCT_CATALOG_SALES","base_ts":"formularios"},{"categoria":null,"optimization_goal":"POST_ENGAGEMENT","objective":"OUTCOME_ENGAGEMENT","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":"LINK_CLICKS","objective":"OUTCOME_TRAFFIC","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_TRAFFIC","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_AWARENESS","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":null,"objective":"REACH","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":null,"objective":"VIDEO_VIEWS","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":null,"objective":"OUTCOME_APP_PROMOTION","base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":"THRUPLAY","objective":null,"base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":"VISIT_INSTAGRAM_PROFILE","objective":null,"base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":"LANDING_PAGE_VIEWS","objective":null,"base_ts":"cliques_no_link"},{"categoria":null,"optimization_goal":"CONVERSATIONS","objective":"OUTCOME_TRAFFIC","base_ts":"conversas"},{"categoria":null,"optimization_goal":"LINK_CLICKS","objective":"OUTCOME_LEADS","base_ts":"formularios"},{"categoria":null,"optimization_goal":"POST_ENGAGEMENT","objective":"OUTCOME_MESSAGES","base_ts":"conversas"},{"categoria":null,"optimization_goal":null,"objective":null,"base_ts":"formularios"},{"categoria":"","optimization_goal":"","objective":"","base_ts":"formularios"},{"categoria":null,"optimization_goal":"ALGO_QUE_A_META_INVENTOU_DEPOIS","objective":"OUTCOME_QUE_NAO_EXISTE","base_ts":"formularios"}]$casos$::jsonb
  ) as c(categoria text, optimization_goal text, objective text, base_ts text)
$function$;

comment on function public.prova_base_de_resultado() is
'Confronta public.base_de_resultado() com baseDoObjetivo() de _shared/metrica_canonica.ts, caso a caso. A lista de casos vive em _shared/casos_de_base_de_resultado.ts e a copia literal desta funcao e gerada de la; a prova do TypeScript reprova se as duas sairem de sincronia. Linha com confere = false significa que os dois lados do sistema passaram a decidir bases diferentes para a mesma campanha - foi assim que campanha de trafego virou custo por formulario inflado em 5,4x.';

-- A migration se recusa a terminar com os dois lados discordando.
do $conferencia$
declare v_div int; v_total int;
begin
  select count(*), count(*) filter (where not confere) into v_total, v_div
    from public.prova_base_de_resultado();
  if v_div > 0 then
    raise exception 'A base de resultado do SQL discorda do TypeScript em % de % casos. Rode: select * from public.prova_base_de_resultado() where not confere;', v_div, v_total;
  end if;
  if v_total < 30 then
    raise exception 'A lista de casos encolheu para % - a paridade so vale se cobrir os ramos da regra', v_total;
  end if;
  raise notice 'paridade da base de resultado: % casos, zero divergencia', v_total;
end $conferencia$;
