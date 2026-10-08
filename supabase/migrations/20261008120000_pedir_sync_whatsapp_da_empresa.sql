-- 08/10/2026 - A tela WhatsApp pede dado vivo: o gestor filtra um periodo e quer
-- o numero de agora, nao o do sync das 09:30. O waba-sync so aceita chave MCP,
-- entao o navegador nao chama a edge direto. Esta RPC faz a ponte do mesmo jeito
-- que pedir_sync_da_empresa: confere que o usuario e membro da empresa e dispara
-- o waba-sync SO dessa empresa (body company_id), com a chave do proprio cron.
-- Fire-and-forget via pg_net: a tela recarrega depois de alguns segundos.
create or replace function public.pedir_sync_whatsapp_da_empresa(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_chave text;
  v_req bigint;
begin
  if auth.uid() is null then
    raise exception 'sessao ausente';
  end if;
  if not public.is_company_member(p_company_id, auth.uid()) then
    raise exception 'sem acesso a esta empresa';
  end if;

  v_chave := public.get_mcp_api_key('cron:waba-sync-daily');
  if v_chave is null or length(btrim(v_chave)) < 8 then
    raise exception 'credencial do sync de WhatsApp ausente';
  end if;

  select net.http_post(
    url := public.url_functions() || 'waba-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_chave
    ),
    body := jsonb_build_object('company_id', p_company_id),
    timeout_milliseconds := 150000
  ) into v_req;

  return jsonb_build_object('ok', true, 'request_id', v_req, 'pedido_em', now());
end;
$function$;

revoke all on function public.pedir_sync_whatsapp_da_empresa(uuid) from public, anon;
grant execute on function public.pedir_sync_whatsapp_da_empresa(uuid) to authenticated;
