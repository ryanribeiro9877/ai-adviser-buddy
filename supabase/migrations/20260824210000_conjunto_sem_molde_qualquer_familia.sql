-- Conjunto do zero: molde deixa de ser obrigatorio (inclui trafego/website).

update public.contrato_de_execucao
   set obrigatorio = false,
       observacao =
         'Id do conjunto molde (empresta targeting) OU literal sem_molde para criar do zero. '
      || 'Vale qualquer familia (trafego/website, engajamento, mensagens, conversao). '
      || 'Molde NAO e obrigatorio quando o gestor pede conjunto novo.',
       fonte = 'meta-actions v5.47 / traffic-chat v28.63'
 where acao = 'criar_conjunto_a_partir_de'
   and campo = 'molde_external_id'
   and vigente;

update public.contrato_de_execucao
   set observacao =
         'true: targeting BR Advantage+ minimo sem ler molde Graph. Vale QUALQUER familia, '
      || 'inclusive trafego/website (defaults WEBSITE + LANDING_PAGE_VIEWS). '
      || 'Alternativa: target_name/molde_external_id=sem_molde.',
       fonte = 'meta-actions v5.47 / traffic-chat v28.63'
 where acao = 'criar_conjunto_a_partir_de'
   and campo = 'sem_molde'
   and vigente;

update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente
   and (
     fato ilike '%sem_molde%engajamento%'
     or fato ilike '%conjunto pode nascer com sem_molde%'
   );

insert into public.agent_context (categoria, fato, vigente, desde)
values
(
  'doutrina',
  'CONJUNTO SEM MOLDE — QUALQUER FAMILIA (24/08/2026). Molde NAO e obrigatorio para criar conjunto do zero. Use target_name=sem_molde (ou params.sem_molde=true / molde_external_id=sem_molde) em trafego/website (OUTCOME_TRAFFIC + WEBSITE + LANDING_PAGE_VIEWS), engajamento, reconhecimento, mensagens/CTWA e conversao. PROIBIDO recusar o pedido pedindo molde de La Felicita/COHAPM ou desviar para OUTCOME_ENGAGEMENT so para burlar a trava. Molde continua opcional quando o gestor quiser copiar targeting de um conjunto que ja funciona.',
  true,
  date '2026-08-24'
);
