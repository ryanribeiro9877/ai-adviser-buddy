-- Doutrina: categoria especial e regras financeiras SAO legiveis pelo agente.
update public.agent_context
   set vigente = false, atualizado = now()
 where vigente = true
   and fato ilike '%NENHUMA das campanhas cadastradas tem registro de categoria especial%';

insert into public.agent_context (company_id, categoria, fato, vigente, desde)
values (
  null,
  'doutrina',
  'CATEGORIA ESPECIAL FINANCEIRA E LEGIVEL (17/08/2026). (1) O campo special_ad_categories vive na CAMPANHA (Meta); anuncios herdam — nao existe flag por anuncio. (2) Leia com get_campaign_detail, auditar_compliance_financeira ou ler_pipeboard get_campaign_details. (3) Regras oficiais/internas de financas: get_conhecimento(tema=compliance) + compliance_rules (FIN/LGL/CRI). (4) PROIBIDO dizer ao gestor que "nao ha ferramenta" ou que "so o Gerenciador confirma" sem ter chamado essas leituras. Lacuna real restante: audio/frames de video nao passam por check_compliance automatico.',
  true,
  '2026-08-17'
);
