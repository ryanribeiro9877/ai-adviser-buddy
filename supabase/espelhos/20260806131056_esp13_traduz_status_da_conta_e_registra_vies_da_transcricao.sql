-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260806131056
-- name: esp13_traduz_status_da_conta_e_registra_vies_da_transcricao
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- Dois ajustes depois da primeira coleta real do ESP-12 e ESP-13.
--
-- 1) account_status chega como "1" e disable_reason como "0" - codigos crus da Meta. Guardar cru
--    esta certo (evidencia nao se normaliza); mas devolver cru na leitura e inutil para humano.
--    Traduzo NA LEITURA e mantenho o codigo ao lado, para quem quiser conferir.
--
-- 2) O VIES DA TRANSCRICAO, que e o achado mais importante da corrida: dos 19 videos, 8 foram
--    transcritos e 11 estouraram o teto de 15MB. Os 11 NAO sao aleatorios - os 5 videos que tem
--    bloqueio de compliance (22, 23, 25, 26, 27) estao TODOS entre os nao transcritos. Ou seja:
--    o audio foi lido exatamente onde nao havia problema, e em nenhum dos cinco onde ha.
--    "8 de 19" parece 42% de cobertura; ponderada por risco a cobertura e ZERO. Sem este fato
--    registrado, o agente pode dizer "o compliance agora le o audio" - o que e verdade no
--    agregado e falso justamente no grupo que importa.

create or replace function public.auditar_anuncios_no_ar(p_company_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_dias_de_historico int; v_ads_no_historico int; v_reprovados int; v jsonb;
begin
  if p_company_id is null then
    raise exception 'auditar_anuncios_no_ar exige p_company_id';
  end if;

  select count(distinct snapshot_date), count(distinct ad_external_id)
    into v_dias_de_historico, v_ads_no_historico
    from public.ad_status_snapshots
   where company_id = p_company_id and snapshot_date >= current_date - 30;

  select count(distinct ad_external_id) into v_reprovados
    from public.ad_status_snapshots
   where company_id = p_company_id and snapshot_date >= current_date - 30
     and upper(coalesce(effective_status, status,'')) in ('DISAPPROVED','WITH_ISSUES');

  select jsonb_build_object(
    'empresa', p_company_id,
    'auditado_em', now(),
    'anuncios_no_ar', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name, 'external_id', a.external_id, 'status', a.status,
          'tem_texto', (coalesce(a.body,'') <> '' or coalesce(a.title,'') <> ''),
          'destino', a.destino_url,
          'compliance_do_texto', public.checar_promessas_proibidas(
              nullif(btrim(coalesce(a.body,'') || ' ' || coalesce(a.title,'')), ''))
        ) order by a.name), '[]'::jsonb)
      from public.ads a
      where a.company_id = p_company_id and upper(coalesce(a.status,'')) = 'ACTIVE'),
    'retrato_de_status', (
      select coalesce(jsonb_object_agg(coalesce(status,'(nulo)'), n), '{}'::jsonb)
      from (select status, count(*) n from public.ads where company_id = p_company_id group by 1) z),
    'com_problema_agora', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'anuncio', a.name, 'status', a.status,
          'motivo_da_meta', (select s.issues_info from public.ad_status_snapshots s
                              where s.company_id = a.company_id and s.ad_external_id = a.external_id
                              order by s.snapshot_date desc limit 1))), '[]'::jsonb)
      from public.ads a
      where a.company_id = p_company_id
        and upper(coalesce(a.status,'')) in ('DISAPPROVED','WITH_ISSUES')),
    'taxa_de_reprovacao_30d', case
        when v_dias_de_historico = 0 then null
        else round(100.0 * v_reprovados / nullif(v_ads_no_historico,0), 1) end,
    'saude_da_conta', (
      select case when count(*) = 0 then null else jsonb_build_object(
          'ultima_leitura', max(snapshot_date), 'fonte', max(fonte),
          'situacao', case max(account_status)
              when '1' then 'ATIVA' when '2' then 'DESABILITADA' when '3' then 'INADIMPLENTE'
              when '7' then 'EM ANALISE' when '8' then 'FECHADA PELO PROPRIETARIO'
              when '9' then 'EM PERIODO DE GRACA' when '100' then 'FECHADA'
              else 'codigo nao mapeado' end,
          'situacao_codigo', max(account_status),
          'motivo_de_bloqueio', case when coalesce(max(disable_reason),'0') = '0'
              then 'nenhum' else 'codigo ' || max(disable_reason) end) end
      from public.account_health_snapshots
      where company_id = p_company_id and snapshot_date >= current_date - 7),
    'LACUNAS', (
      select coalesce(jsonb_agg(l), '[]'::jsonb) from (
        select 'TAXA DE REPROVACAO NAO EXISTE AINDA: ha ' || v_dias_de_historico ||
               ' dia(s) de foto de status. A taxa de 30 dias exige coleta diaria; ads guarda so o estado de AGORA.' as l
         where v_dias_de_historico < 7
        union all
        select 'SAUDE DA CONTA NAO COLETADA nos ultimos 7 dias - e conta restrita nao entrega, por melhor que esteja o criativo.'
         where not exists (select 1 from public.account_health_snapshots
                            where company_id = p_company_id and snapshot_date >= current_date - 7)
        union all
        select 'AUDITORIA DE TEXTO SO: le body e title do anuncio, NAO o par texto+peca, porque o espelho nao liga anuncio a peca do Drive.'
      ) z),
    'definicao_de_reprovado', 'Contam DISAPPROVED e WITH_ISSUES. PENDING_REVIEW nao conta. Os *_PAUSED nao contam.',
    'nao_e_aprovacao', 'Ausencia de violacao detectada por padrao de texto nao aprova o anuncio.'
  ) into v;

  return v;
end;
$$;

-- O fato do vies, para o agente nunca dizer que o compliance le o audio.
insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values ('compliance',
'COBERTURA DE AUDIO NO COMPLIANCE - O NUMERO AGREGADO MENTE (medido 06/08/2026). '
|| 'Dos 19 videos do acervo, 8 foram transcritos e 11 estouraram o teto de 15MB da transcricao. '
|| 'MAS os 11 nao sao aleatorios: os 5 videos que tem bloqueio de compliance por citar valor, parcela e prazo '
|| 'sem CET (22, 23, 25, 26 e 27) estao TODOS entre os NAO transcritos, porque sao os mais pesados. '
|| 'Portanto: o audio foi lido exatamente nos videos que nao tinham problema, e em NENHUM dos cinco que tem. '
|| 'Cobertura agregada 42%; cobertura ponderada por risco ZERO. '
|| 'COMO FALAR DISSO: NUNCA diga "o compliance agora le o audio" - diga que o audio e lido em parte do acervo e '
|| 'que nenhuma das pecas em revisao teve o audio lido. Ao recomendar qualquer uma das cinco, declare que o que '
|| 'e FALADO nela segue nao avaliado. '
|| 'O QUE RESOLVE: transcrever o AUDIO em vez do arquivo de video - o teto e sobre os bytes enviados, e a trilha '
|| 'de audio de um video de 42MB e uma fracao disso. Se isso e viavel dentro de uma edge e pergunta para o Code.',
true, '2026-08-06', 'ded20b38-f42e-4c71-800c-31b97ea48bcf');