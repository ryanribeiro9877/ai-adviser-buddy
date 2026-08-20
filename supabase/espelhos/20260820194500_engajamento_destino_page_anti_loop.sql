-- Doutrina: anuncio de engajamento usa destino Page/IG; lote EMITE OS N sem loop vazio.
-- Espelho do fix traffic-chat v28.45 / meta-actions v5.31 (20/08/2026).

update public.agent_context
   set vigente = false
 where categoria = 'doutrina'
   and vigente = true
   and (
     fato ilike 'ANUNCIO ENGAJAMENTO DESTINO%'
     or fato ilike 'EMITE OS N SEM LOOP%'
   );

insert into public.agent_context (categoria, fato, vigente, desde, company_id)
values (
  'doutrina',
  'ANUNCIO ENGAJAMENTO DESTINO PAGE/IG (20/08/2026 v28.45). Em conjunto/campanha '
  || 'OUTCOME_ENGAGEMENT ou OUTCOME_AWARENESS (impulsão social), criar_anuncio_a_partir_de '
  || 'com sem_molde NAO exige LP nem produto CLT. O codigo preenche destino_url com a Page '
  || '(facebook.com/profile.php?id=…) ou Instagram da meta_execution_config. PROIBIDO '
  || 'recusar com peca_nova_sem_molde_incompleta por falta de destino_url/produto CLT nesse '
  || 'caminho. FIN-01 em copy educativa de impulsão: se so falta "Consulte sua margem '
  || 'disponivel", anexe a frase e emita — nao trave o lote autorizado pelo gestor.',
  true,
  date '2026-08-20',
  null
),
(
  'doutrina',
  'EMITE OS N SEM LOOP VAZIO (20/08/2026 v28.45). Pedido "emite os N cards" com slate em '
  || 'conversation_legendas / historico: chame propose_action×N PRIMEIRO. Nao re-narre o '
  || 'slate, nao releia acervo total, nao auto-continue so para repetir "nenhum card" apos '
  || 'erro duro de propose (destino/compliance). Se falhar, diga o erro e pare.',
  true,
  date '2026-08-20',
  null
);
