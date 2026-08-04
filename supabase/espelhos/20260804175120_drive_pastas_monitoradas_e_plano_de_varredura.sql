-- ESPELHO DE MIGRACAO APLICADA
-- version: 20260804175120
-- name: drive_pastas_monitoradas_e_plano_de_varredura
-- projeto: gzjwnjdpxpbmdhcyefvs (Gestor de Trafego IA)
-- aplicada por: Claude via MCP apply_migration
-- espelho gerado a partir de supabase_migrations.schema_migrations - NAO transcrito a mao

-- 04/08/2026 - COBERTURA DE PASTAS DO DRIVE (item B do plano de 04/08).
--
-- SITUACAO QUE ISSO CORRIGE: o sistema le UMA pasta, cujo id vive no segredo
-- DRIVE_CRIATIVOS_FOLDER_ID. O Ryan cadastrou um e-mail com acesso a 100% das pastas de criativo,
-- mas ACESSO NAO E COBERTURA: por mais amplo que seja o acesso da conta, o codigo continua olhando
-- um unico id. Acrescentar pasta hoje exige mudar segredo e fazer deploy - ou seja, cobertura de
-- criativo depende de deploy, o que e absurdo para algo que muda quando o time de criacao quiser.
--
-- DESENHO: a lista de pastas passa a ser DADO, com dono e data. Acrescentar pasta vira INSERT.
-- E a varredura ganha plano explicito, para o agente nunca dizer "li o Drive" tendo lido uma parte.
--
-- O QUE JA ESTAVA PRONTO E NAO PRECISOU MUDAR: a chave de analise e
-- (drive_file_id, drive_modified_time) com NULLS NOT DISTINCT, entao arquivo novo ou EDITADO gera
-- impressao digital diferente e entra; arquivo intocado e ignorado. A deteccao incremental - a
-- metade dificil de um monitoramento - ja existia.

CREATE TABLE IF NOT EXISTS public.drive_pastas_monitoradas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  folder_id          text NOT NULL,
  nome               text NOT NULL,
  descricao          text,
  ativo              boolean NOT NULL DEFAULT true,
  declarado_por      text NOT NULL,
  declarado_em       date NOT NULL DEFAULT current_date,
  ultima_varredura_em timestamptz,
  pecas_na_ultima_varredura integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_drive_pasta UNIQUE (company_id, folder_id)
);

COMMENT ON TABLE public.drive_pastas_monitoradas IS
  'Pastas do Drive que o sistema varre em busca de criativo. Antes disso a pasta era um segredo de ambiente e acrescentar pasta exigia deploy. Pasta ausente desta tabela NAO e lida - e o agente deve declarar isso em vez de dizer que leu "o Drive".';
COMMENT ON COLUMN public.drive_pastas_monitoradas.ultima_varredura_em IS
  'Preenchida pela rotina de varredura. NULL = nunca varrida. Serve para o agente distinguir "pasta sem peca nova" de "pasta nunca lida".';

ALTER TABLE public.drive_pastas_monitoradas ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_pastas_leitura ON public.drive_pastas_monitoradas
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

-- Semeia com a pasta que hoje vive no segredo, para nada regredir.
INSERT INTO public.drive_pastas_monitoradas
  (company_id, folder_id, nome, descricao, declarado_por, declarado_em, ultima_varredura_em, pecas_na_ultima_varredura)
SELECT id, '1F6dRZcjGa0Vu_dxsZF32YbR6v2m-5KCo', 'Junho e Julho',
       'Pasta unica lida ate 04/08/2026, herdada do segredo DRIVE_CRIATIVOS_FOLDER_ID. Dono no Drive: Joao (joao.motta97). Varrida uma vez, em 31/07/2026: 67 pecas em 14 subpastas.',
       'Ryan', '2026-07-31', '2026-07-31 00:00:00+00', 67
  FROM public.companies WHERE name = 'Legal é Viver'
ON CONFLICT (company_id, folder_id) DO NOTHING;

-- ============================================================
-- PLANO DE VARREDURA: diz a rotina o que varrer e o que JA foi analisado, para ela pular o que
-- nao mudou. Devolve tambem o panorama, para a resposta ao gestor poder declarar cobertura.
-- ============================================================
CREATE OR REPLACE FUNCTION public.drive_plano_de_varredura(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
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
      FROM drive_midia_analises WHERE company_id = p_company_id), '[]'::jsonb),
    'total_ja_analisado', (SELECT count(*) FROM drive_midia_analises WHERE company_id = p_company_id),
    'como_usar', 'Varra CADA pasta de pastas_ativas. Para cada arquivo, monte a impressao digital (id do arquivo + horario de modificacao) e PULE se ela ja estiver em ja_analisados - arquivo intocado nao precisa reanalise. Arquivo novo ou EDITADO tem impressao diferente e deve ser analisado. Ao terminar, grave ultima_varredura_em e a contagem em drive_pastas_monitoradas.',
    'declare_a_cobertura', 'NUNCA diga que leu "o Drive". Diga quais pastas foram varridas e quando. Pasta que nao esta em pastas_ativas NAO e lida por ninguem, e uma peca que exista nela e invisivel para o sistema - declare isso ao gestor se ele perguntar por peca que voce nao encontrou.'
  );
$$;

REVOKE ALL ON FUNCTION public.drive_plano_de_varredura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_plano_de_varredura(uuid) TO authenticated, service_role;

-- Rotina de fechamento da varredura, para a marca nao depender de o codigo lembrar de escrever.
CREATE OR REPLACE FUNCTION public.drive_registrar_varredura(p_company_id uuid, p_folder_id text, p_pecas integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE drive_pastas_monitoradas
     SET ultima_varredura_em = now(), pecas_na_ultima_varredura = p_pecas
   WHERE company_id = p_company_id AND folder_id = p_folder_id;
$$;
REVOKE ALL ON FUNCTION public.drive_registrar_varredura(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drive_registrar_varredura(uuid, text, integer) TO service_role;

-- ============================================================
-- FATO: o acervo lido hoje e majoritariamente de OUTRO produto. Isso importa mais que a rota.
-- ============================================================
INSERT INTO agent_context (categoria, fato, vigente, desde, atualizado, company_id)
VALUES ('lacuna',
  'ACERVO DE CRIATIVO DO DRIVE - COBERTURA E PRODUTO (levantado em 04/08/2026). '
  || 'O QUE FOI LIDO: 67 pecas, em UMA pasta ("Junho e Julho", do Joao), varrida UMA VEZ em 31/07/2026. '
  || '14 subpastas percorridas: Cards, Carrossel 1 a 9, Fixado Cards e Videos com os eixos '
  || '"Caminho Triste" e "Educacao financeira". Texto lido e risco de compliance avaliado nas 67. '
  || 'NAO EXISTE MONITORAMENTO: nenhum dos 13 crons toca no Drive. A analise so roda quando alguem pede '
  || 'pelo chat ou pelo job. Peca que o Joao subir hoje NAO e vista por ninguem ate alguem pedir. '
  || 'ACESSO NAO E COBERTURA: a conta de servico pode ter acesso amplo, mas o sistema le a lista de '
  || 'drive_pastas_monitoradas. Pasta fora dessa lista e invisivel - se o gestor perguntar por uma peca que '
  || 'voce nao achou, declare que ela pode estar em pasta nao monitorada. '
  || 'ACHADO QUE MUDA A CONVERSA: dos 67, apenas SETE mostram consignado CLT nos pixels. O resto: 43 '
  || 'indeterminado, 7 financiamento, 4 abertura de conta, 3 imovel, 3 consorcio. O produto e exclusivo CLT '
  || 'desde 30/07/2026, entao o acervo lido e majoritariamente de OUTROS produtos. Ao propor anuncio a partir '
  || 'deste acervo, DECLARE isso: nao e falha de leitura, e composicao da pasta. E pode significar duas coisas '
  || 'diferentes - peca CLT existe em pasta que ninguem monitora, ou peca CLT nao existe em quantidade. A '
  || 'primeira e problema de cobertura, a segunda e assunto de producao com o Joao. NAO conclua qual sem apurar.',
  true, '2026-08-04', now(), 'ded20b38-f42e-4c71-800c-31b97ea48bcf');