-- [NOTIFICACOES] Pre-requisitos de backend para a central de notificacoes (sino + toast).
--
-- MOTIVO: a publicacao supabase_realtime cobria apenas chat_jobs e chat_messages. Sem
-- approval_requests e alerts publicando, o aviso na tela dependeria de polling - pior
-- experiencia e carga desnecessaria. REPLICA IDENTITY FULL para que o front receba o
-- registro ANTIGO no UPDATE e consiga distinguir transicao (pendente->aprovado,
-- alerta aberto->resolvido) em vez de so ver o estado novo.
--
-- PRINCIPIO: nao existe tabela de notificacoes. Notificacao NAO e entidade propria - e
-- projecao de dois estados que ja existem: aprovacao pendente e alerta nao resolvido.
-- Criar tabela separada abriria uma segunda fonte de verdade que dessincroniza (o item
-- decidido no banco continuaria "pendente" na notificacao). Estado de UI deriva do banco.

alter table public.approval_requests replica identity full;
alter table public.alerts replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'approval_requests'
  ) then
    alter publication supabase_realtime add table public.approval_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;
end $$;

-- Fonte unica das pendencias: uma chamada para o badge e para a lista do sino.
-- security invoker => a RLS das duas tabelas continua valendo (membro da empresa).
create or replace function public.get_notificacoes_pendentes(p_company_id uuid)
returns jsonb
language sql
stable
security invoker
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
    where company_id = p_company_id and status::text = 'pendente'
  ),
  al as (
    select id, 'alerta' as tipo, title as titulo, description as descricao,
           severity::text as urgencia, created_at,
           null::timestamptz as expires_at, null::int as minutos_para_expirar,
           null::uuid as conversation_id
    from alerts
    where company_id = p_company_id and resolved = false
  ),
  tudo as (select * from ap union all select * from al)
  select jsonb_build_object(
    'total', (select count(*) from tudo),
    'aprovacoes_pendentes', (select count(*) from ap),
    'alertas_abertos', (select count(*) from al),
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
  'Pendencias da empresa para o sino de notificacoes: aprovacoes com status pendente + alertas nao resolvidos, com urgencia derivada (aprovacao perto de expirar sobe para high/critical) e minutos restantes. Fonte unica do badge e da lista. security invoker: RLS vale.';
