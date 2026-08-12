-- ESP-30: modelo persistente de BM / contas de anuncio / tokens Meta + monitor de
-- expiracao e escopo. bm-monitor (F4.4) ja vigia STATUS/cobranca da conta e
-- meta-identity-probe ja LE escopo/validade ao vivo, mas NADA gravava QUANDO o token
-- expira nem QUAIS escopos ele tem ao longo do tempo. Token vencendo derruba tudo em
-- silencio: estas tabelas + saude_dos_tokens tornam esse risco observavel e alertavel.
--
-- REGRA DURA: meta_tokens guarda METADADO (app_id, tipo, validade, escopos), NUNCA o
-- valor do token. O segredo continua so na env var (META_ADS_TOKEN/WHATSAPP_ACCESS_TOKEN).
--
-- Aplicada como version 20260812213231. Espelho fiel em
-- supabase/espelhos/20260812213231_esp30_modelo_meta_e_saude_dos_tokens.sql

create table if not exists public.meta_business_managers (
  id uuid primary key default gen_random_uuid(),
  bm_id text not null unique,
  nome text,
  company_id uuid references public.companies(id) on delete set null,
  verificado text,
  primary_page_id text,
  coletado_em timestamptz not null default now(),
  bruto jsonb
);
comment on table public.meta_business_managers is
  'ESP-30: estado atual de cada Business Manager visto pelo token. Upsert pelo meta-token-monitor; bm_id unico. NAO guarda segredo.';

create table if not exists public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null unique,
  nome text,
  company_id uuid references public.companies(id) on delete set null,
  bm_id text,
  account_status int,
  status_label text,
  moeda text,
  coletado_em timestamptz not null default now(),
  bruto jsonb
);
comment on table public.meta_ad_accounts is
  'ESP-30: conta de anuncio (act_...) -> BM, com status observado. Complementa integrations (registro de conexao) com a linkagem de BM e o status. Upsert pelo meta-token-monitor.';

create table if not exists public.meta_tokens (
  id uuid primary key default gen_random_uuid(),
  token_ref text not null unique,
  papel text not null check (papel in ('ads','waba')),
  company_id uuid references public.companies(id) on delete set null,
  app_id text,
  tipo text,
  subject_id text,
  subject_nome text,
  is_valid boolean,
  expires_at timestamptz,
  data_access_expires_at timestamptz,
  scopes text[] not null default '{}',
  granular_scopes jsonb,
  verificado_em timestamptz not null default now(),
  bruto jsonb
);
comment on table public.meta_tokens is
  'ESP-30: REGISTRO DE METADADOS do token Meta (app_id, tipo, validade, escopos) por env var (token_ref). NUNCA guarda o valor do token — o segredo permanece so na env var. Upsert pelo meta-token-monitor via /me + /debug_token. expires_at NULO = nao expira (system user).';

alter table public.meta_business_managers enable row level security;
alter table public.meta_ad_accounts enable row level security;
alter table public.meta_tokens enable row level security;

drop policy if exists meta_bm_leitura on public.meta_business_managers;
create policy meta_bm_leitura on public.meta_business_managers for select
  using (is_company_member(company_id, auth.uid()) or has_role(auth.uid(), 'admin'::app_role));
drop policy if exists meta_ad_accounts_leitura on public.meta_ad_accounts;
create policy meta_ad_accounts_leitura on public.meta_ad_accounts for select
  using (is_company_member(company_id, auth.uid()) or has_role(auth.uid(), 'admin'::app_role));
drop policy if exists meta_tokens_leitura on public.meta_tokens;
create policy meta_tokens_leitura on public.meta_tokens for select
  using (is_company_member(company_id, auth.uid()) or has_role(auth.uid(), 'admin'::app_role));

-- saude_dos_tokens: leitura pura sobre meta_tokens. Calcula dias para expirar / para o fim
-- do data_access, os escopos que faltam contra o conjunto esperado por papel e um veredito.
create or replace function public.saude_dos_tokens(p_company_id uuid default null, p_aviso_dias int default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tokens jsonb := '[]'::jsonb;
  r record;
  v_esperado text[];
  v_faltando text[];
  v_dias_exp numeric;
  v_dias_da numeric;
  v_veredito text;
  v_n int := 0;
  v_alertas int := 0;
begin
  for r in
    select * from public.meta_tokens
    where p_company_id is null or company_id = p_company_id or company_id is null
    order by papel
  loop
    v_n := v_n + 1;
    v_esperado := case r.papel
      when 'ads' then array['ads_management','ads_read','business_management','pages_read_engagement','pages_manage_ads']
      when 'waba' then array['whatsapp_business_management','whatsapp_business_messaging','business_management']
      else array[]::text[] end;
    select coalesce(array_agg(e), array[]::text[]) into v_faltando
      from unnest(v_esperado) e
      where not (e = any(coalesce(r.scopes, array[]::text[])));
    v_dias_exp := case when r.expires_at is null then null
                       else round(extract(epoch from (r.expires_at - now())) / 86400.0, 1) end;
    v_dias_da := case when r.data_access_expires_at is null then null
                      else round(extract(epoch from (r.data_access_expires_at - now())) / 86400.0, 1) end;
    v_veredito := case
      when r.is_valid is not true then 'invalido'
      when v_dias_exp is not null and v_dias_exp <= 0 then 'expirado'
      when v_dias_da is not null and v_dias_da <= 0 then 'data_access_expirado'
      when array_length(v_faltando, 1) is not null then 'escopo_incompleto'
      when (v_dias_exp is not null and v_dias_exp <= p_aviso_dias)
        or (v_dias_da is not null and v_dias_da <= p_aviso_dias) then 'expira_em_breve'
      else 'ok' end;
    if v_veredito <> 'ok' then v_alertas := v_alertas + 1; end if;
    v_tokens := v_tokens || jsonb_build_object(
      'token_ref', r.token_ref,
      'papel', r.papel,
      'veredito', v_veredito,
      'valido', r.is_valid,
      'tipo', r.tipo,
      'app_id', r.app_id,
      'subject', r.subject_nome,
      'expira_em', r.expires_at,
      'dias_para_expirar', v_dias_exp,
      'data_access_expira_em', r.data_access_expires_at,
      'dias_para_data_access', v_dias_da,
      'nao_expira', r.expires_at is null,
      'escopos_presentes', to_jsonb(coalesce(r.scopes, array[]::text[])),
      'escopos_esperados', to_jsonb(v_esperado),
      'escopos_faltando', to_jsonb(coalesce(v_faltando, array[]::text[])),
      'verificado_em', r.verificado_em);
  end loop;

  if v_n = 0 then
    return jsonb_build_object(
      'existe', false,
      'tokens', '[]'::jsonb,
      'motivo', 'Nenhum token registrado em meta_tokens; rode o meta-token-monitor para popular (via /me + /debug_token).',
      'premissas', jsonb_build_array('Leitura pura: NAO chama a Graph nem altera nada; le o ultimo estado gravado pelo monitor.'));
  end if;

  return jsonb_build_object(
    'existe', true,
    'aviso_dias', p_aviso_dias,
    'tokens', v_tokens,
    'quantidade', v_n,
    'com_alerta', v_alertas,
    'premissas', jsonb_build_array(
      'Leitura pura: NAO chama a Graph nem altera nada; le o ultimo estado gravado pelo meta-token-monitor.',
      'meta_tokens guarda METADADO, nunca o valor do token; o segredo vive so na env var (token_ref).',
      'expires_at NULO = token que nao expira (system user). data_access_expires_at NULO = nao coletado ou nao aplicavel.',
      'escopos_esperados sao o minimo por papel (ads/waba); faltar escopo NAO prova que a acao quebra, mas e risco declarado.'));
end $function$;

comment on function public.saude_dos_tokens(uuid, int) is
  'ESP-30: leitura pura sobre meta_tokens — dias para expirar/data_access, escopos faltando vs esperado por papel e veredito (ok|expira_em_breve|expirado|data_access_expirado|escopo_incompleto|invalido). Nao chama a Graph.';

revoke all on function public.saude_dos_tokens(uuid, int) from public, anon;
grant execute on function public.saude_dos_tokens(uuid, int) to service_role, authenticated;

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'MODELO META E SAUDE DOS TOKENS (ESP-30, 12/08/2026). Tres tabelas modelam a camada Meta: meta_business_managers (BM), meta_ad_accounts (conta act_... -> BM + status) e meta_tokens (METADADO do token: app_id, tipo, is_valid, expires_at, data_access_expires_at, scopes — NUNCA o valor; o segredo vive so na env var token_ref). O meta-token-monitor popula tudo via /me + /debug_token e levanta alerta (dedup) quando o token esta invalido, expira em <= aviso_dias ou falta escopo. saude_dos_tokens(company_id) e leitura pura que devolve, por token, dias para expirar, escopos faltando vs esperado por papel e veredito. Complementa bm-monitor (F4.4, status/cobranca da conta) e meta-identity-probe (leitura ao vivo). expires_at NULO = system user (nao expira).',
  true,
  date '2026-08-12'
);
