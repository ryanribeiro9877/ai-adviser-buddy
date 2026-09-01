-- CTWA: quem cria o conjunto e o DRIVER, nao o formato do numero.
--
-- O fato 217 (migration 20260901130000) leu a auditoria das 11:49 UTC como "o numero
-- precisa estar numa WABA". A comparacao controlada de 12:46 UTC desmentiu isso:
--
--   11:49  driver=graph      promoted_object {page_id:105656372312257,
--                            whatsapp_phone_number:"557191894229"}  -> HTTP 400 / 1487246
--                            (o retry tambem tentou +557191894229 e 5571991894229)
--   12:46  driver=pipeboard  MESMO promoted_object, MESMO destination_type=WHATSAPP,
--                            MESMO optimization_goal=CONVERSATIONS
    10|--                            -> conjunto 120249829825270182 criado e reconciliado
--
-- Mesma conta, mesma Pagina, mesmos digitos, mesmo minuto de codigo: a unica variavel
-- foi o driver. Os quatro numeros VISTTA continuam fora de qualquer WABA e mesmo assim
-- o Pipeboard cria. O fato 217 mandaria o agente recusar um pedido que funciona, que e
-- o erro mais caro possivel aqui — por isso sai de vigencia.

update public.agent_context
set vigente = false
where id = 217
    20|  and company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'CTWA CRIA PELO PIPEBOARD (01/09/2026, medido em comparacao controlada). Quem decide o create do conjunto Click-to-WhatsApp e o DRIVER DE ESCRITA, nao o formato do numero nem vinculo de WABA. Com o MESMO promoted_object {page_id:105656372312257, whatsapp_phone_number:"557191894229"}, MESMO destination_type=WHATSAPP e MESMO optimization_goal=CONVERSATIONS: driver graph devolveu HTTP 400 / 1487246 as 11:49 UTC (o retry tentou 557191894229, +557191894229 e 5571991894229, os tres recusados) e driver pipeboard (create_adset) CRIOU o conjunto 120249829825270182 as 12:46 UTC. Portanto conjunto CTWA da COHAPM sai por meta_execution_config.driver_por_acao.criar_conjunto_a_partir_de=pipeboard. get_whatsapp_da_pagina com casou_na_api=false e INFORMATIVO e NAO impede a criacao: os numeros VISTTA 7199189-4229, 7199185-8107, 7199264-9576 e 7199188-7731 nao estao em WABA alguma e o Pipeboard cria do mesmo jeito. PROIBIDO dizer que falta vincular o numero a uma WABA no WhatsApp Manager, que o numero "nao existe", que "nao esta no seletor da Pagina" ou que so o Gerenciador cria — a medicao desmentiu tudo isso. Pedido "vamos aos conjuntos" = EMITIR criar_conjunto_a_partir_de com destination_type=WHATSAPP (Messenger OFF) e whatsapp_phone_number em DIGITOS 55+DDD+8; o display "+55 71 9189-4229" e so texto do card, nunca vai no promoted_object. Nao substitua por numero Juridico/La Felicita em VISTTA/Ocular.',
  true,
  now()
);
