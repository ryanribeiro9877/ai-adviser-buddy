-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260807193503
-- name: retrata_fato_dry_run_ligado_legal_e_viver
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

do $$
declare
  v_company uuid := 'ded20b38-f42e-4c71-800c-31b97ea48bcf';
  v_dry boolean;
  v_driver text;
  v_retirados int;
begin
  -- guarda 1: so retrata se o estado real for mesmo escrita real pelo pipeboard
  select dry_run, driver_escrita into v_dry, v_driver
  from public.meta_execution_config where company_id = v_company;

  if v_dry is null then
    raise exception 'meta_execution_config ausente para a empresa %', v_company;
  end if;
  if v_dry is true or v_driver is distinct from 'pipeboard' then
    raise exception 'estado inesperado: dry_run=% driver_escrita=% - migracao abortada', v_dry, v_driver;
  end if;

  -- guarda 2: nao reaplicar se o fato novo ja existir vigente
  if exists (
    select 1 from public.agent_context
    where company_id = v_company and vigente = true
      and fato like 'ESCRITA REAL LIGADA - dry_run DESLIGADO%'
  ) then
    raise notice 'fato novo ja vigente - nada a fazer';
    return;
  end if;

  -- retira de vigencia todo fato que declara dry_run ligado / modo de simulacao
  update public.agent_context
     set vigente = false, atualizado = now()
   where company_id = v_company
     and vigente = true
     and id in (85, 93);
  get diagnostics v_retirados = row_count;
  raise notice 'fatos retirados de vigencia: %', v_retirados;

  insert into public.agent_context (categoria, fato, vigente, desde, company_id)
  values (
    'execucao',
    'ESCRITA REAL LIGADA - dry_run DESLIGADO (07/08/2026). ESTE FATO SUBSTITUI OS FATOS 85 E 93, QUE DIZIAM QUE dry_run ESTAVA LIGADO E VIRARAM MENTIRA. ESTADO LIDO EM meta_execution_config DA LEGAL E VIVER: master_enabled = true, dry_run = FALSE, driver_escrita = pipeboard, conta permitida para criacao act_3302001729967572, teto de sanidade R$ 3.000,00 por dia, 5 acoes por hora. O QUE ISSO MUDA NO CARD: aprovar um card AGORA CRIA OBJETO REAL na conta da Meta - nao simula, nao registra o que faria. NUNCA diga ao gestor que a aprovacao e ensaio; declare o contrario, antes de ele decidir. LIGADAS: criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de e upload_midia. DESLIGADAS: pausar_campanha, pausar_criativo, alterar_orcamento e criar_template - pedido de qualquer uma das quatro e recusa nomeada, nao card. O QUE NASCE PAUSADO: campanha, conjunto e anuncio criados nascem PAUSED. Quem liga a entrega e o GESTOR, no Gerenciador de Anuncios - o sistema nao ativa nada e nao tem flag para isso. Diga isso no card: o objeto vai existir de verdade e nao vai gastar ate ele ligar. POR ONDE SAI A ESCRITA: driver_escrita = pipeboard. Em 06/08 a Meta recusou criacao de criativo pelo Graph com o nosso app em modo de desenvolvimento, e o Pipeboard escreve pelo app deles. Todas as travas, o compliance, o card e a aprovacao continuam acontecendo antes e sem mudanca - so o ultimo passo tem destino diferente. EVIDENCIA DA DECISAO: a primeira escrita real aconteceu em 07/08/2026 - anuncio 120254319507370191, acao criar_anuncio_a_partir_de, driver pipeboard, criado em /act_3302001729967572/ads (audit_log meta_action_executed, 17:16 UTC). VALE SO PARA A LEGAL E VIVER: COHAPM e Cooperativa_ Cohapm seguem com dry_run = true e driver graph.',
    true,
    date '2026-08-07',
    v_company
  );

  insert into public.agent_context (categoria, fato, vigente, desde, company_id)
  values (
    'execucao',
    'O QUE CONTINUA VALENDO DO FATO 85, QUE SAIU DE VIGENCIA EM 07/08/2026. O 85 caiu porque declarava dry_run ligado, o que virou falso - mas duas partes dele nao tinham relacao com isso e seguem verdadeiras, entao ficam registradas aqui para nao se perderem. (1) AS 5 PECAS EM REVISAO DE COMPLIANCE BLOQUEIAM USO: os videos 22, 23, 25, 26 e 27 citam valor, parcela e prazo sem CET e seguem aguardando veredito do Roberto - ate 07/08/2026 nenhum veredito foi registrado. Pedido de anuncio com qualquer uma delas e IMPEDIMENTO, nao ressalva. Isso pesa mais agora: com dry_run desligado, aprovar cria objeto de verdade. (2) CUIDADO CONHECIDO COM O BLOCO DE FUNCOES DE MIDIA (teto_vigente, decidir_sobre_conjunto, avaliar_escala, diagnosticar_custo, avaliar_fadiga, pode_pausar_por_custo, avaliar_pacing): ele ainda pode nao estar exposto como ferramenta. Se voce nao conseguir chamar teto_vigente, NAO julgue custo pela regua de R$ 2,30 de targets - declare que a regua de negocio e R$ 1,60, decidida pelo Roberto em 30/07, e que voce nao tem a ferramenta para confirmar.',
    true,
    date '2026-08-07',
    v_company
  );
end $$;
