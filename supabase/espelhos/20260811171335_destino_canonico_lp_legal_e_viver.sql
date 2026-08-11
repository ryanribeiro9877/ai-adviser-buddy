-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260811171335
-- name: destino_canonico_lp_legal_e_viver
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Cursor via MCP apply_migration
-- espelho do arquivo em supabase/migrations com o mesmo version do schema_migrations
-- DESTINO CANONICO LP/SITE DA LEGAL E VIVER
--
-- PROBLEMA: a rota de peca nova (e a replicacao com object_story_spec) herda o link do molde.
-- Em 11/08/2026 a coleta GT-12 mostrava 38 anuncios em https://legaleviver.com.br/ e 23 no
-- path certo https://legaleviver.com.br/simulacao-clt. Moldes "bons" de criativo dinamico ja
-- carregam o path; moldes de video_data muitas vezes so a raiz. Herdar a raiz em silencio
-- publicaria LP incompleta.
--
-- COMPORTAMENTO ESCOLHIDO: CORRIGIR automaticamente (nao recusar) quando a URL e do dominio
-- legaleviver.com.br sem /simulacao-clt. Justificativa: e o mesmo produto com path incompleto;
-- recusar bloquearia dezenas de moldes operacionais. WhatsApp (wa.me, api.whatsapp.com) e
-- outros dominios ficam FORA â€” nao inventamos URL. Normaliza http/https, www e trailing slash.
--
-- ONDE VIVE: RPC resolver_destino_url_lp_legal_e_viver (criterio) + pedido_de_anuncio_completo
-- (portao na emissao, declara a correcao no JSON) + meta-actions montarCriacao (enforcement,
-- mesmo criterio via _shared/destino_url_lp.ts). agent_context orienta o agente a propor o
-- canÃ´nico.

create or replace function public.resolver_destino_url_lp_legal_e_viver(
  p_company_id uuid,
  p_url text
)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_lev constant uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
  v_canon constant text := 'https://legaleviver.com.br/simulacao-clt';
  v_dom constant text := 'legaleviver.com.br';
  v_raw text := nullif(btrim(coalesce(p_url, '')), '');
  v_sem_scheme text;
  v_hostport text;
  v_host text;
  v_path text;
begin
  if p_company_id is distinct from v_lev then
    return jsonb_build_object(
      'aplicavel', false,
      'url_original', v_raw,
      'url_final', v_raw,
      'corrigiu', false,
      'motivo', 'empresa_fora_do_escopo');
  end if;

  if v_raw is null then
    return jsonb_build_object(
      'aplicavel', false,
      'url_original', null,
      'url_final', null,
      'corrigiu', false,
      'motivo', 'url_ausente');
  end if;

  -- Aceita http(s)://opcional. Host = primeiro segmento; path = resto ate ?/#.
  v_sem_scheme := regexp_replace(v_raw, '^https?://', '', 'i');
  v_hostport := split_part(v_sem_scheme, '/', 1);
  if v_hostport = '' then
    return jsonb_build_object(
      'aplicavel', false,
      'url_original', v_raw,
      'url_final', v_raw,
      'corrigiu', false,
      'motivo', 'url_invalida');
  end if;
  -- userinfo@host:porta -> host
  if position('@' in v_hostport) > 0 then
    v_hostport := split_part(v_hostport, '@', 2);
  end if;
  v_host := lower(split_part(v_hostport, ':', 1));
  v_host := regexp_replace(v_host, '^www\.', '');

  if v_host = '' then
    return jsonb_build_object(
      'aplicavel', false,
      'url_original', v_raw,
      'url_final', v_raw,
      'corrigiu', false,
      'motivo', 'url_invalida');
  end if;

  if v_host is distinct from v_dom then
    return jsonb_build_object(
      'aplicavel', false,
      'url_original', v_raw,
      'url_final', v_raw,
      'corrigiu', false,
      'motivo', 'dominio_fora_do_escopo_lp');
  end if;

  v_path := substr(v_sem_scheme, length(split_part(v_sem_scheme, '/', 1)) + 1);
  if v_path is null or v_path = '' then
    v_path := '/';
  end if;
  v_path := split_part(split_part(v_path, '?', 1), '#', 1);
  if v_path <> '/' then
    v_path := regexp_replace(v_path, '/+$', '');
  end if;

  if v_path = '/simulacao-clt'
     and v_raw ~* '^https://legaleviver\.com\.br/simulacao-clt/?$' then
    return jsonb_build_object(
      'aplicavel', true,
      'url_original', v_raw,
      'url_final', v_canon,
      'corrigiu', false,
      'motivo', 'ja_canonico');
  end if;

  return jsonb_build_object(
    'aplicavel', true,
    'url_original', v_raw,
    'url_final', v_canon,
    'corrigiu', true,
    'motivo', 'corrigido_para_canonico');
end;
$function$;

comment on function public.resolver_destino_url_lp_legal_e_viver(uuid, text) is
  'Criterio unico (PO-17) do destino LP/Site da Legal e Viver: dominio legaleviver.com.br vira https://legaleviver.com.br/simulacao-clt. Outros dominios (WhatsApp etc.) nao se aplicam. Espelhado em _shared/destino_url_lp.ts na executora.';

revoke all on function public.resolver_destino_url_lp_legal_e_viver(uuid, text) from public, anon;
grant execute on function public.resolver_destino_url_lp_legal_e_viver(uuid, text) to authenticated, service_role;

-- Le o destino coletado (GT-12) do molde pelo creative_id e aplica o criterio.
create or replace function public.destino_url_lp_do_molde(
  p_company_id uuid,
  p_creative_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_url text;
  v_sit text;
  v_res jsonb;
begin
  if nullif(btrim(coalesce(p_creative_id, '')), '') is null then
    return jsonb_build_object(
      'aplicavel', false,
      'url_do_molde', null,
      'motivo', 'creative_id_ausente');
  end if;

  select a.destino_url, a.destino_url_situacao
    into v_url, v_sit
    from public.ads a
   where a.company_id = p_company_id
     and a.creative_id = btrim(p_creative_id)
     and a.destino_url_coletado_em is not null
   order by
     case when a.destino_url_situacao = 'unica' and a.destino_url is not null then 0 else 1 end,
     a.destino_url_coletado_em desc nulls last
   limit 1;

  if not found then
    return jsonb_build_object(
      'aplicavel', false,
      'url_do_molde', null,
      'destino_url_situacao', null,
      'motivo', 'destino_do_molde_nunca_lido');
  end if;

  v_res := public.resolver_destino_url_lp_legal_e_viver(p_company_id, v_url);
  return v_res || jsonb_build_object(
    'url_do_molde', v_url,
    'destino_url_situacao', v_sit);
end;
$function$;

comment on function public.destino_url_lp_do_molde(uuid, text) is
  'Portao de emissao: le ads.destino_url (GT-12) do creative molde e devolve a resolucao canÃ´nica LP da Legal e Viver.';

revoke all on function public.destino_url_lp_do_molde(uuid, text) from public, anon;
grant execute on function public.destino_url_lp_do_molde(uuid, text) to authenticated, service_role;

-- Portao: apos completo+estado, anexa destino_url_lp. Nao recusa raiz do dominio LP â€”
-- a executora corrige. Recusa nomeada so quando o pedido EXPLICITA destino_url do dominio
-- LP que a resolucao marca como aplicavel+corrigiu E o caller pediu recusar_se_corrigir
-- (nao usado hoje; reservado). Padrao: declara a correcao.
create or replace function public.pedido_de_anuncio_completo(p_company_id uuid, p_pedido jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_estado jsonb;
  v_molde text;
  v_dest jsonb;
  v_msg text;
begin
  v_base := public.pedido_de_anuncio_completo_sem_estado_destino(p_company_id, p_pedido);
  if coalesce((v_base->>'completo')::boolean, false) is not true then
    return v_base;
  end if;

  v_estado := public.avaliar_estado_destino_execucao(
    'criar_anuncio_a_partir_de', p_pedido, p_company_id);
  if coalesce((v_estado->>'valido')::boolean, true) is not true then
    return v_base || jsonb_build_object(
      'completo', false,
      'recusa', v_estado->>'recusa',
      'estado_destino', v_estado,
      'faltando', '[]'::jsonb,
      'mensagem_para_o_gestor', v_estado->>'mensagem');
  end if;

  v_molde := coalesce(
    nullif(btrim(coalesce(p_pedido->>'creative_id', '')), ''),
    nullif(btrim(coalesce(p_pedido->>'molde', '')), ''),
    nullif(btrim(coalesce(p_pedido->>'molde_creative_id', '')), ''));
  v_dest := public.destino_url_lp_do_molde(p_company_id, v_molde);

  v_msg := coalesce(v_base->>'mensagem_para_o_gestor', '');
  if coalesce((v_dest->>'aplicavel')::boolean, false)
     and coalesce((v_dest->>'corrigiu')::boolean, false) then
    v_msg := v_msg
      || ' DESTINO LP: o molde traz '
      || coalesce(v_dest->>'url_original', v_dest->>'url_do_molde', '(raiz)')
      || '; na publicacao usarei o canÃ´nico '
      || coalesce(v_dest->>'url_final', 'https://legaleviver.com.br/simulacao-clt')
      || ' (simulacao CLT). Nao e recusa â€” e correcao automatica do path.';
  elsif coalesce((v_dest->>'aplicavel')::boolean, false) then
    v_msg := v_msg
      || ' DESTINO LP: '
      || coalesce(v_dest->>'url_final', 'https://legaleviver.com.br/simulacao-clt')
      || '.';
  end if;

  return v_base || jsonb_build_object(
    'estado_destino', v_estado,
    'destino_url_lp', v_dest,
    'mensagem_para_o_gestor', v_msg);
end;
$function$;

comment on function public.pedido_de_anuncio_completo(uuid, jsonb) is
  'Gate antes do card. Mantem gates operacionais e de estado; para Legal e Viver anexa destino_url_lp (canÃ´nico /simulacao-clt) a partir do destino GT-12 do molde. Correcao da raiz do dominio LP e declarada, nao silenciosa.';

revoke all on function public.pedido_de_anuncio_completo(uuid, jsonb) from public, anon;
grant execute on function public.pedido_de_anuncio_completo(uuid, jsonb) to authenticated, service_role;

-- Contrato: documenta destino_url como campo opcional do pedido (a executora aplica o canÃ´nico).
insert into public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, suportado, vigente)
select
  'criar_anuncio_a_partir_de',
  'destino_url',
  false,
  'text',
  'URL de destino do anuncio. Na Legal e Viver, LP/Site usa o canÃ´nico https://legaleviver.com.br/simulacao-clt: se o molde trouxer o mesmo dominio sem esse path, a executora CORRIGE (nao inventa URL para WhatsApp/outros dominios). Pedido e card podem carregar o valor ja resolvido para o gestor ver.',
  'meta-actions montarCriacao v5.6 + resolver_destino_url_lp_legal_e_viver',
  true,
  true
where not exists (
  select 1 from public.contrato_de_execucao
   where acao = 'criar_anuncio_a_partir_de' and campo = 'destino_url' and vigente
);

-- Doutrina para o agente.
update public.agent_context
   set vigente = false, atualizado = now()
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and vigente
   and fato ilike '%simulacao-clt%';

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'execucao',
  'DESTINO CANONICO LP/SITE (11/08/2026): anuncios de landing page / site da Legal e Viver usam SEMPRE https://legaleviver.com.br/simulacao-clt â€” nao a raiz legaleviver.com.br. Ao propor criar_anuncio_a_partir_de (peca nova ou replicacao), esse e o destino a declarar. Se o molde trouxer http/https, www ou path vazio/outro no mesmo dominio, o sistema CORRIGE para o canÃ´nico na emissao (pedido_de_anuncio_completo.destino_url_lp) e na executora; WhatsApp (wa.me etc.) nao e reescrito. Nao invente URL para produto que nao seja LP/Site.',
  true,
  current_date,
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);

-- Prova embutida (read-only asserts na migracao).
do $$
declare
  v jsonb;
  v_lev uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
begin
  v := public.resolver_destino_url_lp_legal_e_viver(v_lev, 'https://legaleviver.com.br/');
  if v->>'motivo' <> 'corrigido_para_canonico'
     or v->>'url_final' <> 'https://legaleviver.com.br/simulacao-clt' then
    raise exception 'prova raiz falhou: %', v;
  end if;

  v := public.resolver_destino_url_lp_legal_e_viver(v_lev, 'http://www.legaleviver.com.br');
  if v->>'motivo' <> 'corrigido_para_canonico' then
    raise exception 'prova www/http falhou: %', v;
  end if;

  v := public.resolver_destino_url_lp_legal_e_viver(v_lev, 'https://legaleviver.com.br/simulacao-clt');
  if v->>'motivo' <> 'ja_canonico' or (v->>'corrigiu')::boolean then
    raise exception 'prova ja_canonico falhou: %', v;
  end if;

  v := public.resolver_destino_url_lp_legal_e_viver(v_lev, 'https://wa.me/5571994120467');
  if v->>'motivo' <> 'dominio_fora_do_escopo_lp' or (v->>'aplicavel')::boolean then
    raise exception 'prova whatsapp falhou: %', v;
  end if;

  v := public.resolver_destino_url_lp_legal_e_viver(
    '00000000-0000-0000-0000-000000000001', 'https://legaleviver.com.br/');
  if v->>'motivo' <> 'empresa_fora_do_escopo' then
    raise exception 'prova outra empresa falhou: %', v;
  end if;
end $$;

