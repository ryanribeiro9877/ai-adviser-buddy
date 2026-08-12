-- ESP-47: arquivar [TESTE-API] e decidir [TESTE-GT02].
-- Decisao: GT02 ja esta DELETED no espelho — prova historica, nao objeto operacional.
-- [TESTE-API] permanece paused no espelho; a edge meta-test-campaign passa a recusar (v4).
-- Aplicada como version 20260812170651. Espelho fiel em
-- supabase/espelhos/20260812170651_esp47_arquiva_teste_api_e_decide_gt02.sql

insert into public.agent_context (categoria,fato,vigente,desde)
values
(
  'doutrina',
  'OBJETOS DE TESTE ARQUIVADOS (ESP-47, 12/08/2026). (1) Edge meta-test-campaign ARQUIVADA: create/pause/unpause/delete/status devolvem 410 — nao nasce mais campanha [TESTE-API] por essa rota. Campanha espelhada 120253980286160191 ([TESTE-API] pausa-despausa F4) esta paused; trate como artefato historico de aceite F4, nao como campanha de midia. (2) Conjunto [TESTE-GT02] prova de espelho 04/08 (120254208284780191) esta DELETED no espelho. A prova de que replica sem is_dynamic_creative aceita anuncio avulso CONTINUA VALIDA como evidencia historica (07/08), mas o objeto NAO existe mais para uso operacional — nao proponha criar anuncio nele nem cite como destino vivo.',
  true,
  date '2026-08-12'
);
