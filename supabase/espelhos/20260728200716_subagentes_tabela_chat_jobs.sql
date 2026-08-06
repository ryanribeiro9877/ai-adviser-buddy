-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260728200716
-- name: subagentes_tabela_chat_jobs
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- [SUBAGENTES v1] Tabela de jobs assincronos do traffic-agent-job (EdgeRuntime.waitUntil).
-- Ciclo: queued -> running -> done | error. O resultado final vai para chat_messages
-- (o front ja escuta via Realtime); esta tabela guarda ciclo de vida, progresso por fase
-- e telemetria por subagente (diagnostico jsonb).
-- RLS LIGADA SEM POLICIES de proposito = so service_role le/escreve. Quando o front for
-- exibir progresso ao vivo (briefing futuro p/ Claude Code), adicionar policy de SELECT
-- por is_company_member - nao antes.

create table public.chat_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid,
  message text not null,
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  progresso jsonb not null default '[]'::jsonb,     -- [{fase, detalhe, em}]
  diagnostico jsonb,                                 -- telemetria final (planner, subagentes, sintese, tokens, ms)
  erro text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index chat_jobs_conversation_idx on public.chat_jobs (conversation_id, created_at desc);
create index chat_jobs_status_idx on public.chat_jobs (status) where status in ('queued','running');

alter table public.chat_jobs enable row level security;

-- Guarda-chuva do watchdog: job preso em running ha mais de 15 min e falha, nao misterio.
create or replace function public.expire_stale_chat_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update chat_jobs
     set status = 'error',
         erro = 'expirado: job em execucao ha mais de 15 minutos sem concluir (teto do worker de background e ~6 min; isto indica morte silenciosa do worker)',
         finished_at = now()
   where status in ('queued','running')
     and coalesce(started_at, created_at) < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.expire_stale_chat_jobs() from public, anon, authenticated;

-- Roda junto do expira-aprovacoes (de hora em hora, minuto 07 ja ocupado; usar 08).
select cron.schedule('expira-chat-jobs-hora', '8 * * * *', 'select public.expire_stale_chat_jobs();');
