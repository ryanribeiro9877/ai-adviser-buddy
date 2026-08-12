-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260812214357
-- name: esp41_digest_email_e_alerta_critico
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- ESP-41: digest 1-3x/dia + entrega por e-mail + alerta critico em tempo real.
--
-- Hoje o relatorio diario (post_daily_report) e deterministico, roda 1x/dia (08:30) e so
-- posta no CHAT. ESP-41 acrescenta: (1) o MESMO corpo vira funcao reutilizavel
-- (montar_corpo_digest) para chat e e-mail nao divergirem; (2) cadencia configuravel por
-- empresa (ate 3 horarios); (3) entrega por e-mail (edge enviar-digest via Resend, degrada
-- se faltar provedor); (4) alerta CRITICO empurrado na hora (trigger em alerts -> fila
-- digest_entregas + poke na edge), sem esperar o proximo digest.

-- 1) Corpo do digest extraido de post_daily_report (mesma fonte para chat e e-mail).
create or replace function public.montar_corpo_digest(p_company_id uuid, p_dia date default (current_date - 1))
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  corpo text;
  v_gasto numeric; v_forms int; v_links int; v_msgs int; v_leads int;
  v_teto_form numeric; v_custo_form numeric;
  v_teto_form_r jsonb; v_teto_form_nota text;
  v_alertas text; v_recos text; v_sync text; v_n_alertas int; v_n_recos int;
  v_campanhas text; v_n_camp int; v_d1 date;
begin
  v_d1 := p_dia;

  select coalesce(sum(spend),0), coalesce(sum(form_leads),0), coalesce(sum(link_clicks),0),
         coalesce(sum(messaging_started),0), coalesce(sum(leads),0)
    into v_gasto, v_forms, v_links, v_msgs, v_leads
    from public.metric_snapshots
   where company_id = p_company_id and snapshot_date = v_d1;

  v_teto_form_r := public.teto_vigente(p_company_id, 'custo_por_formulario');
  v_teto_form   := (v_teto_form_r->>'teto_que_governa')::numeric;
  v_teto_form_nota := case
    when v_teto_form is null then null
    when v_teto_form_r->>'governa' = 'meta_de_negocio' then
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form) || ' por formulário, decidida por '
      || coalesce(v_teto_form_r->'meta_de_negocio'->>'decidido_por','o gestor') || ' em '
      || to_char((v_teto_form_r->'meta_de_negocio'->>'decidido_em')::date,'DD/MM/YYYY') || '.'
      || case when (v_teto_form_r->'consistencia_historica'->>'valor') is not null
               and (v_teto_form_r->'consistencia_historica'->>'valor')::numeric <> v_teto_form
              then ' O teto histórico do próprio desempenho é R$ '
                   || public.fmt_brl((v_teto_form_r->'consistencia_historica'->>'valor')::numeric)
                   || ', e mede consistência com o passado — não rentabilidade.'
              else '' end || '_'
    else
      '_Régua usada: R$ ' || public.fmt_brl(v_teto_form)
      || ' por formulário, derivada do histórico do próprio desempenho — mede consistência com o passado, não rentabilidade. Não há régua de negócio declarada para esta métrica._'
    end;

  v_custo_form := case when v_forms > 0 then round(v_gasto / v_forms, 2) end;

  with base as (
    select c.id, c.name,
           coalesce(sum(m.spend),0)              as sp,
           coalesce(sum(m.impressions),0)        as imp,
           coalesce(sum(m.reach),0)              as rch,
           coalesce(sum(m.clicks),0)             as clk,
           coalesce(sum(m.link_clicks),0)        as lclk,
           coalesce(sum(m.landing_page_views),0) as lpv,
           coalesce(sum(m.form_leads),0)         as frm,
           round(avg(m.frequency)::numeric,2)    as freq
      from public.campaigns c
      left join public.metric_snapshots m on m.campaign_id = c.id and m.snapshot_date = v_d1
     where c.company_id = p_company_id
     group by c.id, c.name
  ), enriquecida as (
    select b.*, t.valor as teto,
           (select round(avg(x.spend)::numeric,2) from public.metric_snapshots x
             where x.campaign_id = b.id and x.snapshot_date between v_d1 - 6 and v_d1 - 1
               and x.spend > 0) as media6
      from base b
      left join public.targets t
             on t.campaign_id = b.id and t.metric = 'teto_gasto_diario' and t.active
     where b.sp > 0 or t.valor is not null
  )
  select count(*), string_agg(
    '### ' || name || e'\n'
    || '- Gasto **R$ ' || public.fmt_brl(sp) || '**'
       || case
            when teto is null then ' · sem teto declarado'
            when sp = 0 then ' · teto declarado R$ ' || public.fmt_brl(teto) || ' — **sem gasto ontem**'
            when sp > teto then ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → **' || round(100*sp/teto) || '% do teto** ⚠️'
            else ' · teto declarado R$ ' || public.fmt_brl(teto)
                 || ' → ' || round(100*sp/teto) || '% do teto ✅'
          end
       || case when media6 is not null and media6 > 0 and sp > 0 then
            ' · vs média dos 6 dias anteriores (R$ ' || public.fmt_brl(media6) || '): '
            || case when sp > media6 then '+' else '' end || round(100*(sp-media6)/media6) || '%'
          else '' end || e'\n'
    || case when sp = 0 then ''
       else
         '- **' || public.fmt_int(imp) || '** impressões para **' || public.fmt_int(rch)
         || '** pessoas' || case when freq is not null then ' (frequência ' || public.fmt_brl(freq) || ')' else '' end || e'\n'
         || '- **' || public.fmt_int(clk) || '** cliques · **' || public.fmt_int(lclk) || '** no link · **'
         || public.fmt_int(lpv) || '** chegaram na página' || e'\n'
         || '- **' || public.fmt_int(frm) || '** formulários'
         || case when frm > 0 then
              ' · custo/formulário **R$ ' || public.fmt_brl(round(sp/frm,2)) || '**'
              || case when v_teto_form is not null then
                   case when round(sp/frm,2) <= v_teto_form
                        then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
                        else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
                 else '' end
            else ' — nenhum formulário' end || e'\n'
       end,
    e'\n' order by sp desc, name)
    into v_n_camp, v_campanhas from enriquecida;

  select count(*), coalesce(string_agg(
           '- ' || case severity::text when 'critical' then '🔴' when 'high' then '🟠'
                        when 'medium' then '🟡' else '🔵' end || ' **' || title || '**: ' || description,
           e'\n' order by case severity::text when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end), '- nenhum alerta ativo 👌')
    into v_n_alertas, v_alertas
    from public.alerts where company_id = p_company_id and resolved = false;

  select coalesce(string_agg('- ' || j.jobname || ': ' ||
           case d.status when 'succeeded' then '✅ rodou' else '❌ ' || coalesce(d.status,'?') end, e'\n'),
           '- (nenhuma rotina registrada hoje)')
    into v_sync
    from cron.job j
    join lateral (select status from cron.job_run_details r
       where r.jobid = j.jobid and r.start_time::date = current_date
       order by r.start_time desc limit 1) d on true
   where j.jobname in ('windsor-sync-daily','alerts-eval-daily','pipeboard-metrics-daily');

  select count(*), coalesce(string_agg('- ' ||
           case impact when 'high' then '🚀' else '💡' end || ' **' || title || '**',
           e'\n' order by case impact when 'high' then 0 when 'medium' then 1 else 2 end),
           '- nada pendente de decisão')
    into v_n_recos, v_recos
    from public.ai_recommendations where company_id = p_company_id and status = 'new';

  corpo :=
    '# 📋 Relatório diário — ' || to_char(current_date, 'DD/MM/YYYY') || e'\n\n' ||
    '## 🔎 Ontem (' || to_char(v_d1, 'DD/MM') || ') — campanha por campanha' || e'\n\n' ||
    coalesce(v_campanhas, '- nenhuma campanha com gasto e nenhuma com teto declarado') || e'\n\n' ||
    '**Fechamento da empresa:** gasto **R$ ' || public.fmt_brl(v_gasto) || '** · ' ||
    public.fmt_int(v_links::bigint) || ' cliques no link · ' || public.fmt_int(v_forms::bigint) || ' formulários' ||
    case when v_custo_form is not null then ' · custo/formulário médio **R$ ' || public.fmt_brl(v_custo_form) || '**' ||
      case when v_teto_form is not null then
        case when v_custo_form <= v_teto_form then ' (dentro do teto R$ ' || public.fmt_brl(v_teto_form) || ' ✅)'
             else ' (**ACIMA** do teto R$ ' || public.fmt_brl(v_teto_form) || ' ⚠️)' end
      else '' end else '' end ||
    case when v_msgs > 0 then ' · ' || public.fmt_int(v_msgs::bigint) || ' conversas WhatsApp' else '' end || e'\n' ||
    '_O fechamento é soma de ' || coalesce(v_n_camp,0) || ' campanhas: use-o para conferir o caixa, nunca para julgar desempenho._' || e'\n' ||
    coalesce(v_teto_form_nota || e'\n', '') || e'\n' ||
    coalesce(public.nota_de_cobertura(p_company_id), '') || e'\n\n' ||
    '**Alertas ativos (' || v_n_alertas || '):**' || e'\n' || v_alertas || e'\n\n' ||
    '## ✅ Resolvi' || e'\n' ||
    'Rotinas de hoje (sync de dados, avaliação de regras e vencedores):' || e'\n' || v_sync || e'\n\n' ||
    '## 🫵 Depende de você (' || v_n_recos || ')' || e'\n' || v_recos;

  return corpo;
end $function$;

comment on function public.montar_corpo_digest(uuid, date) is
  'ESP-41: corpo deterministico do relatorio/digest de UMA empresa (mesma fonte usada por post_daily_report no chat e pela edge enviar-digest no e-mail). p_dia = dia de referencia (ontem por padrao).';

revoke all on function public.montar_corpo_digest(uuid, date) from public, anon;
grant execute on function public.montar_corpo_digest(uuid, date) to service_role, authenticated;

-- 2) post_daily_report passa a consumir montar_corpo_digest (chat inalterado no conteudo).
create or replace function public.post_daily_report()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  emp record; conv_id uuid; corpo text; postados int := 0;
begin
  for emp in
    select co.id, co.name from public.companies co
    where exists (select 1 from public.campaigns c where c.company_id = co.id and c.status = 'active')
  loop
    select id into conv_id from public.chat_conversations
     where company_id = emp.id and kind = 'daily_report' limit 1;
    if conv_id is null then
      insert into public.chat_conversations (company_id, title, kind)
      values (emp.id, 'Relatório diário', 'daily_report') returning id into conv_id;
    end if;

    if exists (select 1 from public.chat_messages
                where conversation_id = conv_id and role = 'assistant'
                  and created_at::date = current_date) then
      continue;
    end if;

    corpo := public.montar_corpo_digest(emp.id, current_date - 1);

    insert into public.chat_messages (conversation_id, company_id, role, content, model)
    values (conv_id, emp.id, 'assistant', corpo, 'relatorio-deterministico');
    update public.chat_conversations set updated_at = now() where id = conv_id;
    postados := postados + 1;
  end loop;
  return postados;
end $function$;

-- 3) Config de cadencia/entrega por empresa.
create table if not exists public.digest_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  ativo boolean not null default true,
  slots int[] not null default '{8}',
  emails text[] not null default '{}',
  alerta_critico_email boolean not null default true,
  min_severidade text not null default 'critical' check (min_severidade in ('critical','high','medium','low')),
  assunto_prefixo text not null default '[Gestor IA]',
  atualizado_em timestamptz not null default now()
);
comment on table public.digest_config is
  'ESP-41: cadencia e destino do digest por empresa. slots = horas LOCAIS (America/Bahia, UTC-3), ate 3. emails vazio = digest fica so no chat (e-mail nao sai). alerta_critico_email liga o empurrao em tempo real.';

-- 4) Log/fila de entregas (e dedup).
create table if not exists public.digest_entregas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tipo text not null check (tipo in ('digest','alerta_critico')),
  dia date not null default current_date,
  slot int,
  alert_id uuid references public.alerts(id) on delete cascade,
  destino text[] not null default '{}',
  assunto text,
  corpo_preview text,
  status text not null default 'pendente' check (status in ('pendente','enviado','sem_provedor','sem_destinatario','simulado','erro','cancelado')),
  provedor text,
  provider_id text,
  erro text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz
);
comment on table public.digest_entregas is
  'ESP-41: fila e historico de entregas do digest e de alertas criticos. status pendente -> enviado|sem_provedor|sem_destinatario|simulado|erro. Escrita so por service_role (edge enviar-digest e trigger).';

-- dedup: um alerta critico gera no maximo uma entrega; um digest por empresa/slot/dia.
create unique index if not exists digest_entregas_alert_uk on public.digest_entregas(alert_id);
create unique index if not exists digest_entregas_digest_uk on public.digest_entregas(company_id, slot, dia) where tipo = 'digest';
create index if not exists digest_entregas_pendentes_ix on public.digest_entregas(status) where status = 'pendente';

alter table public.digest_config enable row level security;
alter table public.digest_entregas enable row level security;
drop policy if exists digest_config_leitura on public.digest_config;
create policy digest_config_leitura on public.digest_config for select
  using (is_company_member(company_id, auth.uid()) or has_role(auth.uid(), 'admin'::app_role));
drop policy if exists digest_entregas_leitura on public.digest_entregas;
create policy digest_entregas_leitura on public.digest_entregas for select
  using (is_company_member(company_id, auth.uid()) or has_role(auth.uid(), 'admin'::app_role));

-- Seed LEV: cadencia 1x (08h local), sem e-mail ainda (so chat) ate o gestor cadastrar destino.
insert into public.digest_config (company_id, slots, emails, alerta_critico_email)
values ('ded20b38-f42e-4c71-800c-31b97ea48bcf', '{8}', '{}', true)
on conflict (company_id) do nothing;

-- 5) Leitura das entregas recentes (para o agente responder "o digest saiu?").
create or replace function public.ler_entregas_digest(p_company_id uuid, p_dias int default 7)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'company_id', p_company_id,
    'janela_dias', p_dias,
    'config', (select to_jsonb(dc) from public.digest_config dc where dc.company_id = p_company_id),
    'entregas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tipo', e.tipo, 'dia', e.dia, 'slot', e.slot, 'status', e.status,
        'destino', to_jsonb(e.destino), 'assunto', e.assunto, 'provedor', e.provedor,
        'erro', e.erro, 'criado_em', e.criado_em, 'enviado_em', e.enviado_em)
        order by e.criado_em desc)
      from public.digest_entregas e
      where e.company_id = p_company_id and e.criado_em >= now() - make_interval(days => p_dias)), '[]'::jsonb),
    'premissas', jsonb_build_array(
      'Leitura pura: reflete o que a edge enviar-digest e o trigger de alerta critico gravaram.',
      'status sem_provedor = falta RESEND_API_KEY; sem_destinatario = digest_config.emails vazio. Nesses casos o digest segue no chat.')
  );
$function$;
comment on function public.ler_entregas_digest(uuid, int) is
  'ESP-41: leitura pura da config + entregas recentes (digest e alerta critico) da empresa.';
revoke all on function public.ler_entregas_digest(uuid, int) from public, anon;
grant execute on function public.ler_entregas_digest(uuid, int) to service_role, authenticated;

-- 6) Alerta critico em tempo real: enfileira e cutuca a edge (nao espera o proximo digest).
create or replace function public.notificar_alerta_critico()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cfg record;
begin
  if new.resolved is true then return new; end if;
  if new.severity::text <> 'critical' then return new; end if;
  select * into cfg from public.digest_config where company_id = new.company_id;
  if cfg is null or cfg.alerta_critico_email is not true then return new; end if;

  insert into public.digest_entregas (company_id, tipo, alert_id, destino, assunto, corpo_preview, status)
  values (new.company_id, 'alerta_critico', new.id, coalesce(cfg.emails, '{}'),
          coalesce(cfg.assunto_prefixo,'[Gestor IA]') || ' ALERTA CRÍTICO: ' || new.title,
          left(coalesce(new.description,''), 500), 'pendente')
  on conflict (alert_id) do nothing;

  -- Cutucada assincrona: a edge drena a fila. Se o POST falhar, o cron */5 reprocessa.
  perform net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/enviar-digest',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_mcp_api_key()),
    body := jsonb_build_object('modo','drenar_alertas')
  );
  return new;
exception when others then
  -- Nunca deixar o alerta falhar por causa da notificacao.
  return new;
end $function$;

drop trigger if exists trg_notificar_alerta_critico on public.alerts;
create trigger trg_notificar_alerta_critico
  after insert on public.alerts
  for each row execute function public.notificar_alerta_critico();

-- 7) Crons: digest por horario (a edge decide o slot pela hora local) e dreno de alertas.
select cron.schedule('digest-email-horario', '35 * * * *', $cron$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/enviar-digest',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_mcp_api_key()),
    body := jsonb_build_object('modo','digest')
  );
$cron$);
select cron.schedule('digest-drenar-alertas', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://gzjwnjdpxpbmdhcyefvs.supabase.co/functions/v1/enviar-digest',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_mcp_api_key()),
    body := jsonb_build_object('modo','drenar_alertas')
  );
$cron$);

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'DIGEST, E-MAIL E ALERTA CRITICO (ESP-41, 12/08/2026). O relatorio diario deterministico agora tem corpo unico em montar_corpo_digest(company_id, dia), consumido pelo chat (post_daily_report) e pelo e-mail (edge enviar-digest). digest_config(company_id) define cadencia (slots = horas locais, ate 3), destinatarios (emails) e se o alerta critico vai por e-mail. A edge enviar-digest roda de hora em hora (modo=digest, decide o slot pela hora local America/Bahia) e a cada 5 min (modo=drenar_alertas). Alerta severity=critical dispara trigger que enfileira em digest_entregas e cutuca a edge na hora. Entrega por e-mail usa Resend (RESEND_API_KEY + DIGEST_FROM); sem provedor a entrega fica status=sem_provedor e o digest continua no chat; emails vazio => sem_destinatario. Leitura por ler_entregas_digest(company_id). O corpo NAO usa LLM: continua auditavel e de custo zero.',
  true,
  date '2026-08-12'
);
