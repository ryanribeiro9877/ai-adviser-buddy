-- COHAPM: leitura dos Edge Secrets só pelos nomes literais do painel
-- (META_ADS_TOKEN_COHAPM / WHATSAPP_ACCESS_TOKEN_COHAPM). Sem alias ACESS.

update public.agent_context
   set vigente = false,
       atualizado = now()
 where vigente
   and fato ilike '%TOKENS META POR EMPRESA%SEM MISTURA%';

insert into public.agent_context (categoria, fato, vigente, desde)
values
(
  'doutrina',
  'TOKENS META POR EMPRESA — SEM MISTURA (24/08/2026). Nomes literais nos Edge Secrets, sem alias: Legal = META_ADS_TOKEN + WHATSAPP_ACCESS_TOKEN; COHAPM = META_ADS_TOKEN_COHAPM + WHATSAPP_ACCESS_TOKEN_COHAPM. O company_id da conversa/card/job escolhe o token. E PROIBIDO usar o token da Legal para ler ou escrever ativos da COHAPM e vice-versa. Secret ausente da empresa = falha honesta naquela empresa, nunca emprestar o token da outra. meta_tokens.company_id e o dono do metadado.',
  true,
  date '2026-08-24'
);
