-- =============================================================================
-- ESPELHO (já aplicado em produção — NÃO re-executar; commit no git p/ histórico)
-- Migração: f33_actioncards_aditivo · 23/07/2026 · gestão_marketing (gzjwnjdpxpbmdhcyefvs)
-- =============================================================================
-- Contexto: approval_requests e audit_log JÁ EXISTIAM (scaffold Lovable) com enums
-- approval_entity(campaign,budget,ad,audience,config) e approval_status(pending,
-- approved,rejected) e policies: SELECT membros / INSERT membros / UPDATE só admin.
-- Esta migração é ADITIVA e respeita esse contrato.
-- traffic-chat v8 ganhou a tool propose_action: cria pedido pending + audit
-- 'approval_created' e devolve action_cards[] na resposta. NADA executa no Meta
-- (Fase 4); aprovado = aplicar manualmente no Gerenciador por ora.
-- Provas E2E: alvo ambíguo → perguntou sem criar card; alvo inexistente → negou;
-- confirmação → card cf9343ba criado com justificativa baseada em dados reais;
-- decide_approval (impersonação admin + rollback): approved ✓, audit ✓, dupla
-- decisão bloqueada ✓; trigger de imutabilidade bloqueou UPDATE e DELETE como
-- postgres ✓. Estado final: card pending aguardando teste de tela.
-- =============================================================================

alter table public.approval_requests
  add column if not exists conversation_id uuid references public.chat_conversations(id);
create index if not exists idx_approval_conversation on public.approval_requests(conversation_id);
create index if not exists idx_approval_company_status on public.approval_requests(company_id, status);
comment on column public.approval_requests.conversation_id is 'Conversa do chat Operação que originou o pedido (ActionCard).';

create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log é imutável (operação % bloqueada)', tg_op;
end $$;
drop trigger if exists trg_audit_immutable on public.audit_log;
create trigger trg_audit_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create or replace function public.decide_approval(p_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r public.approval_requests;
begin
  if v_uid is null then raise exception 'autenticação obrigatória'; end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'decisão inválida: use approved ou rejected';
  end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'pedido % não encontrado', p_id; end if;
  if not public.has_role(v_uid, 'admin'::app_role) then
    raise exception 'apenas administradores podem decidir aprovações';
  end if;
  if r.status <> 'pending'::approval_status then
    raise exception 'pedido já decidido (status atual: %)', r.status;
  end if;

  update public.approval_requests
     set status = p_decision::approval_status,
         reviewed_by = v_uid, reviewed_at = now(), review_note = p_reason
   where id = p_id;

  insert into public.audit_log(company_id, user_id, action, target_type, target_id, details)
  values (r.company_id, v_uid,
          case when p_decision = 'approved' then 'approval_approved' else 'approval_rejected' end,
          'approval_request', p_id::text,
          jsonb_build_object('acao', r.action, 'resumo', r.summary, 'motivo', p_reason,
            'nota', case when p_decision = 'approved'
                         then 'Fase 3: execução no Meta ainda não é automática — aplicar manualmente no Gerenciador'
                         end));
  return jsonb_build_object('ok', true, 'id', p_id, 'novo_status', p_decision);
end $$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated, service_role;
