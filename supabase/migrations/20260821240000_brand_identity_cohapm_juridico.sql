-- Isolamento multi-empresa: brand_identity vigente para COHAPM (nao credito / Juridico WA).
-- Sem isto, gerar-legendas / compliance caem em tom generico de consignado.
-- Espelho: supabase/espelhos/20260821240000_brand_identity_cohapm_juridico.sql

insert into public.brand_identity
  (company_id, versao, vigente, marca_nome, marca_tag, voz_tom, dos, donts,
   disclaimers_obrigatorios, linhas_produto, identidade_visual, referencias, procedencia)
select
  '57f755b9-c23d-4f58-a488-8173d697c010', 1, true, 'COHAPM Juridico', 'COHAPM',
  jsonb_build_object(
    'tom', 'direto, acolhedor e protetivo; fala de direitos do cooperado sem juridiques excessivo',
    'persona', 'especialista do nucleo juridico da cooperativa habitacional que orienta pelo WhatsApp oficial',
    'pessoa', 'fala com voce (2a pessoa); frases curtas'
  ),
  jsonb_build_array(
    'Explicar o problema concreto (conta de luz, cobranca indevida, emprestimo abusivo, contrato) com clareza',
    'CTA claro: conversar no WhatsApp oficial do Juridico',
    'Preservar temas juridicos da peca; nao desviar para credito consignado/CLT',
    'Quando LGL-04 aplicar: razao social/CNPJ/WhatsApp oficial na peca ou no destino'
  ),
  jsonb_build_array(
    'Inventar credito consignado, CLT, CET, simulacao de margem ou correspondente bancario',
    'Prometer resultado juridico garantido ou "ganhamos a causa"',
    'Urgencia falsa e escassez inventada',
    'Direcionar para numero/link de terceiro nao identificado'
  ),
  jsonb_build_array(
    'Atendimento pelo WhatsApp oficial do nucleo Juridico',
    'Orientacao informativa — nao substitui consulta presencial quando o caso exigir'
  ),
  jsonb_build_array('juridico_whatsapp', 'conta_de_luz', 'cobranca_indevida', 'emprestimo_abusivo'),
  jsonb_build_object(
    'nota', 'Acervo Juridico COHAPM: pecas de direitos do cooperado / WA. NAO e universo de credito consignado.'
  ),
  jsonb_build_object(
    'page_id_e_instagram', 'ver meta_execution_config (referencias_resolvidas.config)',
    'destino', 'WhatsApp oficial Juridico / Page — sem LP de consignado CLT'
  ),
  jsonb_build_object(
    'decidido_por', 'Roberto (gestor) / isolamento multi-empresa',
    'decidido_em', '2026-08-21',
    'fonte', 'force-task COHAPM Juridico vs Legal; nao-credito',
    'citacao', 'COHAPM e cooperativa habitacional; nucleo Juridico WA — sem CET/CLT/consignado'
  )
where not exists (
  select 1 from public.brand_identity
  where company_id = '57f755b9-c23d-4f58-a488-8173d697c010' and vigente
);

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'doutrina',
  'IDENTIDADE COHAPM (21/08/2026): brand_identity vigente marca_tag=COHAPM, linhas juridico_whatsapp/conta_de_luz/cobranca_indevida/emprestimo_abusivo. NAO e credito. Compliance e legendas NAO inventam CET, consignado CLT nem "Legal e Viver".',
  true,
  date '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and categoria = 'doutrina'
    and fato like 'IDENTIDADE COHAPM (21/08/2026)%'
    and vigente
);
