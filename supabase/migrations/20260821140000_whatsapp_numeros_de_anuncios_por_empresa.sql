-- WhatsApp em anúncios (Click-to-WhatsApp) por empresa.
-- Problema medido (21/08/2026): menu WhatsApp da COHAPM mostrava "Nenhuma conta…",
-- enquanto a Legal tem WABAs Cloud API via waba-sync (hardcoded na Legal).
-- A COHAPM não tem WABA Cloud API no BM do token; os números vivem em destination_url
-- (wa.me/…) e nos nomes dos conjuntos. Esta RPC materializa esse inventário em
-- waba_phone_numbers com platform_type='CLICK_TO_WHATSAPP' (sem fingir qualidade/tier).

create or replace function public.formatar_telefone_br_wa(p_digits text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p_digits, ''), '\D', '', 'g');
begin
  if length(d) = 11 and left(d, 2) <> '55' then
    d := '55' || d;
  end if;
  if length(d) = 13 and left(d, 2) = '55' then
    return '+55 ' || substring(d from 3 for 2) || ' '
      || substring(d from 5 for 5) || '-' || substring(d from 10 for 4);
  end if;
  if length(d) = 12 and left(d, 2) = '55' then
    return '+55 ' || substring(d from 3 for 2) || ' '
      || substring(d from 5 for 4) || '-' || substring(d from 9 for 4);
  end if;
  if d = '' then return null; end if;
  return '+' || d;
end;
$$;

create or replace function public.sincronizar_whatsapp_numeros_de_anuncios(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp record;
  v_waba_id text;
  v_digits text;
  v_display text;
  v_rotulo text;
  v_campanhas text;
  v_conjuntos text;
  v_ativos int;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_empresas int := 0;
  v_total int := 0;
  v_ext text;
  v_existia boolean;
begin
  for v_emp in
    select c.id, c.name
    from public.companies c
    where p_company_id is null or c.id = p_company_id
  loop
    v_empresas := v_empresas + 1;
    v_waba_id := 'ads-destino-' || v_emp.id::text;

    insert into public.wabas as w (
      company_id, external_id, name, ownership_type, account_review_status,
      estado_local, raw, last_synced_at
    ) values (
      v_emp.id,
      v_waba_id,
      'Números em anúncios (Click-to-WhatsApp)',
      'ads_destination',
      'N/A',
      'ativa',
      jsonb_build_object(
        'origem', 'sincronizar_whatsapp_numeros_de_anuncios',
        'nota', 'Inventário derivado de ads/ad_sets — não é Cloud API; sem qualidade/tier da Graph WABA'
      ),
      now()
    )
    on conflict (external_id) do update set
      company_id = excluded.company_id,
      name = excluded.name,
      ownership_type = excluded.ownership_type,
      raw = excluded.raw,
      last_synced_at = now(),
      estado_local = 'ativa';

    -- Extrai dígitos de wa.me / api.whatsapp.com nos anúncios + padrão WA- no conjunto
    for v_digits, v_rotulo, v_campanhas, v_conjuntos, v_ativos in
      with urls as (
        select
          a.company_id,
          regexp_replace(
            coalesce(
              (regexp_match(lower(coalesce(a.destination_url, '')), 'wa\.me/([0-9]+)'))[1],
              (regexp_match(lower(coalesce(a.destino_url, '')), 'wa\.me/([0-9]+)'))[1],
              (regexp_match(lower(coalesce(a.destination_url, a.destino_url, '')), '[?&]phone=([0-9]+)'))[1]
            ),
            '\D', '', 'g'
          ) as digits,
          c.name as campanha,
          s.name as conjunto,
          case when lower(coalesce(a.status, '')) in ('active', 'ativo')
                 or lower(coalesce(c.status, '')) = 'active' then 1 else 0 end as em_ativo
        from public.ads a
        join public.campaigns c on c.id = a.campaign_id
        left join public.ad_sets s on s.external_id = a.adset_external_id and s.company_id = a.company_id
        where a.company_id = v_emp.id
          and coalesce(a.destination_url, a.destino_url, '') ~* 'wa\.me/|whatsapp\.com|phone='
        union all
        select
          s.company_id,
          regexp_replace(
            coalesce((regexp_match(s.name, 'WA[-_]?([0-9][0-9\-]+)'))[1], ''),
            '\D', '', 'g'
          ) as digits,
          c.name,
          s.name,
          case when upper(coalesce(s.status, '')) = 'ACTIVE' then 1 else 0 end
        from public.ad_sets s
        join public.campaigns c on c.id = s.campaign_id
        where s.company_id = v_emp.id
          and s.name ~* 'WA[-_]?[0-9]'
      ),
      norm as (
        select
          case
            when length(digits) = 11 and left(digits, 2) <> '55' then '55' || digits
            when length(digits) = 10 and left(digits, 2) <> '55' then '55' || digits
            when length(digits) between 12 and 13 then digits
            when length(digits) > 13 then right(digits, 13)
            else digits
          end as digits,
          campanha,
          conjunto,
          em_ativo
        from urls
        where length(regexp_replace(coalesce(digits, ''), '\D', '', 'g')) >= 10
      )
      select
        digits,
        max(conjunto) filter (where conjunto is not null) as rotulo,
        string_agg(distinct campanha, ', ' order by campanha) as campanhas,
        string_agg(distinct conjunto, ', ' order by conjunto) as conjuntos,
        sum(em_ativo)::int as ativos
      from norm
      where length(digits) between 12 and 13
      group by digits
    loop
      v_total := v_total + 1;
      v_display := public.formatar_telefone_br_wa(v_digits);
      v_ext := 'ads-wa:' || v_emp.id::text || ':' || v_digits;
      select exists(select 1 from public.waba_phone_numbers where external_id = v_ext) into v_existia;

      insert into public.waba_phone_numbers as p (
        company_id, waba_external_id, external_id,
        display_phone_number, verified_name, status,
        quality_rating, messaging_limit_tier, platform_type,
        raw, last_synced_at
      ) values (
        v_emp.id,
        v_waba_id,
        v_ext,
        v_display,
        coalesce(nullif(v_rotulo, ''), 'Número em anúncio'),
        case when v_ativos > 0 then 'IN_ACTIVE_ADS' else 'IN_ADS' end,
        null,
        null,
        'CLICK_TO_WHATSAPP',
        jsonb_build_object(
          'origem', 'anuncios',
          'digits', v_digits,
          'campanhas', v_campanhas,
          'conjuntos', v_conjuntos,
          'anuncios_ativos_sinal', v_ativos,
          'nota', 'Click-to-WhatsApp / destino de anúncio. Sem qualidade nem tier da Cloud API.'
        ),
        now()
      )
      on conflict (external_id) do update set
        company_id = excluded.company_id,
        waba_external_id = excluded.waba_external_id,
        display_phone_number = excluded.display_phone_number,
        verified_name = excluded.verified_name,
        status = excluded.status,
        platform_type = 'CLICK_TO_WHATSAPP',
        raw = excluded.raw,
        last_synced_at = now();

      if v_existia then
        v_atualizados := v_atualizados + 1;
      else
        v_inseridos := v_inseridos + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'empresas', v_empresas,
    'numeros_processados', v_total,
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'versao', 'whatsapp-ads-destino-v1'
  );
end;
$$;

revoke all on function public.formatar_telefone_br_wa(text) from public, anon;
grant execute on function public.formatar_telefone_br_wa(text) to authenticated, service_role;

revoke all on function public.sincronizar_whatsapp_numeros_de_anuncios(uuid) from public, anon;
grant execute on function public.sincronizar_whatsapp_numeros_de_anuncios(uuid) to authenticated, service_role;

-- Materializa agora (todas as empresas).
select public.sincronizar_whatsapp_numeros_de_anuncios(null);
