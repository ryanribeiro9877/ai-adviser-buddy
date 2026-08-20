-- Liberacao FIN-04 (22/23/25/26/27) + carrossel suportado (20/08/2026).
-- Decisao do gestor: pecas liberadas como estao; CET mora na LEGENDA (FIN-04 v3).
-- Carrossel: contrato passa a aceitar child_attachments (2-10 slides com image_hash).

-- 1) Liberar as 5 pecas FIN-04
update public.pecas_em_revisao
   set bloqueia_uso = false,
       veredito = 'liberado_como_esta',
       veredito_em = current_date,
       veredito_por = 'Gestor (aprovacao explicita no chat Cursor, 20/08/2026)',
       veredito_nota = 'Liberado como esta sob FIN-04 v3: CET obrigatorio na LEGENDA DA PUBLICACAO, nao dentro do video. Peças 22/23/25/26/27 aptas a uso com legenda que traga CET + ressalva.'
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and regra_code = 'FIN-04'
   and bloqueia_uso is true
   and nome in (
     '22. Vídeo - Julho.mp4',
     '23. Vídeo - Julho.mp4',
     '25. Vídeo - Julho.mp4',
     '26. Vídeo - Julho.mp4',
     '27. Vídeo - Julho.mp4'
   );

-- 2) Contrato: carrossel passa a ser suportado
update public.contrato_de_execucao
   set suportado = true,
       recusa_nomeada = null,
       mensagem_de_recusa = null,
       observacao = coalesce(observacao,'') || ' | 20/08/2026: child_attachments HABILITADO. 2-10 cards com image_hash+link cada; mutual exclusive com meta_video_id e meta_image_hash avulso. Executora monta link_data.child_attachments (Graph).'
 where acao = 'criar_anuncio_a_partir_de'
   and campo = 'child_attachments';

-- 3) Memoria do agente: pecas liberadas + carrossel habilitado
update public.agent_context
   set vigente = false
 where company_id = 'ded20b38-f42e-4c71-800c-31b97ea48bcf'
   and vigente
   and (
     fato like 'LEITURA TOTAL DO ACERVO (19/08/2026):%'
     or fato like 'TAXONOMIA DO DRIVE LEV (19/08/2026%'
     or fato ilike '%FIN-04%bloquead%'
     or fato ilike '%carrossel%nao montado%'
     or fato ilike '%Carrossel continua recusado%'
   );

insert into public.agent_context (company_id, categoria, fato, vigente)
values
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'VIDEOS 22/23/25/26/27 LIBERADOS (20/08/2026): veredito liberado_como_esta sob FIN-04 v3. NAO diga que estao bloqueados. Estao APTOS a uso. Condicao de publicacao: a LEGENDA DA PUBLICACAO deve trazer CET + ressalva (taxa a partir de / sujeito a analise de credito e margem). O numero na tela do video NAO reprova a peca. Video 24 continua o vencedor ja usado — evite repetir se o gestor pedir peca nova.',
  true
),
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'CARROSSEL HABILITADO (20/08/2026): criar_anuncio_a_partir_de ACEITA child_attachments (2 a 10 slides). Cada slide: image_hash (ja na biblioteca Meta via upload_midia) + link. NAO use meta_image_hash avulso nem meta_video_id no mesmo pedido. Formato = carrossel Meta real (link_data.child_attachments), nao imagem estatica solta. Pastas Carrossel 1..9 do Drive fornecem os slides. Declare no card o grupo (ex. Carrossel 3) e os hashes de cada slide.',
  true
),
(
  'ded20b38-f42e-4c71-800c-31b97ea48bcf'::uuid,
  'criacao',
  'LEITURA TOTAL DO ACERVO (atualizado 20/08/2026): taxonomia_drive + inventario_global. 19 videos (10 Educacao financeira + 9 Caminho Triste/feliz); Capas; 9 Carrosseis (agora montaveis como formato carrossel); 4 Cards instrucionais. Videos 22/23/25/26/27 LIBERADOS (nao bloqueados). Em lote/mix cite taxonomia completa antes de filtrar por produto.',
  true
);
