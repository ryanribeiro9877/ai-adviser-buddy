-- Doutrina: pegada (organico x conversao) e destino (numero de WhatsApp do anuncio) sao
-- LEGIVEIS na config coletada, distintos da analitica WABA pos-clique (congelada).
insert into public.agent_context(categoria, fato, vigente, desde, company_id)
select
  'midia',
  'PEGADA E DESTINO SAO LEGIVEIS NA CONFIG (14/08/2026). optimization_goal do conjunto DEFINE a pegada: eventos de engajamento/alcance/thruplay/link_clicks/landing_page_view = pegada ORGANICA/topo; CONVERSATIONS ou destination_type WHATSAPP/MESSENGER = pegada de CONVERSA. Quando o criativo aponta para wa.me/api.whatsapp mas o conjunto otimiza por LINK_CLICKS, a pegada e trafego_para_whatsapp_nao_otimizado: a peca leva ao WhatsApp porem a Meta entrega por clique barato, nao por quem inicia conversa. O NUMERO DE WHATSAPP DE DESTINO do anuncio vem do link do CTA (destino_url em get_criativos_conteudo e numeros_whatsapp em get_estrutura_conjuntos) e E CONFIG do anuncio - deve ser informado quando perguntado. Isso NAO se confunde com a analitica de conversa/mensagens WABA (pos-clique), que permanece fora de escopo: uma coisa e para ONDE o anuncio manda (legivel), outra e o que acontece na conversa depois (congelado).',
  true,
  current_date,
  null
where not exists (
  select 1 from public.agent_context
  where vigente is true and company_id is null
    and fato ilike 'PEGADA E DESTINO SAO LEGIVEIS NA CONFIG%'
);
