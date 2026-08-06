-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727134431
-- name: lev_sync_state_varredura
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Controle de progresso da varredura paginada de /api/leads do Dash.
-- Necessário porque a API ignora ordenação e filtro de data (provado por sondagem):
-- a única forma de obter os 180.292 leads é varrer todas as páginas em sequência.
-- Um cron avança alguns lotes por execução até concluir, sem ocupar sessão.
create table public.lev_sync_state (
  id             int primary key default 1 check (id = 1),
  proxima_pagina int not null default 51,   -- 1..50 já foram ingeridas manualmente
  tamanho        int not null default 500,
  total_paginas  int,
  total_esperado bigint,
  leads_gravados bigint not null default 0,
  concluido      boolean not null default false,
  ultimo_erro    text,
  atualizado     timestamptz not null default now()
);
insert into public.lev_sync_state (id) values (1);
comment on table public.lev_sync_state is 'Progresso da varredura de leads do Dash. Cron lev-varredura-leads avança a partir de proxima_pagina até concluido=true.';

alter table public.lev_sync_state enable row level security;
create policy lev_state_select on public.lev_sync_state for select to authenticated using (true);