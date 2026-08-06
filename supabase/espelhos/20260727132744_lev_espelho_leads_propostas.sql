-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260727132744
-- name: lev_espelho_leads_propostas
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Espelho do funil de crédito do Dash da Legal (dash.legaleviver.com.br /api).
-- DECISÃO DE PRIVACIDADE (LGPD — minimização): este banco NÃO guarda PII em claro.
-- Telefone e nome são armazenados apenas como SHA-256 normalizado, que é exatamente
-- o formato que a CAPI da Meta exige. Assim o sistema de tráfego não se torna um segundo
-- repositório de dados pessoais, e ainda assim consegue enviar os eventos de conversão.
-- CPF NÃO é armazenado (a Meta não o aceita como identificador — não há motivo para tê-lo).

create table public.lev_leads (
  lead_id            bigint primary key,          -- id no dash
  criado             timestamptz,
  origem             text,
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  utm_content        text,
  status             text,
  status_pipeline    text,
  fase_contato       text,
  score_conversao    numeric,
  prioridade_score   text,
  custo_aquisicao    numeric,
  custo_total        numeric,
  banco_escolhido    text,
  tentativas_ligacao int,
  ultima_interacao   timestamptz,
  interesse_ativo    boolean,
  autorizacao_lgpd   boolean,
  marketing_opt_out  boolean,
  is_test            boolean default false,
  telefone_sha256    text,                        -- p/ CAPI (ph)
  nome_sha256        text,                        -- p/ CAPI (fn)
  sobrenome_sha256   text,                        -- p/ CAPI (ln)
  atualizado         timestamptz,
  synced_at          timestamptz not null default now()
);
comment on table public.lev_leads is 'Espelho de /api/leads do Dash da Legal. PII apenas em hash SHA-256 (exigência da CAPI + minimização LGPD). CPF não é replicado.';
create index idx_lev_leads_criado on public.lev_leads(criado desc);
create index idx_lev_leads_utm on public.lev_leads(utm_campaign);

create table public.lev_propostas (
  proposta_id          bigint primary key,        -- id no dash
  lead_id              bigint,                    -- elo com lev_leads (e com os UTMs)
  criado               timestamptz,
  atualizado           timestamptz,
  banco                text,
  status_proposta      text,
  valor_financiado     numeric,
  valor_liquido        numeric,
  valor_parcela        numeric,
  prazo                int,
  pago                 boolean default false,
  assinatura_iniciada  boolean default false,
  assinatura_concluida boolean default false,
  contract_number      text,
  -- controle de envio à CAPI (idempotência): evita reenviar o mesmo evento
  capi_evento          text,                      -- PropostaAprovada | ContratoPago
  capi_enviado_em      timestamptz,
  capi_resposta        jsonb,
  synced_at            timestamptz not null default now()
);
comment on table public.lev_propostas is 'Espelho de /api/propostas do Dash. ContratoPago na CAPI usa valor_financiado (decisão do Ryan em 27/07). capi_enviado_em garante idempotência do envio.';
create index idx_lev_prop_lead on public.lev_propostas(lead_id);
create index idx_lev_prop_pago on public.lev_propostas(pago, capi_enviado_em);
create index idx_lev_prop_criado on public.lev_propostas(criado desc);

alter table public.lev_leads enable row level security;
alter table public.lev_propostas enable row level security;
create policy lev_leads_select on public.lev_leads for select to authenticated using (true);
create policy lev_prop_select  on public.lev_propostas for select to authenticated using (true);
-- escrita: apenas service_role (edge de ingestão). Sem policy de insert/update p/ authenticated.