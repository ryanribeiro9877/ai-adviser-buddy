-- CTWA: o que a auditoria de 01/09/2026 11:49 UTC provou.
--
-- Os quatro cards VISTTA (CONJ.1-4) foram executados com destination_type=WHATSAPP
-- e tentaram, para cada numero, os formatos display ("+55 71 9189-4229"), 12 digitos,
-- +E.164 e 13 digitos. Todos voltaram error_subcode=1487246. Nenhum dos quatro numeros
-- aparece em waba_phone_numbers, ad_sets.promoted_object ou nas WABAs do Business —
-- enquanto TODO conjunto CTWA que a API aceitou usa numero que esta no inventario.
--
-- Conclusao: o Destino manual do Gerenciador oferece numero ligado so a Pagina, mas a
-- Marketing API exige o numero como ativo WhatsApp do Business. O fato 216 mandava o
-- agente emitir mesmo assim, o que so gerava cards que falham. Substituido.

update public.agent_context
set vigente = false
where id = 216
  and company_id = '57f755b9-c23d-4f58-a488-8173d697c010';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'CTWA SO CRIA COM NUMERO QUE E ATIVO DA CONTA (01/09/2026, medido). destination_type=WHATSAPP (Messenger OFF) e whatsapp_phone_number em DIGITOS 55+DDD+8 — o display "+55 71 9189-4229" e so para texto do card e era invalido no promoted_object. Antes de emitir conjunto CTWA, chame get_whatsapp_da_pagina: parecer.e_ativo_whatsapp_da_conta=true EMITE; false NAO promete conjunto nem fica reexecutando card, porque a Marketing API recusa 1487246 em qualquer formato (display, 12, +E.164 e 13 testados nos cards VISTTA CONJ.1-4 as 11:49 UTC). Numeros 7199189-4229, 7199185-8107, 7199264-9576 e 7199188-7731 nao estao em nenhuma WABA do Business: para criar pelo agente e preciso vincula-los no WhatsApp Manager; enquanto isso o caminho e o Gerenciador. NAO diga que o numero "nao existe" ou "nao esta no seletor da Pagina" — ele esta no seletor; falta o vinculo WABA. Nao substitua por numero Juridico/La Felicita em VISTTA/Ocular.',
  true,
  now()
);
