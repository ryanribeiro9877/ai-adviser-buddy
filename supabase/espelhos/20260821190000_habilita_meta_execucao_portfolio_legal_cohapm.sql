-- Habilita escrita real Meta no portfólio (Legal + COHAPM).
-- Interpretação do pedido "ativa o dry_run com master": habilitar o pipeline de
-- criação/edição/implantação. dry_run=true só SIMULA e bloqueia implantação real;
-- por isso master_enabled=true e dry_run=false, com action_flags no conjunto operacional da Legal.
-- Legal já estava operacional; update idempotente. COHAPM saía de master=false / dry_run=true / flags off.

-- Legal (ded20b38…): reforça postura de escrita REAL.
update public.meta_execution_config
   set master_enabled = true,
       dry_run = false,
       action_flags = coalesce(action_flags, '{}'::jsonb) || jsonb_build_object(
         'upload_midia', true,
         'criar_campanha', true,
         'criar_template', false,
         'ativar_campanha', true,
         'ativar_conjunto', true,
         'ativar_criativo', true,
         'pausar_campanha', true,
         'pausar_conjunto', true,
         'pausar_criativo', true,
         'escalar_duplicar', true,
         'alterar_orcamento', true,
         'renomear_campanha', true,
         'criar_anuncio_a_partir_de', true,
         'criar_conjunto_a_partir_de', true,
         'ajustar_posicionamentos_do_conjunto', true
       ),
       updated_at = now()
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf';

-- COHAPM (57f755b9…): liga master, desliga dry_run e espelha flags operacionais da Legal.
-- driver_escrita permanece o da empresa (graph); não altera transporte sem evidência de pipeboard.
update public.meta_execution_config
   set master_enabled = true,
       dry_run = false,
       action_flags = coalesce(action_flags, '{}'::jsonb) || jsonb_build_object(
         'upload_midia', true,
         'criar_campanha', true,
         'criar_template', false,
         'ativar_campanha', true,
         'ativar_conjunto', true,
         'ativar_criativo', true,
         'pausar_campanha', true,
         'pausar_conjunto', true,
         'pausar_criativo', true,
         'escalar_duplicar', true,
         'alterar_orcamento', true,
         'renomear_campanha', true,
         'criar_anuncio_a_partir_de', true,
         'criar_conjunto_a_partir_de', true,
         'ajustar_posicionamentos_do_conjunto', true
       ),
       updated_at = now()
 where company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

-- Doutrina: COHAPM agora escreve de verdade (antes defaults bloqueantes).
update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente = true
   and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   and categoria = 'execucao'
   and (
     fato ilike '%dry_run%ligado%'
     or fato ilike '%master_enabled=false%'
     or fato ilike '%master desligado%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'execucao',
  'ESCRITA META HABILITADA NO PORTFOLIO — COHAPM (21/08/2026). meta_execution_config: master_enabled=true, dry_run=false. Flags operacionais ligadas (criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de, upload_midia, alterar_orcamento, pausar_*/ativar_*, renomear_campanha, escalar_duplicar, ajustar_posicionamentos_do_conjunto). Aprovar card = escrita REAL na Meta (nao simulacao). criar_template permanece off. driver_escrita da empresa permanece graph. Legal (ded20b38) ja estava nessa postura; esta mudanca alinha a COHAPM.',
  true,
  '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where vigente = true
    and company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    and fato ilike 'ESCRITA META HABILITADA NO PORTFOLIO — COHAPM (21/08/2026%'
);

-- Reforço Legal (idempotente se já existir fato semelhante vigente).
insert into public.agent_context (company_id, categoria, fato, vigente, desde)
select
  'ded20b38-f42e-4c71-800c-31b97ea48bcf',
  'execucao',
  'ESCRITA META NO PORTFOLIO — LEGAL (21/08/2026, confirmacao). Continua master_enabled=true e dry_run=false: aprovacao de card cria/edita/implanta objetos REAIS na Meta. Flags de criacao/edicao/pausa/ativacao/upload/orcamento/renomear/escala ligadas; criar_template off. driver_escrita=pipeboard.',
  true,
  '2026-08-21'
where not exists (
  select 1 from public.agent_context
  where vigente = true
    and company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
    and fato ilike 'ESCRITA META NO PORTFOLIO — LEGAL (21/08/2026%'
);
