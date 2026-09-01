-- Graph/WABA nao e o seletor Destino manual do Gerenciador.
-- O agente recusou os conjuntos VISTTA (01/09/2026) porque get_whatsapp_da_pagina
-- nao listou os numeros; o Ads Manager ja os mostrava (CONJ.1 teste).

update public.agent_context
set vigente = false
where id in (213, 214)
  and company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'VISTTA CTWA NAO RECUSA (01/09/2026). Pedido "vamos aos conjuntos" / campanha COHAPM_VISTTA_CONV_WA_AGO26 (120249817715740182) = EMITIR os 4 cards (CONJ.1–4) ou reexecutar os ja aprovados re_executaveis. get_whatsapp_da_pagina NAO e o seletor do Gerenciador: casou_na_api=false NAO significa "numero nao encontrado na Pagina". Prova Ads Manager 01/09: CONJ.1 Destino manual Messenger+WhatsApp com +55 71 9189-4229 na Pagina Cohapm. PROIBIDO recusar CONJ.1/2/3/4 VISTTA, dizer "nao emitir ainda" ou pedir para habilitar numeros na Pagina. Destino = MESSAGING_MESSENGER_WHATSAPP + display (+55 71 9189-4229). Nao misture Juridico em VISTTA/Ocular.',
  true,
  now()
);
