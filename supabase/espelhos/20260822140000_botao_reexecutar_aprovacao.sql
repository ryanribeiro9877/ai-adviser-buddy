-- Espelho: botao "Pode tentar de novo" (RPC reexecutar_aprovacao).
-- Ver supabase/migrations/20260822140000_botao_reexecutar_aprovacao.sql

create or replace function public.reexecutar_aprovacao(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  r public.approval_requests;
  v_key text;
  v_re boolean;
begin
  if v_uid is null then raise exception 'autenticação obrigatória'; end if;
  if not public.has_role(v_uid, 'admin'::app_role) then
    raise exception 'apenas administradores podem reexecutar aprovações';
  end if;

  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'pedido % não encontrado', p_id; end if;
  if r.status <> 'approved'::approval_status then
    raise exception 'só é possível tentar de novo um pedido já aprovado (status atual: %)', r.status;
  end if;
  if r.executed_at is not null then
    raise exception 'este pedido já teve escrita na Meta; reexecução exige um card novo';
  end if;
  if r.ultima_falha is null then
    raise exception 'não há falha registrada para reexecutar';
  end if;
  v_re := coalesce((r.ultima_falha->>'re_executavel')::boolean, true);
  if v_re is false then
    raise exception 'não é possível re-executar (houve escrita parcial)';
  end if;
  if r.action = 'registrar_veredito_peca' then
    raise exception 'veredito de compliance não se reexecuta na Meta';
  end if;

  v_key := public.get_mcp_api_key('trigger:disparar_execucao_aprovacao');
  perform net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/meta-actions',
    headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', v_key),
    body := jsonb_build_object('origem','retry_ui','approval_id', r.id),
    timeout_milliseconds := 60000
  );

  insert into public.audit_log(company_id, user_id, action, target_type, target_id, details)
  values (
    r.company_id, v_uid, 'approval_retry', 'approval_request', p_id::text,
    jsonb_build_object(
      'acao', r.action,
      'resumo', r.summary,
      'tentativa_anterior', coalesce((r.ultima_falha->>'tentativa')::int, 0)
    )
  );

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$fn$;

comment on function public.reexecutar_aprovacao(uuid) is
  'Dispara de novo a edge meta-actions para um card APROVADO com ultima_falha reexecutavel (executed_at nulo). Usado pelo botao "Pode tentar de novo" no ActionCard. Apenas admin.';

revoke all on function public.reexecutar_aprovacao(uuid) from public, anon;
grant execute on function public.reexecutar_aprovacao(uuid) to authenticated;
grant execute on function public.reexecutar_aprovacao(uuid) to service_role;
