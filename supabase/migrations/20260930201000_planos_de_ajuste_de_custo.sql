-- Planos do vigia de regua. O cliente autenticado so le a propria empresa.
-- Nao ha policy de escrita: insert/update pelo papel authenticated tem de falhar
-- (42501). service_role grava. Nao copiar USING (true) de agent_context.

create table public.planos_de_ajuste_de_custo (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  nivel text not null check (nivel in ('campanha','conjunto','anuncio')),
  alvo_external_id text not null,
  alvo_nome text not null,
  campanha_external_id text,
  conjunto_external_id text,
  marca text,
  metrica text not null,
  base_declarada text not null,
  regua_valor numeric not null,
  regua_fonte text not null,
  janela_dias int not null,
  janela_inicio date not null,
  janela_fim date not null,
  gasto_da_base numeric not null,
  resultados_da_base int not null,
  custo_observado numeric not null,
  custo_7d numeric,
  custo_3d numeric,
  dias_com_entrega int not null,
  cobertura jsonb not null default '{}'::jsonb,
  status text not null default 'aberto'
    check (status in ('aberto','proposto','descartado','verificado_ok','verificado_sem_efeito','expirado')),
  severidade text not null check (severidade in ('baixa','media','alta')),
  alavanca text,
  plano jsonb not null default '{}'::jsonb,
  data_de_leitura date,
  chave_dedupe text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz,
  proposto_em timestamptz,
  approval_ids uuid[],
  verificado_em timestamptz,
  custo_na_verificacao numeric,
  veredito_nota text,
  tentativas_na_familia int not null default 0
);

comment on table public.planos_de_ajuste_de_custo is
  'Plano do vigia de regua de custo por conversa. Nao executa e nao emite card. Card so quando o gestor manda emitir. chave_dedupe = nivel || '':'' || alvo_external_id || '':'' || metrica. Plano aberto ou proposto na mesma chave e atualizado, nao duplicado. Quem grava e o job (service_role).';

create unique index planos_ajuste_abertos_unicos
  on public.planos_de_ajuste_de_custo (company_id, chave_dedupe)
  where status in ('aberto','proposto');

create index planos_ajuste_por_leitura
  on public.planos_de_ajuste_de_custo (data_de_leitura)
  where status = 'proposto';

alter table public.planos_de_ajuste_de_custo enable row level security;

revoke all on table public.planos_de_ajuste_de_custo from public, anon, authenticated;
grant select on table public.planos_de_ajuste_de_custo to authenticated;
grant all on table public.planos_de_ajuste_de_custo to service_role;

create policy planos_ajuste_select_membro
  on public.planos_de_ajuste_de_custo
  for select
  to authenticated
  using (public.is_company_member(company_id, (select auth.uid())));
