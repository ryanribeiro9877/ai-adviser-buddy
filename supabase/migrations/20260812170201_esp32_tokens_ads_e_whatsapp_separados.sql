-- ESP-32: tokens Ads e WhatsApp nao se substituem.
-- Aplicada como version 20260812170201. Espelho fiel em
-- supabase/espelhos/20260812170201_esp32_tokens_ads_e_whatsapp_separados.sql

update public.agent_context
   set vigente = false, atualizado = now()
 where vigente
   and fato ilike '%META_ADS_TOKEN%WHATSAPP%'
    or (vigente and fato ilike '%fallback%token%WhatsApp%');

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'TOKENS ADS E WHATSAPP SAO SEPARADOS (ESP-32, 12/08/2026). META_ADS_TOKEN serve so Ads (meta-health, meta-actions, upload-midia, etc.). WHATSAPP_ACCESS_TOKEN serve so WABA (waba-sync, waba-template-create, waba-template-replicate). Nao ha fallback cruzado: token ausente = falha honesta com o nome do secret. Probes (waba-probe, meta-identity-probe) podem escolher o token por parametro explicito — isso nao e fallback.',
  true,
  date '2026-08-12'
);
