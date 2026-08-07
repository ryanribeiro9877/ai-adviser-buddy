-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807211828
-- name: estado_do_card_conta_a_verdade_e_nota_fase3_corrigida
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- CONSERTO 1 + CONSERTO 3 (07/08/2026)
--
-- CONSERTO 1: `executed_at IS NULL` significava DUAS coisas incompativeis - "ainda nao executou"
-- e "executou e falhou antes de escrever qualquer coisa". Card b5e2f338-f28c-4c8e-b89f-a8d82d0e16ec:
-- aprovado 20:55:58, create_adset recusado pelo Pipeboard 20:56:01 por conflito de orcamento,
-- e o card ficou status=approved / executed_at=NULL / execution_result=NULL. get_aprovacoes leu
-- esse estado e devolveu "aprovado, ainda NAO executado"; o agente completou a lacuna dizendo ao
-- gestor "aguarde alguns instantes, o conjunto esta sendo criado". A falha existia so no audit_log.
--
-- A falha passa a morar NO CARD, em coluna propria. NAO em execution_result e NAO mexendo em
-- executed_at, porque os dois ja carregam invariantes que funcionam:
--   executed_at is null      = card ainda elegivel para a varredura (retry legitimo)
--   executed_at + ok=false   = fechado apos escrita PARCIAL (creative orfao), sem retry
-- ultima_falha e ortogonal: ela diz "a ultima tentativa terminou, e terminou assim". Com ela,
-- "vai executar" e "tentou e falhou, e segue elegivel" param de ser o mesmo estado.

alter table public.approval_requests
  add column if not exists ultima_falha jsonb;

comment on column public.approval_requests.ultima_falha is
  'Veredito da ULTIMA tentativa de execucao que terminou em falha. Chaves: em (timestamptz), etapa, recusa (nome curto), motivo_para_o_gestor (linguagem de negocio), detalhe_tecnico, tentativa (int), re_executavel (bool), driver_escrita. NULL = nenhuma tentativa falhou. Existe porque executed_at IS NULL era ambiguo entre "nao executou ainda" e "executou e falhou antes de escrever" - ambiguidade que em 07/08/2026 fez o agente prometer ao gestor um conjunto que ja tinha falhado. Limpa no sucesso.';

create index if not exists approval_requests_falha_aberta
  on public.approval_requests (company_id, created_at desc)
  where ultima_falha is not null and executed_at is null;

-- CONSERTO 3: a nota gravada em todo approval_approved dizia que a execucao no Meta "ainda nao e
-- automatica" e mandava aplicar no Gerenciador. Isso e FALSO desde 07/08/2026: existe o trigger
-- trg_executar_aprovacao -> disparar_execucao_aprovacao(), que chama a edge meta-actions no ato
-- da aprovacao. A string vinha da migracao 20260723195448 (F33 ActionCards), quando a fase 3 de
-- fato nao existia, e sobreviveu a automacao inteira sem ninguem reler.
-- A nota nova descreve o que o sistema FAZ, e nao o que ele fazia em julho.
create or replace function public.decide_approval(p_id uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
                         then 'Aprovar DISPARA a execucao na hora: o trigger trg_executar_aprovacao chama a edge meta-actions no ato. Nao existe fila amadurecendo nem processamento em segundo plano. Segundos depois, o card ja carrega o desfecho: executed_at + execution_result.ok=true com o identificador do objeto, ou ultima_falha com o motivo. Card aprovado sem identificador ou FALHOU ou nao rodou - nunca "esta sendo processado".'
                         end));
  return jsonb_build_object('ok', true, 'id', p_id, 'novo_status', p_decision);
end $function$;
revoke all on function public.decide_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_approval(uuid, text, text) to authenticated, service_role;

do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='approval_requests' and column_name='ultima_falha') then
    raise exception 'approval_requests.ultima_falha nao foi criada';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='decide_approval'
                and pg_get_functiondef(p.oid) like '%Fase 3%') then
    raise exception 'a nota falsa da Fase 3 continua em decide_approval';
  end if;
end $$;
