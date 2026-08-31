-- COHAPM Sistema Ocular (pasta Drive VISTTA): terceiro meio, isolado de Jurídico e La Felicità.
-- Espelho: supabase/espelhos/20260831150000_cohapm_sistema_ocular_drive.sql

COMMENT ON COLUMN public.drive_pastas_monitoradas.meio IS
  'Meio/empreendimento dentro da empresa: juridico | la_felicita | sistema_ocular | null (Legal). NUNCA misturar.';

COMMENT ON COLUMN public.drive_midia_analises.meio IS
  'Copia do meio da pasta: juridico | la_felicita | sistema_ocular. Filtro obrigatorio nas respostas do agente.';

COMMENT ON COLUMN public.brand_identity.meio IS
  'Marca/linha dentro da empresa: juridico | la_felicita | sistema_ocular | null (empresa de uma so voz).';

-- Pasta compartilhada com gestor-trafego-drive@… em 31/08/2026 (drive-access-probe).
INSERT INTO public.drive_pastas_monitoradas
  (company_id, folder_id, nome, descricao, meio, declarado_por, declarado_em)
VALUES
  ('57f755b9-c23d-4f58-a488-8173d697c010', '1lxgYBpVI4fF_8rUhsWPhobpSvSN-_tST',
   'COHAPM Sistema Ocular · VISTTA',
   'Acervo Sistema Ocular (pasta Drive "COHAPM - VISTTA", 2026/08. Agosto). Owner: presidentecohapm. NAO misturar com Jurídico, La Felicità nem Legal.',
   'sistema_ocular', 'Ryan', current_date)
ON CONFLICT (company_id, folder_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  meio = EXCLUDED.meio,
  ativo = true;

-- Garantia: pasta Legal NUNCA sob COHAPM
DELETE FROM public.drive_pastas_monitoradas
 WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   AND folder_id = '1F6dRZcjGa0Vu_dxsZF32YbR6v2m-5KCo';

CREATE OR REPLACE FUNCTION public.drive_plano_de_varredura(
  p_company_id uuid,
  p_base_desejada text DEFAULT 'thumbnail'::text,
  p_mime_prefixo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH pecas AS (
    SELECT drive_file_id, drive_modified_time,
           max(nome) AS nome, max(mime) AS mime,
           jsonb_agg(DISTINCT base_da_analise) AS bases,
           bool_or(base_da_analise = p_base_desejada) AS tem_a_base,
           max(produto_detectado) FILTER (WHERE base_da_analise <> p_base_desejada) AS produto_anterior
      FROM drive_midia_analises
     WHERE company_id = p_company_id
       AND (p_mime_prefixo IS NULL OR mime LIKE p_mime_prefixo || '%')
     GROUP BY drive_file_id, drive_modified_time
  )
  SELECT jsonb_build_object(
    'base_desejada', p_base_desejada,
    'filtro_de_midia', coalesce(p_mime_prefixo, 'todos os tipos'),
    'pastas_ativas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'folder_id', folder_id, 'nome', nome, 'meio', meio,
        'ultima_varredura_em', ultima_varredura_em,
        'nunca_varrida', (ultima_varredura_em IS NULL),
        'pecas_na_ultima', pecas_na_ultima_varredura) ORDER BY nome)
      FROM drive_pastas_monitoradas WHERE company_id = p_company_id AND ativo), '[]'::jsonb),
    'pastas_desativadas', coalesce((
      SELECT jsonb_agg(nome ORDER BY nome) FROM drive_pastas_monitoradas
       WHERE company_id = p_company_id AND NOT ativo), '[]'::jsonb),
    'ja_analisados', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', drive_file_id, 'm', drive_modified_time))
        FROM pecas WHERE tem_a_base), '[]'::jsonb),
    'total_na_base_desejada', (SELECT count(*) FROM pecas WHERE tem_a_base),
    'vistos_em_base_mais_rasa', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', drive_file_id, 'm', drive_modified_time,
                                          'nome', nome, 'mime', mime,
                                          'bases_que_ja_tem', bases,
                                          'produto_atual', produto_anterior))
        FROM pecas WHERE NOT tem_a_base), '[]'::jsonb),
    'total_a_reanalisar', (SELECT count(*) FROM pecas WHERE NOT tem_a_base),
    'como_usar', 'Varra CADA pasta de pastas_ativas. Grave pasta_monitorada e meio em cada analise. NUNCA misture meios (juridico x la_felicita x sistema_ocular) nem empresas.',
    'declare_a_cobertura', 'NUNCA diga que leu "o Drive". Diga empresa, meio (Juridico / La Felicita / Sistema Ocular), pastas e quando.'
  );
$function$;

INSERT INTO public.brand_identity
  (company_id, versao, vigente, marca_nome, marca_tag, meio, voz_tom, dos, donts,
   disclaimers_obrigatorios, linhas_produto, identidade_visual, referencias, procedencia)
SELECT
  '57f755b9-c23d-4f58-a488-8173d697c010',
  (SELECT coalesce(max(versao), 0) + 1 FROM public.brand_identity
    WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'),
  true, 'Sistema Ocular', 'VISTTA', 'sistema_ocular',
  jsonb_build_object(
    'tom', 'claro, confiavel e humano; fala de cuidar da visao sem alarmismo nem jargao medico inventado',
    'persona', 'quem busca atendimento ocular de qualidade e quer conhecer o empreendimento Sistema Ocular',
    'pessoa', 'fala com voce (2a pessoa); frases curtas'
  ),
  jsonb_build_array(
    'Abrir pelo cuidado com a visao, acolhimento e clareza do servico',
    'Beneficio concreto sem inventar procedimento, preco, resultado clinico ou especialidade',
    'CTA: conhecer o Sistema Ocular / VISTTA',
    'Isolar desta linha: nao usar copy Juridico nem La Felicità'
  ),
  jsonb_build_array(
    'Copiar voz do nucleo Juridico (conta de luz, cobranca indevida, emprestimo abusivo)',
    'Copiar voz residencial La Felicità (morar bem, condominio, lazer do empreendimento habitacional)',
    'Inventar credito consignado, CLT, CET, margem ou correspondente bancario',
    'Prometer resultado clinico, cura, procedimento ou urgencia falsa de saude'
  ),
  jsonb_build_array(
    'Empreendimento Sistema Ocular / marca VISTTA / COHAPM',
    'Informacoes clinicas e comerciais oficiais no destino do anuncio — nao inventar oferta nem resultado'
  ),
  jsonb_build_array('saude_ocular', 'oftalmologia', 'sistema_ocular', 'vistta'),
  jsonb_build_object(
    'nota', 'Acervo Drive: pasta COHAPM - VISTTA (2026/08. Agosto). NAO e universo Juridico WA nem La Felicità.'
  ),
  jsonb_build_object(
    'page_id_e_instagram', 'ver meta_execution_config (referencias_resolvidas.config)',
    'destino', 'empreendimento Sistema Ocular — sem wa.me do Juridico e sem landing La Felicità'
  ),
  jsonb_build_object(
    'decidido_por', 'gestor / isolamento Juridico vs La Felicita vs Sistema Ocular',
    'decidido_em', '2026-08-31',
    'fonte', 'pasta Drive COHAPM - VISTTA compartilhada com a SA do Gestor',
    'citacao', 'Sistema Ocular e empreendimento de saude ocular (VISTTA); copy propria — sem Juridico nem La Felicità'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.brand_identity
  WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    AND meio = 'sistema_ocular'
    AND vigente
);

UPDATE public.agent_context
   SET fato = 'DRIVE COHAPM: tres meios — juridico (Exports Finais), la_felicita (Jun/Jul/Ago) e sistema_ocular (pasta Drive "COHAPM - VISTTA" = empreendimento Sistema Ocular). Ao falar de criativos, SEMPRE diga o meio. NUNCA misture com Legal (company_id distinto) nem misture Jurídico, La Felicità e Sistema Ocular entre si. Pasta Legal 1F6dRZ… e proibida sob COHAPM.',
       vigente = true
 WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
   AND categoria = 'drive_isolamento'
   AND vigente;

INSERT INTO public.agent_context (company_id, categoria, fato, vigente)
SELECT '57f755b9-c23d-4f58-a488-8173d697c010', 'drive_isolamento',
  'DRIVE COHAPM: tres meios — juridico (Exports Finais), la_felicita (Jun/Jul/Ago) e sistema_ocular (pasta Drive "COHAPM - VISTTA" = empreendimento Sistema Ocular). Ao falar de criativos, SEMPRE diga o meio. NUNCA misture com Legal (company_id distinto) nem misture Jurídico, La Felicità e Sistema Ocular entre si. Pasta Legal 1F6dRZ… e proibida sob COHAPM.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_context
  WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    AND categoria = 'drive_isolamento' AND vigente
);

INSERT INTO public.agent_context (company_id, categoria, fato, vigente)
SELECT '57f755b9-c23d-4f58-a488-8173d697c010', 'drive_sistema_ocular',
  'SISTEMA OCULAR / VISTTA (31/08/2026): acervo no Drive pasta "COHAPM - VISTTA" (folder 1lxgYBpVI4fF_8rUhsWPhobpSvSN-_tST), meio=sistema_ocular. Recorte com get_drive_criativos(meio=sistema_ocular). Nao cite inventario Juridico ou La Felicità como pecas deste empreendimento. Geo de bairros do Juridico NAO se aplica.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_context
  WHERE company_id = '57f755b9-c23d-4f58-a488-8173d697c010'
    AND categoria = 'drive_sistema_ocular' AND vigente
);
