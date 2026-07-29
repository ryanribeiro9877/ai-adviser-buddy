-- [F5.5] Monitor de tier/qualidade dos numeros WhatsApp (caminho para o ilimitado).
-- Compara, POR NUMERO, o snapshot mais recente com o snapshot anterior (datas distintas)
-- em waba_phone_snapshots (alimentada diariamente pelo waba-sync 09:30 UTC) e gera alerta:
--   - queda de tier  -> high   (perda de capacidade de envio)
--   - subida de tier -> medium (progresso rumo ao ilimitado - noticia boa, mas registrada)
--   - qualidade piorou (GREEN->YELLOW/RED, YELLOW->RED) -> high
--   - qualidade melhorou -> low
-- Dedup: nao insere se ja existe alerta NAO resolvido com mesmo titulo+descricao na empresa.
-- rule_id fica NULL de proposito (a coluna e FK uuid para regras de custo; isto e monitor).
-- SQL puro de proposito, mesmo racional do watchdog: monitor nao pode depender da saude
-- do que ele monitora.

create or replace function public.evaluate_waba_tier_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  criados int := 0;
  v_title text;
  v_desc text;
  v_sev text;
begin
  for r in
    with ranked as (
      select s.company_id, s.phone_external_id, s.snapshot_date,
             s.quality_rating, s.messaging_limit_tier,
             row_number() over (partition by s.phone_external_id order by s.snapshot_date desc) as rn
      from waba_phone_snapshots s
    ),
    pares as (
      select a.company_id, a.phone_external_id,
             a.snapshot_date as data_atual, b.snapshot_date as data_anterior,
             a.messaging_limit_tier as tier_atual, b.messaging_limit_tier as tier_anterior,
             a.quality_rating as qual_atual, b.quality_rating as qual_anterior
      from ranked a
      join ranked b on b.phone_external_id = a.phone_external_id and b.rn = 2
      where a.rn = 1
    ),
    mapeado as (
      select p.*, n.display_phone_number, n.verified_name,
        case p.tier_atual    when 'TIER_50' then 1 when 'TIER_250' then 2 when 'TIER_1K' then 3
                             when 'TIER_10K' then 4 when 'TIER_100K' then 5 when 'TIER_UNLIMITED' then 6 else null end as rank_atual,
        case p.tier_anterior when 'TIER_50' then 1 when 'TIER_250' then 2 when 'TIER_1K' then 3
                             when 'TIER_10K' then 4 when 'TIER_100K' then 5 when 'TIER_UNLIMITED' then 6 else null end as rank_anterior,
        case p.qual_atual    when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else null end as q_atual,
        case p.qual_anterior when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else null end as q_anterior
      from pares p
      left join waba_phone_numbers n on n.external_id = p.phone_external_id
    )
    select * from mapeado
    where (rank_atual is not null and rank_anterior is not null and rank_atual <> rank_anterior)
       or (q_atual is not null and q_anterior is not null and q_atual <> q_anterior)
  loop
    -- Mudanca de TIER
    if r.rank_atual is not null and r.rank_anterior is not null and r.rank_atual <> r.rank_anterior then
      if r.rank_atual < r.rank_anterior then
        v_sev := 'high';
        v_title := 'Queda de tier em numero WhatsApp';
        v_desc := 'O numero ' || coalesce(r.display_phone_number, r.phone_external_id) ||
                  coalesce(' (' || r.verified_name || ')', '') ||
                  ' caiu de ' || r.tier_anterior || ' para ' || r.tier_atual ||
                  ' entre ' || to_char(r.data_anterior, 'DD/MM') || ' e ' || to_char(r.data_atual, 'DD/MM') ||
                  '. Isso reduz a capacidade diaria de envio; investigar qualidade e denuncias antes de escalar volume.';
      else
        v_sev := 'medium';
        v_title := 'Subida de tier em numero WhatsApp';
        v_desc := 'O numero ' || coalesce(r.display_phone_number, r.phone_external_id) ||
                  coalesce(' (' || r.verified_name || ')', '') ||
                  ' subiu de ' || r.tier_anterior || ' para ' || r.tier_atual ||
                  ' entre ' || to_char(r.data_anterior, 'DD/MM') || ' e ' || to_char(r.data_atual, 'DD/MM') ||
                  '. Progresso no caminho para o TIER_UNLIMITED.';
      end if;
      if not exists (select 1 from alerts a where a.company_id = r.company_id
                       and a.resolved = false and a.title = v_title and a.description = v_desc) then
        insert into alerts (company_id, severity, title, description, resolved)
        values (r.company_id, v_sev, v_title, v_desc, false);
        criados := criados + 1;
      end if;
    end if;

    -- Mudanca de QUALIDADE
    if r.q_atual is not null and r.q_anterior is not null and r.q_atual <> r.q_anterior then
      if r.q_atual < r.q_anterior then
        v_sev := 'high';
        v_title := 'Queda de qualidade em numero WhatsApp';
        v_desc := 'O numero ' || coalesce(r.display_phone_number, r.phone_external_id) ||
                  coalesce(' (' || r.verified_name || ')', '') ||
                  ' piorou de ' || r.qual_anterior || ' para ' || r.qual_atual ||
                  ' entre ' || to_char(r.data_anterior, 'DD/MM') || ' e ' || to_char(r.data_atual, 'DD/MM') ||
                  '. Qualidade baixa antecede queda de tier e restricao de envio; revisar templates e reclamacoes.';
      else
        v_sev := 'low';
        v_title := 'Melhora de qualidade em numero WhatsApp';
        v_desc := 'O numero ' || coalesce(r.display_phone_number, r.phone_external_id) ||
                  coalesce(' (' || r.verified_name || ')', '') ||
                  ' melhorou de ' || r.qual_anterior || ' para ' || r.qual_atual ||
                  ' entre ' || to_char(r.data_anterior, 'DD/MM') || ' e ' || to_char(r.data_atual, 'DD/MM') || '.';
      end if;
      if not exists (select 1 from alerts a where a.company_id = r.company_id
                       and a.resolved = false and a.title = v_title and a.description = v_desc) then
        insert into alerts (company_id, severity, title, description, resolved)
        values (r.company_id, v_sev, v_title, v_desc, false);
        criados := criados + 1;
      end if;
    end if;
  end loop;

  return criados;
end;
$$;

revoke execute on function public.evaluate_waba_tier_alerts() from public, anon, authenticated;

-- Cron 09:40 UTC: depois do waba-sync (09:30) e antes do watchdog (09:45).
select cron.schedule('waba-tier-alerts-0940', '40 9 * * *', 'select public.evaluate_waba_tier_alerts();');
