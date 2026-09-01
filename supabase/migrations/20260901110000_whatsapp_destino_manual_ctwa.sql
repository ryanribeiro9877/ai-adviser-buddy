-- Destino MANUAL no conjunto CTWA (01/09/2026).
-- O Gerenciador tem destino automatico (Meta escolhe o canal) vs manual (WhatsApp
-- e/ou Messenger + numero). A API nao pode omitir o numero: isso cairia no
-- WhatsApp padrao da Pagina (risco de cruzar Juridico em VISTTA).

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'DESTINO MANUAL CTWA (01/09/2026). Conjunto de conversa usa destino MANUAL: destination_type=WHATSAPP (so WhatsApp, padrao dos JUR/LF que entregam) ou MESSAGING_MESSENGER_WHATSAPP (Messenger+WhatsApp, dropdown Destino manual do Gerenciador). NUNCA destino automatico (Meta escolhe IG/Messenger/WhatsApp) — isso pode cair no numero Juridico. O numero vai em promoted_object; se o card falhar 1487246, reexecute — o executor tenta 12/13 digitos, E.164 com + e as duas dest types. Numeros so visiveis no Gerenciador (sem whats_app_business_phone_number_id) a Graph ainda pode recusar. Nao misture Juridico em VISTTA/Ocular nem La Felicita.',
  true,
  now()
);
