-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260731215609
-- name: gatilho_execucao_pos_aprovacao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [EXECUCAO POS-APROVACAO] Aprovou o card -> o sistema puxa a corda sozinho.
--
-- ACHADO (31/07/2026, investigacao dos 3 cards aprovados que nao subiram): a meta-actions
-- JA varre os cards aprovados-e-nao-executados quando chamada (sonda com corpo vazio
-- processou os 3 e simulou). O elo ausente era o DISPARO: decide_approval so registra a
-- decisao e NINGUEM chamava a executora depois do clique do humano. Este trigger fecha o
-- elo: card vira approved -> POST assincrono na meta-actions (que continua sendo a UNICA
-- autoridade de travas: master, flag por acao, dry_run, conta permitida, teto por hora -
-- com travas fechadas ela simula/recusa, e o comportamento fica VISIVEL em vez de mudo).

create or replace function public.disparar_execucao_aprovacao()
returns trigger
language plpgsql
security definer
as $$
declare v_key text;
begin
  if new.status = 'approved'::approval_status
     and (old.status is distinct from new.status) then
    select api_key into v_key from public.mcp_config where id = 1;
    perform net.http_post(
      url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/meta-actions',
      headers := jsonb_build_object('Content-Type','application/json','x-mcp-key', v_key),
      body := jsonb_build_object('origem','trigger_aprovacao','approval_id', new.id),
      timeout_milliseconds := 60000
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_executar_aprovacao on public.approval_requests;
create trigger trg_executar_aprovacao
  after update of status on public.approval_requests
  for each row execute function public.disparar_execucao_aprovacao();

comment on function public.disparar_execucao_aprovacao() is
  'Ao aprovar um card (status -> approved), dispara POST assincrono na meta-actions, que varre os aprovados nao executados e aplica TODAS as travas (master, flag da acao, dry_run, conta, teto/hora). O trigger nao decide nada: so puxa a corda. pg_cron/pg_net: o POST e enfileirado; a verdade da execucao fica em net._http_response e no registro da propria meta-actions.';

select 'gatilho_instalado' as ok,
       (select tgname from pg_trigger where tgname='trg_executar_aprovacao') as trigger;