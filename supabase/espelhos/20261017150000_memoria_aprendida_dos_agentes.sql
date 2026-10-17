-- Memoria aprendida dos agentes (Tarefa 1): tabela, travas de isolamento e busca no banco.
-- Espelho: supabase/espelhos/20261017150000_memoria_aprendida_dos_agentes.sql
-- Prova:   supabase/functions/_shared/_prova_aprendizados.sql (begin/rollback, nada fica no banco)
--
-- Por que existe: os agentes passam a guardar o que aprendem de duradouro na conta
-- (preferencia do gestor, correcao, armadilha) e a consultar isso antes de responder.
-- Fica separada de agent_context porque o ciclo de vida e outro (reforco, substituicao,
-- uso) e para nao perturbar a injecao curada que ja foi medida.
--
-- Aprendizado e sempre de UMA empresa e, quando houver, de UMA linha de negocio dentro
-- dela. A edge testa antes e devolve motivo legivel; o trigger daqui e a rede final.
-- Escrita so por service role (as edges). Membros da empresa so leem.
-- A coluna embedding NAO nasce aqui: so entra se a prova de embedding da Tarefa 10 servir.

-- ---------------------------------------------------------------------------
-- Extensoes e normalizacao de acento
-- ---------------------------------------------------------------------------
-- No schema public porque as funcoes abaixo rodam com search_path = public.
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

-- unaccent puro e stable, entao nao pode entrar em coluna gerada nem em indice.
-- O wrapper imutavel e o padrao conhecido: o dicionario e fixo, o resultado nao varia.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
as $$ select public.unaccent('public.unaccent', $1) $$;

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.agent_aprendizados (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  linha text,
  categoria text not null check (categoria in (
    'preferencia_do_gestor', 'correcao', 'fato_da_conta', 'armadilha', 'processo'
  )),
  fato text not null check (char_length(fato) between 20 and 600),
  contexto text check (contexto is null or char_length(contexto) <= 1500),
  evidencias jsonb not null check (
    jsonb_typeof(evidencias) = 'array' and jsonb_array_length(evidencias) >= 1
  ),
  agente_codigo text not null,
  superficie text not null check (superficie in ('chat', 'job', 'curadoria')),
  conversation_id uuid,
  confianca text not null check (confianca in ('confirmada', 'observada')),
  status text not null default 'vigente' check (status in (
    'vigente', 'substituida', 'aposentada', 'vencida'
  )),
  substitui_id uuid references public.agent_aprendizados(id) on delete set null,
  substituida_por uuid references public.agent_aprendizados(id) on delete set null,
  motivo_status text,
  confirmacoes int not null default 1,
  usos int not null default 0,
  ultimo_uso timestamptz,
  valido_ate date,
  chave_normalizada text not null,
  busca tsvector generated always as (
    to_tsvector('portuguese', public.f_unaccent(fato || ' ' || coalesce(contexto, '')))
  ) stored,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Sair de vigente sem dizer por que deixa a memoria sem historico.
  constraint agent_aprendizados_motivo_ao_sair_de_vigente
    check (status = 'vigente' or nullif(btrim(motivo_status), '') is not null)
);

comment on table public.agent_aprendizados is
  'Memoria aprendida dos agentes: sempre de uma empresa, de uma linha quando houver. Escrita so por service role; membros leem. Fica abaixo do dado fresco, das regras de conformidade e da memoria curada (agent_context/agent_knowledge).';
comment on column public.agent_aprendizados.linha is
  'Linha de negocio dentro da empresa (la_felicita, juridico, sistema_ocular). Nulo = vale para a empresa toda.';
comment on column public.agent_aprendizados.evidencias is
  'Array com 1 ou mais itens: {tipo: fala_do_gestor|retorno_de_ferramenta|resultado_de_ato, ferramenta?, trecho, mensagem_id?, job_id?, em}.';
comment on column public.agent_aprendizados.confianca is
  'confirmada = o gestor afirmou; observada = veio de dado.';
comment on column public.agent_aprendizados.chave_normalizada is
  'Fato em minusculo, sem acento e sem pontuacao, calculado pela edge. Unica entre os vigentes da empresa (dedupe exato); o dedupe aproximado usa aprendizados_parecidos.';
comment on column public.agent_aprendizados.busca is
  'Busca textual em portugues sobre fato + contexto, sem acento (f_unaccent).';

create index if not exists agent_aprendizados_busca_gin
  on public.agent_aprendizados using gin (busca);
create index if not exists agent_aprendizados_chave_trgm
  on public.agent_aprendizados using gin (chave_normalizada public.gin_trgm_ops);
-- Dedupe exato: o mesmo fato vigente nao entra duas vezes na mesma empresa.
create unique index if not exists agent_aprendizados_vigente_chave_uq
  on public.agent_aprendizados (company_id, chave_normalizada)
  where status = 'vigente';

-- ---------------------------------------------------------------------------
-- Trava de isolamento (rede final; a edge testa antes e devolve motivo legivel)
-- ---------------------------------------------------------------------------
-- Recusa fato ou contexto que:
--   1. cite marca de outra empresa (mesmos padroes de MARCA_LEGAL / MARCA_COHAPM em agent_memory.ts);
--   2. cite act_ de conta que nao e da empresa (compara so os digitos: account_id vem com ou sem act_);
--   3. cite outra linha de negocio quando o registro tem linha preenchida.
-- Roda sobre o texto sem acento, entao as grafias com acento tambem caem nos padroes
-- (a alternativa acentuada de "legal e viver" nunca chega a casar, fica so por paridade com a edge).
-- No UPDATE so reavalia quando o texto, a linha ou a empresa mudam: reforco, uso e troca de
-- status nao podem ser barrados por uma conta que saiu de meta_ad_accounts depois.
create or replace function public.guard_agent_aprendizados_isolamento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_legal   constant uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
  c_cohapm  constant uuid := '57f755b9-c23d-4f58-a488-8173d697c010';
  v_txt   text;
  v_conta text;
begin
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.linha is not distinct from old.linha
     and new.fato is not distinct from old.fato
     and new.contexto is not distinct from old.contexto then
    return new;
  end if;

  v_txt := public.f_unaccent(new.fato || ' ' || coalesce(new.contexto, ''));

  -- 1. Marca de outra empresa.
  if new.company_id = c_legal then
    if v_txt ~* 'cohapm|la felicit|lafelicita' then
      raise exception 'aprendizado_cita_outra_empresa';
    end if;
  elsif new.company_id = c_cohapm then
    if v_txt ~* 'legal\s*(e|é)\s*viver|\mLEV\M|consignado\s*clt' then
      raise exception 'aprendizado_cita_outra_empresa';
    end if;
  else
    -- Demais empresas (Cooperativa_ Cohapm e as futuras): nem a Legal, nem a La Felicita.
    if v_txt ~* 'legal\s*(e|é)\s*viver|\mLEV\M|consignado\s*clt|la felicit|lafelicita' then
      raise exception 'aprendizado_cita_outra_empresa';
    end if;
  end if;

  -- 2. Conta Meta que nao e desta empresa.
  for v_conta in
    select (regexp_matches(v_txt, 'act_([0-9]+)', 'gi'))[1]
  loop
    if not exists (
      select 1
        from public.meta_ad_accounts a
       where a.company_id = new.company_id
         and regexp_replace(a.account_id, '[^0-9]', '', 'g') = v_conta
    ) then
      raise exception 'aprendizado_cita_conta_alheia';
    end if;
  end loop;

  -- 3. Outra linha da mesma empresa.
  if new.linha is not null then
    if new.linha <> 'la_felicita' and v_txt ~* 'la felicit|lafelicita|\mlaf\M' then
      raise exception 'aprendizado_cita_outra_linha';
    end if;
    if new.linha <> 'juridico' and v_txt ~* 'juridic' then
      raise exception 'aprendizado_cita_outra_linha';
    end if;
    if new.linha <> 'sistema_ocular' and v_txt ~* 'vistta|sistema ocular|\moculos?\M' then
      raise exception 'aprendizado_cita_outra_linha';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_agent_aprendizados_isolamento on public.agent_aprendizados;
create trigger guard_agent_aprendizados_isolamento
  before insert or update on public.agent_aprendizados
  for each row execute function public.guard_agent_aprendizados_isolamento();

revoke all on function public.guard_agent_aprendizados_isolamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: leitura para membros; escrita so pelas edges (service role ignora a RLS)
-- ---------------------------------------------------------------------------
alter table public.agent_aprendizados enable row level security;

drop policy if exists agent_aprendizados_leitura_membros on public.agent_aprendizados;
create policy agent_aprendizados_leitura_membros on public.agent_aprendizados
  for select to authenticated
  using (public.is_company_member(company_id, (select auth.uid())));

-- Os grants padrao do Supabase dao tudo a anon/authenticated; aqui so leitura de membro.
revoke all on public.agent_aprendizados from anon, authenticated;
grant select on public.agent_aprendizados to authenticated;

-- ---------------------------------------------------------------------------
-- Chave global: desliga consulta e gravacao sem deploy
-- ---------------------------------------------------------------------------
-- Uma linha so (id boolean com check). Desligada, as edges se comportam como hoje.
-- Sem policy: so service role le e escreve.
create table if not exists public.memoria_config (
  id boolean primary key default true check (id),
  consulta_ativa boolean not null default true,
  gravacao_ativa boolean not null default true
);

insert into public.memoria_config (id) values (true) on conflict (id) do nothing;

alter table public.memoria_config enable row level security;
revoke all on public.memoria_config from anon, authenticated;

comment on table public.memoria_config is
  'Chave global da memoria aprendida: consulta_ativa e gravacao_ativa. Uma linha so; as edges leem por service role.';

-- ---------------------------------------------------------------------------
-- consultar_aprendizados: o que entra no prompt
-- ---------------------------------------------------------------------------
-- Entra so o que esta vigente e dentro do prazo. Linha nula sempre entra; com p_linhas
-- informado entra tambem a linha pedida; p_linhas nulo traz todas (tarefa sem linha definida).
-- As preferencias do gestor vem primeiro (ate p_max_preferencias, as mais confirmadas) e contam
-- dentro de p_limite. O resto ate p_limite e ordenado por RRF (k = 60) de duas listas: ts_rank_cd
-- e word_similarity. A consulta textual troca & por | porque o pedido e uma frase solta: casar
-- UMA palavra ja conta, o ranking separa o que casa mais.
create or replace function public.consultar_aprendizados(
  p_company_id uuid,
  p_linhas text[],
  p_texto text,
  p_limite int,
  p_max_preferencias int,
  p_somente_confirmadas boolean
)
returns table (
  id uuid,
  categoria text,
  fato text,
  linha text,
  agente_codigo text,
  confianca text,
  confirmacoes int,
  criado_em timestamptz,
  motivo text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_txt      text := public.f_unaccent(coalesce(p_texto, ''));
  v_limite   int  := greatest(coalesce(p_limite, 0), 0);
  v_max_pref int  := greatest(least(coalesce(p_max_preferencias, 0), coalesce(p_limite, 0)), 0);
  v_so_conf  boolean := coalesce(p_somente_confirmadas, false);
  v_q        tsquery;
begin
  -- Texto vazio ou so de stopwords gera tsquery vazia: sem sinal textual, o desempate e a data.
  v_q := plainto_tsquery('portuguese', v_txt);
  if v_q::text = '' then
    v_q := null;
  else
    v_q := replace(v_q::text, ' & ', ' | ')::tsquery;
  end if;

  return query
  with base as (
    select a.id, a.categoria, a.fato, a.linha, a.agente_codigo, a.confianca,
           a.confirmacoes, a.criado_em, a.busca
      from public.agent_aprendizados a
     where a.company_id = p_company_id
       and a.status = 'vigente'
       and (a.valido_ate is null or a.valido_ate >= current_date)
       and (a.linha is null or p_linhas is null or a.linha = any(p_linhas))
       and (not v_so_conf or a.confianca = 'confirmada')
  ),
  prefs as (
    select q.id, q.ordem
      from (
        select b.id,
               row_number() over (order by b.confirmacoes desc, b.criado_em desc, b.id) as ordem
          from base b
         where b.categoria = 'preferencia_do_gestor'
      ) q
     where q.ordem <= v_max_pref
  ),
  pontos as (
    select b.id, b.criado_em,
           row_number() over (
             order by coalesce(ts_rank_cd(b.busca, v_q), 0) desc, b.criado_em desc, b.id
           ) as pos_ts,
           row_number() over (
             order by word_similarity(v_txt, public.f_unaccent(b.fato)) desc, b.criado_em desc, b.id
           ) as pos_ws
      from base b
     where b.id not in (select p.id from prefs p)
  ),
  relevantes as (
    select q.id, q.ordem
      from (
        select p.id,
               row_number() over (
                 order by (1.0 / (60 + p.pos_ts) + 1.0 / (60 + p.pos_ws)) desc, p.criado_em desc, p.id
               ) as ordem
          from pontos p
      ) q
     where q.ordem <= v_limite - (select count(*) from prefs)
  )
  select b.id, b.categoria, b.fato, b.linha, b.agente_codigo, b.confianca,
         b.confirmacoes, b.criado_em, s.motivo
    from (
      select p.id, p.ordem, 'preferencia'::text as motivo, 0 as grupo from prefs p
      union all
      select r.id, r.ordem, 'relevante'::text, 1 from relevantes r
    ) s
    join base b on b.id = s.id
   order by s.grupo, s.ordem;
end;
$$;

-- ---------------------------------------------------------------------------
-- aprendizados_parecidos: dedupe aproximado antes de gravar
-- ---------------------------------------------------------------------------
-- Entre os vigentes da empresa, da mesma linha ou da empresa toda (linha nula), devolve os
-- que tem chave parecida. O limiar padrao 0.8 e ponto de partida: nas provas, uma palavra
-- trocada em frase de 10 palavras deu ~0.92 e uma reescrita mais solta ~0.74.
create or replace function public.aprendizados_parecidos(
  p_company_id uuid,
  p_linha text,
  p_chave text,
  p_limiar real default 0.8
)
returns table (id uuid, similaridade real)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, similarity(a.chave_normalizada, p_chave) as similaridade
    from public.agent_aprendizados a
   where a.company_id = p_company_id
     and a.status = 'vigente'
     and (a.linha is not distinct from p_linha or a.linha is null)
     and similarity(a.chave_normalizada, p_chave) >= p_limiar
   order by similaridade desc, a.criado_em desc;
$$;

-- ---------------------------------------------------------------------------
-- reforcar_aprendizado: o mesmo fato registrado de novo
-- ---------------------------------------------------------------------------
-- Soma 1 em confirmacoes e anexa a evidencia (objeto ou lista de objetos). So mexe em
-- registro vigente: reforcar o que ja foi substituido ou aposentado nao ressuscita nada.
create or replace function public.reforcar_aprendizado(p_id uuid, p_evidencia jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.agent_aprendizados a
     set confirmacoes = a.confirmacoes + 1,
         evidencias = case
           when p_evidencia is null or p_evidencia = 'null'::jsonb then a.evidencias
           when jsonb_typeof(p_evidencia) = 'array' then a.evidencias || p_evidencia
           else a.evidencias || jsonb_build_array(p_evidencia)
         end,
         atualizado_em = now()
   where a.id = p_id
     and a.status = 'vigente';
$$;

-- ---------------------------------------------------------------------------
-- marcar_uso_aprendizados: o que entrou num prompt
-- ---------------------------------------------------------------------------
create or replace function public.marcar_uso_aprendizados(p_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.agent_aprendizados a
     set usos = a.usos + 1,
         ultimo_uso = now()
   where a.id = any(p_ids);
$$;

-- Execute so para service role (as edges). PUBLIC entra na lista porque o grant padrao
-- de funcao vai para PUBLIC, nao so para anon e authenticated.
revoke all on function public.consultar_aprendizados(uuid, text[], text, int, int, boolean)
  from public, anon, authenticated;
revoke all on function public.aprendizados_parecidos(uuid, text, text, real)
  from public, anon, authenticated;
revoke all on function public.reforcar_aprendizado(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.marcar_uso_aprendizados(uuid[])
  from public, anon, authenticated;

grant execute on function public.consultar_aprendizados(uuid, text[], text, int, int, boolean) to service_role;
grant execute on function public.aprendizados_parecidos(uuid, text, text, real) to service_role;
grant execute on function public.reforcar_aprendizado(uuid, jsonb) to service_role;
grant execute on function public.marcar_uso_aprendizados(uuid[]) to service_role;
