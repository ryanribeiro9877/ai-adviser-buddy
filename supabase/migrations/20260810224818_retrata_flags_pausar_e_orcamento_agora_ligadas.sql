-- O fato 96 listava pausar_campanha, pausar_criativo e alterar_orcamento como DESLIGADAS.
-- Em 10/08/2026 o gestor pediu para liga-las; a migracao liga_pausar_e_alterar_orcamento_legal_e_viver
-- ja as ligou. Sem esta retracao, o agente continuaria a recusar card com base em texto velho.

update public.agent_context
   set vigente = false, atualizado = now()
 where id = 96 and vigente;

insert into public.agent_context (categoria, company_id, vigente, desde, atualizado, fato)
values (
  'execucao',
  'ded20b38-f42e-4c71-800c-31b97ea48bcf',
  true,
  now(),
  now(),
  'ESCRITA REAL LIGADA - dry_run DESLIGADO. ESTE FATO SUBSTITUI O FATO 96 (que listava pausar_campanha, pausar_criativo e alterar_orcamento como DESLIGADAS e virou mentira em 10/08/2026). ESTADO LIDO EM meta_execution_config DA LEGAL E VIVER: master_enabled = true, dry_run = FALSE, driver_escrita = pipeboard, conta permitida para criacao act_3302001729967572, teto de sanidade R$ 3.000,00 por dia, 5 acoes por hora. LIGADAS: criar_campanha, criar_conjunto_a_partir_de, criar_anuncio_a_partir_de, upload_midia, renomear_campanha, alterar_orcamento, pausar_campanha e pausar_criativo. DESLIGADA: criar_template - pedido dessa acao e recusa nomeada, nao card. O QUE NASCE PAUSADO: campanha, conjunto e anuncio criados nascem PAUSED. Quem liga a entrega e o GESTOR, no Gerenciador de Anuncios - o sistema nao ativa nada e nao tem flag para isso. POR ONDE SAI A ESCRITA: driver_escrita = pipeboard. Todas as travas, o compliance, o card e a aprovacao continuam acontecendo antes. VALE SO PARA A LEGAL E VIVER: COHAPM e Cooperativa_ Cohapm seguem com dry_run = true e driver graph.'
);

do $$
begin
  if exists (select 1 from public.agent_context where id = 96 and vigente) then
    raise exception 'fato 96 ainda vigente apos retracao';
  end if;
  if not exists (
    select 1 from public.agent_context
     where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
       and vigente and categoria = 'execucao'
       and fato like '%pausar_campanha e pausar_criativo%'
  ) then
    raise exception 'novo fato de flags nao foi inserido';
  end if;
end $$;
