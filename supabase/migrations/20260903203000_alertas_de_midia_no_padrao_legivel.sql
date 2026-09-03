-- ============================================================================
-- Alertas de midia no padrao legivel, sem apagar historico
-- ============================================================================
-- Duas doencas na evaluate_alerts antiga, ambas visiveis para o gestor:
--
-- 1) Ela comecava com  delete from public.alerts where resolved = false and rule_id is not null
--    Toda rodada diaria varria TODOS os alertas abertos de regra e reinseria do zero. Efeitos:
--    o created_at reiniciava todo dia (nunca se sabia desde quando o problema existe), o id
--    trocava (o sino de notificacao via tudo como novo outra vez) e nada registrava que um
--    alerta havia deixado de valer — ele so desaparecia.
--
-- 2) O title era o nome da regra (igual para toda campanha) e o description empilhava tudo
--    numa frase so, com jargao interno ('regua', 'teto_vigente', 'espelho'). Pior: nao havia
--    identificacao de linha de produto. Como COHAPM Juridico, La Felicita, VISTTA e Legal &
--    Viver dividem company_id, dois alertas de linhas diferentes ficavam indistinguiveis —
--    exatamente a contaminacao que este sistema ja sofreu.
--
-- Agora cada regra emite por emitir_alerta, com chave de dedupe estavel por campanha/anuncio.
-- Rodar duas vezes no mesmo dia atualiza a mesma linha em vez de duplicar. Condicao que parou
-- de valer e RESOLVIDA por resolver_alertas_da_tarefa, nao apagada.
--
-- A matematica de deteccao das sete regras foi copiada sem alteracao: limiares, janelas e
-- excecoes continuam identicos. O que muda e so a forma de gravar o achado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Dinheiro e numero em portugues
-- ----------------------------------------------------------------------------
-- to_char com 'FM999990.00' devolvia "1234.50" — ponto decimal, sem separador de milhar.
-- Para quem le rapido, "R$ 1.234,50" e menos ambiguo. 'D' e 'G' respeitam o lc_numeric do
-- servidor (en_US aqui), entao o translate final inverte ponto e virgula.
create or replace function public.reais(p_valor numeric)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_valor is null then 'sem valor'
    else 'R$ ' || translate(to_char(p_valor, 'FM999G999G999G990D00'), '.,', ',.')
  end;
$function$;

create or replace function public.numero_br(p_valor numeric, p_decimais integer default 0)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_valor is null then 'sem valor'
    when p_decimais <= 0 then translate(to_char(p_valor, 'FM999G999G999G990'), '.,', ',.')
    else translate(to_char(p_valor, 'FM999G999G999G990D' || repeat('0', p_decimais)), '.,', ',.')
  end;
$function$;

revoke all on function public.reais(numeric)              from anon, authenticated;
revoke all on function public.numero_br(numeric, integer) from anon, authenticated;
grant execute on function public.reais(numeric)              to service_role;
grant execute on function public.numero_br(numeric, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 2) emitir_alerta passa a guardar rule_id
-- ----------------------------------------------------------------------------
-- Sem isso, migrar as regras para o padrao novo cortaria o vinculo com alert_rules e
-- qualquer filtro por regra na interface. Assinatura antiga e derrubada de proposito para
-- nao criar sobrecarga ambigua; todos os chamadores usam argumento nomeado, entao seguem
-- valendo.
drop function if exists public.emitir_alerta(uuid, alert_severity, text, text, text, text, text, text, text, text, text, numeric, uuid);

create or replace function public.emitir_alerta(
  p_company_id    uuid,
  p_severidade    alert_severity,
  p_titulo        text,
  p_o_que         text,
  p_onde          text default null,
  p_quanto        text default null,
  p_acao          text default null,
  p_janela        text default null,
  p_tarefa        text default null,
  p_linha_produto text default null,
  p_chave_dedupe  text default null,
  p_valor         numeric default null,
  p_campaign_id   uuid default null,
  p_rule_id       uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id     uuid;
  v_desc   text;
  v_agora  text := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  v_linhas text[] := array[]::text[];
begin
  if p_company_id is null or p_titulo is null or p_o_que is null then
    raise exception 'emitir_alerta exige company_id, titulo e o_que';
  end if;

  -- O corpo e montado em blocos rotulados sempre na mesma ordem: o que houve, onde (com a
  -- linha de produto), quanto, janela, o que fazer, gravidade e deteccao. Padrao unico —
  -- quem le o segundo alerta ja sabe onde olhar.
  v_linhas := array_append(v_linhas, btrim(p_o_que));

  if p_onde is not null or p_linha_produto is not null then
    v_linhas := array_append(v_linhas,
      'Onde: ' || coalesce(p_onde, 'nao especificado') ||
      case when p_linha_produto is not null then '  |  Linha: ' || p_linha_produto else '' end);
  end if;

  if p_quanto is not null then
    v_linhas := array_append(v_linhas, 'Quanto: ' || p_quanto);
  end if;

  if p_janela is not null then
    v_linhas := array_append(v_linhas, 'Janela dos dados: ' || p_janela);
  end if;

  if p_acao is not null then
    v_linhas := array_append(v_linhas, 'O que fazer: ' || p_acao);
  end if;

  v_linhas := array_append(v_linhas,
    'Gravidade ' || lower(public.rotulo_severidade(p_severidade)) ||
    '. Detectado em ' || v_agora ||
    case when p_tarefa is not null then ' pela tarefa ' || p_tarefa else '' end || '.');

  v_desc := array_to_string(v_linhas, E'\n');

  -- Idempotencia: mesma chave e mesmo alerta aberto viram UPDATE. primeira_deteccao
  -- preserva desde quando o problema existe; vistas conta quantas rodadas o confirmaram.
  if p_chave_dedupe is not null then
    update public.alerts a
       set severity          = p_severidade,
           title             = p_titulo,
           description       = v_desc,
           tarefa            = p_tarefa,
           linha_produto     = p_linha_produto,
           onde              = p_onde,
           quanto            = p_quanto,
           acao              = p_acao,
           janela            = p_janela,
           triggered_value   = coalesce(p_valor, a.triggered_value),
           campaign_id       = coalesce(p_campaign_id, a.campaign_id),
           rule_id           = coalesce(p_rule_id, a.rule_id),
           padrao_versao     = 2,
           vistas            = a.vistas + 1,
           primeira_deteccao = coalesce(a.primeira_deteccao, a.created_at)
     where a.company_id = p_company_id
       and a.chave_dedupe = p_chave_dedupe
       and a.resolved = false
    returning a.id into v_id;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.alerts (
    company_id, severity, title, description, resolved,
    tarefa, linha_produto, onde, quanto, acao, janela,
    chave_dedupe, padrao_versao, primeira_deteccao, vistas,
    triggered_value, campaign_id, rule_id)
  values (
    p_company_id, p_severidade, p_titulo, v_desc, false,
    p_tarefa, p_linha_produto, p_onde, p_quanto, p_acao, p_janela,
    p_chave_dedupe, 2, now(), 1,
    p_valor, p_campaign_id, p_rule_id)
  returning id into v_id;

  return v_id;
end
$function$;

revoke all on function public.emitir_alerta(uuid, alert_severity, text, text, text, text, text, text, text, text, text, numeric, uuid, uuid) from anon, authenticated;
grant execute on function public.emitir_alerta(uuid, alert_severity, text, text, text, text, text, text, text, text, text, numeric, uuid, uuid) to service_role;
