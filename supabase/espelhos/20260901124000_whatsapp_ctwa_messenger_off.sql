-- Espelho: supabase/migrations/20260901124000_whatsapp_ctwa_messenger_off.sql

update public.agent_context
set vigente = false
where id = 215
  and company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'CTWA MESSENGER OFF (01/09/2026). destination_type=WHATSAPP (so WhatsApp, como JUR/LF). PROIBIDO MESSAGING_MESSENGER_WHATSAPP e destino automatico. Pedido "vamos aos conjuntos" = EMITIR no agente. Campanha de teste criada no Gerenciador sera excluida pelo gestor — NAO use como molde. get_whatsapp_da_pagina NAO e o seletor: casou_na_api=false NAO recusa. Display +55 71 9189-4229. Nao misture Juridico em VISTTA/Ocular.',
  true,
  now()
);
