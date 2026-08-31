-- WhatsApp da Pagina (CTWA): o agente lia so get_waba_status (inventario Cloud/CTWA
-- ja em anuncios) e o create_adset ia com 13 digitos sem phone_number_id. A Meta
-- recusava 1487246 embora o Gerenciador listasse o numero no conjunto.
-- Leitura: get_whatsapp_da_pagina (traffic-chat / job). Escrita: criar_conjunto
-- (meta-actions v5.53) ja resolve o formato Ads e tenta variantes.

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  '57f755b9-c23d-4f58-a488-8173d697c010',
  'whatsapp_pagina',
  'WHATSAPP NO CONJUNTO (31/08/2026). Para habilitar o numero no conjunto (dropdown da Pagina Cohapm no Gerenciador) use get_whatsapp_da_pagina(numero=...). Isso NAO e get_waba_status (Cloud/ON_PREMISE). Pipeboard create_adset e escrita e NAO roda via ler_pipeboard. O caminho e propose_action criar_conjunto_a_partir_de: o executor envia 55+DDD+8 (sem o 9 extra do celular BR) e whats_app_business_phone_number_id quando a API conhece. Se um card ja aprovado falhou com "This WhatsApp phone number is not linked to your account", reexecute — nao diga que falta ferramenta. Nao misture numero Juridico em VISTTA/Sistema Ocular nem em La Felicita.',
  true,
  now()
);
