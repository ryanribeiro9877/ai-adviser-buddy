-- Slate duravel por conversa + identidade La Felicità (25/08/2026).
-- Incidente COHAPM: o agente esqueceu os 8 videos do CONJ.1 (HIST_CAP cortou a cauda
-- da distribuicao; inventario Drive dos 34 nao e o slate) e ler_brand_identity so
-- devolvia COHAPM Juridico. Espelho: supabase/espelhos/20260825190000_slate_duravel_e_brand_la_felicita.sql

create table if not exists public.conversation_slate (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  conjunto integer not null check (conjunto between 1 and 99),
  peca_chave text not null,
  drive_file_id text not null,
  nome text not null,
  pasta text,
  angulo text,
  cta text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_slate_peca_unica unique (conversation_id, drive_file_id)
);

comment on table public.conversation_slate is
  'Slate contratual desta conversa: pecas ja escolhidas por conjunto (drive_file_id, nome, angulo, CTA). Sobrevive a HIST_CAP. Inventario Drive != slate.';

create index if not exists conversation_slate_company_conv_idx
  on public.conversation_slate (company_id, conversation_id, conjunto);

alter table public.conversation_slate enable row level security;
drop policy if exists conversation_slate_select on public.conversation_slate;
create policy conversation_slate_select on public.conversation_slate
  for select to authenticated
  using (public.is_company_member(company_id, (select auth.uid())));
drop policy if exists conversation_slate_admin_write on public.conversation_slate;
create policy conversation_slate_admin_write on public.conversation_slate
  for all to authenticated
  using (public.is_company_member(company_id, (select auth.uid())))
  with check (public.is_company_member(company_id, (select auth.uid())));

alter table public.brand_identity add column if not exists meio text;
comment on column public.brand_identity.meio is
  'Marca/linha dentro da empresa: juridico | la_felicita | null (empresa de uma so voz).';

drop index if exists public.idx_brand_identity_uma_vigente;
create unique index if not exists idx_brand_identity_uma_vigente_meio
  on public.brand_identity (company_id, coalesce(meio, ''))
  where vigente;

update public.brand_identity
   set meio = 'juridico'
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and vigente
   and (meio is null or meio = '')
   and marca_nome ilike '%juridico%';

insert into public.brand_identity
  (company_id, versao, vigente, marca_nome, marca_tag, meio, voz_tom, dos, donts,
   disclaimers_obrigatorios, linhas_produto, identidade_visual, referencias, procedencia)
select
  '57f755b9-c23d-4f58-a488-8173d697c010', 2, true, 'La Felicità', 'LAF', 'la_felicita',
  jsonb_build_object(
    'tom', 'acolhedor, sensorial e cotidiano; fala de morar bem, rotina e pertencimento sem legalese',
    'persona', 'quem ja vive no residencial e convida o vizinho a conhecer o La Felicità',
    'pessoa', 'fala com voce (2a pessoa); frases curtas'
  ),
  jsonb_build_array(
    'Abrir pela sensacao da cena (chegada, familia, lazer, rotina, noite)',
    'Beneficio concreto do residencial sem inventar metragem, preco ou condicao comercial',
    'CTA claro: conhecer o La Felicità / ver o empreendimento no site',
    'Destino WEBSITE / LANDING_PAGE_VIEWS — nao WhatsApp juridico'
  ),
  jsonb_build_array(
    'Copiar voz do nucleo Juridico (conta de luz, cobranca indevida, emprestimo abusivo)',
    'Inventar credito consignado, CLT, CET, margem ou correspondente bancario',
    'Prometer resultado juridico, garantia de financiamento ou urgencia falsa',
    'Tratar La Felicità como produto de WhatsApp juridico da cooperativa'
  ),
  jsonb_build_array(
    'Empreendimento residencial La Felicità / COHAPM',
    'Informacoes comerciais oficiais no destino do anuncio — nao inventar oferta'
  ),
  jsonb_build_array('imovel', 'residencial', 'la_felicita'),
  jsonb_build_object(
    'nota', 'Acervo La Felicità: Reels/Videos de Junho-Agosto. NAO e universo Juridico WA.'
  ),
  jsonb_build_object(
    'page_id_e_instagram', 'ver meta_execution_config (referencias_resolvidas.config)',
    'destino', 'WEBSITE / landing do empreendimento — sem wa.me do Juridico'
  ),
  jsonb_build_object(
    'decidido_por', 'Roberto (gestor) / isolamento Juridico vs La Felicita',
    'decidido_em', '2026-08-25',
    'fonte', 'campanha COHAPM_LAFELICITA_CONV_AGO26',
    'citacao', 'La Felicità e residencial; copy de descoberta/rotina/morar bem — sem Juridico'
  )
where not exists (
  select 1 from public.brand_identity
  where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and meio = 'la_felicita'
    and vigente
);

-- NAO dropa ler_brand_identity(uuid): score_de_prontidao depende da assinatura de 1 arg.
-- Duas funcoes: (uuid, text) SEM default + (uuid) que delega. Evita ambiguidade e CASCADE.

create or replace function public.ler_brand_identity(p_company_id uuid, p_meio text)
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
  v_todas jsonb;
  v_meio text;
begin
  if p_company_id is null then
    return jsonb_build_object('erro','company_id_obrigatorio','motivo','ler_brand_identity exige a empresa da conversa.');
  end if;

  v_meio := nullif(lower(trim(coalesce(p_meio, ''))), '');

  select jsonb_agg(jsonb_build_object(
           'meio', meio, 'marca_nome', marca_nome, 'marca_tag', marca_tag,
           'linhas_produto', linhas_produto
         ) order by meio nulls last, versao desc)
    into v_todas
    from public.brand_identity
   where company_id = p_company_id and vigente;

  select to_jsonb(t) into v
  from (
    select versao, vigente, marca_nome, marca_tag, meio, voz_tom, dos, donts,
           disclaimers_obrigatorios, forbidden_claims_ref, linhas_produto,
           identidade_visual, referencias, procedencia
    from public.brand_identity
    where company_id = p_company_id and vigente
      and (
        v_meio is null
        or meio = v_meio
      )
    order by
      case
        when v_meio is not null and meio = v_meio then 0
        when v_meio is null and meio = 'juridico' then 1
        when v_meio is null and meio is null then 2
        else 3
      end,
      versao desc
    limit 1
  ) t;

  -- Pedido de um meio especifico: NUNCA devolver a outra marca da mesma empresa.
  if v_meio is not null and (v is null or coalesce(v->>'meio','') <> v_meio) then
    v := null;
  end if;

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
      'meio_pedido', v_meio,
      'identidades', coalesce(v_todas, '[]'::jsonb),
      'referencias_resolvidas', jsonb_build_object('config', coalesce(v_ref,'{}'::jsonb), 'destinos', coalesce(v_destinos,'[]'::jsonb)),
      'motivo', case
        when v_meio is not null then 'nenhuma identidade vigente para este meio. Nao use a outra marca da empresa.'
        else 'nenhuma identidade de marca vigente para a empresa. Semeie brand_identity ou crie uma versao.'
      end
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'existe', true,
    'brand', v,
    'identidades', coalesce(v_todas, '[]'::jsonb),
    'referencias_resolvidas', jsonb_build_object('config', coalesce(v_ref,'{}'::jsonb), 'destinos', coalesce(v_destinos,'[]'::jsonb)),
    'lacunas', jsonb_build_array(
      'Identidade e CURADA (decisao do gestor), nao inferida de dados. Mantenha vigente ao mudar posicionamento.',
      'COHAPM tem vozes distintas: meio=juridico vs meio=la_felicita. Passe p_meio. Misturar copy e falta grave.'
    )
  );
end $function$;

comment on function public.ler_brand_identity(uuid, text) is
  'ESP-36: le identidade vigente. p_meio = juridico|la_felicita. Sem match no meio pedido, existe=false — nao devolve a outra marca.';

revoke all on function public.ler_brand_identity(uuid, text) from public, anon, authenticated;
grant execute on function public.ler_brand_identity(uuid, text) to service_role;

create or replace function public.ler_brand_identity(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.ler_brand_identity(p_company_id, null::text);
$function$;

comment on function public.ler_brand_identity(uuid) is
  'ESP-36: identidade vigente sem recorte de meio (delega para a assinatura de 2 args com p_meio null). Preferencia COHAPM: juridico quando ha duas vozes.';

revoke all on function public.ler_brand_identity(uuid) from public, anon, authenticated;
grant execute on function public.ler_brand_identity(uuid) to service_role;

update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and vigente = true
   and (
     fato ilike 'SLATE DA CONVERSA E DURAVEL%'
     or fato ilike 'IDENTIDADE LA FELICITA%'
   );

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  'SLATE DA CONVERSA E DURAVEL (25/08/2026). Pecas JA escolhidas por conjunto (CONJ.N + drive_file_id + nome + angulo + CTA) ficam em conversation_slate (tools get_slate_da_conversa e registrar_peca_da_conversa). O sistema tambem extrai tabelas CONJ.N da propria conversa. Inventario Drive (N videos da pasta) NAO e o slate e NAO apaga a selecao. Pedido de legendas/cards dos videos que VOCE selecionou: use o store — PROIBIDO pedir ao gestor para re-colar e PROIBIDO recusar porque o acervo "nao traz o slate".',
  true,
  date '2026-08-25',
  null
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'doutrina',
  'IDENTIDADE LA FELICITA (25/08/2026): brand_identity vigente meio=la_felicita, marca La Felicità, linhas imovel/residencial. Campanha COHAPM_LAFELICITA_* e produto imovel usam ESTA voz. NAO use COHAPM Juridico (conta de luz, cobranca, emprestimo). Chame ler_brand_identity com meio=la_felicita. gerar_legendas consome automaticamente quando produto=imovel/la_felicita.',
  true,
  date '2026-08-25'
where not exists (
  select 1 from public.agent_context
  where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and categoria = 'doutrina'
    and fato like 'IDENTIDADE LA FELICITA (25/08/2026)%'
    and vigente
);
