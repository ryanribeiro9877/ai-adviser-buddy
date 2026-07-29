-- =====================================================================================
-- EXPIRACAO DE APROVACOES EM 24H
-- Risco que motiva: uma aprovacao decidida hoje sobre um card criado ha 5 dias executa
-- contra uma conta que mudou - orcamento diferente, criativo pausado, campanha renomeada.
-- Decisao do Ryan: 24 horas.
--
-- DECISAO DE IMPLEMENTACAO: o enum approval_status tem apenas pending/approved/rejected.
-- Adicionar 'expired' seria aditivo no banco, mas o front e o meta-actions nao conhecem o
-- valor novo e renderizariam/tratariam como desconhecido. Por isso o vencido vira 'rejected'
-- com review_note explicito: nenhum consumidor precisa mudar, e a auditoria fica clara.
-- Efeito pratico: o meta-actions, que executa apenas o que esta 'pending'/'approved',
-- nunca encontra um card vencido em estado executavel.
-- =====================================================================================

alter table public.approval_requests
  add column if not exists expires_at timestamptz;

-- Backfill: cards existentes ganham prazo a partir da criacao.
update public.approval_requests
   set expires_at = created_at + interval '24 hours'
 where expires_at is null;

alter table public.approval_requests
  alter column expires_at set default (now() + interval '24 hours');

comment on column public.approval_requests.expires_at is
  'Prazo de decisao. Card pending nao decidido ate aqui e marcado como rejected pela funcao expire_stale_approvals() (cron a cada hora), com review_note declarando a expiracao. Evita que aprovacao antiga execute contra estado de conta que mudou.';

create or replace function public.expire_stale_approvals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_n int;
begin
  with venc as (
    update public.approval_requests
       set status = 'rejected'::approval_status,
           reviewed_at = now(),
           review_note = coalesce(review_note || ' | ', '') ||
             format('EXPIRADO automaticamente: nao decidido em 24h (criado %s, prazo %s).',
                    to_char(created_at, 'DD/MM HH24:MI'), to_char(expires_at, 'DD/MM HH24:MI'))
     where status = 'pending'
       and expires_at is not null
       and expires_at < now()
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from venc;

  v_n := coalesce(v_n, 0);

  -- Registro em audit_log: expiracao e decisao do sistema e precisa ser auditavel.
  if v_n > 0 then
    insert into audit_log (company_id, user_id, action, target_type, target_id, details)
    select ar.company_id, null, 'approval_expired', 'approval_request', ar.id,
           jsonb_build_object('acao', ar.action, 'resumo', ar.summary,
                              'criado_em', ar.created_at, 'prazo', ar.expires_at,
                              'origem', 'cron:expire_stale_approvals')
      from public.approval_requests ar
     where ar.id = any(v_ids);
  end if;

  return jsonb_build_object('verificado_em', now(), 'expirados', v_n);
end $$;

revoke all on function public.expire_stale_approvals() from public, anon;
grant execute on function public.expire_stale_approvals() to authenticated, service_role;

comment on function public.expire_stale_approvals() is
  'Marca como rejected os pedidos de aprovacao pending vencidos (24h), com nota de expiracao e registro em audit_log. Roda de hora em hora (cron expira-aprovacoes-hora). SQL puro: nao depende de edge nem do IDLE_TIMEOUT.';

select cron.schedule('expira-aprovacoes-hora', '7 * * * *', $$select public.expire_stale_approvals();$$);
