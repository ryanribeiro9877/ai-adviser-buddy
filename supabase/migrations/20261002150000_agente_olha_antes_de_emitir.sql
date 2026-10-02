-- O agente passa a olhar a classe da segmentacao, a ficha ao vivo e o plano,
-- e uma recusa da Meta fica registrada em vez de morrer como texto no card.
-- Nao usar supabase db push: aplicar este arquivo e o espelho juntos.

alter table public.meta_execution_config
  add column if not exists gestor_nome text,
  add column if not exists waba_template_id uuid;

comment on column public.meta_execution_config.gestor_nome is
  'Nome da pessoa que opera esta empresa. O prompt nao inventa um nome fixo.';
comment on column public.meta_execution_config.waba_template_id is
  'Template de WhatsApp desta marca. Sem fallback por nome de empresa.';

create table if not exists public.segmentacao_resolvida (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversa_id uuid,
  termo_id text not null,
  classe text not null check (classe in ('interests', 'behaviors', 'work_positions', 'industries')),
  nome text not null,
  resolvido_em timestamptz not null default now()
);
create index if not exists idx_segmentacao_resolvida_empresa
  on public.segmentacao_resolvida (company_id, resolvido_em desc);
alter table public.segmentacao_resolvida enable row level security;
drop policy if exists segmentacao_resolvida_leitura on public.segmentacao_resolvida;
create policy segmentacao_resolvida_leitura on public.segmentacao_resolvida
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

create table if not exists public.plano_campanha (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  campanha_external_id text,
  campanha_nome text not null,
  versao integer not null default 1,
  vigente boolean not null default true,
  conjuntos jsonb not null,
  origem text not null default 'chat',
  created_at timestamptz not null default now()
);
create unique index if not exists idx_plano_campanha_vigente
  on public.plano_campanha (company_id, campanha_nome) where vigente;
alter table public.plano_campanha enable row level security;
drop policy if exists plano_campanha_leitura on public.plano_campanha;
create policy plano_campanha_leitura on public.plano_campanha
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

create table if not exists public.recusas_meta (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  approval_id uuid,
  conversa_id uuid,
  acao text,
  recusa text,
  motivo text,
  payload jsonb,
  campo_culpado text,
  correcao jsonb,
  card_corrigido_id uuid,
  created_at timestamptz not null default now()
);
alter table public.recusas_meta enable row level security;
drop policy if exists recusas_meta_leitura on public.recusas_meta;
create policy recusas_meta_leitura on public.recusas_meta
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

-- As duas colunas de destino do anuncio passam a carregar o mesmo valor.
-- destino_url e a fonte. destination_url espelha.
update public.ads
   set destino_url = destination_url
 where destino_url is null
   and destination_url is not null;

update public.ads
   set destination_url = destino_url
 where destino_url is not null
   and destination_url is distinct from destino_url;

create or replace function public.ads_destino_unico()
returns trigger
language plpgsql
as $$
begin
  if new.destino_url is null and new.destination_url is not null then
    new.destino_url := new.destination_url;
  end if;
  new.destination_url := new.destino_url;
  return new;
end;
$$;

drop trigger if exists ads_destino_unico on public.ads;
create trigger ads_destino_unico
  before insert or update of destino_url, destination_url on public.ads
  for each row execute function public.ads_destino_unico();

create or replace function public.alertar_cards_aprovados_sem_execucao()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer := 0;
  r record;
  chave text;
begin
  for r in
    select id, company_id, action, summary
    from public.approval_requests
    where status = 'approved'
      and executed_at is null
      and coalesce(reviewed_at, created_at) < now() - interval '15 minutes'
  loop
    chave := 'card_sem_execucao:' || r.id::text;
    if exists (
      select 1 from public.alerts
      where company_id = r.company_id
        and chave_dedupe = chave
        and resolved = false
    ) then
      continue;
    end if;
    insert into public.alerts (company_id, severity, title, description, resolved, chave_dedupe, onde, acao)
    values (
      r.company_id,
      'high',
      'Card aprovado sem execução',
      'O card ' || r.id::text || ' (' || coalesce(r.action, '') || ') foi aprovado e segue sem executed_at. ' || coalesce(r.summary, ''),
      false,
      chave,
      r.id::text,
      'Conferir a fila da meta-actions. Aprovacao sem execucao nao e sucesso.'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'cards-aprovados-sem-execucao';

select cron.schedule(
  'cards-aprovados-sem-execucao',
  '*/15 * * * *',
  $$select public.alertar_cards_aprovados_sem_execucao()$$
);

insert into public.agent_ferramentas
  (chave, descricao, parametros, doutrina, superficies, parametros_omitidos)
values
  ('buscar_comportamentos',
   'Resolve NOMES de COMPORTAMENTO (classe behaviors). O id volta com classe=behaviors e nao entra em interests.',
   '{"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"}}},"required":["nomes"]}'::jsonb,
   'Dois comportamentos pedidos como OU ficam no mesmo bloco, na chave behaviors.',
   array['chat','job']::text[],
   '{}'::jsonb),
  ('buscar_setores_de_trabalho',
   'Resolve cargo (work_positions) ou setor (industries). Passe classe.',
   '{"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"}},"classe":{"type":"string","enum":["work_positions","industries"]}},"required":["nomes"]}'::jsonb,
   'A classe do retorno e a chave do flexible_spec.',
   array['chat','job']::text[],
   '{}'::jsonb),
  ('buscar_segmentacao',
   'Resolve um termo e devolve id, nome e classe. Id sem esta chamada nao entra no card.',
   '{"type":"object","properties":{"nomes":{"type":"array","items":{"type":"string"}},"classe":{"type":"string","enum":["interests","behaviors","work_positions","industries"]}},"required":["nomes","classe"]}'::jsonb,
   'Classe interests, behaviors, work_positions ou industries. Nao invente id.',
   array['chat','job']::text[],
   '{}'::jsonb),
  ('ler_objeto',
   'Le ao vivo na Meta a ficha do objeto, com os campos pedidos por nome. Nao le o espelho.',
   '{"type":"object","properties":{"id":{"type":"string"},"nivel":{"type":"string"},"parte":{"type":"string"}},"required":["id","nivel"]}'::jsonb,
   'promoted_object e targeting so aparecem porque sao pedidos por nome. Falha e consulta_falhou, nao objeto vazio.',
   array['chat','job']::text[],
   '{}'::jsonb),
  ('conferir_contra_plano',
   'Compara o plano vigente com a ficha ao vivo. Devolve igual, diferente e ausente.',
   '{"type":"object","properties":{"campanha":{"type":"string"}}}'::jsonb,
   'Sem adjetivo. consulta_falhou nao e esta tudo certo.',
   array['chat','job']::text[],
   '{}'::jsonb),
  ('gravar_plano',
   'Grava a versao vigente do plano da campanha. Nao escreve na Meta.',
   '{"type":"object","properties":{"campanha_nome":{"type":"string"},"conjuntos":{"type":"array"}},"required":["campanha_nome","conjuntos"]}'::jsonb,
   'Cada conjunto traz nome, verba, idade, geo, segmentacao com id e classe, whatsapp.',
   array['chat','job']::text[],
   '{}'::jsonb)
on conflict (chave) do update set
  descricao = excluded.descricao,
  parametros = excluded.parametros,
  doutrina = excluded.doutrina,
  superficies = excluded.superficies,
  vigente = true;

update public.agent_ferramentas
   set superficies = array['chat','job']
 where chave = 'propose_action';

update public.agent_ferramentas
   set descricao = 'Resolve NOMES de INTERESSE (classe interests). O retorno traz classe. Comportamento nao passa por aqui.'
 where chave = 'buscar_interesses';
