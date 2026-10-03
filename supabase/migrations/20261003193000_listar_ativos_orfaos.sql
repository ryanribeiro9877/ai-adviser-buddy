-- Faxina da biblioteca: a leitura classifica, a escrita ainda não existe.
-- Espelho: supabase/espelhos/20261003193000_listar_ativos_orfaos.sql
--
-- Tirar um arquivo da biblioteca NÃO apaga o histórico de entrega (ads_insights /
-- ad_metric_snapshots), NÃO apaga a avaliação de política feita no momento da
-- veiculação, e NÃO apaga a reputação da conta, da Página ou do portfólio.
-- A faxina só existe para achar a peça e não confundir duplicata.
--
-- arquivar_ativo não entra aqui. É irreversível: pausar, orçamento e criativo
-- se desfazem; apagar o arquivo, não. A listagem roda sozinha até a conferência
-- na conta mostrar o 01. Setembro como duplicata, o La Felicità fora da lista
-- e nenhum candidato com gasto nos últimos 90 dias.

-- Memória do que saiu. A linha nasce ANTES da chamada à Meta: depois que o
-- arquivo some, a releitura não tem o que ler. resultado_meta fica nulo até
-- a Meta responder. Lote pela metade não é "executado".
create table if not exists public.ativos_arquivados (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  account_id text not null,
  tipo text not null check (tipo in ('video', 'imagem')),
  ativo_id text not null,
  nome text,
  motivo text not null check (motivo in (
    'nunca_usado', 'duplicata', 'sem_uso_90d', 'residuo_de_teste', 'anuncio_inativo'
  )),
  anuncios jsonb not null default '[]'::jsonb,
  gasto_total numeric,
  ultimo_gasto_em date,
  duplicata_de text,
  approval_id uuid references public.approval_requests(id) on delete set null,
  aprovado_por uuid,
  aprovado_em timestamptz,
  registrado_em timestamptz not null default now(),
  resultado_meta jsonb,
  unique (company_id, account_id, tipo, ativo_id)
);

create index if not exists ativos_arquivados_approval_id_idx
  on public.ativos_arquivados (approval_id);

comment on table public.ativos_arquivados is
  'Registro do arquivo tirado da biblioteca, gravado antes da chamada à Meta. Não substitui ads_insights, a avaliação de política nem a reputação da conta. resultado_meta nulo significa que a Meta ainda não respondeu; lote com falha no meio não é executado.';

comment on column public.ativos_arquivados.resultado_meta is
  'Resposta da Meta para ESTE arquivo. Nulo = a chamada ainda não voltou. Erro da Meta entra aqui com o nome do erro, sem virar mensagem genérica.';

alter table public.ativos_arquivados enable row level security;

drop policy if exists ativos_arquivados_ler on public.ativos_arquivados;
create policy ativos_arquivados_ler on public.ativos_arquivados
  for select to authenticated
  using (public.is_company_member(company_id, (select auth.uid())));

revoke all on table public.ativos_arquivados from anon;
grant select on table public.ativos_arquivados to authenticated;

-- Pedido de apagar rastro, evitar detecção ou limpar histórico.
-- Recusa porque não funciona: o histórico não está no arquivo.
-- E porque o pedido aponta para outro problema, que é o que precisa ser olhado.
create or replace function public.motivo_recusa_de_rastro(p_texto text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
begin
  if p_texto is null or btrim(p_texto) = '' then
    return null;
  end if;
  if p_texto ~* 'apagar[[:space:]]+rastro|evitar[[:space:]]+detec|limpar[[:space:]]+hist[oó]rico|apagar[[:space:]]+hist[oó]rico|sumir[[:space:]]+com[[:space:]]+(o[[:space:]]+)?hist' then
    return 'o_historico_nao_esta_no_ativo';
  end if;
  return null;
end;
$fn$;

comment on function public.motivo_recusa_de_rastro(text) is
  'Recusa justificativa de apagar rastro, evitar detecção ou limpar histórico. Não é um filtro moral em cima de um efeito real: remover o arquivo não mexe em ads_insights, na política nem na reputação.';

revoke all on function public.motivo_recusa_de_rastro(text) from public, anon, authenticated;
grant execute on function public.motivo_recusa_de_rastro(text) to service_role;

-- Ids citados no card (meta_video_id, image_hash e os mesmos nomes aninhados).
create or replace function public.ids_de_midia_no_json(p_payload jsonb)
returns table(tipo text, ativo_id text)
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select 'video'::text, m[1]
    from regexp_matches(
      coalesce(p_payload::text, ''),
      '"(?:meta_)?video_id"[[:space:]]*:[[:space:]]*"?([0-9]{6,})"?',
      'g'
    ) as m
  union
  select 'imagem'::text, m[1]
    from regexp_matches(
      coalesce(p_payload::text, ''),
      '"(?:meta_)?image_hash"[[:space:]]*:[[:space:]]*"([0-9A-Fa-f]{8,})"',
      'g'
    ) as m;
$fn$;

revoke all on function public.ids_de_midia_no_json(jsonb) from public, anon, authenticated;
grant execute on function public.ids_de_midia_no_json(jsonb) to service_role;

-- Leitura pura. Não grava, não chama a Meta.
-- A biblioteca (vídeos e imagens) e o mapa anúncio→arquivo vêm completos do chamador.
-- Gasto e card aberto são lidos aqui, para o chamador não "esquecer" o histórico.
-- p_gastos / p_cards só existem para o ensaio: nulos leem o banco. Array (mesmo vazio)
-- substitui o banco — a edge de produção não passa esses argumentos.
create or replace function public.listar_ativos_orfaos(
  p_company_id uuid,
  p_account_id text,
  p_dias_sem_uso integer default 90,
  p_videos jsonb default null,
  p_imagens jsonb default null,
  p_anuncios jsonb default null,
  p_videos_ok boolean default false,
  p_imagens_ok boolean default false,
  p_anuncios_ok boolean default false,
  p_gastos jsonb default null,
  p_cards jsonb default null
) returns table(
  tipo text,
  id text,
  nome text,
  motivo text,
  anuncios jsonb,
  ultimo_gasto_em date,
  gasto_total numeric,
  bloqueado_por text,
  duplicata_de text,
  candidato boolean
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_dias integer := coalesce(p_dias_sem_uso, 90);
  v_conta text := replace(btrim(coalesce(p_account_id, '')), 'act_', '');
begin
  if p_company_id is null or v_conta = '' then
    raise exception 'escopo_ausente: company_id e account_id são obrigatórios.'
      using errcode = 'P0001';
  end if;
  if v_dias < 1 or v_dias > 3650 then
    raise exception 'dias_sem_uso_invalido: use um inteiro entre 1 e 3650.'
      using errcode = 'P0001';
  end if;
  -- Lista curta, falha ou argumento ausente não é biblioteca vazia.
  if coalesce(p_videos_ok, false) is not true
     or coalesce(p_imagens_ok, false) is not true
     or coalesce(p_anuncios_ok, false) is not true
     or jsonb_typeof(p_videos) is distinct from 'array'
     or jsonb_typeof(p_imagens) is distinct from 'array'
     or jsonb_typeof(p_anuncios) is distinct from 'array'
     or (p_gastos is not null and jsonb_typeof(p_gastos) is distinct from 'array')
     or (p_cards is not null and jsonb_typeof(p_cards) is distinct from 'array')
  then
    raise exception 'listagem_incompleta: a biblioteca ou os anúncios não vieram inteiros. Lista vazia com escopo zero não é faxina.'
      using errcode = 'P0001';
  end if;

  return query
  with biblioteca as (
    select 'video'::text as tipo,
           btrim(v.id) as id,
           nullif(btrim(v.nome), '') as nome,
           v.criado_em,
           lower(regexp_replace(btrim(coalesce(v.nome, '')), '[[:space:]]+', ' ', 'g')) as nome_norm
      from jsonb_to_recordset(p_videos) as v(id text, nome text, criado_em timestamptz)
     where btrim(coalesce(v.id, '')) <> ''
    union all
    select 'imagem'::text,
           btrim(i.id),
           nullif(btrim(i.nome), ''),
           i.criado_em,
           lower(regexp_replace(btrim(coalesce(i.nome, '')), '[[:space:]]+', ' ', 'g'))
      from jsonb_to_recordset(p_imagens) as i(id text, nome text, criado_em timestamptz)
     where btrim(coalesce(i.id, '')) <> ''
  ),
  anuncios_in as (
    select btrim(a.id) as ad_id,
           nullif(btrim(a.nome), '') as ad_nome,
           nullif(upper(btrim(coalesce(a.effective_status, ''))), '') as efetivo,
           coalesce(a.video_ids, '[]'::jsonb) as video_ids,
           coalesce(a.image_hashes, '[]'::jsonb) as image_hashes
      from jsonb_to_recordset(p_anuncios) as a(
        id text,
        nome text,
        effective_status text,
        video_ids jsonb,
        image_hashes jsonb
      )
     where btrim(coalesce(a.id, '')) <> ''
  ),
  refs as (
    select distinct x.ad_id, x.ad_nome, x.efetivo, x.tipo, x.ativo_id
      from (
        select n.ad_id, n.ad_nome, n.efetivo, 'video'::text as tipo, btrim(vid) as ativo_id
          from anuncios_in n
          cross join lateral jsonb_array_elements_text(n.video_ids) as vid
        union all
        select n.ad_id, n.ad_nome, n.efetivo, 'imagem'::text, btrim(hsh)
          from anuncios_in n
          cross join lateral jsonb_array_elements_text(n.image_hashes) as hsh
      ) x
     where x.ativo_id <> ''
  ),
  gastos_vivos as (
    select s.ad_external_id as ad_id,
           sum(coalesce(s.spend, 0)) as gasto,
           max(s.snapshot_date) filter (where coalesce(s.spend, 0) > 0) as ultimo
      from public.ad_metric_snapshots s
     where p_gastos is null
       and s.company_id = p_company_id
       and replace(coalesce(s.account_id, ''), 'act_', '') = v_conta
     group by s.ad_external_id
    union all
    select btrim(g.ad_id), coalesce(g.gasto, 0), g.ultimo_em
      from jsonb_to_recordset(coalesce(p_gastos, '[]'::jsonb)) as g(ad_id text, gasto numeric, ultimo_em date)
     where p_gastos is not null
       and btrim(coalesce(g.ad_id, '')) <> ''
  ),
  espelho as (
    select a.external_id as ad_id, coalesce(a.spend, 0) as spend
      from public.ads a
     where p_gastos is null
       and a.company_id = p_company_id
       and replace(coalesce(a.account_id, ''), 'act_', '') = v_conta
       and a.ausente_na_graph_em is null
  ),
  gasto_do_anuncio as (
    select r.ad_id,
           case
             when coalesce(g.gasto, 0) > 0 then g.gasto
             else coalesce(e.spend, 0)
           end as gasto,
           case
             when coalesce(g.gasto, 0) > 0 then g.ultimo
             else null
           end as ultimo
      from (select distinct refs.ad_id from refs) r
      left join gastos_vivos g on g.ad_id = r.ad_id
      left join espelho e on e.ad_id = r.ad_id
  ),
  uso as (
    select r.tipo,
           r.ativo_id,
           coalesce((
             select jsonb_agg(jsonb_build_object('id', s.ad_id, 'nome', s.ad_nome) order by s.ad_nome)
               from (
                 select distinct r2.ad_id, r2.ad_nome
                   from refs r2
                  where r2.tipo = r.tipo and r2.ativo_id = r.ativo_id
               ) s
           ), '[]'::jsonb) as anuncios,
           bool_or(r.efetivo = 'ACTIVE') as em_uso,
           bool_or(r.efetivo = 'WITH_ISSUES') as with_issues,
           bool_or(r.efetivo in ('PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED', 'DISAPPROVED')) as em_revisao,
           bool_or(r.efetivo is null) as status_desconhecido,
           coalesce(sum(g.gasto), 0) as gasto_total,
           max(g.ultimo) as ultimo_gasto_em
      from refs r
      left join gasto_do_anuncio g on g.ad_id = r.ad_id
     group by r.tipo, r.ativo_id
  ),
  cards as (
    select ar.status::text as status, m.tipo, m.ativo_id
      from public.approval_requests ar
      cross join lateral public.ids_de_midia_no_json(ar.payload) m
     where p_cards is null
       and ar.company_id = p_company_id
       and ar.status in ('pending', 'approved')
       and ar.executed_at is null
    union all
    select c.status, 'video'::text, btrim(vid)
      from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb)) as c(
        status text, video_ids jsonb, image_hashes jsonb
      )
      cross join lateral jsonb_array_elements_text(coalesce(c.video_ids, '[]'::jsonb)) as vid
     where p_cards is not null
       and btrim(vid) <> ''
    union all
    select c.status, 'imagem'::text, btrim(hsh)
      from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb)) as c(
        status text, video_ids jsonb, image_hashes jsonb
      )
      cross join lateral jsonb_array_elements_text(coalesce(c.image_hashes, '[]'::jsonb)) as hsh
     where p_cards is not null
       and btrim(hsh) <> ''
  ),
  card_bloqueio as (
    select c.tipo,
           c.ativo_id,
           bool_or(c.status = 'approved') as aprovado,
           bool_or(c.status = 'pending') as pendente
      from cards c
     group by c.tipo, c.ativo_id
  ),
  grupos as (
    select b.tipo, b.nome_norm
      from biblioteca b
     where length(b.nome_norm) >= 4
     group by b.tipo, b.nome_norm
    having count(*) > 1
       and count(b.criado_em) = count(*)
  ),
  -- Mesmo nome, alguma cópia sem data: não escolhe qual fica. Escolher no escuro
  -- apagaria a cópia errada — foi a recente que confundiu o conjunto 4.
  inseguros as (
    select b.tipo, b.nome_norm
      from biblioteca b
     where length(b.nome_norm) >= 4
     group by b.tipo, b.nome_norm
    having count(*) > 1
       and count(b.criado_em) < count(*)
  ),
  ranked as (
    select b.tipo,
           b.id,
           row_number() over (
             partition by b.tipo, b.nome_norm
             order by
               (u.ativo_id is not null) desc,
               b.criado_em asc,
               b.id asc
           ) as pos
      from biblioteca b
      join grupos g on g.tipo = b.tipo and g.nome_norm = b.nome_norm
      left join uso u on u.tipo = b.tipo and u.ativo_id = b.id
  ),
  keeper as (
    select r.tipo, r.id as fica_id, b.nome_norm
      from ranked r
      join biblioteca b on b.tipo = r.tipo and b.id = r.id
     where r.pos = 1
  ),
  classificado as (
    select b.tipo,
           b.id,
           b.nome,
           case
             when coalesce(u.em_uso, false) then null
             when coalesce(u.with_issues, false) then null
             when coalesce(u.em_revisao, false) then null
             when coalesce(u.status_desconhecido, false) then null
             when coalesce(c.aprovado, false) then null
             when coalesce(c.pendente, false) then null
             when i.nome_norm is not null then null
             when k.fica_id is not null and k.fica_id = b.id then null
             when k.fica_id is not null and k.fica_id <> b.id then 'duplicata'
             when b.nome_norm ~ '(^|[^a-z0-9])(teste|test|sonda|apagar|rascunho)([^a-z0-9]|$)'
               or b.nome_norm ~ 'dry[-_ ]?run'
               or b.nome_norm ~ '(^|[^a-z0-9])gt-?[0-9]+([^a-z0-9]|$)'
               then 'residuo_de_teste'
             when u.ativo_id is null then 'nunca_usado'
             when coalesce(u.gasto_total, 0) > 0
              and (u.ultimo_gasto_em is null or u.ultimo_gasto_em >= (current_date - v_dias))
               then 'anuncio_inativo'
             else 'sem_uso_90d'
           end as motivo,
           coalesce(u.anuncios, '[]'::jsonb) as anuncios,
           u.ultimo_gasto_em,
           round(coalesce(u.gasto_total, 0), 2) as gasto_total,
           case
             when coalesce(u.em_uso, false) then 'em_uso'
             when coalesce(u.with_issues, false) then 'with_issues'
             when coalesce(u.em_revisao, false) then 'em_revisao'
             when coalesce(u.status_desconhecido, false) then 'status_desconhecido'
             when coalesce(c.aprovado, false) then 'card_aprovado'
             when coalesce(c.pendente, false) then 'card_pendente'
             when i.nome_norm is not null then 'duplicata_sem_data'
             when k.fica_id is not null and k.fica_id = b.id then 'copia_que_fica'
             else null
           end as bloqueado_por,
           case
             when k.fica_id is not null and k.fica_id <> b.id then k.fica_id
             else null
           end as duplicata_de
      from biblioteca b
      left join uso u on u.tipo = b.tipo and u.ativo_id = b.id
      left join card_bloqueio c on c.tipo = b.tipo and c.ativo_id = b.id
      left join keeper k on k.tipo = b.tipo and k.nome_norm = b.nome_norm
      left join inseguros i on i.tipo = b.tipo and i.nome_norm = b.nome_norm
  ),
  divergencia as (
    select u.tipo,
           u.ativo_id as id,
           null::text as nome,
           'divergencia'::text as motivo,
           u.anuncios,
           u.ultimo_gasto_em,
           round(coalesce(u.gasto_total, 0), 2) as gasto_total,
           null::text as bloqueado_por,
           null::text as duplicata_de
      from uso u
     where not exists (
       select 1 from biblioteca b where b.tipo = u.tipo and b.id = u.ativo_id
     )
  )
  select s.tipo,
         s.id,
         s.nome,
         s.motivo,
         s.anuncios,
         s.ultimo_gasto_em,
         s.gasto_total,
         s.bloqueado_por,
         s.duplicata_de,
         (s.bloqueado_por is null and s.motivo is distinct from 'divergencia') as candidato
    from (
      select * from classificado
      union all
      select * from divergencia
    ) s
   order by (s.bloqueado_por is null and s.motivo is distinct from 'divergencia') desc,
            s.motivo nulls last,
            s.nome nulls last,
            s.id;
end;
$fn$;

comment on function public.listar_ativos_orfaos(uuid, text, integer, jsonb, jsonb, jsonb, boolean, boolean, boolean, jsonb, jsonb) is
  'Classifica a biblioteca da conta. Candidato é o que não está em anúncio ativo, nem em card aprovado ou pendente ainda não executado, nem em anúncio WITH_ISSUES ou em revisão. Duplicata: fica a cópia mais antiga que tenha histórico de anúncio; sem histórico em nenhuma, a mais antiga. anuncio_inativo é candidato da regra larga (anúncio pausado/arquivado com gasto dentro da janela) e a conferência dos 90 dias olha esse caso antes de qualquer exclusão. Arquivo que a Meta não devolve mas o anúncio cita sai como divergencia e não é candidato. Listagem truncada ou falha levanta listagem_incompleta.';

revoke all on function public.listar_ativos_orfaos(uuid, text, integer, jsonb, jsonb, jsonb, boolean, boolean, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.listar_ativos_orfaos(uuid, text, integer, jsonb, jsonb, jsonb, boolean, boolean, boolean, jsonb, jsonb) to service_role;
