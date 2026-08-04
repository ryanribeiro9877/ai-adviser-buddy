-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804185957
-- name: drive_chave_inclui_base_da_analise
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - Destrava a REANALISE mais profunda das pecas do Drive.
--
-- BLOQUEIO: as 67 pecas foram julgadas com base_da_analise = 'thumbnail' - UM QUADRO. Resultado:
-- 89% dos videos (17 de 19) e 54% das imagens vieram "indeterminado". O agente olhou um quadro e
-- disse honestamente que nao sabia. O Roberto AUTORIZOU em 03/08 reclassificar por audio mais
-- varios quadros, e nunca foi executado - porque a chave unica era (drive_file_id,
-- drive_modified_time) e o arquivo nao muda numa reanalise: o incremental que economiza custo era
-- o que impedia analisar melhor. Risco levantado na primeira auditoria deste projeto ("a chave tem
-- versao de arquivo, nao versao de critério") e agora mordendo de fato.
--
-- CONSERTO: base_da_analise entra na chave. Reanalise com base diferente cria linha NOVA e o
-- veredito antigo PERMANECE - duas camadas, nunca sobrescrita.
-- NOTA: era CONSTRAINT sustentando o indice, nao indice solto - por isso o DROP CONSTRAINT.

ALTER TABLE public.drive_midia_analises ALTER COLUMN base_da_analise SET DEFAULT 'thumbnail';
UPDATE public.drive_midia_analises SET base_da_analise = 'thumbnail' WHERE base_da_analise IS NULL;
ALTER TABLE public.drive_midia_analises ALTER COLUMN base_da_analise SET NOT NULL;

ALTER TABLE public.drive_midia_analises DROP CONSTRAINT uq_drive_analise;
ALTER TABLE public.drive_midia_analises
  ADD CONSTRAINT uq_drive_analise UNIQUE NULLS NOT DISTINCT
  (drive_file_id, drive_modified_time, base_da_analise);

COMMENT ON COLUMN public.drive_midia_analises.base_da_analise IS
  'COM O QUE o agente olhou a peca: "thumbnail" = um unico quadro (foi assim nas 67 primeiras, e e a razao de 89% dos videos terem vindo indeterminados); "multiquadro+audio" = analise profunda autorizada pelo Roberto em 03/08. FAZ PARTE DA CHAVE: reanalise com base diferente NAO sobrescreve o veredito antigo, cria linha nova. Ao citar veredito, diga com o que ele foi produzido.';

CREATE OR REPLACE FUNCTION public.drive_plano_de_varredura(
  p_company_id uuid,
  p_base_desejada text DEFAULT 'thumbnail'
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'base_desejada', p_base_desejada,
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
      FROM drive_midia_analises
       WHERE company_id = p_company_id AND base_da_analise = p_base_desejada), '[]'::jsonb),
    'total_na_base_desejada', (SELECT count(*) FROM drive_midia_analises
       WHERE company_id = p_company_id AND base_da_analise = p_base_desejada),
    'vistos_em_base_mais_rasa', coalesce((
      SELECT jsonb_agg(jsonb_build_object('f', d.drive_file_id, 'm', d.drive_modified_time,
                                          'nome', d.nome, 'base_atual', d.base_da_analise,
                                          'produto_atual', d.produto_detectado))
      FROM drive_midia_analises d
       WHERE d.company_id = p_company_id AND d.base_da_analise <> p_base_desejada
         AND NOT EXISTS (SELECT 1 FROM drive_midia_analises d2
                          WHERE d2.drive_file_id = d.drive_file_id
                            AND d2.drive_modified_time = d.drive_modified_time
                            AND d2.base_da_analise = p_base_desejada)), '[]'::jsonb),
    'como_usar', 'Varra CADA pasta de pastas_ativas. PULE o arquivo cuja impressao digital (id + horario de modificacao) esteja em ja_analisados - ele ja foi visto NA BASE QUE VOCE PEDIU. Os de vistos_em_base_mais_rasa foram vistos de forma menos completa e DEVEM ser reanalisados na base pedida: a linha nova nao apaga a antiga, porque base_da_analise faz parte da chave. Ao terminar cada pasta, chame drive_registrar_varredura.',
    'declare_a_cobertura', 'NUNCA diga que leu "o Drive". Diga quais pastas, quando, e COM O QUE olhou. Veredito de produto feito so com miniatura e um quadro deixou 89% dos videos indeterminados nas 67 primeiras pecas. Ao citar produto detectado, diga a base - "indeterminado por miniatura" e afirmacao muito mais fraca que "indeterminado apos ver o video inteiro".'
  );
$$;

INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('armadilha',
  'VEREDITO DE PECA TEM BASE - "INDETERMINADO" PODE SER LIMITE DA ANALISE, NAO DA PECA (04/08/2026). '
  || 'As 67 pecas analisadas em 31/07 foram julgadas com base_da_analise = "thumbnail": UMA miniatura, e '
  || 'para video UM QUADRO de um video inteiro. Resultado: 17 dos 19 videos (89%) e 26 das 48 imagens (54%) '
  || 'voltaram com produto_detectado = "indeterminado". '
  || 'ISSO NAO E FALHA DO AGENTE nem ausencia de produto na peca: e o que da para ver num quadro. Ao citar '
  || 'produto detectado, DIGA A BASE - "indeterminado por miniatura" e afirmacao muito mais fraca que '
  || '"indeterminado apos ver o video inteiro com audio". '
  || 'O gestor Roberto AUTORIZOU em 03/08 a reanalise por audio mais varios quadros. Desde 04/08 a chave de '
  || 'analise inclui base_da_analise, entao a reanalise profunda CRIA LINHA NOVA e o veredito antigo '
  || 'permanece - duas camadas, nunca sobrescrita. Havendo duas leituras da mesma peca, use a mais completa '
  || 'e declare a mudanca de veredito, se houver.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');