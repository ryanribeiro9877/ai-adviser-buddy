-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804215729
-- name: drive_plano_filtra_por_tipo_de_midia
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - CONSERTO DE DEFEITO MEU na drive_plano_de_varredura, achado ao preparar o GT-45.
--
-- O QUE ESTAVA ERRADO: 'vistos_em_base_mais_rasa' listava TODA linha que nao estivesse na base
-- pedida. Com duas bases existindo (thumbnail e thumbnail/criterio-v2.4), as 48 imagens ja
-- relidas apareciam DUAS vezes na lista - uma por cada base anterior - e o plano para
-- 'multiquadro+audio' devolvia 115 itens em vez dos 19 videos que interessam.
-- Se o executor obedecesse a lista, reanalisaria 48 imagens com quadros e audio: custo de visao
-- sem ganho nenhum, porque imagem nao tem quadros para extrair.
-- Defeito que so aparece quando existe mais de uma base - ou seja, so a partir de hoje.
--
-- CONSERTO EM DUAS PARTES:
--   (1) DISTINCT por arquivo: uma peca aparece UMA vez, com a base mais completa que ela tem.
--   (2) p_mime_prefixo opcional: quem vai reanalisar video pede 'video', quem vai reanalisar
--       imagem pede 'image'. Metodo diferente exige recorte diferente, e o plano passa a saber.

CREATE OR REPLACE FUNCTION public.drive_plano_de_varredura(
  p_company_id uuid,
  p_base_desejada text DEFAULT 'thumbnail',
  p_mime_prefixo text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pecas AS (
    -- uma linha por ARQUIVO, com as bases que ele ja tem
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
        'folder_id', folder_id, 'nome', nome,
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
    -- AGORA: uma entrada por peca, so as que faltam na base pedida
    'vistos_em_base_mais_rasa', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', drive_file_id, 'm', drive_modified_time,
                                          'nome', nome, 'mime', mime,
                                          'bases_que_ja_tem', bases,
                                          'produto_atual', produto_anterior))
        FROM pecas WHERE NOT tem_a_base), '[]'::jsonb),
    'total_a_reanalisar', (SELECT count(*) FROM pecas WHERE NOT tem_a_base),
    'como_usar', 'Varra CADA pasta de pastas_ativas. PULE o arquivo cuja impressao digital (id + horario de modificacao) esteja em ja_analisados - ele ja foi visto NA BASE QUE VOCE PEDIU. Os de vistos_em_base_mais_rasa devem ser analisados na base pedida: a linha nova nao apaga a antiga, porque base_da_analise faz parte da chave. Use p_mime_prefixo para nao aplicar metodo de video em imagem e vice-versa. Ao terminar cada pasta, chame drive_registrar_varredura.',
    'declare_a_cobertura', 'NUNCA diga que leu "o Drive". Diga quais pastas, quando, e COM O QUE olhou. Ao citar produto detectado, diga a base: "indeterminado por miniatura" e afirmacao muito mais fraca que "indeterminado apos ver o video inteiro". E ATENCAO ao vocabulario: nas 67 primeiras pecas, 17 dos 19 videos ficaram com aproveitavel = "incerto", nao "nao". Incerto e candidato pendente de evidencia, nao descarte - nao os trate como reprovados.'
  );
$$;