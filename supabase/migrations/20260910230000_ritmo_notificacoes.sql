-- Sino da força-tarefa Ritmo (11/09/2026)
--
-- O QUE ENTRA: projeção, não entidade. Quatro estados da missão/ato viram
-- item tipo 'ritmo' na mesma RPC do sino. Aprovação pendente continua só
-- approval_requests.status = pending (comparação TIPADA). Ritmo NÃO entra
-- em aprovacoes_pendentes — senão o badge de card mentiria.
--
-- GASTO × TETO: snapshots.campaign_id = campaigns.id AND
-- campaigns.external_id = missao.campaign_id (o mesmo join do portão).
-- Janela civil America/Sao_Paulo: periodo_inicio .. least(hoje, periodo_fim).
--
-- REPLICA IDENTITY FULL: UPDATE de status (plano_pronto / encerrada) precisa
-- do registro antigo no Realtime; sem ele todo UPDATE parece novidade.

alter table public.ritmo_missoes replica identity full;
alter table public.ritmo_atos replica identity full;

create or replace function public.get_notificacoes_pendentes(p_company_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  with ap as (
    select id, 'aprovacao' as tipo, action as titulo, summary as descricao,
           case
             when expires_at is not null and expires_at <= now() + interval '2 hours' then 'critical'
             when expires_at is not null and expires_at <= now() + interval '6 hours' then 'high'
             else 'medium'
           end as urgencia,
           created_at, expires_at,
           case when expires_at is null then null
                else greatest(0, floor(extract(epoch from (expires_at - now())) / 60)::int) end as minutos_para_expirar,
           conversation_id
    from approval_requests
    where company_id = p_company_id
      and status = 'pending'::approval_status   -- comparacao TIPADA: rotulo errado = erro, nao zero
  ),
  al as (
    select id, 'alerta' as tipo, title as titulo, description as descricao,
           severity::text as urgencia, created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from alerts
    where company_id = p_company_id and resolved = false
  ),
  ri_plano as (
    select m.id, 'ritmo'::text as tipo,
           'Plano da força-tarefa pronto'::text as titulo,
           coalesce(nullif(m.campaign_name, ''), m.campaign_id) as descricao,
           'medium'::text as urgencia,
           coalesce(m.atualizado_em, m.criado_em) as created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from ritmo_missoes m
    where m.company_id = p_company_id
      and m.status = 'plano_pronto'
  ),
  ri_teto as (
    select m.id, 'ritmo'::text as tipo,
           'Força-tarefa perto do teto de gasto'::text as titulo,
           (coalesce(nullif(m.campaign_name, ''), m.campaign_id)
            || ' · gasto da janela em 80% ou mais do teto') as descricao,
           'high'::text as urgencia,
           coalesce(m.atualizado_em, m.criado_em) as created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from ritmo_missoes m
    where m.company_id = p_company_id
      and m.status = 'em_execucao'
      and m.teto_gasto_janela is not null
      and coalesce((
            select sum(s.spend)
              from metric_snapshots s
              join campaigns c
                on s.campaign_id = c.id
               and c.company_id = m.company_id
               and c.external_id = m.campaign_id
             where s.company_id = m.company_id
               and s.snapshot_date >= m.periodo_inicio
               and s.snapshot_date <= least(
                     (now() at time zone 'America/Sao_Paulo')::date,
                     m.periodo_fim)
          ), 0) >= 0.8 * m.teto_gasto_janela
  ),
  ri_falhou as (
    select distinct on (a.missao_id, a.acao, a.alvo_external_id)
           a.missao_id as id, 'ritmo'::text as tipo,
           'Ato da força-tarefa falhou'::text as titulo,
           (coalesce(nullif(m.campaign_name, ''), m.campaign_id)
            || ' · ' || a.acao) as descricao,
           'high'::text as urgencia,
           a.criado_em as created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from ritmo_atos a
    join ritmo_missoes m on m.id = a.missao_id
    where a.company_id = p_company_id
      and a.resultado = 'falhou'
      and not exists (
        select 1 from ritmo_atos b
         where b.missao_id = a.missao_id
           and b.acao = a.acao
           and b.alvo_external_id is not distinct from a.alvo_external_id
           and b.criado_em > a.criado_em
           and b.resultado in ('ok', 'simulado')
      )
    order by a.missao_id, a.acao, a.alvo_external_id, a.criado_em desc
  ),
  ri_encerrada as (
    select m.id, 'ritmo'::text as tipo,
           'Força-tarefa encerrada'::text as titulo,
           coalesce(nullif(m.campaign_name, ''), m.campaign_id) as descricao,
           'low'::text as urgencia,
           coalesce(m.encerrada_em, m.atualizado_em) as created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from ritmo_missoes m
    where m.company_id = p_company_id
      and m.status = 'encerrada'
      and coalesce(m.encerrada_em, m.atualizado_em) >= now() - interval '24 hours'
  ),
  ri as (
    select * from ri_plano
    union all select * from ri_teto
    union all select * from ri_falhou
    union all select * from ri_encerrada
  ),
  tudo as (
    select * from ap
    union all select * from al
    union all select * from ri
  )
  select jsonb_build_object(
    'total', (select count(*) from tudo),
    'aprovacoes_pendentes', (select count(*) from ap),
    'alertas_abertos', (select count(*) from al),
    'ritmo_pendentes', (select count(*) from ri),
    'criticos', (select count(*) from tudo where urgencia in ('critical','high')),
    'expirando_em_2h', (select count(*) from ap where minutos_para_expirar is not null and minutos_para_expirar <= 120),
    'itens', (select coalesce(jsonb_agg(to_jsonb(t) order by
                 case t.urgencia when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
                 t.created_at desc), '[]'::jsonb)
              from (select * from tudo limit 50) t)
  );
$$;

revoke all on function public.get_notificacoes_pendentes(uuid) from public, anon;
grant execute on function public.get_notificacoes_pendentes(uuid) to authenticated, service_role;

comment on function public.get_notificacoes_pendentes(uuid) is
  'Pendencias da empresa para o sino: aprovacoes pending (enum tipado) + alertas abertos + forca-tarefa Ritmo (plano pronto, teto 80%, ato falhou sem ok/simulado posterior, encerrada em 24h). Ritmo nao conta em aprovacoes_pendentes. security invoker: RLS vale.';

-- Doutrina do Executor: a exceção é concessão nomeada, não interruptor global.
-- O card no chat permanece fora de missão Ritmo com concessão válida.
update public.agents
   set papel = $ag$Unico agente com direito de provocar escrita. Emite card de aprovacao, valida o pedido contra o contrato de execucao declarado, sobe midia para a biblioteca da Meta e acompanha o card ate a Meta confirmar. Nao decide MERITO: decide se o ato e formalmente possivel e o coloca na fila para decisao humana.

Excecao: missao Ritmo com concessao valida escreve via ritmo-executar, sem card. Fora disso, card.$ag$,
       updated_at = now()
 where codigo = 'AG-06';
