-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807182843
-- name: retrata_molde_c7_lal_dynamic_creative_bloqueia_anuncio_avulso
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 07/08/2026 - Achado da primeira escrita real via Pipeboard: o molde C7-LAL e Dynamic Creative.
--
-- EVIDENCIA GRAPH (sonda meta-health v3, campo is_dynamic_creative):
--   molde 120251373799340191 is_dynamic_creative=true
--   replica de prova 120254208284780191 (criada pelo sistema a partir do molde) = false
--   create_ad no molde falhou OAuthException 100 / subcode 1885274
--   create_ad na replica de prova SUCEDEU (anuncio 120254319507370191)
--
-- O QUE ESTAVA ERRADO NA BASE DE FATOS:
--   1) ANATOMIA DO MOLDE (id 48) citava C7-LAL como molde replicavel de conjunto E de anuncio
--      sem a ressalva de que NAO aceita anuncio avulso (create_ad).
--   2) Lacuna da replicacao parcial (id 59) deixava como "premissa nao verificada" se o molde
--      tinha criativo dinamico - agora medido: tem, e a replica NAO herda porque o campo
--      nao esta na lista copiada.
--
-- CONSEQUENCIA PARA O AGENTE: pode continuar usando C7-LAL como molde de SEGMENTACAO/
-- OTIMIZACAO via criar_conjunto_a_partir_de (a replica nasce sem DC). NAO pode propor
-- create_ad direto no C7-LAL nem nos conjuntos ACTIVE a R$72/dia da familia Dynamic Video
-- (todos is_dynamic_creative=true). Destino de anuncio avulso precisa ser conjunto com
-- is_dynamic_creative=false.

do $$
declare
  v_old48 int;
  v_old59 int;
  v_novos int;
begin
  select count(*) into v_old48
    from public.agent_context
   where id = 48
     and company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and vigente = true
     and fato like '%120251373799340191%'
     and fato like '%ANATOMIA DO MOLDE%';

  if v_old48 <> 1 then
    raise exception 'guarda id 48 falhou (achou %): anatomia do molde C7-LAL mudou ou ja foi retratada', v_old48;
  end if;

  select count(*) into v_old59
    from public.agent_context
   where id = 59
     and company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and vigente = true
     and fato like '%PREMISSA NAO VERIFICADA%'
     and fato like '%is_dynamic_creative%';

  if v_old59 <> 1 then
    raise exception 'guarda id 59 falhou (achou %): lacuna de replicacao parcial mudou ou ja foi resolvida', v_old59;
  end if;

  update public.agent_context
     set vigente = false, atualizado = now()
   where id in (48, 59)
     and company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and vigente = true;

  insert into public.agent_context (categoria, fato, vigente, desde, company_id)
  values (
    'contexto',
    'ANATOMIA DO MOLDE DE CONJUNTO (atualizado 07/08/2026 com evidencia Graph). MOLDE DE REFERENCIA PARA SEGMENTACAO/OTIMIZACAO: conjunto "[LP][C3-REELS] Advantage+ BR - Dynamic Video [C7-LAL1%-R06]", external_id 120251373799340191. Campos que a executora REPLICARIA em criar_conjunto_a_partir_de: optimization_goal OFFSITE_CONVERSIONS; billing_event IMPRESSIONS; bid_strategy LOWEST_COST_WITHOUT_CAP; destination_type WEBSITE; promoted_object = pixel 26963641603232240 com evento LEAD; targeting 18-65 sem genero; targeting_automation / targeting_relaxation_types; custom_audiences com "[LEV] LAL 1% Leads Convertidos BR" (120251372755580191). ORCAMENTO NAO SE HERDA. '
    || 'RESSALVA CRITICA MEDIDA EM 07/08/2026: este molde tem is_dynamic_creative=true na Graph. create_ad avulso NELE falha com OAuthException 100 / subcode 1885274 ("Nao e possivel criar ou atualizar anuncios no conjunto de anuncios de criativo dinamico"). NAO proponha criar_anuncio_a_partir_de com conjunto_destino = 120251373799340191. '
    || 'PROPAGACAO: criar_conjunto_a_partir_de NAO copia is_dynamic_creative (campo fora da lista fixa) - a replica nasce com Criativo dinamico DESATIVADO. Prova: conjunto 120254208284780191 ([TESTE-GT02] prova de espelho 04/08 - APAGAR) tem is_dynamic_creative=false e ACEITOU o anuncio 120254319507370191 via Pipeboard em 07/08. Logo o problema NAO se propaga automaticamente para campanha nova criada pelo sistema a partir deste molde; propaga-se so se o destino do anuncio for um conjunto JA existente com DC ligado. '
    || 'OS 3 CONJUNTOS LP QUE ENTREGAM A R$ 72/DIA HOJE (120253805954390191, 120253542040290191, 120253897605020191) tambem sao is_dynamic_creative=true - NAO servem de destino de anuncio avulso. Candidato natural de destino/molde de anuncio: conjunto NAO-DC (is_dynamic_creative=false), de preferencia LP, alinhado a LAL CLT - ex.: a propria replica do sistema, ou [LP][C7-REFRESH] LAL1% (120253389922700191, PAUSED, false). WPP/CTWA ficam fora por doutrina de destino LP.',
    true,
    '2026-08-07',
    'ded20b38-f42e-4c71-800c-31b97ea48bcf'
  );

  insert into public.agent_context (categoria, fato, vigente, desde, company_id)
  values (
    'lacuna',
    'A REPLICACAO DE CONJUNTO E PARCIAL E O CARD NAO DIZ ISSO (achado 04/08/2026; premissa de criativo dinamico RESOLVIDA em 07/08/2026). A executora copia do molde uma LISTA FIXA: optimization_goal, billing_event, bid_strategy, targeting, promoted_object, destination_type, attribution_spec, bid_amount e dsa_*. Todo campo fora dessa lista NAO e replicado e nasce no default da Meta. '
    || 'PREMISSA AGORA VERIFICADA PELA GRAPH: o molde C7-LAL (120251373799340191) TEM is_dynamic_creative=true; a replica de prova 120254208284780191 nasceu com is_dynamic_creative=false porque o campo nao esta na lista copiada. Consequencia: a replica NAO e copia fiel nesse interruptor - e isso e BOM para create_ad avulso (a replica aceita; o molde recusa com subcode 1885274). Ao mencionar fidelidade, diga que a replica copia os campos de segmentacao/otimizacao listados e que criativo dinamico nasce desativado por omissao da lista - nao por escolha explicita do card. '
    || 'PROPOSTA PENDENTE (nao implementada ate decisao com Ryan): montarCriacao deveria ler is_dynamic_creative do conjunto_destino ANTES de criar o adcreative e recusar com nome proprio conjunto_destino_criativo_dinamico (padrao molde_sem_*), evitando creatives orfaos. Hoje ele so descobre no create_ad.',
    true,
    '2026-08-07',
    'ded20b38-f42e-4c71-800c-31b97ea48bcf'
  );

  select count(*) into v_novos
    from public.agent_context
   where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
     and vigente = true
     and desde = '2026-08-07'
     and (
       fato like '%is_dynamic_creative=true%'
       or fato like '%subcode 1885274%'
     );

  if v_novos < 2 then
    raise exception 'esperava >=2 fatos novos vigentes sobre dynamic creative; achou %', v_novos;
  end if;

  if exists (
    select 1 from public.agent_context
     where id in (48, 59) and vigente = true
       and company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
  ) then
    raise exception 'ids 48/59 ainda vigentes apos retratacao';
  end if;

  raise notice 'molde C7-LAL retratado: DC medido, create_ad bloqueado no molde, replica aceita';
end $$;
