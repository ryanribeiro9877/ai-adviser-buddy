-- Tokens Meta por empresa: isolamento absoluto Legal x COHAPM (21/08/2026).
-- Edges leem META_ADS_TOKEN / META_ADS_TOKEN_COHAPM (e WABA *_COHAPM) via
-- _shared/meta_company_tokens.ts. Sem fallback cruzado.

update public.agent_context
   set vigente = false, atualizado = now()
 where vigente
   and (
     fato ilike '%META_ADS_TOKEN%' and fato ilike '%unico%'
     or fato ilike '%token%global%todas as empresas%'
   );

insert into public.agent_context (categoria, fato, vigente, desde)
values
(
  'doutrina',
  'TOKENS META POR EMPRESA — SEM MISTURA (21/08/2026). Cada empresa tem seu Edge Secret: Legal = META_ADS_TOKEN + WHATSAPP_ACCESS_TOKEN; COHAPM = META_ADS_TOKEN_COHAPM + WHATSAPP_ACCESS_TOKEN_COHAPM (typo ACESS tambem aceito). O company_id da conversa/card/job escolhe o token. E PROIBIDO usar o token da Legal para ler ou escrever ativos da COHAPM e vice-versa. Secret ausente da empresa = falha honesta naquela empresa, nunca emprestar o token da outra. meta_tokens.company_id e o dono do metadado; saude_dos_tokens e get_waba_* ja filtram por company_id da conversa.',
  true,
  date '2026-08-21'
);
