-- ESP-36: brand_identity por empresa (voz/tom + guardrails de marca curados).
--
-- Ate aqui a "marca" estava fragmentada: prompt hardcoded do motor de legenda ("Legal e Viver"),
-- IDs tecnicos em meta_execution_config, decisoes em prosa no agent_context e guardrails globais em
-- promessas_proibidas/compliance_rules. Nao havia um registro CONSULTAVEL de voz/tom por empresa.
--
-- ESP-36 cria uma identidade de marca CURADA por empresa (decisao do gestor, nao inferida): voz/tom,
-- dos/donts, disclaimers obrigatorios, linhas de produto, nota de identidade visual e ponteiros para
-- os guardrails (promessas_proibidas) e para as referencias tecnicas (meta_execution_config,
-- destino_por_produto). O motor de legenda (ESP-37) passa a consumir isso automaticamente.
--
-- Aplicada como version 20260812210513. Espelho fiel em
-- supabase/espelhos/20260812210513_esp36_brand_identity_por_empresa.sql

create table if not exists public.brand_identity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  versao integer not null,
  vigente boolean not null default true,
  marca_nome text not null,
  marca_tag text,
  voz_tom jsonb not null default '{}'::jsonb,
  dos jsonb not null default '[]'::jsonb,
  donts jsonb not null default '[]'::jsonb,
  disclaimers_obrigatorios jsonb not null default '[]'::jsonb,
  forbidden_claims_ref text not null default 'promessas_proibidas',
  linhas_produto jsonb not null default '[]'::jsonb,
  identidade_visual jsonb not null default '{}'::jsonb,
  referencias jsonb not null default '{}'::jsonb,
  procedencia jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint brand_identity_versao_unica unique (company_id, versao)
);
create unique index if not exists idx_brand_identity_uma_vigente
  on public.brand_identity (company_id) where vigente;

alter table public.brand_identity enable row level security;
drop policy if exists brand_identity_leitura on public.brand_identity;
create policy brand_identity_leitura on public.brand_identity
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

create or replace function public.ler_brand_identity(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
  v_ref jsonb;
  v_destinos jsonb;
begin
  if p_company_id is null then
    return jsonb_build_object('erro','company_id_obrigatorio','motivo','ler_brand_identity exige a empresa da conversa.');
  end if;

  select to_jsonb(t) into v
  from (
    select versao, vigente, marca_nome, marca_tag, voz_tom, dos, donts,
           disclaimers_obrigatorios, forbidden_claims_ref, linhas_produto,
           identidade_visual, referencias, procedencia
    from public.brand_identity
    where company_id = p_company_id and vigente
    order by versao desc
    limit 1
  ) t;

  select jsonb_agg(jsonb_build_object('produto', produto, 'url', url_canonica) order by produto)
    into v_destinos
    from public.destino_por_produto
   where company_id = p_company_id and vigente;

  select jsonb_strip_nulls(jsonb_build_object(
           'page_id', mec.page_id,
           'cta_padrao', mec.cta_padrao,
           'marca_tag', mec.marca_tag,
           'instagram_actor_id', mec.instagram_actor_id,
           'instagram_handle', mec.instagram_handle,
           'instagram_identity_page_id', mec.instagram_identity_page_id,
           'driver_escrita', mec.driver_escrita
         ))
    into v_ref
    from public.meta_execution_config mec
   where mec.company_id = p_company_id
   limit 1;

  if v is null then
    return jsonb_build_object(
      'ok', true, 'existe', false,
      'referencias_resolvidas', jsonb_build_object('config', coalesce(v_ref,'{}'::jsonb), 'destinos', coalesce(v_destinos,'[]'::jsonb)),
      'motivo', 'nenhuma identidade de marca vigente para a empresa. Semeie brand_identity ou crie uma versao.'
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'existe', true,
    'brand', v,
    'referencias_resolvidas', jsonb_build_object('config', coalesce(v_ref,'{}'::jsonb), 'destinos', coalesce(v_destinos,'[]'::jsonb)),
    'lacunas', jsonb_build_array(
      'Identidade e CURADA (decisao do gestor), nao inferida de dados. Mantenha vigente ao mudar posicionamento.',
      'forbidden_claims_ref aponta promessas_proibidas (global); a checagem dura continua em compliance-check e checar_par_texto_e_peca.'
    )
  );
end $function$;

comment on function public.ler_brand_identity(uuid) is
  'ESP-36: le a identidade de marca vigente da empresa (voz/tom, dos/donts, disclaimers, linhas de produto) + referencias resolvidas de meta_execution_config e destino_por_produto.';

revoke all on function public.ler_brand_identity(uuid) from public, anon;
grant execute on function public.ler_brand_identity(uuid) to service_role;

-- Seed LEV v1 (decisoes Roberto 31/07 e 03/08; FIN-04 v3; ESP-09).
insert into public.brand_identity
  (company_id, versao, vigente, marca_nome, marca_tag, voz_tom, dos, donts,
   disclaimers_obrigatorios, linhas_produto, identidade_visual, referencias, procedencia)
select
  'ded20b38-f42e-4c71-800c-31b97ea48bcf', 1, true, 'Legal e Viver', 'LEV',
  jsonb_build_object(
    'tom', 'direto, conversacional e acolhedor; sem urgencia falsa nem escassez inventada',
    'persona', 'especialista em credito consignado CLT que fala simples e honesto',
    'pessoa', 'fala com voce (2a pessoa); frases curtas'
  ),
  jsonb_build_array(
    'Explicar beneficio concreto (dinheiro rapido, sem burocracia) com honestidade',
    'CTA claro: simular ou falar com especialista',
    'Incluir o CET na legenda da publicacao (FIN-04 v3)',
    'Falar de CLT/carteira assinada quando a oferta for consignado CLT'
  ),
  jsonb_build_array(
    'Garantia de aprovacao / "100% aprovado"',
    '"sem consulta" / "sem analise"',
    'Prometer dinheiro gratis ou omitir risco de credito',
    'Urgencia falsa e escassez inventada'
  ),
  jsonb_build_array(
    'CET da oferta mora na legenda da publicacao (FIN-04 v3)',
    'Credito sujeito a analise/aprovacao'
  ),
  jsonb_build_array('consignado_clt', 'educacao_financeira', 'seguranca_financeira'),
  jsonb_build_object(
    'nota', 'Acervo liberado por Roberto (31/07); universo visual educacional/seguranca com produto CLT. Visual da peca informa, nao aprova.'
  ),
  jsonb_build_object(
    'page_id_e_instagram', 'ver meta_execution_config (referencias_resolvidas.config)',
    'destino_por_produto', 'ver referencias_resolvidas.destinos'
  ),
  jsonb_build_object(
    'decidido_por', 'Roberto (gestor)',
    'decidido_em', '2026-07-31 / 2026-08-03',
    'fonte', 'audios 31/07 e 03/08; FIN-04 v3; ESP-09 promessas_proibidas',
    'citacao', 'universo criativo: CLT + educacao financeira + seguranca; tudo derrama na LP'
  )
where not exists (
  select 1 from public.brand_identity
  where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf' and vigente
);

insert into public.agent_context (categoria, fato, vigente, desde)
values (
  'doutrina',
  'IDENTIDADE DE MARCA (ESP-36, 12/08/2026). Cada empresa tem brand_identity vigente (voz/tom, dos/donts, disclaimers, linhas de produto) lida por ler_brand_identity, que ainda resolve referencias tecnicas (page_id/instagram/CTA/driver em meta_execution_config) e destinos (destino_por_produto). O motor de legenda (gerar_legendas/ESP-37) CONSOME automaticamente essa identidade; antes de redigir copy, consulte ler_brand_identity. A identidade e CURADA (decisao do gestor), nao inferida; forbidden_claims_ref aponta promessas_proibidas e a checagem dura segue em compliance-check.',
  true,
  date '2026-08-12'
);
