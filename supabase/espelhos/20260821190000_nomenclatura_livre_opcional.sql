-- ESPELHO DE MIGRACAO
-- name: nomenclatura_livre_opcional
-- data: 2026-08-21
-- efeito: doutrina nome livre; contrato nome_partes/papel opcionais; agent_knowledge criacao
-- nao altera schema DDL

-- Nomenclatura livre: nome de campanha/conjunto/anuncio e free-form.
-- Padrao [MARCA][CANAL][OBJ]… vira sugestao opcional (nao obrigatorio).
-- Atualiza doutrina agent_context, contrato_de_execucao e trecho do tema criacao.

-- 1) Revoga doutrinas que forçavam nome composto / partes obrigatorias.
UPDATE public.agent_context
   SET vigente = false
 WHERE categoria = 'doutrina'
   AND vigente = true
   AND (
     fato LIKE 'NOMENCLATURA + PAPEL (ESP-40/39%'
     OR fato LIKE 'NOMENCLATURA COMPOSTA (ESP-40%'
     OR fato LIKE '%AUTONOMIA DO SUPER GESTOR (15/08/2026%'
   );

INSERT INTO public.agent_context (categoria, fato, vigente, desde)
VALUES (
  'doutrina',
  'NOMENCLATURA LIVRE (21/08/2026). O motor de criacao/renomeacao ACEITA string livre '
  || 'arbitrária em nome / nome_novo / novo_nome / target_name — o gestor nomeia como quiser. '
  || 'O padrao estruturado [MARCA][CANAL][OBJ][PROD?][PAPEL?][ROTULO?][PERIODO] e apenas '
  || 'SUGESTAO OPCIONAL (helper), nunca obrigatorio na criacao inicial. Nao recuse nome livre '
  || 'nem force o gestor a montar colchetes. ESP-39 (negocio, nao formato de nome): preferivel '
  || 'testes e vencedores/escala em campanhas SEPARADAS; escalar_duplicar nao deve permanecer '
  || 'em campanha claramente de TESTE — informe campanha_destino ESCALA quando fizer sentido.',
  true,
  date '2026-08-21'
);

INSERT INTO public.agent_context (categoria, fato, vigente, desde, company_id)
VALUES (
  'doutrina',
  $fato$
AUTONOMIA DO SUPER GESTOR (atualizado 21/08/2026 — nomenclatura livre).
O agente FACILITA a vida do gestor — nao o contrario.

DECIDA E EMITA no card (sem entrevistar o contrato):
- legenda_fonte=agente => preencha legenda_referencias com o anuncio REAL que motivou a copy.
  NUNCA peca "confirme que a legenda foi baseada no Video10".
- NOME: use a string que o gestor pediu (livre). Padrao [MARCA][CANAL]… so se ele pedir
  ou como sugestao opcional — nunca obrigue.
- Molde: nome EXATO do espelho OU sem_molde=true + drive_file_id do acervo. Inventar molde e FALTA GRAVE.
- Plataformas: padrao facebook+instagram; Threads OFF; video no Facebook = sem Coluna da direita.
- Instagram: use o id da meta_execution_config da empresa.
- utm_campaign: use o que o gestor deu; se omitiu, derive do nome/rotulo/periodo.

SO PERGUNTE decisao de NEGOCIO nao inferivel: orcamento diario quando nao informado; escolha entre
pecas equivalentes ja listadas com veredito.

PROIBIDO: inventar external_id/creative_id/meta_video_id/nome de anuncio-molde; pedir ao gestor
para montar nome em colchetes; montar a solucao em entrevista em vez de emitir o ActionCard pronto.
$fato$,
  true,
  date '2026-08-21',
  NULL
);

-- 2) Contrato: nome_partes e papel deixam de ser obrigatorios; nome_novo permanece.
UPDATE public.contrato_de_execucao
   SET obrigatorio = false,
       observacao = 'OPCIONAL: metadado/sugestao estruturada. Nome livre (nome_novo) e a fonte da verdade.'
 WHERE vigente = true
   AND campo = 'nome_partes'
   AND acao IN (
     'criar_campanha',
     'criar_conjunto_a_partir_de',
     'criar_anuncio_a_partir_de',
     'renomear_campanha'
   );

UPDATE public.contrato_de_execucao
   SET obrigatorio = false,
       observacao = 'OPCIONAL (negocio ESP-39). Nao forca formato do nome. Aceito na raiz OU em nome_partes.papel.'
 WHERE vigente = true
   AND campo = 'papel'
   AND acao IN ('criar_campanha', 'renomear_campanha');

UPDATE public.contrato_de_execucao
   SET observacao = 'Nome livre do objeto que nasce (string arbitraria). Padrao [MARCA]… e so sugestao.'
 WHERE vigente = true
   AND campo = 'nome_novo'
   AND acao IN (
     'criar_campanha',
     'criar_conjunto_a_partir_de',
     'criar_anuncio_a_partir_de',
     'escalar_duplicar'
   );

-- Garante campo novo_nome em renomear como obrigatorio livre (se ainda nao existir).
INSERT INTO public.contrato_de_execucao
  (acao, campo, obrigatorio, tipo, observacao, fonte, vigente, suportado, valores_aceitos)
SELECT
  'renomear_campanha', 'novo_nome', true, 'text',
  'Nome livre desejado apos renomear. String arbitraria aceita.',
  'traffic-chat + meta-actions', true, true, null
WHERE NOT EXISTS (
  SELECT 1 FROM public.contrato_de_execucao
   WHERE acao = 'renomear_campanha' AND campo = 'novo_nome' AND vigente = true
);

-- 3) Tema criacao: secao 5 — nome livre (regex UTF-8).
UPDATE public.agent_knowledge
   SET conteudo = regexp_replace(
     conteudo,
     'Padrão de nome: `\[MARCA\]\[DESTINO\]\[OBJETIVO\]\[DATA\]`[^\n]+',
     E'Nome e LIVRE: o gestor/agente pode usar qualquer string em campanha/conjunto/anúncio. O padrão `[MARCA][CANAL][OBJ][PROD?][PAPEL?][ROTULO?][PERIODO]` (ex.: `[LEV][LP][LEADS][CLT][TESTE][AGO26]`) é apenas SUGESTÃO OPCIONAL de governança — nunca bloqueia criação.',
     'n'
   ),
       updated_at = now()
 WHERE tema = 'criacao'
   AND vigente = true
   AND conteudo ~ 'Padrão de nome:';
