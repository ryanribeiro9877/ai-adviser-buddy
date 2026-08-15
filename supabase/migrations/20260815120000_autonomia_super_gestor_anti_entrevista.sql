-- ESPELHO DE MIGRACAO
-- name: autonomia_super_gestor_anti_entrevista
-- data: 2026-08-15
-- efeito: INSERT agent_context (doutrina universal + armadilha Legal)
-- nao altera schema

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'doutrina',
  $fato$
AUTONOMIA DO SUPER GESTOR (15/08/2026, apos incidente criar criativo TESTE RR).
O agente FACILITA a vida do gestor — nao o contrario.

DECIDA E EMITA no card (sem entrevistar o contrato):
- legenda_fonte=agente => preencha legenda_referencias com o anuncio REAL que motivou a copy
  (ex.: o Video10 que sera substituido). O codigo tambem autofill a partir do molde/conjunto.
  NUNCA peca "confirme que a legenda foi baseada no Video10".
- ESP-40: monte marca/canal/objetivo_tag/periodo/produto/rotulo (defaults da casa: LEV/LP/LEADS/CLT/periodo atual).
- Molde: nome EXATO do espelho OU sem_molde=true + drive_file_id do acervo. Inventar molde composto e FALTA GRAVE.
- Plataformas: padrao facebook+instagram; Threads OFF; video no Facebook = sem Coluna da direita.
- Instagram: use o id da meta_execution_config da empresa; nao reabra se ja esta configurado.
- utm_campaign: use o que o gestor deu; se omitiu, derive do rotulo/periodo (o codigo tambem deriva).

SO PERGUNTE decisao de NEGOCIO nao inferivel: orcamento diario quando nao informado; escolha entre
pecas equivalentes ja listadas com veredito.

PROIBIDO: inventar external_id/creative_id/meta_video_id/nome de anuncio; pedir ao gestor para
te ensinar o contrato; montar a solucao em entrevista em vez de emitir o ActionCard pronto.
Humano aprova atos drasticos no card — ele nao monta o pedido por voce.
$fato$,
  true,
  '2026-08-15',
  NULL
);

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'armadilha',
  $fato2$
ARMADILHA 15/08/2026 — CRIAR ANUNCIO TRAVADO POR ENTREVISTA FALSA.
No teste CAMPANHA TESTE AGO26 RR o agente pausou o Video10 corretamente, mas na criacao da peca
nova recusou propose_action 2+ vezes: (1) inventou nome de molde composto; (2) pediu ao humano
para confirmar legenda_referencias. Resultado: zero card de criar_anuncio emitido.
Correcao vigente: autofill de legenda_referencias + defaults ESP-40/plataformas no traffic-chat
v28.27 + doutrina de autonomia. Se voltar a perguntar referencia de legenda ou inventar molde,
e regressao — releia o espelho e reemitir o card completo.
$fato2$,
  true,
  '2026-08-15',
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'
);
